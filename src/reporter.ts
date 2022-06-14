import * as process from 'process';

import * as core from '@actions/core';
import * as github from '@actions/github';
import * as nunjucks from 'nunjucks';

import { checks } from '@actions-rs/core';
import * as interfaces from './interfaces';
import * as templates from './templates';

nunjucks.configure({
    trimBlocks: true,
    lstripBlocks: true,
});

function makeReport(warnings: Array<interfaces.Dependency>): string {
    return nunjucks.renderString(templates.REPORT, {
        warnings: warnings,
    });
}

export function plural(value: number, suffix = 's'): string {
    return value == 1 ? '' : suffix;
}

function getStats(warnings: Array<interfaces.Dependency>): Map<string, number> {
    const licenses = new Map<string, number>();
    for (const dep of warnings) {
        if (dep.license !== undefined) {
            let c = licenses.get(dep.license) || 0;
            c += 1;
            licenses.set(dep.license, c);
        }
    }

    return licenses;
}

function getSummary(stats: Map<string, number>): string {
    const blocks: string[] = [];

    stats.forEach(function (v, k) {
        blocks.push(`${k} ${v} violations`);
    });

    return blocks.join(', ');
}

/// Create and publish audit results into the Commit Check.
export async function reportCheck(
    client: github.GitHub,
    warnings: Array<interfaces.Dependency>,
): Promise<void> {
    const reporter = new checks.CheckReporter(client, 'License audit');
    const stats = getStats(warnings);
    const summary = getSummary(stats);

    core.info(`Found ${summary}`);

    try {
        await reporter.startCheck('queued');
    } catch (error) {
        // `GITHUB_HEAD_REF` is set only for forked repos,
        // so we can check if it is a fork and not a base repo.
        if (process.env.GITHUB_HEAD_REF) {
            core.error(`Unable to publish license check! Reason: ${error}`);
            core.warning(
                'It seems that this Action is executed from the forked repository.',
            );
            core.warning(`GitHub Actions are not allowed to use Check API, \
when executed for a forked repos. \
See https://github.com/actions-rs/clippy-check/issues/2 for details.`);
            core.info('Posting audit report here instead.');

            core.info(makeReport(warnings));
            if (warnings.length > 0) {
                throw new Error(
                    'License violations were found, marking check as failed',
                );
            } else {
                core.info(
                    'No critical violations were found, not marking check as failed',
                );
                return;
            }
        }

        throw error;
    }

    try {
        const body = makeReport(warnings);
        const output = {
            title: 'License advisories found',
            summary: summary,
            text: body,
        };
        const status = warnings.length > 0 ? 'failure' : 'success';
        await reporter.finishCheck(status, output);
    } catch (error) {
        await reporter.cancelCheck();
        throw error;
    }

    if (warnings.length > 0) {
        throw new Error(
            'License violations were found, marking check as failed',
        );
    } else {
        core.info(
            'No license violations were found, not marking check as failed',
        );
        return;
    }
}

async function alreadyReported(
    client: github.GitHub,
    dependencyName: string,
): Promise<boolean> {
    const { owner, repo } = github.context.repo;
    const results = await client.search.issuesAndPullRequests({
        q: `${dependencyName} in:title repo:${owner}/${repo}`,
        per_page: 1, // eslint-disable-line @typescript-eslint/camelcase
    });

    if (results.data.total_count > 0) {
        core.info(
            `Seems like ${dependencyName} is mentioned already in the issues/PRs, \
will not report an issue against it`,
        );
        return true;
    } else {
        return false;
    }
}

export async function reportIssues(
    client: github.GitHub,
    warnings: Array<interfaces.Dependency>,
): Promise<void> {
    const { owner, repo } = github.context.repo;

    for (const dep of warnings) {
        const reported = await alreadyReported(client, dep.name);
        if (reported) {
            continue;
        }

        const body = nunjucks.renderString(templates.LICENSE_ISSUE, {
            vulnerability: dep,
        });
        const issue = await client.issues.create({
            owner: owner,
            repo: repo,
            title: `License violation on ${dep.name}: ${dep.license}`,
            body: body,
        });
        core.info(`Created an issue for ${dep.name}: ${issue.data.html_url}`);
    }
}
