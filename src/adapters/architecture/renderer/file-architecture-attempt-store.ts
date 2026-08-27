/**
 * Immutable, run-scoped write-ahead journal for `model.write-architecture@1`.
 *
 * A run is allowed to dispatch exactly one provider mutation.  Its plan digest
 * is evidence of what was dispatched, never a secondary idempotency key: after
 * a crash the live model can produce a different plan and must not open another
 * mutation attempt for the same run.
 */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  architectureWriteSelector,
  type InsertionItem,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  type SysmlSourceAnalysisReference,
  validateSysmlSourceAnalysisReference,
} from "./sysml-source-analysis-capture.ts";
import {
  replaceAttemptFileDurably,
  syncAttemptDirectoryChain,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

const NO_WRITE_PROGRESS = "Architecture write-attempt journal made no write progress.";
export const ARCHITECTURE_WRITE_ATTEMPT_SCHEMA =
  "architecture-write-attempt/3.0" as const;

type ArchitectureWriteAttemptBase = {
  readonly schemaVersion: typeof ARCHITECTURE_WRITE_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly packageName: string;
  readonly items: readonly InsertionItem[];
  /** Exact CAS source+analysis evidence for every provider write in the plan. */
  readonly sourceAnalyses: readonly SysmlSourceAnalysisReference[];
  readonly planDigest: string;
  readonly dispatchedAt: string;
};

export type ArchitectureWriteAttempt =
  | ArchitectureWriteAttemptBase & {
    readonly status: "dispatched";
  }
  | ArchitectureWriteAttemptBase & {
    readonly status: "completed";
    readonly result: {
      readonly inserted: "true";
      readonly architecturePackageId: string;
    };
  };

export class ArchitectureWriteOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The SysON architecture insertion outcome is unknown and will not be retried automatically.",
    );
    this.name = "ArchitectureWriteOutcomeUnknownError";
  }
}

export type ArchitectureRunQuarantine = {
  readonly schemaVersion: "architecture-run-quarantine/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly reason: "structural_failure_post_acknowledgement";
  readonly quarantinedAt: string;
};

export class ArchitectureRunQuarantinedError extends Error {
  constructor() {
    super(
      "This architecture run is quarantined: a prior attempt acknowledged a SysON " +
        "insertion but structural verification failed. The SysON model may be partially " +
        "inserted. An operator must inspect and manually correct SysON before queuing " +
        "a new architecture run.",
    );
    this.name = "ArchitectureRunQuarantinedError";
  }
}

export class FileArchitectureAttemptStore {
  constructor(
    private readonly directory = "state/local/architecture-attempts",
  ) {}

  /**
   * Atomically reserve the sole provider dispatch allowed for this run.
   *
   * The returned completed action intentionally ignores the caller's current
   * planDigest: it is a recovery signal, so the executor must read back the
   * exact Package id pinned after acknowledgement and never insert again.
   */
  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly packageName: string;
    readonly items: readonly InsertionItem[];
    readonly planDigest: string;
    readonly dispatchedAt: string;
    readonly sourceAnalyses: readonly SysmlSourceAnalysisReference[];
  }): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly architecturePackageId: string }
  > {
    const fresh = await attempt(input);
    await Deno.mkdir(this.directory, { recursive: true });

    let current: ArchitectureWriteAttempt | undefined;
    try {
      current = await this.readRun(fresh.projectId, fresh.runId);
    } catch {
      throw new ArchitectureWriteOutcomeUnknownError();
    }
    if (current) return actionFor(current);

    const path = await this.pathFor(fresh.projectId, fresh.runId);
    try {
      await writeNewAttemptFileDurably(
        path,
        `${deterministicJson(fresh)}\n`,
        this.directory,
        NO_WRITE_PROGRESS,
      );
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.requiredRun(fresh.projectId, fresh.runId);
    await syncAttemptDirectoryChain(this.directory);
    return actionFor(existing);
  }

  /** Mark the run completed only after exact readback pinned the Package id. */
  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly architecturePackageId: string;
  }): Promise<void> {
    nonEmpty(input.projectId, "projectId");
    nonEmpty(input.runId, "runId");
    nonEmpty(input.planDigest, "planDigest");
    const architecturePackageId = nonEmpty(
      input.architecturePackageId,
      "architecturePackageId",
    );
    const existing = await this.requiredRun(input.projectId, input.runId);
    if (existing.planDigest !== input.planDigest) {
      throw new ArchitectureWriteOutcomeUnknownError();
    }
    const completed: ArchitectureWriteAttempt = {
      ...existing,
      status: "completed",
      result: { inserted: "true", architecturePackageId },
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Architecture insertion acknowledgement conflicts with the existing attempt.",
        );
      }
      await syncAttemptDirectoryChain(this.directory);
      return;
    }
    await replaceAttemptFileDurably(
      await this.pathFor(existing.projectId, existing.runId),
      `${deterministicJson(completed)}\n`,
      this.directory,
      NO_WRITE_PROGRESS,
    );
  }

  /** Return the immutable run record, independent of a newly computed plan. */
  async readRun(
    projectId: string,
    runId: string,
  ): Promise<ArchitectureWriteAttempt | undefined> {
    nonEmpty(projectId, "projectId");
    nonEmpty(runId, "runId");
    const current = await this.readPath(
      await this.pathFor(projectId, runId),
      projectId,
      runId,
      undefined,
    );
    return current;
  }

  async quarantine(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly quarantinedAt: string;
  }): Promise<void> {
    const record: ArchitectureRunQuarantine = {
      schemaVersion: "architecture-run-quarantine/1.0",
      projectId: nonEmpty(input.projectId, "projectId"),
      runId: nonEmpty(input.runId, "runId"),
      reason: "structural_failure_post_acknowledgement",
      quarantinedAt: timestamp(input.quarantinedAt, "quarantinedAt"),
    };
    await Deno.mkdir(this.directory, { recursive: true });
    const path = await this.quarantinePath(record.projectId, record.runId);
    try {
      await writeNewAttemptFileDurably(
        path,
        `${deterministicJson(record)}\n`,
        this.directory,
        NO_WRITE_PROGRESS,
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      // An EEXIST sentinel is safe only after its identity and shape have been
      // read back.  A torn/corrupt sentinel is an unknown outcome, not "true".
      await this.requiredQuarantine(record.projectId, record.runId);
      await syncAttemptDirectoryChain(this.directory);
    }
  }

  async isQuarantined(projectId: string, runId: string): Promise<boolean> {
    const current = await this.readQuarantinePath(
      await this.quarantinePath(projectId, runId),
      projectId,
      runId,
    );
    return current !== undefined;
  }

  private async requiredRun(
    projectId: string,
    runId: string,
  ): Promise<ArchitectureWriteAttempt> {
    try {
      const existing = await this.readRun(projectId, runId);
      if (!existing) throw new Error("Architecture insertion marker is missing.");
      return existing;
    } catch {
      throw new ArchitectureWriteOutcomeUnknownError();
    }
  }

  private async requiredQuarantine(
    projectId: string,
    runId: string,
  ): Promise<ArchitectureRunQuarantine> {
    const value = await this.readQuarantinePath(
      await this.quarantinePath(projectId, runId),
      projectId,
      runId,
    );
    if (!value) throw new ArchitectureWriteOutcomeUnknownError();
    return value;
  }

  private async readPath(
    path: string,
    projectId: string,
    runId: string,
    expectedPlanDigest: string | undefined,
  ): Promise<ArchitectureWriteAttempt | undefined> {
    try {
      return await parseAttempt(
        await Deno.readTextFile(path),
        projectId,
        runId,
        expectedPlanDigest,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private async readQuarantinePath(
    path: string,
    projectId: string,
    runId: string,
  ): Promise<ArchitectureRunQuarantine | undefined> {
    try {
      return parseQuarantine(await Deno.readTextFile(path), projectId, runId);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private async pathFor(projectId: string, runId: string): Promise<string> {
    return `${root(this.directory)}/run-${await sha256Hex(
      JSON.stringify([projectId, runId]),
    )}.json`;
  }

  private async quarantinePath(projectId: string, runId: string): Promise<string> {
    return `${root(this.directory)}/quarantine-${await sha256Hex(
      JSON.stringify([projectId, runId]),
    )}.json`;
  }
}

async function attempt(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly packageName: string;
  readonly items: readonly InsertionItem[];
  readonly planDigest: string;
  readonly dispatchedAt: string;
  readonly sourceAnalyses: readonly SysmlSourceAnalysisReference[];
}): Promise<ArchitectureWriteAttempt> {
  const projectId = nonEmpty(input.projectId, "projectId");
  const runId = nonEmpty(input.runId, "runId");
  const packageName = sysmlName(input.packageName, "packageName");
  const items = exactInsertionItems(input.items);
  const sourceAnalyses = exactSourceAnalyses(
    input.sourceAnalyses,
    runId,
    packageName,
    items,
  );
  const planDigest = hex64(input.planDigest, "planDigest");
  if (
    planDigest !==
      await architectureWritePlanDigest({ packageName, items, sourceAnalyses })
  ) {
    throw new Error("Architecture write-attempt planDigest does not seal its plan.");
  }
  return {
    schemaVersion: ARCHITECTURE_WRITE_ATTEMPT_SCHEMA,
    projectId,
    runId,
    packageName,
    items,
    sourceAnalyses,
    planDigest,
    status: "dispatched",
    dispatchedAt: timestamp(input.dispatchedAt, "dispatchedAt"),
  };
}

function actionFor(
  attempt: ArchitectureWriteAttempt,
): { readonly action: "completed"; readonly architecturePackageId: string } {
  if (attempt.status !== "completed") {
    throw new ArchitectureWriteOutcomeUnknownError();
  }
  return {
    action: "completed",
    architecturePackageId: attempt.result.architecturePackageId,
  };
}

async function parseAttempt(
  text: string,
  projectId: string,
  runId: string,
  expectedPlanDigest: string | undefined,
): Promise<ArchitectureWriteAttempt> {
  const record = parseObject(text, "Architecture insertion marker");
  const keys = Object.keys(record).sort();
  if (
    record.schemaVersion !== ARCHITECTURE_WRITE_ATTEMPT_SCHEMA ||
    record.projectId !== projectId || record.runId !== runId ||
    (typeof record.planDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(record.planDigest)) ||
    (expectedPlanDigest !== undefined && record.planDigest !== expectedPlanDigest) ||
    (record.status !== "dispatched" && record.status !== "completed") ||
    typeof record.dispatchedAt !== "string"
  ) throw new Error("Architecture insertion marker does not match its identity.");
  timestamp(record.dispatchedAt, "dispatchedAt");
  const expectedKeys = record.status === "completed"
    ? [
      "dispatchedAt",
      "items",
      "packageName",
      "planDigest",
      "projectId",
      "result",
      "runId",
      "schemaVersion",
      "sourceAnalyses",
      "status",
    ]
    : [
      "dispatchedAt",
      "items",
      "packageName",
      "planDigest",
      "projectId",
      "runId",
      "schemaVersion",
      "sourceAnalyses",
      "status",
    ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Architecture insertion marker has an unsupported shape.");
  }
  if (
    record.status === "completed" &&
    (!record.result || typeof record.result !== "object" ||
      Array.isArray(record.result) ||
      (record.result as Record<string, unknown>).inserted !== "true" ||
      typeof (record.result as Record<string, unknown>).architecturePackageId !==
        "string" ||
      !(record.result as Record<string, unknown>).architecturePackageId ||
      Object.keys(record.result as Record<string, unknown>).sort().join("\u0000") !==
        "architecturePackageId\u0000inserted")
  ) throw new Error("Completed architecture insertion marker has an invalid result.");
  const packageName = sysmlName(record.packageName, "packageName");
  const items = exactInsertionItems(record.items);
  const sourceAnalyses = exactSourceAnalyses(
    record.sourceAnalyses,
    runId,
    packageName,
    items,
  );
  if (
    record.planDigest !==
      await architectureWritePlanDigest({ packageName, items, sourceAnalyses })
  ) {
    throw new Error("Architecture insertion marker planDigest is not exact.");
  }
  const base: ArchitectureWriteAttemptBase = {
    schemaVersion: ARCHITECTURE_WRITE_ATTEMPT_SCHEMA,
    projectId,
    runId,
    packageName,
    items,
    sourceAnalyses,
    planDigest: record.planDigest,
    dispatchedAt: record.dispatchedAt,
  };
  return record.status === "completed"
    ? {
      ...base,
      status: "completed",
      result: {
        inserted: "true",
        architecturePackageId: (record.result as Record<string, unknown>)
          .architecturePackageId as string,
      },
    }
    : { ...base, status: "dispatched" };
}

function exactSourceAnalyses(
  value: unknown,
  runId: string,
  packageName: string,
  items: readonly InsertionItem[],
): readonly SysmlSourceAnalysisReference[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Architecture write-attempt must seal one or more SysML sources.");
  }
  const sourceAnalyses = value.map((rawReference, index) => {
    let reference: SysmlSourceAnalysisReference;
    try {
      reference = validateSysmlSourceAnalysisReference(rawReference);
    } catch (error) {
      throw new Error(
        `Architecture write-attempt has an invalid SysML source reference: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (reference.runId !== runId) {
      throw new Error(
        `Architecture write-attempt sourceAnalyses[${index}] names another run.`,
      );
    }
    if (
      reference.operation.id !== MODEL_WRITE_ARCHITECTURE_OPERATION.id ||
      reference.operation.version !== MODEL_WRITE_ARCHITECTURE_OPERATION.version
    ) {
      throw new Error(
        `Architecture write-attempt sourceAnalyses[${index}] names another operation.`,
      );
    }
    if (reference.selector.packageName !== packageName) {
      throw new Error(
        `Architecture write-attempt sourceAnalyses[${index}] names another package.`,
      );
    }
    return reference;
  });
  const keys = sourceAnalyses.map((reference) => deterministicJson(reference));
  if (new Set(keys).size !== keys.length) {
    throw new Error("Architecture write-attempt repeats a SysML source reference.");
  }
  const selectorKeys = sourceAnalyses.map((reference) =>
    deterministicJson(reference.selector)
  );
  if (new Set(selectorKeys).size !== selectorKeys.length) {
    throw new Error("Architecture write-attempt repeats a SysML source selector.");
  }
  const expectedSelectors = items.map((item) =>
    architectureWriteSelector(item, packageName)
  );
  if (
    deterministicJson(sourceAnalyses.map((reference) => reference.selector)) !==
      deterministicJson(expectedSelectors)
  ) {
    throw new Error(
      "Architecture write-attempt sourceAnalyses do not exactly cover its ordered write items.",
    );
  }
  return Object.freeze(sourceAnalyses);
}

function exactInsertionItems(value: unknown): readonly InsertionItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Architecture write-attempt items must be non-empty.");
  }
  const items = value.map((rawItem, index): InsertionItem => {
    const item = object(rawItem, `items[${index}]`);
    if (item.kind === "full-package") {
      exactKeys(item, ["kind"], `items[${index}]`);
      return { kind: "full-package" };
    }
    if (item.kind === "part-def") {
      exactKeys(item, ["kind", "componentName"], `items[${index}]`);
      return {
        kind: "part-def",
        componentName: sysmlName(item.componentName, `items[${index}].componentName`),
      };
    }
    if (item.kind === "usage") {
      exactKeys(
        item,
        ["kind", "componentName", "usageName", "parentName"],
        `items[${index}]`,
      );
      return {
        kind: "usage",
        componentName: sysmlName(item.componentName, `items[${index}].componentName`),
        usageName: usageName(item.usageName, `items[${index}].usageName`),
        parentName: sysmlName(item.parentName, `items[${index}].parentName`),
      };
    }
    if (item.kind === "attribute") {
      exactKeys(
        item,
        ["kind", "attributeName", "parentName"],
        `items[${index}]`,
      );
      return {
        kind: "attribute",
        attributeName: usageName(item.attributeName, `items[${index}].attributeName`),
        parentName: sysmlName(item.parentName, `items[${index}].parentName`),
      };
    }
    throw new Error(`Architecture write-attempt items[${index}] has unknown kind.`);
  });
  const fullPackageCount = items.filter((item) => item.kind === "full-package").length;
  if (
    fullPackageCount > 0 &&
    (fullPackageCount !== 1 || items[0]?.kind !== "full-package")
  ) {
    throw new Error(
      "Architecture write-attempt full-package plan must start with exactly one full-package item.",
    );
  }
  return Object.freeze(items);
}

export async function architectureWritePlanDigest(input: {
  readonly packageName: string;
  readonly items: readonly InsertionItem[];
  readonly sourceAnalyses: readonly SysmlSourceAnalysisReference[];
}): Promise<string> {
  return (await sha256Fingerprint({
    packageName: input.packageName,
    items: input.items,
    sourceAnalyses: input.sourceAnalyses,
  })).digest;
}

function parseQuarantine(
  text: string,
  projectId: string,
  runId: string,
): ArchitectureRunQuarantine {
  const record = parseObject(text, "Architecture quarantine marker");
  const keys = Object.keys(record).sort();
  const expected = ["projectId", "quarantinedAt", "reason", "runId", "schemaVersion"];
  if (
    record.schemaVersion !== "architecture-run-quarantine/1.0" ||
    record.projectId !== projectId || record.runId !== runId ||
    record.reason !== "structural_failure_post_acknowledgement" ||
    typeof record.quarantinedAt !== "string" || keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) throw new Error("Architecture quarantine marker does not match its identity.");
  timestamp(record.quarantinedAt, "quarantinedAt");
  return {
    schemaVersion: "architecture-run-quarantine/1.0",
    projectId,
    runId,
    reason: "structural_failure_post_acknowledgement",
    quarantinedAt: record.quarantinedAt,
  };
}

function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) throw new Error(`${path} has an unsupported shape.`);
}

function sysmlName(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${path} must be a SysML identifier.`);
  }
  return value;
}

function usageName(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${path} must be a SysML usage identifier.`);
  }
  return value;
}

function hex64(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${path} must be a SHA-256 digest.`);
  }
  return value;
}

function root(directory: string): string {
  return directory.replace(/\/$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be non-empty.`);
  }
  return value;
}

function timestamp(value: string, label: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}
