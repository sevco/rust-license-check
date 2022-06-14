import * as process from 'process';
import * as os from 'os';

import * as core from '@actions/core';
import * as github from '@actions/github';

import { Cargo } from '@actions-rs/core';

import * as input from './input';
import * as interfaces from './interfaces';
import * as reporter from './reporter';

const pkg = require('../package.json'); // eslint-disable-line @typescript-eslint/no-var-requires

const USER_AGENT = `${pkg.name}/${pkg.version} (${pkg.bugs.url})`;

async function getData(): Promise<interfaces.Dependency[]> {
    const cargo = await Cargo.get();
    await cargo.findOrInstall('cargo-license');

    await cargo.call(['generate-lockfile']);

    let stdout = '';
    try {
        core.startGroup('Calling cargo-license (JSON output)');
        await cargo.call(
            ['license', '--json', '--all-features', '--do-not-bundle'],
            {
                ignoreReturnCode: true,
                listeners: {
                    stdout: (buffer) => {
                        stdout += buffer.toString();
                    },
                },
            },
        );
    } finally {
        // Cool story: `cargo-license` JSON output is missing the trailing `\n`,
        // so the `::endgroup::` annotation from the line below is being
        // eaten by it.
        // Manually writing the `\n` to denote the `cargo-audit` end
        process.stdout.write(os.EOL);
        core.endGroup();
    }

    return JSON.parse(stdout);
}

export async function run(actionInput: input.Input): Promise<void> {
    const report = await getData();
    let shouldReport = false;

    // In `cargo-audit < 0.12` report contained an array of `Warning`.
    // In `cargo-audit >= 0.12` it is a JSON object,
    // where key is a warning type, and value is an array of `Warning` of that type.
    const warnings: Array<interfaces.Dependency> = [];
    for (const dep of report) {
        actionInput.licenses.forEach(function (license) {
            if (dep.license !== undefined && dep.license.includes(license)) {
                warnings.push(dep);
            }
        });
    }
    if (warnings.length === 0) {
        core.info('No warnings were found');
    } else {
        core.warning(`${warnings.length} warnings found!`);
        shouldReport = true;
    }

    if (!shouldReport) {
        return;
    }

    const client = new github.GitHub(actionInput.token, {
        userAgent: USER_AGENT,
    });
    if (github.context.eventName == 'schedule') {
        core.debug(
            'Action was triggered on a schedule event, creating an Issues report',
        );
        await reporter.reportIssues(client, warnings);
    } else {
        core.debug(
            `Action was triggered on a ${github.context.eventName} event, creating a Check report`,
        );
        await reporter.reportCheck(client, warnings);
    }
}

async function main(): Promise<void> {
    try {
        const actionInput = input.get();
        await run(actionInput);
    } catch (error) {
        core.setFailed(error.message);
    }

    return;
}

main();
