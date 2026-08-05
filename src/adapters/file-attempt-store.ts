/**
 * Shared filesystem abstraction for write-ahead attempt journals.
 *
 * Three WAL stores (syson-model-seed, oracle-requirements-seed,
 * sensitivity-relations) use the same durable-write pattern. This module
 * extracts the injectable filesystem interface so tests can provide a
 * deterministic stub without touching Deno.* I/O directly.
 */

export interface DurableAttemptFile {
  write(data: Uint8Array): Promise<number>;
  syncData(): Promise<void>;
  sync(): Promise<void>;
  close(): void;
}

export interface AttemptFileSystem {
  mkdir(path: string): Promise<void>;
  open(path: string, options: Deno.OpenOptions): Promise<DurableAttemptFile>;
  readTextFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
}

export const DENO_FILE_SYSTEM: AttemptFileSystem = {
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  open: (path, options) => Deno.open(path, options),
  readTextFile: (path) => Deno.readTextFile(path),
  rename: (from, to) => Deno.rename(from, to),
};
