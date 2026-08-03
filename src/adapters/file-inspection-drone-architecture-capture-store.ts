import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

/**
 * Immutable byte store for the closed r3 capture created by
 * `architecture.author-inspection-drone@2` (or immutable historical @1).
 *
 * The ThreadSnapshot will reference the capture by content fingerprint and
 * logical URI. This adapter owns the corresponding local content-addressed
 * text. A digest can never be repurposed for different bytes, including after
 * restart.
 */
export class FileInspectionDroneArchitectureCaptureStore {
  constructor(
    private readonly directory = "state/local/inspection-drone-architecture-captures",
  ) {}

  uriFor(fingerprint: ContentFingerprint): string {
    const digest = sha256Digest(fingerprint);
    return `casys://inspection-drone-architecture-capture/sha256/${digest}`;
  }

  pathFor(fingerprint: ContentFingerprint): string {
    return `${this.directory.replace(/\/$/, "")}/${sha256Digest(fingerprint)}.json`;
  }

  /**
   * Persist exactly the text named by `fingerprint`. Existing identical bytes
   * are an idempotent success; divergent bytes are an integrity conflict.
   */
  async save(
    fingerprint: ContentFingerprint,
    text: string,
  ): Promise<{ readonly uri: string; readonly path: string }> {
    const digest = sha256Digest(fingerprint);
    const actual = await fingerprintBytes(new TextEncoder().encode(text));
    if (actual !== digest) {
      throw new Error(
        `Inspection-drone architecture capture content does not match declared sha256 ${digest}.`,
      );
    }

    const path = this.pathFor(fingerprint);
    await Deno.mkdir(this.directory, { recursive: true });
    const created = await linkNewCaptureDurably(path, text, this.directory);
    if (!created) {
      const existing = await Deno.readTextFile(path);
      if (existing !== text) {
        const existingDigest = await fingerprintBytes(
          new TextEncoder().encode(existing),
        );
        if (existingDigest === digest) {
          throw new Error(
            `Inspection-drone architecture capture ${digest} already exists with different content.`,
          );
        }
        // A final capture pathname with the wrong digest can only be a
        // partial/corrupt predecessor (or an integrity failure). Replace it
        // atomically with the bytes named by this digest so a retry after the
        // already-completed provider write can recover without another insert.
        await replaceCorruptCaptureDurably(path, text, this.directory);
        const repaired = await Deno.readTextFile(path);
        if (repaired !== text) {
          throw new Error(
            `Inspection-drone architecture capture ${digest} could not be repaired exactly.`,
          );
        }
      }
    }
    return { uri: this.uriFor(fingerprint), path };
  }

  /** Re-read and re-hash exact text; corrupt local bytes never look valid. */
  async read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    const path = this.pathFor(fingerprint);
    try {
      const text = await Deno.readTextFile(path);
      const actual = await fingerprintBytes(new TextEncoder().encode(text));
      if (actual !== fingerprint.digest) {
        throw new Error(
          `Inspection-drone architecture capture ${fingerprint.digest} does not match its filename digest.`,
        );
      }
      return text;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }
}

function sha256Digest(fingerprint: ContentFingerprint): string {
  if (
    fingerprint.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError("A lowercase 64-character sha256 fingerprint is required.");
  }
  return fingerprint.digest;
}

async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  // Copy into an ArrayBuffer-backed view before crossing the Web Crypto
  // boundary; the generic Uint8Array input may otherwise be SharedArrayBuffer-backed.
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Prepare the bytes under a private pathname, fsync them, then link them into
 * the content-addressed final pathname without overwriting a concurrent final
 * file. A crash can leave only a disposable `.tmp`; it can never make a
 * partial file look like the immutable digest capture.
 */
async function linkNewCaptureDurably(
  path: string,
  text: string,
  directory: string,
): Promise<boolean> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  await writeTextDurably(temporaryPath, text);
  let linked = false;
  try {
    await Deno.link(temporaryPath, path);
    linked = true;
  } catch (error) {
    await removeIfPresent(temporaryPath);
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
  await removeIfPresent(temporaryPath);
  if (linked) await syncDirectoryChain(directory);
  return linked;
}

/** Replace only bytes already proved not to match their content-addressed key. */
async function replaceCorruptCaptureDurably(
  path: string,
  text: string,
  directory: string,
): Promise<void> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  await writeTextDurably(temporaryPath, text);
  await Deno.rename(temporaryPath, path);
  await syncDirectoryChain(directory);
}

async function writeTextDurably(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    const bytes = new TextEncoder().encode(text);
    let written = 0;
    while (written < bytes.length) {
      const count = await file.write(bytes.subarray(written));
      if (count <= 0) {
        throw new Error(
          "Inspection-drone architecture capture made no write progress.",
        );
      }
      written += count;
    }
    await file.syncData();
  } finally {
    file.close();
  }
}

async function syncDirectoryChain(directory: string): Promise<void> {
  let current = directory.replace(/\/+$/, "") || ".";
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const file = await Deno.open(current, { read: true });
    try {
      await file.sync();
    } finally {
      file.close();
    }
    // `state` is the repository-owned durable storage root and pre-exists the
    // run. Stopping here keeps the server inside its deliberately narrow
    // filesystem permission boundary.
    if (current === "state") return;
    const parent = parentDirectory(current);
    if (parent === current) return;
    current = parent;
  }
}

function parentDirectory(path: string): string {
  if (path === "." || path === "/") return path;
  const slash = path.lastIndexOf("/");
  if (slash < 0) return ".";
  if (slash === 0) return "/";
  return path.slice(0, slash);
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
