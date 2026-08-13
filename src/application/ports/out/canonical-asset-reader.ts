/**
 * Outbound port for a content-addressed canonical engineering asset.
 *
 * The application names only the expected SHA-256 digest. Filesystem layout,
 * integrity errors and storage mechanics belong to the concrete adapter.
 */
export interface CanonicalAssetReader {
  read(digest: string): Promise<Uint8Array>;
}
