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
} from "../../domain/kernel/deterministic-json.ts";
import {
  type InsertionItem,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
} from "../../domain/platform/architecture-proposal.ts";
import {
  type SysmlSourceAnalysisReference,
  validateSysmlSourceAnalysisReference,
} from "../captures/sysml-source-analysis-capture.ts";

type ArchitectureWriteAttemptV2Base = {
  readonly schemaVersion: "architecture-write-attempt/2.0";
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  readonly dispatchedAt: string;
};

type ArchitectureWriteAttemptV3Base = {
  readonly schemaVersion: "architecture-write-attempt/3.0";
  readonly projectId: string;
  readonly runId: string;
  readonly packageName: string;
  readonly items: readonly InsertionItem[];
  /** Exact CAS source+analysis evidence for every provider write in the plan. */
  readonly sourceAnalyses: readonly SysmlSourceAnalysisReference[];
  readonly planDigest: string;
  readonly dispatchedAt: string;
};

export type ArchitectureWriteAttemptV2 =
  | ArchitectureWriteAttemptV2Base & {
    readonly status: "dispatched";
  }
  | ArchitectureWriteAttemptV2Base & {
    readonly status: "completed";
    readonly result: {
      readonly inserted: "true";
      readonly architecturePackageId: string;
    };
  };

type ArchitectureWriteAttemptV3 =
  | ArchitectureWriteAttemptV3Base & {
    readonly status: "dispatched";
  }
  | ArchitectureWriteAttemptV3Base & {
    readonly status: "completed";
    readonly result: {
      readonly inserted: "true";
      readonly architecturePackageId: string;
    };
  };

export type ArchitectureWriteAttempt =
  | ArchitectureWriteAttemptV2
  | ArchitectureWriteAttemptV3;

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
    private readonly directory = "state/local/architecture-write-attempts",
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

    // The new run-scoped record is authoritative if a deployment briefly has
    // both formats. A stale legacy per-plan marker must not hide a completed
    // immutable recovery record.
    let current: ArchitectureWriteAttempt | undefined;
    try {
      current = await this.readRun(fresh.projectId, fresh.runId);
    } catch {
      throw new ArchitectureWriteOutcomeUnknownError();
    }
    if (current) return actionFor(current);

    const path = await this.pathFor(fresh.projectId, fresh.runId);
    try {
      await writeNewDurably(path, `${deterministicJson(fresh)}\n`, this.directory);
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.requiredRun(fresh.projectId, fresh.runId);
    await syncDirectoryChain(this.directory);
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
    // Historical v2 records are immutable evidence only.  They can prevent a
    // redispatch and remain readable for historical replay, but must never be
    // promoted into a current completed acknowledgement: doing so would invent
    // v3 source-analysis context that the historical dispatch did not seal.
    if (existing.schemaVersion !== "architecture-write-attempt/3.0") {
      throw new ArchitectureWriteOutcomeUnknownError();
    }
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
      await syncDirectoryChain(this.directory);
      return;
    }
    await replaceDurably(
      await this.pathFor(existing.projectId, existing.runId),
      `${deterministicJson(completed)}\n`,
      this.directory,
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
    if (current) return current;

    // Before run-scoped filenames and Package-id pinning were introduced, the
    // plan digest was part of the filename and a completed marker carried no
    // architecturePackageId. Such a record can block a second dispatch but can
    // never authorize publication. A current hash record above remains
    // authoritative during a mixed-format deployment.
    return await this.readLegacyRun(projectId, runId);
  }

  /** Compatibility for callers that still need to inspect an exact legacy plan. */
  async read(
    projectId: string,
    runId: string,
    planDigest: string,
  ): Promise<ArchitectureWriteAttempt | undefined> {
    nonEmpty(planDigest, "planDigest");
    const current = await this.readRun(projectId, runId);
    return current?.planDigest === planDigest ? current : undefined;
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
    const legacy = await this.readLegacyQuarantine(record.projectId, record.runId);
    if (legacy) {
      await syncDirectoryChain(this.directory);
      return;
    }
    const path = await this.quarantinePath(record.projectId, record.runId);
    try {
      await writeNewDurably(
        path,
        `${deterministicJson(record)}\n`,
        this.directory,
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      // An EEXIST sentinel is safe only after its identity and shape have been
      // read back.  A torn/corrupt sentinel is an unknown outcome, not "true".
      await this.requiredQuarantine(record.projectId, record.runId);
      await syncDirectoryChain(this.directory);
    }
  }

  async isQuarantined(projectId: string, runId: string): Promise<boolean> {
    const current = await this.readQuarantinePath(
      await this.quarantinePath(projectId, runId),
      projectId,
      runId,
    );
    if (current) return true;
    return Boolean(await this.readLegacyQuarantine(projectId, runId));
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

  private async readLegacyRun(
    projectId: string,
    runId: string,
  ): Promise<ArchitectureWriteAttempt | undefined> {
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(this.directory)) entries.push(entry);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile) continue;
      const identity = legacyAttemptIdentity(entry.name);
      if (!identity || identity.projectId !== projectId || identity.runId !== runId) {
        continue;
      }
      throw new ArchitectureWriteOutcomeUnknownError();
    }
    return undefined;
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

  private async readLegacyQuarantine(
    projectId: string,
    runId: string,
  ): Promise<ArchitectureRunQuarantine | undefined> {
    const path = legacyQuarantinePath(this.directory, projectId, runId);
    if (!fitsNameMax(path)) return undefined;
    return await this.readQuarantinePath(path, projectId, runId);
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

/**
 * Test-only migration fixture for immutable v2 records.
 *
 * Production code has no v2 writer: `begin` always requires and writes a v3
 * plan. Historical tests use this explicit helper when they need to prove
 * bi-read behavior without weakening the production boundary.
 */
export async function writeArchitectureAttemptV2Fixture(
  directory: string,
  input: ArchitectureWriteAttemptV2,
): Promise<void> {
  const normalized = await parseAttempt(
    deterministicJson(input),
    input.projectId,
    input.runId,
    input.planDigest,
  );
  if (normalized.schemaVersion !== "architecture-write-attempt/2.0") {
    throw new Error("Architecture v2 fixture did not normalize as historical v2.");
  }
  await Deno.mkdir(directory, { recursive: true });
  const path = `${root(directory)}/run-${await sha256Hex(
    JSON.stringify([input.projectId, input.runId]),
  )}.json`;
  await writeNewDurably(path, `${deterministicJson(normalized)}\n`, directory);
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
    schemaVersion: "architecture-write-attempt/3.0",
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

async function writeNewDurably(
  path: string,
  text: string,
  directory: string,
): Promise<void> {
  // Write a fully synced inode under a short, private name, then publish it
  // with link(2). Unlike createNew on the final name, readers can never see a
  // zero-byte/partial record while the producer is still writing it.
  const temporary = `${root(directory)}/.${crypto.randomUUID()}.tmp`;
  try {
    await writeTemporaryDurably(temporary, text);
    await Deno.link(temporary, path);
    await syncDirectoryChain(directory);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

async function writeTemporaryDurably(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    await writeAll(file, text);
    await file.syncData();
  } finally {
    file.close();
  }
}

async function replaceDurably(
  path: string,
  text: string,
  directory: string,
): Promise<void> {
  // Keep the temporary basename short: appending to an identity-derived name
  // can exceed NAME_MAX even though the final hash name is safe.
  const temporary = `${root(directory)}/.${crypto.randomUUID()}.tmp`;
  try {
    await writeTemporaryDurably(temporary, text);
    await Deno.rename(temporary, path);
    await syncDirectoryChain(directory);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

async function writeAll(file: Deno.FsFile, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  let written = 0;
  while (written < bytes.length) {
    const count = await file.write(bytes.subarray(written));
    if (count <= 0) {
      throw new Error("Architecture write-attempt journal made no write progress.");
    }
    written += count;
  }
}

async function syncDirectoryChain(path: string): Promise<void> {
  let current = root(path) || ".";
  while (current !== "/") {
    const directory = await Deno.open(current, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    if (current === "state" || current.endsWith("/state") || current === ".") return;
    const slash = current.lastIndexOf("/");
    current = slash < 0 ? "." : slash === 0 ? "/" : current.slice(0, slash);
  }
}

async function parseAttempt(
  text: string,
  projectId: string,
  runId: string,
  expectedPlanDigest: string | undefined,
): Promise<ArchitectureWriteAttempt> {
  const record = parseObject(text, "Architecture insertion marker");
  const keys = Object.keys(record).sort();
  const isV2 = record.schemaVersion === "architecture-write-attempt/2.0";
  const isV3 = record.schemaVersion === "architecture-write-attempt/3.0";
  if (
    (!isV2 && !isV3) ||
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
      "planDigest",
      "projectId",
      "result",
      "runId",
      "schemaVersion",
      "status",
    ]
    : ["dispatchedAt", "planDigest", "projectId", "runId", "schemaVersion", "status"];
  if (isV3) {
    expectedKeys.push("items", "packageName", "sourceAnalyses");
  }
  expectedKeys.sort();
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
  let base: ArchitectureWriteAttemptV2Base | ArchitectureWriteAttemptV3Base;
  if (isV3) {
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
    base = {
      schemaVersion: "architecture-write-attempt/3.0" as const,
      projectId,
      runId,
      packageName,
      items,
      sourceAnalyses,
      planDigest: record.planDigest,
      dispatchedAt: record.dispatchedAt,
    };
  } else {
    base = {
      schemaVersion: "architecture-write-attempt/2.0" as const,
      projectId,
      runId,
      planDigest: record.planDigest,
      dispatchedAt: record.dispatchedAt,
    };
  }
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
  const expectedSelectors = items.map((item) => selectorForItem(item, packageName));
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
    throw new Error(`Architecture write-attempt items[${index}] has unknown kind.`);
  });
  const fullPackageCount = items.filter((item) => item.kind === "full-package").length;
  if (fullPackageCount > 0 && (fullPackageCount !== 1 || items.length !== 1)) {
    throw new Error("Architecture write-attempt full-package plan is not exact.");
  }
  return Object.freeze(items);
}

function selectorForItem(item: InsertionItem, packageName: string) {
  if (item.kind === "full-package") {
    return {
      kind: "full-package" as const,
      packageName,
    };
  }
  if (item.kind === "part-def") {
    return {
      kind: "part-def" as const,
      packageName,
      componentName: item.componentName,
    };
  }
  return {
    kind: "usage" as const,
    packageName,
    componentName: item.componentName,
    usageName: item.usageName,
    parentName: item.parentName,
  };
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

function legacyAttemptIdentity(
  fileName: string,
):
  | { readonly projectId: string; readonly runId: string; readonly planDigest: string }
  | undefined {
  if (!fileName.endsWith(".json")) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(fileName.slice(0, -".json".length)));
  } catch {
    // Modern hash names and unrelated files are not legacy markers.
    return undefined;
  }
  if (
    !Array.isArray(value) || value.length !== 3 ||
    value.some((part) => typeof part !== "string" || !part.trim())
  ) return undefined;
  const [projectId, runId, planDigest] = value as [string, string, string];
  return { projectId, runId, planDigest };
}

function legacyQuarantinePath(
  directory: string,
  projectId: string,
  runId: string,
): string {
  return `${root(directory)}/quarantine-${
    encodeURIComponent(JSON.stringify([projectId, runId]))
  }.json`;
}

function fitsNameMax(path: string): boolean {
  return new TextEncoder().encode(path.slice(path.lastIndexOf("/") + 1)).length <= 255;
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
