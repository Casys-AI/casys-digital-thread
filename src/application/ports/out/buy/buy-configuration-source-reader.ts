/** Reopen one agent-resource configuration proposal by exact URI and digest. */

export interface BuyConfigurationSourceReader {
  read(uri: string, digest: string): Promise<string | undefined>;
}
