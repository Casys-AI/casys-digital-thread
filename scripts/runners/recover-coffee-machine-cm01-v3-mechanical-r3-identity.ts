import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../../src/adapters/mcp/http-mcp-tool-client.ts";

/** Explicit consent for the provider-free R10 -> R11 identity recovery. */
export const CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT =
  "RECOVER_CM01_V3_MECHANICAL_R3_IDENTITY" as const;

const PROJECT_ID = "coffee-machine-cm01-v3" as const;
const SUBJECT_ID = "project:coffee-machine-cm01-v3" as const;
const MCP_URL = "http://127.0.0.1:3020/mcp";
const ISSUED_AT = "2026-08-03T13:15:00.000Z";
const COMMAND_PREFIX = "cm01-v3-r10-r11-mechanical-r3-identity-recovery";
const HISTORICAL_R3_WORK_ITEM_ID =
  "verify-cm01-v3-drip-tray-height-30-mechanical-r3-retry";
const RECOVERY = {
  phaseId: "cm01-v3-drip-tray-height-30-mechanical-r3-identity-recovery",
  workItemId: "recover-cm01-v3-drip-tray-height-30-mechanical-r3-identity",
  operation: {
    id: "repair.coffee-machine-cm01-drip-tray-mechanical-r3-identity",
    version: "1",
  },
  appendCommandId: `${COMMAND_PREFIX}-append`,
  queueCommandId: `${COMMAND_PREFIX}-queue`,
  executeCommandId: `${COMMAND_PREFIX}-execute`,
} as const;
const ORIGINAL_R3_OPERATION = {
  id: "verify.coffee-machine-cm01-drip-tray-mechanical",
  version: "3",
} as const;
const R10_SOLVE_ID = /^coffee-machine-cm01-v3-mechanical-r2-[a-f0-9]{64}-solve$/;
const R11_SOLVE_ID = /^coffee-machine-cm01-v3-mechanical-r3-[a-f0-9]{64}-solve$/;

export interface RecoverCoffeeMachineCm01V3MechanicalR3IdentityOptions {
  readonly execute?: boolean;
  readonly acknowledgement?: string;
  /** Test seam; production uses the local streamable MCP server only. */
  readonly client?: McpToolClient;
  readonly mcpUrl?: string;
}

export type RecoverCoffeeMachineCm01V3MechanicalR3IdentityResult =
  | {
    readonly status: "confirmation-required";
    readonly acknowledgement:
      typeof CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT;
    readonly note: string;
  }
  | {
    readonly status: "completed";
    readonly projectId: typeof PROJECT_ID;
    readonly projectRevision: number;
    readonly historicalR10Evidence: ThreadEntityRef;
    readonly r3Evidence: ThreadEntityRef;
    readonly snapshot: ThreadSnapshotRef;
    readonly note: string;
  };

interface ThreadSnapshotRef {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}

interface ThreadEntityRef {
  readonly snapshotId: string;
  readonly snapshotRevision: number;
  readonly kind: "artifact";
  readonly id: string;
}

interface ProjectView {
  readonly value: Record<string, unknown>;
  readonly revision: number;
  readonly head: ThreadSnapshotRef;
}

interface RunView {
  readonly value: Record<string, unknown>;
  readonly id: string;
  readonly workItemId: string;
  readonly status: string;
}

/**
 * Queue and execute the sole R10 -> R11 identity correction through MCP.
 *
 * It never reads local project files, invokes a provider, replays R3, aliases
 * R10, or accepts an arbitrary artifact. The registered server executor reads
 * only the immutable completed R3 capture and rejects every other boundary.
 */
export async function recoverCoffeeMachineCm01V3MechanicalR3Identity(
  options: RecoverCoffeeMachineCm01V3MechanicalR3IdentityOptions = {},
): Promise<RecoverCoffeeMachineCm01V3MechanicalR3IdentityResult> {
  if (!options.execute) {
    return {
      status: "confirmation-required",
      acknowledgement: CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT,
      note:
        "This will append one provider-free R3 identity-recovery run. R10 remains immutable historical evidence.",
    };
  }
  if (
    options.acknowledgement !== CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT
  ) {
    throw new Error(
      `Refusing CM-01 R3 identity recovery without --acknowledge=${CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT}.`,
    );
  }
  const mcpUrl = options.mcpUrl ?? MCP_URL;
  assertLoopback(mcpUrl);
  const client = options.client ??
    new HttpMcpToolClient({ mcpUrl, timeoutMs: 120_000 });
  let project = await readProject(client);
  assertCanonicalProject(project);

  const existing = workItem(project, RECOVERY.workItemId, false);
  if (existing) {
    const historical = retainedOriginalR3Evidence(project);
    assertRecoveryWorkItem(existing, historical);
    const runs = runsForWorkItem(project, RECOVERY.workItemId);
    if (runs.length === 0) {
      requireExactR10Boundary(project, historical);
      project = await queueRecovery(client, project);
      project = await executeExisting(
        client,
        project,
        exactRun(project, RECOVERY.workItemId),
      );
      return completed(project, exactRun(project, RECOVERY.workItemId), historical);
    }
    if (runs.length !== 1) {
      throw new Error("CM-01 project must have exactly one R3 identity-recovery run.");
    }
    const run = runs[0]!;
    if (run.status === "completed") return completed(project, run, historical);
    if (run.status === "failed" || run.status === "cancelled") {
      throw new Error(
        "The R3 identity-recovery run stopped; review it before creating a new recovery.",
      );
    }
    requireExactR10Boundary(project, historical);
    project = await executeExisting(client, project, run);
    return completed(project, exactRun(project, RECOVERY.workItemId), historical);
  }

  const historical = requireExactR10Boundary(project);
  project = projectFromResult(
    await client.callTool({
      name: "project_change_append",
      arguments: {
        commandId: RECOVERY.appendCommandId,
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: ISSUED_AT,
        baseSnapshot: project.head,
        phases: [{
          id: RECOVERY.phaseId,
          name: "Correct the CM-01 R3 mechanical evidence identity",
          description:
            "Create one correctly identified R3 successor from the immutable completed capture. The R10 record remains visible as superseded history.",
        }],
        workItems: [{
          id: RECOVERY.workItemId,
          phaseId: RECOVERY.phaseId,
          owner: "agent",
          dependsOnWorkItemIds: [],
          decisionIds: [],
          operation: {
            ...RECOVERY.operation,
            bindings: recoveryBindings(historical),
          },
        }],
        requiredDecisions: [],
      },
    }),
  );
  assertCanonicalProject(project);
  assertRecoveryWorkItem(requiredWorkItem(project, RECOVERY.workItemId), historical);

  project = await queueRecovery(client, project);
  const queued = exactRun(project, RECOVERY.workItemId);
  project = await executeExisting(client, project, queued);
  return completed(project, exactRun(project, RECOVERY.workItemId), historical);
}

async function queueRecovery(
  client: McpToolClient,
  project: ProjectView,
): Promise<ProjectView> {
  const queued = projectFromResult(
    await client.callTool({
      name: "project_agent_run_queue",
      arguments: {
        commandId: RECOVERY.queueCommandId,
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: ISSUED_AT,
        workItemId: RECOVERY.workItemId,
      },
    }),
  );
  const run = exactRun(queued, RECOVERY.workItemId);
  if (run.status !== "queued") {
    throw new Error(
      `CM-01 R3 identity-recovery run must be queued; received ${run.status}.`,
    );
  }
  return queued;
}

async function executeExisting(
  client: McpToolClient,
  project: ProjectView,
  run: RunView,
): Promise<ProjectView> {
  if (
    run.status !== "queued" && run.status !== "running" && run.status !== "publishing"
  ) {
    throw new Error(
      `CM-01 R3 identity-recovery run cannot execute from ${run.status}.`,
    );
  }
  return projectFromResult(
    await client.callTool({
      name: "project_agent_run_execute",
      arguments: {
        commandId: RECOVERY.executeCommandId,
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: ISSUED_AT,
        runId: run.id,
      },
    }),
  );
}

function completed(
  project: ProjectView,
  run: RunView,
  historical: ThreadEntityRef,
): Extract<
  RecoverCoffeeMachineCm01V3MechanicalR3IdentityResult,
  { status: "completed" }
> {
  assertCanonicalProject(project);
  if (run.status !== "completed") {
    throw new Error(
      `CM-01 R3 identity-recovery run must be completed; received ${run.status}.`,
    );
  }
  const result = snapshotRef(
    run.value.resultSnapshot,
    "identity-recovery resultSnapshot",
  );
  if (
    result.revision !== 11 || !result.snapshotId.includes("mechanical-r3-") ||
    result.snapshotId.includes("mechanical-r2-") || !sameSnapshot(result, project.head)
  ) {
    throw new Error(
      "CM-01 R3 identity recovery must publish exactly the correctly named R11 snapshot.",
    );
  }
  const evidence = exactlyOneEvidence(run, result);
  if (!R11_SOLVE_ID.test(evidence.id)) {
    throw new Error(
      "CM-01 R3 identity recovery did not return the correctly named R3 solve artifact.",
    );
  }
  return {
    status: "completed",
    projectId: PROJECT_ID,
    projectRevision: project.revision,
    historicalR10Evidence: historical,
    r3Evidence: evidence,
    snapshot: result,
    note:
      "R10 remains immutable, superseded history. R11 reuses its verified completed R3 capture without provider calls and records only R3 identity.",
  };
}

function requireExactR10Boundary(
  project: ProjectView,
  historical = retainedOriginalR3Evidence(project),
): ThreadEntityRef {
  if (
    project.head.revision !== 10 || !project.head.snapshotId.includes(":r10:") ||
    !project.head.snapshotId.includes("mechanical-r2-")
  ) {
    throw new Error(
      "CM-01 R3 identity recovery requires the exact retained R10 naming-defect head.",
    );
  }
  if (
    historical.snapshotId !== project.head.snapshotId ||
    historical.snapshotRevision !== project.head.revision
  ) {
    throw new Error(
      "The retained original R3 run must point to the current R10 snapshot.",
    );
  }
  return historical;
}

function retainedOriginalR3Evidence(project: ProjectView): ThreadEntityRef {
  const original = requiredWorkItem(project, HISTORICAL_R3_WORK_ITEM_ID);
  assertOperation(original, ORIGINAL_R3_OPERATION);
  const run = exactRun(project, HISTORICAL_R3_WORK_ITEM_ID);
  if (run.status !== "completed") {
    throw new Error("The retained CM-01 R3 source run must be completed.");
  }
  const result = snapshotRef(run.value.resultSnapshot, "historical R3 resultSnapshot");
  const evidence = exactlyOneEvidence(run, result);
  if (
    result.revision !== 10 || !result.snapshotId.includes(":r10:") ||
    !result.snapshotId.includes("mechanical-r2-") || !R10_SOLVE_ID.test(evidence.id)
  ) {
    throw new Error(
      "The retained original R3 run is not the known R10 naming-defect solve record.",
    );
  }
  return evidence;
}

function recoveryBindings(historical: ThreadEntityRef) {
  return [
    { name: "approvedBrief", source: { kind: "approved-brief" } },
    {
      name: "historicalMechanicalR3Result",
      source: { kind: "thread-entity", reference: historical },
    },
  ] as const;
}

function assertRecoveryWorkItem(
  value: Record<string, unknown>,
  historical: ThreadEntityRef,
): void {
  assertOperation(value, RECOVERY.operation);
  const bindings = array(
    object(value.operation, "identity-recovery operation").bindings,
    "identity-recovery bindings",
  );
  const expected = recoveryBindings(historical);
  if (bindings.length !== expected.length) {
    throw new Error("CM-01 R3 identity-recovery bindings are incomplete.");
  }
  const brief = object(bindings[0], "identity-recovery approvedBrief");
  if (
    string(brief.name, "identity-recovery approvedBrief.name") !== "approvedBrief" ||
    string(
        object(brief.source, "identity-recovery approvedBrief.source").kind,
        "identity-recovery approvedBrief.source.kind",
      ) !== "approved-brief"
  ) {
    throw new Error(
      "CM-01 R3 identity recovery must retain the approved-brief binding.",
    );
  }
  const source = object(
    object(bindings[1], "identity-recovery evidence").source,
    "identity-recovery evidence.source",
  );
  const actual = entityRef(source.reference, "identity-recovery evidence.reference");
  if (
    string(
        object(bindings[1], "identity-recovery evidence").name,
        "identity-recovery evidence.name",
      ) !==
      "historicalMechanicalR3Result" ||
    string(source.kind, "identity-recovery evidence.source.kind") !== "thread-entity" ||
    actual.id !== historical.id || actual.kind !== "artifact" ||
    actual.snapshotId !== historical.snapshotId ||
    actual.snapshotRevision !== historical.snapshotRevision
  ) {
    throw new Error(
      "CM-01 R3 identity recovery must bind exactly the retained R10 solve.",
    );
  }
}

function assertCanonicalProject(project: ProjectView): void {
  if (string(project.value.schemaVersion, "project.schemaVersion") !== "3.0") {
    throw new Error(
      "CM-01 R3 identity recovery requires an EngineeringProject V3 contract.",
    );
  }
  const identity = object(project.value.project, "project.project");
  if (
    string(identity.id, "project.project.id") !== PROJECT_ID ||
    string(identity.subjectId, "project.project.subjectId") !== SUBJECT_ID
  ) {
    throw new Error("The MCP server did not return the canonical CM-01 V3 project.");
  }
  const framing = object(project.value.framing, "project.framing");
  const approval = object(
    framing.currentBriefApproval,
    "project.framing.currentBriefApproval",
  );
  if (
    string(approval.status, "project.framing.currentBriefApproval.status") !==
      "approved"
  ) {
    throw new Error("CM-01 R3 identity recovery requires the approved project brief.");
  }
}

function requiredWorkItem(project: ProjectView, id: string): Record<string, unknown> {
  const item = workItem(project, id, true);
  if (!item) throw new Error(`CM-01 project has no work item ${id}.`);
  return item;
}

function workItem(
  project: ProjectView,
  id: string,
  required: boolean,
): Record<string, unknown> | undefined {
  const matching = array(project.value.workItems, "project.workItems").filter((value) =>
    string(object(value, "project.workItem").id, "project.workItem.id") === id
  );
  if (matching.length === 1) return object(matching[0], `project.workItem(${id})`);
  if (!required && matching.length === 0) return undefined;
  throw new Error(`CM-01 project must have exactly one work item ${id}.`);
}

function exactRun(project: ProjectView, workItemId: string): RunView {
  const matching = runsForWorkItem(project, workItemId);
  if (matching.length !== 1) {
    throw new Error(`CM-01 project must have exactly one run for ${workItemId}.`);
  }
  return matching[0]!;
}

function runsForWorkItem(
  project: ProjectView,
  workItemId: string,
): readonly RunView[] {
  return array(project.value.agentRuns, "project.agentRuns")
    .map((value) => run(value))
    .filter((item) => item.workItemId === workItemId);
}

function run(value: unknown): RunView {
  const record = object(value, "project.agentRun");
  return {
    value: record,
    id: string(record.id, "project.agentRun.id"),
    workItemId: string(record.workItemId, "project.agentRun.workItemId"),
    status: string(record.status, "project.agentRun.status"),
  };
}

function assertOperation(
  workItem: Record<string, unknown>,
  expected: { readonly id: string; readonly version: string },
): void {
  const operation = object(workItem.operation, "workItem.operation");
  if (
    string(operation.id, "workItem.operation.id") !== expected.id ||
    string(operation.version, "workItem.operation.version") !== expected.version
  ) {
    throw new Error(
      `CM-01 project work item does not declare ${expected.id}@${expected.version}.`,
    );
  }
}

function exactlyOneEvidence(run: RunView, result: ThreadSnapshotRef): ThreadEntityRef {
  const values = array(run.value.evidenceRefs, "run.evidenceRefs");
  if (values.length !== 1) {
    throw new Error(`${run.workItemId} must expose exactly one artifact evidence ref.`);
  }
  const evidence = entityRef(values[0], "run.evidenceRefs[0]");
  if (
    evidence.snapshotId !== result.snapshotId ||
    evidence.snapshotRevision !== result.revision
  ) {
    throw new Error(
      `${run.workItemId} evidence must belong to its exact result snapshot.`,
    );
  }
  return evidence;
}

function projectFromResult(
  result: { readonly structuredContent: Readonly<Record<string, unknown>> },
): ProjectView {
  const value = object(result.structuredContent, "MCP structuredContent");
  const snapshots = array(value.threadSnapshots, "project.threadSnapshots")
    .map((item) => snapshotRef(item, "project.threadSnapshot"));
  if (snapshots.length === 0) {
    throw new Error("CM-01 project has no declared ThreadSnapshot.");
  }
  const head = [...snapshots].sort((left, right) => right.revision - left.revision)[0]!;
  return { value, revision: positive(value.revision, "project.revision"), head };
}

async function readProject(client: McpToolClient): Promise<ProjectView> {
  return projectFromResult(
    await client.callTool({
      name: "project_snapshot",
      arguments: { projectId: PROJECT_ID },
    }),
  );
}

function snapshotRef(value: unknown, label: string): ThreadSnapshotRef {
  const record = object(value, label);
  return {
    snapshotId: string(record.snapshotId, `${label}.snapshotId`),
    revision: positive(record.revision, `${label}.revision`),
    subjectId: string(record.subjectId, `${label}.subjectId`),
  };
}

function entityRef(value: unknown, label: string): ThreadEntityRef {
  const record = object(value, label);
  if (string(record.kind, `${label}.kind`) !== "artifact") {
    throw new Error(`${label}.kind must be artifact.`);
  }
  return {
    snapshotId: string(record.snapshotId, `${label}.snapshotId`),
    snapshotRevision: positive(record.snapshotRevision, `${label}.snapshotRevision`),
    kind: "artifact",
    id: string(record.id, `${label}.id`),
  };
}

function sameSnapshot(left: ThreadSnapshotRef, right: ThreadSnapshotRef): boolean {
  return left.snapshotId === right.snapshotId && left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function assertLoopback(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new Error("CM-01 R3 identity recovery only permits the local MCP endpoint.");
  }
}

if (import.meta.main) {
  const args = new Set(Deno.args);
  const result = await recoverCoffeeMachineCm01V3MechanicalR3Identity({
    execute: args.has("--execute"),
    acknowledgement: Deno.args.find((value) => value.startsWith("--acknowledge="))
      ?.slice("--acknowledge=".length),
  });
  console.log(JSON.stringify(result, null, 2));
}
