/**
 * These types should match to what `cargo-audit` outputs in a JSON format.
 *
 * See `rustsec` crate for structs used for serialization.
 */

export interface Dependency {
    name: string;
    version: string;
    authors: string;
    repository: undefined | string;
    description: undefined | string;
    license_file: undefined | string;
    license: undefined | string;
}
