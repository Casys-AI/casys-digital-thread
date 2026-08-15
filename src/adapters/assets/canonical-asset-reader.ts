/**
 * Injected reader for content-addressed geometry assets on the local filesystem.
 *
 * WHY AN INTERFACE — `verify.seal-proof-case@1` and
 * `verify.run-fea-static-proof@1` must read a STEP file whose path they do not
 * know.  The canonical store is `state/local/thread-assets`, but the executors
 * must never contain that literal: server.ts constructs a
 * `FileCanonicalAssetReader` with the resolved directory and injects it.  This
 * boundary keeps the executors filesystem-agnostic and testable in isolation
 * with an in-memory double.
 *
 * Content-addressing contract: the filename IS the digest.  A file named
 * `<digest>.step` in the canonical directory must have SHA-256 equal to
 * `digest`.  Any deviation — file renamed, bytes corrupted — is an integrity
 * violation; the read fails hard with code `integrity_mismatch`.
 */

// ── Interface ─────────────────────────────────────────────────────────────────

import type { CanonicalAssetReader } from "../../application/ports/out/canonical-asset-reader.ts";

// ── Error ────────────────────────────────────────────────────────────────────

export type CanonicalAssetReadCode =
  | "not_found"
  | "read_failed"
  | "integrity_mismatch";

/**
 * Thrown when a canonical asset cannot be read or fails integrity verification.
 *
 * `code` is machine-readable; `context` carries operator-visible details
 * (digest, path, actual hash) without embedding arbitrary I/O prose.
 * Callers MUST treat this as stop-for-review: automatic retry is not safe
 * because the root cause (missing file, corruption, wrong directory) requires
 * operator diagnosis.
 */
export class CanonicalAssetReadError extends Error {
  constructor(
    readonly code: CanonicalAssetReadCode,
    readonly context: Readonly<Record<string, string>>,
    message: string,
  ) {
    super(message);
    this.name = "CanonicalAssetReadError";
  }
}

// ── Production implementation ─────────────────────────────────────────────────

/**
 * Reads canonical geometry assets from a local directory where filenames are
 * their own SHA-256 hex digests.
 *
 * Directory convention: `<directory>/<digest>.<extension>`.  `extension`
 * defaults to `step` so FEA and printability keep the existing STEP store.
 * Print-estimate injects `extension: "stl"` for write-geometry mesh bytes.
 *
 * `directory` is a PARAMETER — server.ts supplies `state/local/thread-assets`
 * at the composition root.  This class never hard-codes any path.
 *
 * Integrity guarantee: after every successful read, the SHA-256 of the bytes
 * is recomputed and compared to the requested digest.  A renamed or corrupted
 * file is caught deterministically, never silently accepted.
 */
export type CanonicalAssetExtension = "step" | "stl";

export class FileCanonicalAssetReader implements CanonicalAssetReader {
  readonly #directory: string;
  readonly #extension: CanonicalAssetExtension;

  constructor(options: {
    readonly directory: string;
    readonly extension?: CanonicalAssetExtension;
  }) {
    this.#directory = options.directory.replace(/\/+$/, "");
    const extension = options.extension ?? "step";
    if (extension !== "step" && extension !== "stl") {
      throw new TypeError(
        'CanonicalAssetReader: extension must be "step" or "stl".',
      );
    }
    this.#extension = extension;
  }

  async read(digest: string): Promise<Uint8Array> {
    requireHex64Digest(digest);

    const path = `${this.#directory}/${digest}.${this.#extension}`;

    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new CanonicalAssetReadError(
          "not_found",
          { digest, path },
          `Canonical asset not found: ${digest.slice(0, 16)}… at ${path}`,
        );
      }
      throw new CanonicalAssetReadError(
        "read_failed",
        { digest, path, error: String(error) },
        `Failed to read canonical asset ${digest.slice(0, 16)}…: ${String(error)}`,
      );
    }

    const actualDigest = await sha256Hex(bytes);
    if (actualDigest !== digest) {
      throw new CanonicalAssetReadError(
        "integrity_mismatch",
        { digest, path, actual: actualDigest },
        `Integrity mismatch for canonical asset ${digest.slice(0, 16)}…: ` +
          `expected ${digest.slice(0, 16)}…, got ${actualDigest.slice(0, 16)}….`,
      );
    }

    return bytes;
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Reject non-hex-64 digests before any filesystem access.
 *
 * This is a programmer-error guard (bad caller argument), not an I/O error.
 * TypeError is consistent with `host-asset-materializer.ts` which uses the
 * same convention for its `requireSha256Digest` helper.
 */
function requireHex64Digest(digest: string): void {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(
      `CanonicalAssetReader: digest "${
        digest.slice(0, 20)
      }…" is not a valid 64-character lowercase hex string.`,
    );
  }
}
