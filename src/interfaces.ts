/**
 * These types should match to what `cargo-audit` outputs in a JSON format.
 *
 * See `rustsec` crate for structs used for serialization.
 */

export interface Dependency {
    name: string;
    version: string;
    authors: string;
    repository?: string;
    description?: string;
    license_file?: string;
    license?: string;
}
