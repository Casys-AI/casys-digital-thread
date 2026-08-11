/**
 * Container-side asset staging boundary.
 *
 * WHY THIS BOUNDARY EXISTS — the CalculiX solver reads its STEP input from a
 * known path inside the container. Before any solve, the exact file attested in
 * the proof-case must be present at that path with the correct SHA-256.
 * DockerVolumeAssetStager closes the TOCTOU window: it verifies the host file
 * before the copy (pre_verify_failed), then re-reads the container file after
 * the copy to confirm end-to-end integrity (post_read_failed / sha256_mismatch).
 * Neither verification step is bypassed regardless of prior results.
 *
 * This module is the inverse of host-asset-materializer.ts: where the
 * materializer pulls a file FROM a container TO the host, the stager pushes a
 * file FROM the host INTO the container. Both follow the same two-step
 * verify-then-act-then-verify sequence to prevent partial or unattested state.
 *
 * INVARIANTS (unconditional, never bypassed):
 *  1. Any fingerprint mismatch — on the host before copy (pre_verify_failed) or
 *     in the container after copy (sha256_mismatch) — surfaces as a
 *     ContainerAssetStagingError. No partial or unverified state is left in the
 *     container.
 *  2. A caller that catches ContainerAssetStagingError MUST treat it as
 *     stop-for-review. No automatic retry is permitted; the root cause (wrong
 *     file on host, Docker state, container path) requires operator diagnosis.
 *
 * IDEMPOTENCY — if the target file already exists in the container with the
 * expected SHA-256, the copy is skipped entirely. Restarts after a partial
 * success are safe: a file already staged and verified is not re-copied.
 *
 * PRODUCTION DEPENDENCY — DockerVolumeAssetStager is an explicit CLI boundary.
 * It requires:
 *  - Docker daemon running on the host.
 *  - Compose service running (`docker compose up -d <service>`).
 *  - `docker` (Compose v2 subcommand) available in PATH.
 *  - The Deno process has access to the Docker socket.
 *
 * These conditions are NOT checked at construction time. Failures at copy time
 * surface as ContainerAssetStagingError with code "copy_failed".
 */

export interface ContainerAssetStager {
  /**
   * Resolve the code-owned provider location for a safe filename without any
   * Docker I/O. The executor uses this identity to lower its exact request
   * before WAL preflight, so recovery never stages merely to learn a path.
   */
  resolveTarget(input: {
    /** Safe filename for the target path inside the container directory. */
    readonly containerFileName: string;
  }): StagedContainerAsset;

  /**
   * Copy a named file from the host into the provider container, then verify
   * its SHA-256 against `expectedDigest`.
   *
   * Idempotent: if the file already exists in the container with the correct
   * SHA-256, the call succeeds immediately without running any Docker command.
   *
   * Throws TypeError on malformed input (programmer errors, not staging errors).
   *
   * Throws ContainerAssetStagingError on:
   *   - `pre_verify_failed`: the host file is missing, has wrong byte count, or
   *     wrong SHA-256 before the copy. No Docker command is run.
   *   - `copy_failed`: `docker compose cp` exited non-zero.
   *   - `post_read_failed`: the container re-read via `docker compose exec cat`
   *     failed after the copy.
   *   - `sha256_mismatch`: the container file's SHA-256 after copy does not
   *     match `expectedDigest`.
   */
  stage(input: {
    /** Absolute host-side path of the verified source file. */
    readonly sourcePath: string;
    /** Attested SHA-256 hex digest (64 lowercase hex chars). */
    readonly expectedDigest: string;
    /** Attested byte count; must match the host file exactly. */
    readonly expectedBytes: number;
    /** Safe filename for the target path inside the container directory. */
    readonly containerFileName: string;
  }): Promise<StagedContainerAsset>;
}

/**
 * Code-owned, provider-readable location of an asset after staging. It is
 * constructed by the staging adapter from a fixed directory and a validated
 * filename; callers never supply a path.
 */
export interface StagedContainerAsset {
  readonly containerPath: string;
}

export type ContainerAssetStagingCode =
  | "pre_verify_failed"
  | "copy_failed"
  | "post_read_failed"
  | "sha256_mismatch";

/**
 * Typed error thrown when asset staging fails.
 *
 * `code` is machine-readable; `context` carries operator-visible details
 * (paths, exit codes, expected/actual digests) without embedding arbitrary
 * provider prose. Callers must treat this as stop-for-review.
 */
export class ContainerAssetStagingError extends Error {
  constructor(
    readonly code: ContainerAssetStagingCode,
    readonly context: Record<string, string>,
    message: string,
  ) {
    super(message);
    this.name = "ContainerAssetStagingError";
  }
}

/**
 * Injectable command runner — the production default uses Deno.Command.
 * Tests inject a fake that returns canned outputs without spawning Docker.
 */
export type ContainerCommandRunner = (
  exe: string,
  args: string[],
) => Promise<{
  readonly success: boolean;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly code: number;
}>;

/**
 * Injectable host-file reader — the production default calls Deno.readFile.
 * Returns undefined when the file is not found; propagates all other errors.
 * Tests inject a lambda that returns pre-arranged bytes without touching disk.
 */
export type HostFileReader = (path: string) => Promise<Uint8Array | undefined>;

export interface DockerVolumeAssetStagerOptions {
  /** Compose service that owns the target volume, e.g. "mcp-calculix". */
  readonly service: string;
  /** Absolute, code-owned container-side directory, e.g. "/inputs". */
  readonly containerDirectory: string;
  /**
   * Path to the directory containing `docker-compose.yml`.
   * Passed as `--project-directory` to Docker commands.
   * Defaults to "." (the Deno process CWD).
   */
  readonly composeProjectDirectory?: string;
  /** Override for tests. Defaults to a Deno.Command-based runner. */
  readonly commandRunner?: ContainerCommandRunner;
  /** Override for tests. Defaults to Deno.readFile (NotFound → undefined). */
  readonly hostFileReader?: HostFileReader;
}

/**
 * Production asset stager: pre-verifies the host file, pushes it into the
 * container via `docker compose cp`, then re-reads it via
 * `docker compose exec cat` to confirm end-to-end integrity.
 *
 * The container re-read uses `-T` (no pseudo-TTY) to capture raw binary
 * content without terminal escape sequences corrupting the byte stream.
 */
export class DockerVolumeAssetStager implements ContainerAssetStager {
  readonly #service: string;
  readonly #containerDirectory: string;
  readonly #composeProjectDirectory: string;
  readonly #run: ContainerCommandRunner;
  readonly #readHost: HostFileReader;

  constructor(options: DockerVolumeAssetStagerOptions) {
    if (!/^[A-Za-z0-9._-]+$/.test(options.service)) {
      throw new TypeError(
        `DockerVolumeAssetStager: service name "${options.service}" is not safe.`,
      );
    }
    this.#service = options.service;
    this.#containerDirectory = requireSafeContainerDirectory(
      options.containerDirectory,
    );
    this.#composeProjectDirectory = options.composeProjectDirectory ?? ".";
    this.#run = options.commandRunner ?? defaultCommandRunner;
    this.#readHost = options.hostFileReader ?? defaultHostFileReader;
  }

  resolveTarget(input: {
    readonly containerFileName: string;
  }): StagedContainerAsset {
    requireSafeContainerFilename(input.containerFileName);
    return Object.freeze({
      containerPath: `${this.#containerDirectory}/${input.containerFileName}`,
    });
  }

  async stage(input: {
    readonly sourcePath: string;
    readonly expectedDigest: string;
    readonly expectedBytes: number;
    readonly containerFileName: string;
  }): Promise<StagedContainerAsset> {
    requireSafeContainerFilename(input.containerFileName);
    requireSha256Digest(input.expectedDigest, input.containerFileName);
    const target = this.resolveTarget(input);

    // Pre-verify the host file before touching the container at all.
    const hostBytes = await this.#readHost(input.sourcePath);
    if (hostBytes === undefined) {
      throw new ContainerAssetStagingError(
        "pre_verify_failed",
        {
          sourcePath: input.sourcePath,
          containerFileName: input.containerFileName,
        },
        `Host file not found at ${input.sourcePath}.`,
      );
    }
    if (hostBytes.length !== input.expectedBytes) {
      throw new ContainerAssetStagingError(
        "pre_verify_failed",
        {
          sourcePath: input.sourcePath,
          expectedBytes: String(input.expectedBytes),
          actualBytes: String(hostBytes.length),
          containerFileName: input.containerFileName,
        },
        `Host file size mismatch for ${input.containerFileName}: ` +
          `expected ${input.expectedBytes} bytes, got ${hostBytes.length}.`,
      );
    }
    const hostDigest = await sha256Hex(hostBytes);
    if (hostDigest !== input.expectedDigest) {
      throw new ContainerAssetStagingError(
        "pre_verify_failed",
        {
          sourcePath: input.sourcePath,
          expected: input.expectedDigest,
          actual: hostDigest,
          containerFileName: input.containerFileName,
        },
        `Host file SHA-256 mismatch for ${input.containerFileName}: ` +
          `expected ${input.expectedDigest.slice(0, 16)}…, ` +
          `got ${hostDigest.slice(0, 16)}….`,
      );
    }

    // Idempotency: if the container file already exists with the right digest,
    // skip the copy. Failure to read the container file is not an error here;
    // it simply means the file is absent and the copy must proceed.
    const containerPath = target.containerPath;
    if (
      await this.#existsInContainerWithDigest(containerPath, input.expectedDigest)
    ) {
      return target;
    }

    // Copy host → container.
    const destination = `${this.#service}:${containerPath}`;
    const copyResult = await this.#run("docker", [
      "compose",
      "--project-directory",
      this.#composeProjectDirectory,
      "cp",
      input.sourcePath,
      destination,
    ]);
    if (!copyResult.success) {
      const stderr = new TextDecoder().decode(copyResult.stderr).trim();
      throw new ContainerAssetStagingError(
        "copy_failed",
        {
          containerFileName: input.containerFileName,
          service: this.#service,
          exitCode: String(copyResult.code),
          stderr: stderr.slice(0, 512),
        },
        `docker compose cp exited ${copyResult.code} for ${input.containerFileName}: ` +
          `${stderr.slice(0, 200)}`,
      );
    }

    // Re-read the container file and verify the digest end-to-end.
    const postResult = await this.#run("docker", [
      "compose",
      "--project-directory",
      this.#composeProjectDirectory,
      "exec",
      "-T",
      this.#service,
      "cat",
      containerPath,
    ]);
    if (!postResult.success) {
      const stderr = new TextDecoder().decode(postResult.stderr).trim();
      throw new ContainerAssetStagingError(
        "post_read_failed",
        {
          containerFileName: input.containerFileName,
          service: this.#service,
          containerPath,
          exitCode: String(postResult.code),
          stderr: stderr.slice(0, 512),
        },
        `Container re-read failed for ${input.containerFileName} ` +
          `at ${containerPath}: exit ${postResult.code}.`,
      );
    }
    const containerDigest = await sha256Hex(postResult.stdout);
    if (containerDigest !== input.expectedDigest) {
      throw new ContainerAssetStagingError(
        "sha256_mismatch",
        {
          containerFileName: input.containerFileName,
          expected: input.expectedDigest,
          actual: containerDigest,
        },
        `SHA-256 mismatch after staging ${input.containerFileName}: ` +
          `expected ${input.expectedDigest.slice(0, 16)}…, ` +
          `got ${containerDigest.slice(0, 16)}….`,
      );
    }
    return target;
  }

  /**
   * Attempt to read the container file and confirm its SHA-256.
   * Returns true only when the exec succeeds and the digest matches.
   * Any Docker failure is treated as "absent"; callers proceed with the copy.
   */
  async #existsInContainerWithDigest(
    containerPath: string,
    expectedDigest: string,
  ): Promise<boolean> {
    try {
      const result = await this.#run("docker", [
        "compose",
        "--project-directory",
        this.#composeProjectDirectory,
        "exec",
        "-T",
        this.#service,
        "cat",
        containerPath,
      ]);
      if (!result.success) return false;
      const digest = await sha256Hex(result.stdout);
      return digest === expectedDigest;
    } catch {
      return false;
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

async function defaultHostFileReader(
  path: string,
): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function defaultCommandRunner(
  exe: string,
  args: string[],
): Promise<{
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
  code: number;
}> {
  const command = new Deno.Command(exe, {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  return {
    success: output.success,
    stdout: output.stdout,
    stderr: output.stderr,
    code: output.code,
  };
}

function requireSafeContainerFilename(filename: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    // TypeError rather than ContainerAssetStagingError: this is a programmer
    // error (bad argument shape), not a Docker or I/O failure. Using TypeError
    // is consistent with requireSha256Digest below and with the same pattern
    // in host-asset-materializer.ts.
    throw new TypeError(
      `Container filename "${filename}" is not safe ` +
        `(must match /^[A-Za-z0-9._-]+$/).`,
    );
  }
}

function requireSafeContainerDirectory(directory: string): string {
  const normalized = directory.replace(/\/+$/, "");
  if (
    !normalized.startsWith("/") ||
    normalized === "/" ||
    normalized.split("/").slice(1).some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    throw new TypeError(
      `DockerVolumeAssetStager: container directory "${directory}" is not a safe absolute path.`,
    );
  }
  return normalized;
}

function requireSha256Digest(digest: string, filename: string): void {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    // TypeError rather than ContainerAssetStagingError: this is a programmer
    // error (bad argument), not a Docker or I/O failure.
    throw new TypeError(
      `Expected SHA-256 digest for "${filename}" is not a valid ` +
        `64-character lowercase hex string.`,
    );
  }
}
