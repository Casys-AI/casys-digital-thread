import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  fingerprintResourceBytes,
  type ImmutableBytes,
  immutableBytes,
  sha256Hex,
} from "../../../domain/compile/source/provider-resource-reader.ts";

const SAFE_KIND = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SAFE_URI_NAMESPACE = /^[a-z0-9][a-z0-9.-]{0,62}$/;

export interface ByteStoreDescriptor<Kind extends string> {
  readonly kind: Kind;
  readonly directory: string;
  readonly uriNamespace: string;
  readonly label: string;
}

const VERIFIED_STORED_BYTES_TOKEN = Symbol("verified-stored-bytes");
const VERIFIED_STORED_BYTES_INSTANCES = new WeakSet<object>();

/**
 * Opaque receipt issued only after FileByteStore has reopened and verified the
 * atomically published object. The private module token prevents callers from
 * manufacturing a receipt from an arbitrary CAS URI.
 */
export class VerifiedStoredBytes<Kind extends string> {
  readonly #bytes: Uint8Array;
  readonly kind: Kind;
  readonly uri: string;
  /** Store namespace used to issue `uri`; never caller supplied. */
  readonly uriNamespace: string;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly verification = "reread-after-atomic-publication" as const;

  constructor(
    token: symbol,
    value: {
      kind: Kind;
      uri: string;
      uriNamespace: string;
      fingerprint: ContentFingerprint;
      byteCount: number;
      bytes: Uint8Array;
    },
  ) {
    if (token !== VERIFIED_STORED_BYTES_TOKEN) {
      throw new TypeError("VerifiedStoredBytes can only be issued by FileByteStore.");
    }
    this.kind = value.kind;
    this.uri = value.uri;
    this.uriNamespace = value.uriNamespace;
    this.fingerprint = Object.freeze({ ...value.fingerprint });
    this.byteCount = value.byteCount;
    this.#bytes = Uint8Array.from(value.bytes);
    VERIFIED_STORED_BYTES_INSTANCES.add(this);
    Object.freeze(this);
  }

  copyBytes(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

const VERIFIED_STORED_BYTES_COPY = VerifiedStoredBytes.prototype.copyBytes;

export function isVerifiedStoredBytes(
  value: unknown,
): value is VerifiedStoredBytes<string> {
  return typeof value === "object" && value !== null &&
    VERIFIED_STORED_BYTES_INSTANCES.has(value) &&
    (value as { copyBytes?: unknown }).copyBytes === VERIFIED_STORED_BYTES_COPY;
}

export interface FileByteStoreSeams {
  /** Test seam for proving that write-all handles partial writes. */
  readonly writeChunk?: (
    file: Deno.FsFile,
    remaining: Uint8Array,
  ) => Promise<number>;
  /** Test seam for observing or faulting the directory durability boundary. */
  readonly syncDirectory?: (directory: string) => Promise<void>;
}

export class ByteStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ByteStoreIntegrityError";
  }
}

/**
 * Filesystem content-addressed byte store.
 *
 * Caller-controlled values never become paths: the only filename is a
 * validated lowercase SHA-256 digest, under the descriptor's fixed directory.
 * Publication uses link(2), so an existing CAS object is never overwritten.
 */
export class FileByteStore<Kind extends string> {
  readonly #descriptor: ByteStoreDescriptor<Kind>;
  readonly #writeChunk: NonNullable<FileByteStoreSeams["writeChunk"]>;
  readonly #syncDirectory: NonNullable<FileByteStoreSeams["syncDirectory"]>;

  constructor(
    descriptor: ByteStoreDescriptor<Kind>,
    seams: FileByteStoreSeams = {},
  ) {
    if (!SAFE_KIND.test(descriptor.kind)) {
      throw new TypeError("Byte store kind must be a safe lowercase identifier.");
    }
    if (!SAFE_URI_NAMESPACE.test(descriptor.uriNamespace)) {
      throw new TypeError("Byte store URI namespace must be a safe lowercase host.");
    }
    if (
      descriptor.directory.length === 0 ||
      descriptor.directory !== descriptor.directory.trim() ||
      descriptor.directory.includes("\0") ||
      descriptor.directory === "/"
    ) {
      throw new TypeError("Byte store directory must be a bounded directory path.");
    }
    if (
      descriptor.label.length === 0 || descriptor.label !== descriptor.label.trim()
    ) {
      throw new TypeError("Byte store label must be non-empty.");
    }
    this.#descriptor = Object.freeze({ ...descriptor });
    this.#writeChunk = seams.writeChunk ?? ((file, bytes) => file.write(bytes));
    this.#syncDirectory = seams.syncDirectory ?? syncDirectory;
  }

  uriFor(fingerprint: ContentFingerprint): string {
    const digest = fingerprintDigest(fingerprint);
    return `casys://${this.#descriptor.uriNamespace}/sha256/${digest}`;
  }

  async save(
    fingerprint: ContentFingerprint,
    source: Uint8Array,
  ): Promise<VerifiedStoredBytes<Kind>> {
    const digest = fingerprintDigest(fingerprint);
    const bytes = Uint8Array.from(source);
    const actual = await fingerprintResourceBytes(bytes);
    if (actual !== digest) {
      throw new ByteStoreIntegrityError(
        `${this.#descriptor.label} bytes do not match sha256 ${digest}.`,
      );
    }

    await Deno.mkdir(this.#descriptor.directory, { recursive: true });
    const finalPath = this.#pathForDigest(digest);
    try {
      await this.#writeNew(finalPath, bytes);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    // A receipt attests a durable directory entry whether this invocation won
    // the link race or observed the already-published CAS object.
    await this.#syncDirectory(this.#descriptor.directory);

    const reread = await this.#readRequired(digest);
    if (reread.byteLength !== bytes.byteLength || !bytesEqual(reread, bytes)) {
      throw new ByteStoreIntegrityError(
        `${this.#descriptor.label} sha256 collision or divergent existing object.`,
      );
    }
    return new VerifiedStoredBytes(VERIFIED_STORED_BYTES_TOKEN, {
      kind: this.#descriptor.kind,
      uri: this.uriFor(fingerprint),
      uriNamespace: this.#descriptor.uriNamespace,
      fingerprint: { algorithm: "sha256", digest },
      byteCount: reread.byteLength,
      bytes: reread,
    });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<ImmutableBytes | undefined> {
    const digest = fingerprintDigest(fingerprint);
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(this.#pathForDigest(digest));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    await assertDigest(bytes, digest, this.#descriptor.label);
    return immutableBytes(bytes);
  }

  async #readRequired(digest: string): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(this.#pathForDigest(digest));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new ByteStoreIntegrityError(
          `${this.#descriptor.label} object disappeared after publication.`,
        );
      }
      throw error;
    }
    await assertDigest(bytes, digest, this.#descriptor.label);
    return bytes;
  }

  #pathForDigest(digest: string): string {
    return `${this.#descriptor.directory.replace(/\/+$/, "")}/${digest}`;
  }

  async #writeNew(path: string, bytes: Uint8Array): Promise<void> {
    const parent = path.slice(0, path.lastIndexOf("/"));
    const temporary = `${parent}/.${crypto.randomUUID()}.tmp`;
    try {
      const file = await Deno.open(temporary, { createNew: true, write: true });
      try {
        let written = 0;
        while (written < bytes.byteLength) {
          const count = await this.#writeChunk(file, bytes.subarray(written));
          if (!Number.isSafeInteger(count) || count < 1) {
            throw new ByteStoreIntegrityError(
              `${this.#descriptor.label} object made no write progress.`,
            );
          }
          if (count > bytes.byteLength - written) {
            throw new ByteStoreIntegrityError(
              `${this.#descriptor.label} write seam reported too many bytes.`,
            );
          }
          written += count;
        }
        await file.syncData();
      } finally {
        file.close();
      }
      await Deno.link(temporary, path);
    } finally {
      await Deno.remove(temporary).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
  }
}

function fingerprintDigest(fingerprint: ContentFingerprint): string {
  if (
    fingerprint === null ||
    typeof fingerprint !== "object" ||
    fingerprint.algorithm !== "sha256"
  ) {
    throw new TypeError("A sha256 fingerprint is required.");
  }
  return sha256Hex(fingerprint.digest, "fingerprint.digest");
}

async function assertDigest(
  bytes: Uint8Array,
  expected: string,
  label: string,
): Promise<void> {
  const actual = await fingerprintResourceBytes(bytes);
  if (actual !== expected) {
    throw new ByteStoreIntegrityError(
      `${label} object failed sha256 verification: expected ${expected}, received ${actual}.`,
    );
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index] ^ right[index];
  }
  return different === 0;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await Deno.open(directory, { read: true });
  try {
    await handle.sync();
  } finally {
    handle.close();
  }
}
