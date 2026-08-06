import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";

export const PRINTABILITY_RUN_ATTEMPT_SCHEMA = "printability-run-attempt/1.0" as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Durable shape of one printability-run WAL entry.
 *
 * `status: "dispatched"` means the providers may have been called but no
 * normalised result was recorded yet. Like the sensitivity WAL, this status is
 * NOT terminal: `build123d_export` with a deterministic script and
 * `dfm_check_*` with caller-supplied thresholds are effectively idempotent for
 * the same case digest. Re-dispatching is safe.
 */
type PrintabilityRunAttempt =
  | {
    readonly schemaVersion: typeof PRINTABILITY_RUN_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly caseDigest: string;
    readonly status: "dispatched";
    readonly dispatchedAt: string;
  }
  | {
    readonly schemaVersion: typeof PRINTABILITY_RUN_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly caseDigest: string;
    readonly status: "completed";
    readonly dispatchedAt: string;
    readonly completedAt: string;
    readonly captureFingerprint: ContentFingerprint;
  };

export interface BeginPrintabilityRunAttempt {
  readonly projectId: string;
  readonly runId: string;
  /** SHA-256 digest of deterministicJson(printabilityCase). */
  readonly caseDigest: string;
  readonly dispatchedAt: string;
}

export interface CompletePrintabilityRunAttempt extends BeginPrintabilityRunAttempt {
  readonly completedAt: string;
  readonly captureFingerprint: ContentFingerprint;
}

/**
 * Write-ahead journal for the build123d + dfm_check_* pair executed during a
 * printability run.
 *
 * Key: `[projectId, runId, caseDigest]` — ties the attempt to the exact
 * reviewed case, not only to the run identity. A case change produces a new
 * key and therefore a new attempt record.
 *
 * A `dispatched` entry returns `{ action: "dispatch" }` and allows
 * re-dispatch. The provider sequence is effectively idempotent: the same
 * deterministic build123d script always produces the same STL bytes (same SHA),
 * and `dfm_check_*` with caller-supplied thresholds on that STL is a
 * read-only analysis.
 */
export class FileCm01DripTrayPrintabilityAttemptStore {
  constructor(
    private readonly directory = "state/local/cm01-drip-tray-printability-attempts",
  ) {}

  async begin(
    input: BeginPrintabilityRunAttempt,
  ): Promise<
    | { readonly action: "dispatch" }
    | {
      readonly action: "completed";
      readonly captureFingerprint: ContentFingerprint;
    }
  > {
    validateBegin(input);
    const fresh: PrintabilityRunAttempt = {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      caseDigest: input.caseDigest,
      status: "dispatched",
      dispatchedAt: input.dispatchedAt,
    };
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      const file = await Deno.open(
        this.pathFor(input.projectId, input.runId, input.caseDigest),
        { createNew: true, write: true },
      );
      try {
        const bytes = new TextEncoder().encode(`${deterministicJson(fresh)}\n`);
        await file.write(bytes);
        await file.syncData();
      } finally {
        file.close();
      }
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    // Existing entry: idempotent re-dispatch is safe for either status.
    const existing = await this.readExisting(
      input.projectId,
      input.runId,
      input.caseDigest,
    );
    if (!existing) {
      throw new Error(
        "Printability run attempt was created but cannot be read back.",
      );
    }
    if (existing.status === "completed") {
      return { action: "completed", captureFingerprint: existing.captureFingerprint };
    }
    // "dispatched" → safe to retry (providers are effectively idempotent).
    return { action: "dispatch" };
  }

  async complete(input: CompletePrintabilityRunAttempt): Promise<void> {
    validateComplete(input);
    const existing = await this.readExisting(
      input.projectId,
      input.runId,
      input.caseDigest,
    );
    if (!existing) {
      throw new Error(
        "Cannot complete a printability run attempt that was never begun.",
      );
    }
    const completed: PrintabilityRunAttempt = {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      projectId: existing.projectId,
      runId: existing.runId,
      caseDigest: existing.caseDigest,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      completedAt: input.completedAt,
      captureFingerprint: normalizedFingerprint(input.captureFingerprint),
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Completed printability run attempt conflicts with its recorded capture fingerprint.",
        );
      }
      return;
    }
    const path = this.pathFor(
      input.projectId,
      input.runId,
      input.caseDigest,
    );
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const file = await Deno.open(temporary, { createNew: true, write: true });
    try {
      const bytes = new TextEncoder().encode(`${deterministicJson(completed)}\n`);
      let written = 0;
      while (written < bytes.length) {
        const count = await file.write(bytes.subarray(written));
        if (count <= 0) {
          throw new Error("Printability run attempt write made no progress.");
        }
        written += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
    await Deno.rename(temporary, path);
  }

  pathFor(projectId: string, runId: string, caseDigest: string): string {
    validateIdentity(projectId, runId, caseDigest);
    const key = encodeURIComponent(JSON.stringify([projectId, runId, caseDigest]));
    return `${this.directory.replace(/\/$/, "")}/${key}.json`;
  }

  private async readExisting(
    projectId: string,
    runId: string,
    caseDigest: string,
  ): Promise<PrintabilityRunAttempt | undefined> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.pathFor(projectId, runId, caseDigest));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    return parseAttempt(text, { projectId, runId, caseDigest });
  }
}

function parseAttempt(
  text: string,
  expected: { projectId: string; runId: string; caseDigest: string },
): PrintabilityRunAttempt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Printability run attempt is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Printability run attempt must be an object.");
  }
  const rec = value as Record<string, unknown>;
  if (
    rec.schemaVersion !== PRINTABILITY_RUN_ATTEMPT_SCHEMA ||
    rec.projectId !== expected.projectId ||
    rec.runId !== expected.runId ||
    rec.caseDigest !== expected.caseDigest ||
    (rec.status !== "dispatched" && rec.status !== "completed") ||
    typeof rec.dispatchedAt !== "string"
  ) {
    throw new Error(
      "Printability run attempt has an invalid identity, schema, or status.",
    );
  }
  if (rec.status === "dispatched") {
    return {
      schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
      projectId: expected.projectId,
      runId: expected.runId,
      caseDigest: expected.caseDigest,
      status: "dispatched",
      dispatchedAt: rec.dispatchedAt,
    };
  }
  if (
    typeof rec.completedAt !== "string" ||
    !isContentFingerprint(rec.captureFingerprint)
  ) {
    throw new Error("Completed printability run attempt is missing required fields.");
  }
  return {
    schemaVersion: PRINTABILITY_RUN_ATTEMPT_SCHEMA,
    projectId: expected.projectId,
    runId: expected.runId,
    caseDigest: expected.caseDigest,
    status: "completed",
    dispatchedAt: rec.dispatchedAt,
    completedAt: rec.completedAt,
    captureFingerprint: normalizedFingerprint(rec.captureFingerprint),
  };
}

function isContentFingerprint(value: unknown): value is ContentFingerprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return rec.algorithm === "sha256" && typeof rec.digest === "string" &&
    SHA256_HEX.test(rec.digest);
}

function normalizedFingerprint(value: ContentFingerprint): ContentFingerprint {
  if (value.algorithm !== "sha256" || !SHA256_HEX.test(value.digest)) {
    throw new TypeError(
      "captureFingerprint must be a sha256 ContentFingerprint with a 64-char hex digest.",
    );
  }
  return { algorithm: "sha256", digest: value.digest };
}

function validateBegin(input: BeginPrintabilityRunAttempt): void {
  validateIdentity(input.projectId, input.runId, input.caseDigest);
  isoDateTime(input.dispatchedAt, "dispatchedAt");
}

function validateComplete(input: CompletePrintabilityRunAttempt): void {
  validateBegin(input);
  isoDateTime(input.completedAt, "completedAt");
  normalizedFingerprint(input.captureFingerprint);
}

function validateIdentity(projectId: string, runId: string, caseDigest: string): void {
  nonEmpty(projectId, "projectId");
  nonEmpty(runId, "runId");
  if (!SHA256_HEX.test(caseDigest)) {
    throw new TypeError(
      "caseDigest must be a 64-character lowercase hexadecimal SHA-256 digest.",
    );
  }
}

function nonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function isoDateTime(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
}
