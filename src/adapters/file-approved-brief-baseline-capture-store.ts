import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

/**
 * Immutable byte store for the documentary source created by
 * `baseline.from-approved-brief@1`.
 *
 * The ThreadSnapshot holds the content fingerprint and logical URI; this
 * adapter owns the local, content-addressed bytes behind that URI. A digest is
 * never reused for different text, including across process restarts.
 */
export class FileApprovedBriefBaselineCaptureStore {
  constructor(
    private readonly directory = "state/local/approved-brief-captures",
  ) {}

  uriFor(fingerprint: ContentFingerprint): string {
    const digest = sha256Digest(fingerprint);
    return `casys://approved-brief-capture/sha256/${digest}`;
  }

  pathFor(fingerprint: ContentFingerprint): string {
    return `${this.directory.replace(/\/$/, "")}/${sha256Digest(fingerprint)}.json`;
  }

  /**
   * Persist exactly the bytes named by `fingerprint`. Existing identical
   * content is an idempotent success; any different file is a hard conflict.
   */
  async save(
    fingerprint: ContentFingerprint,
    text: string,
  ): Promise<{ readonly uri: string; readonly path: string }> {
    const digest = sha256Digest(fingerprint);
    const bytes = new TextEncoder().encode(text);
    const actual = await fingerprintBytes(bytes);
    if (actual !== digest) {
      throw new Error(
        `Approved-brief capture content does not match declared sha256 ${digest}.`,
      );
    }

    const path = this.pathFor(fingerprint);
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await Deno.writeTextFile(path, text, { createNew: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      const existing = await Deno.readTextFile(path);
      if (existing !== text) {
        throw new Error(
          `Approved-brief capture ${digest} already exists with different content.`,
        );
      }
    }
    return { uri: this.uriFor(fingerprint), path };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<string | undefined> {
    const path = this.pathFor(fingerprint);
    try {
      const text = await Deno.readTextFile(path);
      const actual = await fingerprintBytes(new TextEncoder().encode(text));
      if (actual !== fingerprint.digest) {
        throw new Error(
          `Approved-brief capture ${fingerprint.digest} does not match its filename digest.`,
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
