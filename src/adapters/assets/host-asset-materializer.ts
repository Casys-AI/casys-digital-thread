/**
 * Host-side asset materialization boundary.
 *
 * A HostAssetMaterializer pulls a named file from its provider-side storage
 * into the local directory from which the BFF serves presentation assets.
 * Two invariants hold unconditionally and are never bypassed:
 *
 *  1. Any SHA-256 mismatch between the expected fingerprint and the copied
 *     file causes an immediate HostAssetMaterializationError. The partially
 *     copied file is removed before the error surfaces; callers see no partial
 *     or unverified state in the local directory.
 *  2. A caller that catches HostAssetMaterializationError MUST treat it as
 *     stop-for-review. No automatic retry is permitted because the root cause
 *     (Docker state, container path, network) requires operator diagnosis.
 *
 * PRODUCTION DEPENDENCY — DockerVolumeAssetMaterializer is an explicit CLI
 * boundary. It requires:
 *  - Docker daemon running on the host.
 *  - Compose service running (`docker compose up -d <service>`).
 *  - `docker` (Compose v2 subcommand) available in PATH.
 *  - The Deno process has access to the Docker socket.
 *
 * These conditions are NOT checked at construction time. Any failure at copy
 * time surfaces as a HostAssetMaterializationError with code "copy_failed".
 *
 * IDEMPOTENCY — if a file with the expected SHA-256 already exists at the
 * local path, no Docker copy is performed. This makes re-runs after a partial
 * success safe: assets already written and verified are not re-copied.
 */

export interface HostAssetMaterializer {
  /**
   * Copy a named asset from the provider-side storage into the local host
   * directory, then verify its SHA-256 against `expectedDigest`.
   *
   * Idempotent: if the file already exists at the local path with the correct
   * SHA-256, the call succeeds immediately without touching the container.
   *
   * Throws HostAssetMaterializationError on:
   *   - `copy_failed`: `docker compose cp` exited non-zero.
   *   - `read_failed`: the copy appeared to succeed but the file is unreadable.
   *   - `sha256_mismatch`: the copied file's SHA-256 does not match the
   *     expected digest; the file is removed before throwing.
   */
  materialize(filename: string, expectedDigest: string): Promise<void>;
}

export type HostAssetMaterializationCode =
  | "copy_failed"
  | "read_failed"
  | "sha256_mismatch";

/**
 * Typed error thrown when asset materialization fails.
 *
 * `code` is machine-readable; `context` carries operator-visible details
 * (filename, exit code, expected/actual digests) without embedding arbitrary
 * provider prose. Callers must treat this as stop-for-review.
 */
export class HostAssetMaterializationError extends Error {
  constructor(
    readonly code: HostAssetMaterializationCode,
    readonly context: Record<string, string>,
    message: string,
  ) {
    super(message);
    this.name = "HostAssetMaterializationError";
  }
}

export interface DockerVolumeAssetMaterializerOptions {
  /** Compose service that owns the source volume, e.g. "mcp-build123d". */
  readonly service: string;
  /** Absolute path of the source directory inside the container, e.g. "/exports". */
  readonly containerDirectory: string;
  /** Host filesystem directory where assets are written, e.g. "state/local/thread-assets". */
  readonly localDirectory: string;
  /**
   * Path to the directory containing `docker-compose.yml`.
   * Passed as `--project-directory` to `docker compose cp`.
   * Defaults to "." (the Deno process CWD).
   */
  readonly composeProjectDirectory?: string;
}

/**
 * Production asset materializer: `docker compose cp` + SHA-256 verification.
 *
 * One call to `materialize(filename, digest)` runs:
 *   docker compose --project-directory <dir> cp <service>:/exports/<filename> <localPath>
 * then reads the copied file and checks its SHA-256. On mismatch the file is
 * removed and HostAssetMaterializationError("sha256_mismatch", …) is thrown.
 *
 * CLI dependency: Docker Compose v2 plugin style (`docker compose` not
 * `docker-compose`).
 */
export class DockerVolumeAssetMaterializer implements HostAssetMaterializer {
  readonly #service: string;
  readonly #containerDirectory: string;
  readonly #localDirectory: string;
  readonly #composeProjectDirectory: string;

  constructor(options: DockerVolumeAssetMaterializerOptions) {
    if (!/^[A-Za-z0-9._-]+$/.test(options.service)) {
      throw new TypeError(
        `DockerVolumeAssetMaterializer: service name "${options.service}" is not safe.`,
      );
    }
    this.#service = options.service;
    this.#containerDirectory = options.containerDirectory.replace(/\/+$/, "");
    this.#localDirectory = options.localDirectory.replace(/\/+$/, "");
    this.#composeProjectDirectory = options.composeProjectDirectory ?? ".";
  }

  async materialize(filename: string, expectedDigest: string): Promise<void> {
    requireSafeFilename(filename);
    requireSha256Digest(expectedDigest, filename);

    const localPath = `${this.#localDirectory}/${filename}`;

    // Idempotent guard: if the file already exists with the right digest, skip.
    const existing = await readFileSafe(localPath);
    if (existing !== undefined) {
      const actualDigest = await sha256Hex(existing);
      if (actualDigest === expectedDigest) return;
      // File exists but digest differs — stale; remove and re-copy below.
      await removeFileSafe(localPath);
    }

    await Deno.mkdir(this.#localDirectory, { recursive: true });

    const containerPath = `${this.#containerDirectory}/${filename}`;
    const source = `${this.#service}:${containerPath}`;
    const command = new Deno.Command("docker", {
      args: [
        "compose",
        "--project-directory",
        this.#composeProjectDirectory,
        "cp",
        source,
        localPath,
      ],
      stdout: "null",
      stderr: "piped",
    });

    let output: Deno.CommandOutput;
    try {
      output = await command.output();
    } catch (error) {
      throw new HostAssetMaterializationError(
        "copy_failed",
        { filename, service: this.#service, error: String(error) },
        `docker compose cp failed to start for ${filename}: ${String(error)}`,
      );
    }
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr).trim();
      throw new HostAssetMaterializationError(
        "copy_failed",
        {
          filename,
          service: this.#service,
          exitCode: String(output.code),
          stderr: stderr.slice(0, 512),
        },
        `docker compose cp exited ${output.code} for ${filename}: ${
          stderr.slice(0, 200)
        }`,
      );
    }

    // Verify the copied file against the attested fingerprint.
    const copied = await readFileSafe(localPath);
    if (copied === undefined) {
      throw new HostAssetMaterializationError(
        "read_failed",
        { filename, localPath },
        `docker compose cp succeeded but ${filename} is not readable at ${localPath}.`,
      );
    }
    const actualDigest = await sha256Hex(copied);
    if (actualDigest !== expectedDigest) {
      await removeFileSafe(localPath);
      throw new HostAssetMaterializationError(
        "sha256_mismatch",
        { filename, expected: expectedDigest, actual: actualDigest },
        `SHA-256 mismatch for ${filename}: expected ${expectedDigest.slice(0, 16)}…, ` +
          `got ${actualDigest.slice(0, 16)}….`,
      );
    }
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readFileSafe(path: string): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function removeFileSafe(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch { /* best-effort cleanup — do not mask original errors */ }
}

function requireSafeFilename(filename: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    throw new TypeError(`Asset filename "${filename}" is not safe.`);
  }
}

function requireSha256Digest(digest: string, filename: string): void {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    // Throw TypeError, not HostAssetMaterializationError, because this is a
    // programmer error (bad argument), not a Docker or I/O failure.  The
    // "copy_failed" code would mislead a caller diagnosing infrastructure
    // problems; TypeError is consistent with requireSafeFilename above.
    throw new TypeError(
      `Expected SHA-256 digest for "${filename}" is not a valid 64-character hex string.`,
    );
  }
}
