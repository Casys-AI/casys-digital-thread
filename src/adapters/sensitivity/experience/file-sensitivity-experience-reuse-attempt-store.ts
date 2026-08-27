/** WAL for lookup/review/receipt before any sensitivity CAD dispatch. */

import { join, parse, resolve } from "node:path";

import {
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const SENSITIVITY_EXPERIENCE_REUSE_ATTEMPT_SCHEMA =
  "sensitivity-experience-reuse-attempt/1.0" as const;

export type SensitivityExperienceReuseAttempt =
  | {
    readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_REUSE_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly scientificKey: ContentFingerprint;
    readonly status: "reviewed-miss" | "reviewed-hit";
    readonly reviewFingerprint: ContentFingerprint;
  }
  | {
    readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_REUSE_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly scientificKey: ContentFingerprint;
    readonly status: "receipt-recorded";
    readonly reviewFingerprint: ContentFingerprint;
    readonly receiptFingerprint: ContentFingerprint;
  }
  | {
    readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_REUSE_ATTEMPT_SCHEMA;
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly scientificKey: ContentFingerprint;
    readonly status: "completed";
    readonly reviewFingerprint: ContentFingerprint;
    readonly receiptFingerprint: ContentFingerprint;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  };

export class FileSensitivityExperienceReuseAttemptStore {
  #canonicalDirectory: string | undefined;

  constructor(
    private readonly directory = "state/local/sensitivity-experience/reuse-attempts",
  ) {}

  async read(
    projectId: string,
    runId: string,
  ): Promise<SensitivityExperienceReuseAttempt | undefined> {
    if (!await this.#ensureDirectory(false)) return undefined;
    const path = await this.#path(projectId, runId);
    try {
      const attempt = parseAttempt(
        JSON.parse(await readRegularFile(path)),
      );
      assertAttemptIdentity(attempt, projectId, runId);
      return attempt;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  async readForPlan(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly scientificKey: ContentFingerprint;
  }): Promise<SensitivityExperienceReuseAttempt | undefined> {
    const attempt = await this.read(input.projectId, input.runId);
    if (attempt) assertPlan(attempt, input);
    return attempt;
  }

  async recordReview(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly scientificKey: ContentFingerprint;
    readonly reviewFingerprint: ContentFingerprint;
    readonly hit: boolean;
  }): Promise<SensitivityExperienceReuseAttempt> {
    const existing = await this.read(input.projectId, input.runId);
    if (existing) {
      assertPlan(existing, input);
      return existing;
    }
    const next: SensitivityExperienceReuseAttempt = {
      schemaVersion: SENSITIVITY_EXPERIENCE_REUSE_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      planDigest: sha256Hex(input.planDigest, "$reuseAttempt.planDigest"),
      scientificKey: parseFingerprint(
        input.scientificKey,
        "$reuseAttempt.scientificKey",
      ),
      status: input.hit ? "reviewed-hit" : "reviewed-miss",
      reviewFingerprint: parseFingerprint(
        input.reviewFingerprint,
        "$reuseAttempt.reviewFingerprint",
      ),
    };
    await this.#ensureDirectory(true);
    const path = await this.#path(input.projectId, input.runId);
    await assertAbsentOrRegularFile(path);
    try {
      await writeNewAttemptFileDurably(
        path,
        `${deterministicJson(next)}\n`,
        this.directory,
        "Sensitivity experience reuse WAL write made no progress.",
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      const raced = await this.read(input.projectId, input.runId);
      if (!raced) throw error;
      assertPlan(raced, input);
      return raced;
    }
    return next;
  }

  async recordReceipt(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly receiptFingerprint: ContentFingerprint;
  }): Promise<SensitivityExperienceReuseAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    if (current.status === "receipt-recorded" || current.status === "completed") {
      if (!sameFingerprint(current.receiptFingerprint, input.receiptFingerprint)) {
        throw new Error("Sensitivity experience reuse receipt WAL is divergent.");
      }
      return current;
    }
    if (current.status !== "reviewed-hit") {
      throw new Error("A sensitivity reuse miss cannot record a receipt.");
    }
    return await this.#replace(input, current, {
      ...current,
      status: "receipt-recorded",
      receiptFingerprint: parseFingerprint(
        input.receiptFingerprint,
        "$reuseAttempt.receiptFingerprint",
      ),
    });
  }

  async replaceHitWithMiss(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly reviewFingerprint: ContentFingerprint;
  }): Promise<SensitivityExperienceReuseAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    if (current.status === "reviewed-miss") return current;
    if (current.status !== "reviewed-hit") {
      throw new Error(
        "Sensitivity reuse cannot become a miss after receipt publication.",
      );
    }
    return await this.#replace(input, current, {
      ...current,
      status: "reviewed-miss",
      reviewFingerprint: parseFingerprint(
        input.reviewFingerprint,
        "$reuseAttempt.reviewFingerprint",
      ),
    });
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly snapshot: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
  }): Promise<SensitivityExperienceReuseAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    if (current.status === "completed") return current;
    if (current.status !== "receipt-recorded") {
      throw new Error("Sensitivity reuse cannot complete before its receipt.");
    }
    const snapshot = parseSnapshot(input.snapshot);
    return await this.#replace(input, current, {
      ...current,
      status: "completed",
      snapshot,
    });
  }

  async #required(projectId: string, runId: string) {
    const current = await this.read(projectId, runId);
    if (!current) throw new Error("Sensitivity experience reuse WAL is absent.");
    assertAttemptIdentity(current, projectId, runId);
    return current;
  }

  async #replace(
    requested: { readonly projectId: string; readonly runId: string },
    current: SensitivityExperienceReuseAttempt,
    next: SensitivityExperienceReuseAttempt,
  ): Promise<SensitivityExperienceReuseAttempt> {
    assertAttemptIdentity(current, requested.projectId, requested.runId);
    assertAttemptIdentity(next, requested.projectId, requested.runId);
    await this.#ensureDirectory(false);
    const path = await this.#path(requested.projectId, requested.runId);
    await assertRegularFile(path);
    await replaceAttemptFileDurably(
      path,
      `${deterministicJson(next)}\n`,
      this.directory,
      "Sensitivity experience reuse WAL rewrite made no progress.",
    );
    return next;
  }

  async #path(projectId: string, runId: string): Promise<string> {
    if (!this.#canonicalDirectory) {
      throw new Error("Sensitivity experience reuse WAL directory is not confined.");
    }
    const identity = await sha256Fingerprint({
      schemaVersion: "sensitivity-experience-reuse-attempt-key/1.0",
      projectId,
      runId,
    });
    return `${this.#canonicalDirectory}/${identity.digest}.json`;
  }

  async #ensureDirectory(create: boolean): Promise<boolean> {
    let present = await assertDirectoryChainHasNoSymlink(this.directory);
    if (!present) {
      if (!create) return false;
      await Deno.mkdir(this.directory, { recursive: true });
      present = await assertDirectoryChainHasNoSymlink(this.directory);
      if (!present) {
        throw new Error(
          `Sensitivity experience reuse WAL directory was not created: ${this.directory}.`,
        );
      }
    }
    const canonicalDirectory = await Deno.realPath(this.directory);
    if (
      canonicalDirectory !== resolve(this.directory) ||
      (this.#canonicalDirectory !== undefined &&
        canonicalDirectory !== this.#canonicalDirectory)
    ) {
      throw new Error(
        `Sensitivity experience reuse WAL is not a confined directory: ${this.directory}.`,
      );
    }
    this.#canonicalDirectory ??= canonicalDirectory;
    return true;
  }
}

async function assertDirectoryChainHasNoSymlink(path: string): Promise<boolean> {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  let cursor = parsed.root;
  let missing = false;
  for (const component of absolute.slice(parsed.root.length).split("/")) {
    if (component === "") continue;
    cursor = join(cursor, component);
    if (missing) continue;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(cursor);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        missing = true;
        continue;
      }
      throw error;
    }
    if (info.isSymlink || !info.isDirectory) {
      throw new Error(
        `Sensitivity experience reuse WAL has a symlinked or non-directory ancestor: ${cursor}.`,
      );
    }
  }
  return !missing;
}

async function readRegularFile(path: string): Promise<string> {
  await assertRegularFile(path);
  return await Deno.readTextFile(path);
}

async function assertAbsentOrRegularFile(path: string): Promise<void> {
  try {
    await assertRegularFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

async function assertRegularFile(path: string): Promise<void> {
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isFile) {
    throw new Error(
      `Sensitivity experience reuse WAL is not a confined regular file: ${path}.`,
    );
  }
}

function parseAttempt(value: unknown): SensitivityExperienceReuseAttempt {
  if (!value || typeof value !== "object") {
    throw new TypeError("$reuseAttempt must be an object.");
  }
  const status = (value as { status?: unknown }).status;
  const keys = [
    "schemaVersion",
    "projectId",
    "runId",
    "planDigest",
    "scientificKey",
    "status",
    "reviewFingerprint",
    ...(status === "receipt-recorded" || status === "completed"
      ? ["receiptFingerprint"]
      : []),
    ...(status === "completed" ? ["snapshot"] : []),
  ];
  const root = exactRecord(value, keys, "$reuseAttempt");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_EXPERIENCE_REUSE_ATTEMPT_SCHEMA,
    "$reuseAttempt.schemaVersion",
  );
  if (
    status !== "reviewed-miss" && status !== "reviewed-hit" &&
    status !== "receipt-recorded" && status !== "completed"
  ) throw new TypeError("$reuseAttempt.status is unknown.");
  const common = {
    schemaVersion: SENSITIVITY_EXPERIENCE_REUSE_ATTEMPT_SCHEMA,
    projectId: nonEmptyText(root.projectId, "$reuseAttempt.projectId"),
    runId: nonEmptyText(root.runId, "$reuseAttempt.runId"),
    planDigest: sha256Hex(root.planDigest, "$reuseAttempt.planDigest"),
    scientificKey: parseFingerprint(root.scientificKey, "$reuseAttempt.scientificKey"),
    reviewFingerprint: parseFingerprint(
      root.reviewFingerprint,
      "$reuseAttempt.reviewFingerprint",
    ),
  };
  if (status === "reviewed-miss" || status === "reviewed-hit") {
    return { ...common, status };
  }
  const receiptFingerprint = parseFingerprint(
    root.receiptFingerprint,
    "$reuseAttempt.receiptFingerprint",
  );
  if (status === "receipt-recorded") {
    return { ...common, status, receiptFingerprint };
  }
  return {
    ...common,
    status: "completed",
    receiptFingerprint,
    snapshot: parseSnapshot(root.snapshot),
  };
}

function assertAttemptIdentity(
  attempt: Pick<SensitivityExperienceReuseAttempt, "projectId" | "runId">,
  projectId: string,
  runId: string,
): void {
  if (attempt.projectId !== projectId || attempt.runId !== runId) {
    throw new Error(
      "Sensitivity experience reuse WAL identity is divergent from the requested tuple.",
    );
  }
}

function parseSnapshot(value: unknown): {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
} {
  const root = exactRecord(
    value,
    ["snapshotId", "revision", "subjectId"],
    "$reuseAttempt.snapshot",
  );
  return {
    snapshotId: nonEmptyText(root.snapshotId, "$reuseAttempt.snapshot.snapshotId"),
    revision: positiveInteger(root.revision, "$reuseAttempt.snapshot.revision"),
    subjectId: nonEmptyText(root.subjectId, "$reuseAttempt.snapshot.subjectId"),
  };
}

function assertPlan(
  attempt: SensitivityExperienceReuseAttempt,
  input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly scientificKey: ContentFingerprint;
  },
): void {
  if (
    attempt.projectId !== input.projectId || attempt.runId !== input.runId ||
    attempt.planDigest !== input.planDigest ||
    !sameFingerprint(attempt.scientificKey, input.scientificKey)
  ) throw new Error("Sensitivity experience reuse WAL plan is divergent.");
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: sha256Hex(root.digest, `${path}.digest`) };
}

function sha256Hex(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(`${path} must be SHA-256.`);
  return digest;
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}
