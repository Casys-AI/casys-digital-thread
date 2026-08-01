/** Browser-safe presentation asset lookup. */
export interface EngineeringAssetReader {
  read(filename: string): Promise<Uint8Array | undefined>;
}

/** Resolve assets in order: active local output first, versioned baseline second. */
export class OrderedEngineeringAssetReader implements EngineeringAssetReader {
  constructor(private readonly readers: readonly EngineeringAssetReader[]) {
    if (readers.length === 0) {
      throw new TypeError("At least one engineering asset reader is required.");
    }
  }

  async read(filename: string): Promise<Uint8Array | undefined> {
    safeAssetFilename(filename);
    for (const reader of this.readers) {
      const bytes = await reader.read(filename);
      if (bytes) return Uint8Array.from(bytes);
    }
    return undefined;
  }
}

export interface EngineeringAssetFileIo {
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
}

const DENO_FILE_IO: EngineeringAssetFileIo = {
  readFile: (path) => Deno.readFile(path),
  readTextFile: (path) => Deno.readTextFile(path),
};

/** Exact binary assets emitted by the active local engineering run. */
export class FileEngineeringAssetReader implements EngineeringAssetReader {
  constructor(
    private readonly directory: string,
    private readonly io: EngineeringAssetFileIo = DENO_FILE_IO,
  ) {}

  async read(filename: string): Promise<Uint8Array | undefined> {
    safeAssetFilename(filename);
    try {
      return Uint8Array.from(
        await this.io.readFile(joinPath(this.directory, filename)),
      );
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}

/**
 * Lossless text transport for a checked-in binary baseline. The decoded bytes
 * are the observed STL bytes; no geometry conversion occurs at read time.
 */
export class Base64EngineeringAssetReader implements EngineeringAssetReader {
  constructor(
    private readonly directory: string,
    private readonly io: EngineeringAssetFileIo = DENO_FILE_IO,
  ) {}

  async read(filename: string): Promise<Uint8Array | undefined> {
    safeAssetFilename(filename);
    try {
      const encoded = await this.io.readTextFile(
        joinPath(this.directory, `${filename}.base64`),
      );
      return Uint8Array.fromBase64(encoded.replaceAll(/\s/g, ""));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}

function safeAssetFilename(filename: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    throw new TypeError("Engineering asset filename is not safe.");
  }
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/\/$/, "")}/${name}`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}
