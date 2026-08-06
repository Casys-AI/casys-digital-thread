import { parseArgs } from "../lib/cli.ts";
import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../../src/adapters/mcp/http-mcp-tool-client.ts";

/**
 * Explicit consent for the one reviewed CM-01 R3 mechanical retry. This runner
 * is intentionally separate from the failed R2 run: its write-ahead provider
 * attempt is retained as an unknown outcome and is never replayed.
 */
export const CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT =
  "EXECUTE_CM01_V3_MECHANICAL_R3_RETRY" as const;

export const CM01_V3_MECHANICAL_R3_RETRY_PROJECT_ID = "coffee-machine-cm01-v3" as const;
export const CM01_V3_MECHANICAL_R3_RETRY_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;

const MCP_URL = "http://127.0.0.1:3020/mcp";
const ISSUED_AT = "2026-08-03T12:30:00.000Z";
const COMMAND_PREFIX = "cm01-v3-r9-r10-mechanical-r3-retry";
const CORRECTION_ARTIFACT_ID =
  "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record";
const CAD_R2_STEP_ID = /^coffee-machine-cm01-v3-cad-r2-[a-f0-9]{64}-step$/;

const R2 = {
  correctionWorkItemId: "record-cm01-v3-drip-tray-height-28-to-30-correction",
  cadWorkItemId: "build-cm01-v3-drip-tray-height-30-cad",
  mechanicalWorkItemId: "verify-cm01-v3-drip-tray-height-30-mechanical",
  mechanicalFailureCode: "cm01-r2-mechanical-not-published",
} as const;

const R3 = {
  phaseId: "cm01-v3-drip-tray-height-30-mechanical-r3-retry",
  workItemId: "verify-cm01-v3-drip-tray-height-30-mechanical-r3-retry",
  appendCommandId: `${COMMAND_PREFIX}-append`,
  queueCommandId: `${COMMAND_PREFIX}-queue`,
  executeCommandId: `${COMMAND_PREFIX}-execute`,
  operation: {
    id: "verify.coffee-machine-cm01-drip-tray-mechanical",
    version: "3",
  },
} as const;

export interface RunCoffeeMachineCm01V3MechanicalR3RetryOptions {
  /** Required together with the exact acknowledgement before any MCP call. */
  readonly execute?: boolean;
  readonly acknowledgement?: string;
  /** Test seam; production always calls server.ts's local streamable MCP endpoint. */
  readonly client?: McpToolClient;
  /** Loopback endpoint only; the production default is server.ts on port 3020. */
  readonly mcpUrl?: string;
}

export interface CoffeeMachineCm01V3MechanicalR3RetryConfirmationRequired {
  readonly status: "confirmation-required";
  readonly acknowledgement:
    typeof CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT;
  readonly operations: readonly string[];
  readonly note: string;
}

export interface CoffeeMachineCm01V3MechanicalR3RetryCompleted {
  readonly status: "completed";
  readonly projectId: typeof CM01_V3_MECHANICAL_R3_RETRY_PROJECT_ID;
  readonly projectRevision: number;
  readonly correctionEvidence: ThreadEntityRef;
  readonly revisedCadStepEvidence: ThreadEntityRef;
  readonly mechanicalEvidence: ThreadEntityRef;
  readonly mechanicalSnapshot: ThreadSnapshotRef;
  readonly note: string;
}

export type CoffeeMachineCm01V3MechanicalR3RetryResult =
  | CoffeeMachineCm01V3MechanicalR3RetryConfirmationRequired
  | CoffeeMachineCm01V3MechanicalR3RetryCompleted;

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

interface RetryBasis {
  readonly correctionEvidence: ThreadEntityRef;
  readonly revisedCadStepEvidence: ThreadEntityRef;
}

/**
 * Add and execute the one reviewed R3 recovery operation through MCP only.
 *
 * This does not read or modify local project state, call providers directly,
 * retry the failed R2 run, or infer a current project. It refuses every state
 * except the exact R9 recovery boundary left by the durable R2 failure.
 */
export async function runCoffeeMachineCm01V3MechanicalR3Retry(
  options: RunCoffeeMachineCm01V3MechanicalR3RetryOptions = {},
): Promise<CoffeeMachineCm01V3MechanicalR3RetryResult> {
  if (!options.execute) return confirmationRequired();
  if (
    options.acknowledgement !==
      CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT
  ) {
    throw new Error(
      "Refusing the CM-01 V3 mechanical R3 retry without " +
        `--acknowledge=${CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT}.`,
    );
  }

  const mcpUrl = options.mcpUrl ?? MCP_URL;
  assertLoopbackServerMcpUrl(mcpUrl);
  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl,
    timeoutMs: 120_000,
  });

  const initial = await readProject(client);
  const basis = requireExactR2FailureBoundary(initial);

  const appended = projectFromResult(
    await client.callTool({
      name: "project_change_append",
      arguments: {
        commandId: R3.appendCommandId,
        projectId: CM01_V3_MECHANICAL_R3_RETRY_PROJECT_ID,
        expectedRevision: initial.revision,
        issuedAt: ISSUED_AT,
        baseSnapshot: initial.head,
        phases: [{
          id: R3.phaseId,
          name: "Retry the reviewed 30 mm DripTray mechanical proof",
          description:
            "Run the separately reviewed R3 static-proof recovery from the exact R9 correction and CAD evidence; the failed R2 provider attempt remains retained.",
        }],
        workItems: [{
          id: R3.workItemId,
          phaseId: R3.phaseId,
          owner: "agent",
          dependsOnWorkItemIds: [],
          decisionIds: [],
          operation: {
            ...R3.operation,
            bindings: r3Bindings(initial.head, basis),
          },
        }],
        requiredDecisions: [],
      },
    }),
  );
  requireExactR3Append(appended, initial.head, basis);

  const queued = projectFromResult(
    await client.callTool({
      name: "project_agent_run_queue",
      arguments: {
        commandId: R3.queueCommandId,
        projectId: CM01_V3_MECHANICAL_R3_RETRY_PROJECT_ID,
        expectedRevision: appended.revision,
        issuedAt: ISSUED_AT,
        workItemId: R3.workItemId,
      },
    }),
  );
  const queuedRun = requireR3Run(queued, "queued", initial.head);

  const completed = projectFromResult(
    await client.callTool({
      name: "project_agent_run_execute",
      arguments: {
        commandId: R3.executeCommandId,
        projectId: CM01_V3_MECHANICAL_R3_RETRY_PROJECT_ID,
        expectedRevision: queued.revision,
        issuedAt: ISSUED_AT,
        runId: queuedRun.id,
      },
    }),
  );
  const completedRun = requireR3Run(completed, "completed", initial.head);
  if (
    completed.head.revision !== 10 ||
    completed.head.revision !== initial.head.revision + 1
  ) {
    throw new Error(
      `CM-01 V3 mechanical R3 retry must publish exactly ThreadSnapshot r10; received r${completed.head.revision}.`,
    );
  }
  const resultSnapshot = threadSnapshotRef(
    completedRun.value.resultSnapshot,
    "mechanical-r3.resultSnapshot",
  );
  assertSameSnapshot(resultSnapshot, completed.head, "mechanical-r3 result snapshot");
  const mechanicalEvidence = exactlyOneSuccessorEvidence(
    completedRun,
    resultSnapshot,
  );

  return {
    status: "completed",
    projectId: CM01_V3_MECHANICAL_R3_RETRY_PROJECT_ID,
    projectRevision: completed.revision,
    correctionEvidence: rebasedEvidence(basis.correctionEvidence, initial.head),
    revisedCadStepEvidence: basis.revisedCadStepEvidence,
    mechanicalEvidence,
    mechanicalSnapshot: resultSnapshot,
    note:
      "This is one local, reviewed R3 recovery operation through registered MCP control-plane tools. It preserves the failed R2 attempt and proves only the isolated DripTray concept case, not certification, release, or a whole-machine solve.",
  };
}

function requireExactR2FailureBoundary(project: ProjectView): RetryBasis {
  assertCanonicalProject(project);
  if (project.head.revision !== 9) {
    throw new Error(
      `CM-01 V3 mechanical R3 retry requires the exact R9 recovery boundary; received r${project.head.revision}.`,
    );
  }
  assertNoExistingR3Retry(project);

  const correctionWorkItem = requiredWorkItem(project, R2.correctionWorkItemId);
  assertOperation(
    correctionWorkItem,
    "design.correct-coffee-machine-cm01-drip-tray-height",
    "1",
  );
  const correctionRun = requiredRun(project, R2.correctionWorkItemId);
  requireCompletedBasis(correctionRun, 7, "CM-01 correction");
  const correctionSnapshot = requiredResultSnapshot(
    correctionRun,
    8,
    "CM-01 correction",
  );
  const correctionEvidence = exactlyOneSuccessorEvidence(
    correctionRun,
    correctionSnapshot,
  );
  if (correctionEvidence.id !== CORRECTION_ARTIFACT_ID) {
    throw new Error("CM-01 correction did not return its exact reviewed record.");
  }

  const cadWorkItem = requiredWorkItem(project, R2.cadWorkItemId);
  assertOperation(
    cadWorkItem,
    "design.build-coffee-machine-cm01-cad",
    "2",
  );
  const cadRun = requiredRun(project, R2.cadWorkItemId);
  requireCompletedBasis(cadRun, 8, "CM-01 CAD R2");
  assertSameSnapshot(
    runBasis(cadRun),
    correctionSnapshot,
    "CM-01 CAD R2 correction basis",
  );
  const cadSnapshot = requiredResultSnapshot(cadRun, 9, "CM-01 CAD R2");
  assertSameSnapshot(cadSnapshot, project.head, "CM-01 CAD R2 result snapshot");
  const revisedCadStepEvidence = exactlyOneSuccessorEvidence(cadRun, cadSnapshot);
  if (!CAD_R2_STEP_ID.test(revisedCadStepEvidence.id)) {
    throw new Error("CM-01 CAD R2 did not return its exact successor STEP artifact.");
  }

  const mechanicalWorkItem = requiredWorkItem(project, R2.mechanicalWorkItemId);
  assertOperation(
    mechanicalWorkItem,
    R3.operation.id,
    "2",
  );
  const failedMechanical = requiredRun(project, R2.mechanicalWorkItemId);
  if (failedMechanical.status !== "failed") {
    throw new Error(
      "CM-01 mechanical R3 retry requires the recorded R2 mechanical run to be failed.",
    );
  }
  requireRunBasis(failedMechanical, project.head, "failed CM-01 mechanical R2 run");
  if (
    array(failedMechanical.value.evidenceRefs, "failed mechanical R2 evidenceRefs")
      .length !== 0
  ) {
    throw new Error(
      "Failed CM-01 mechanical R2 run must not carry substitute evidence.",
    );
  }
  const failure = object(
    failedMechanical.value.failure,
    "failed mechanical R2 failure",
  );
  if (
    string(failure.code, "failed mechanical R2 failure.code") !==
      R2.mechanicalFailureCode
  ) {
    throw new Error(
      "CM-01 mechanical R2 failure is not the reviewed recovery boundary.",
    );
  }
  return { correctionEvidence, revisedCadStepEvidence };
}

function requireExactR3Append(
  project: ProjectView,
  basis: ThreadSnapshotRef,
  retryBasis: RetryBasis,
): void {
  assertCanonicalProject(project);
  assertSameSnapshot(project.head, basis, "CM-01 R3 append head");
  const workItem = requiredWorkItem(project, R3.workItemId);
  assertOperation(workItem, R3.operation.id, R3.operation.version);
  assertR3Bindings(workItem, basis, retryBasis);
  const phases = array(project.value.phases, "project.phases");
  const matchingPhases = phases.filter((value, index) =>
    string(
      object(value, `project.phases[${index}]`).id,
      `project.phases[${index}].id`,
    ) ===
      R3.phaseId
  );
  if (matchingPhases.length !== 1) {
    throw new Error(
      "CM-01 mechanical R3 retry append did not declare its one bounded phase.",
    );
  }
  if (runsForWorkItem(project, R3.workItemId).length !== 0) {
    throw new Error("CM-01 mechanical R3 retry was unexpectedly queued during append.");
  }
}

function requireR3Run(
  project: ProjectView,
  expectedStatus: "queued" | "completed",
  basis: ThreadSnapshotRef,
): RunView {
  assertCanonicalProject(project);
  const run = requiredRun(project, R3.workItemId);
  if (run.status !== expectedStatus) {
    throw new Error(
      `CM-01 mechanical R3 retry must be ${expectedStatus}; received ${run.status}.`,
    );
  }
  requireRunBasis(run, basis, "CM-01 mechanical R3 retry");
  if (expectedStatus === "queued") {
    if (
      array(run.value.evidenceRefs, "queued mechanical R3 evidenceRefs").length !== 0
    ) {
      throw new Error("Queued CM-01 mechanical R3 retry must not carry evidence.");
    }
    if (run.value.resultSnapshot !== undefined && run.value.resultSnapshot !== null) {
      throw new Error(
        "Queued CM-01 mechanical R3 retry must not have a result snapshot.",
      );
    }
  }
  return run;
}

function assertNoExistingR3Retry(project: ProjectView): void {
  const workItems = array(project.value.workItems, "project.workItems");
  for (const [index, value] of workItems.entries()) {
    const workItem = object(value, `project.workItems[${index}]`);
    const id = string(workItem.id, `project.workItems[${index}].id`);
    if (id === R3.workItemId) {
      throw new Error(
        "CM-01 mechanical R3 retry work item already exists; refusing replay.",
      );
    }
    const operation = object(
      workItem.operation,
      `project.workItems[${index}].operation`,
    );
    if (
      string(operation.id, `project.workItems[${index}].operation.id`) ===
        R3.operation.id &&
      string(operation.version, `project.workItems[${index}].operation.version`) ===
        R3.operation.version
    ) {
      throw new Error(
        "A CM-01 mechanical R3 retry operation already exists; refusing replay.",
      );
    }
  }
  if (runsForWorkItem(project, R3.workItemId).length !== 0) {
    throw new Error("CM-01 mechanical R3 retry run already exists; refusing replay.");
  }
  const changes = array(project.value.planChanges ?? [], "project.planChanges");
  if (
    changes.some((value, index) =>
      string(
        object(value, `project.planChanges[${index}]`).commandId,
        `project.planChanges[${index}].commandId`,
      ) === R3.appendCommandId
    )
  ) {
    throw new Error(
      "CM-01 mechanical R3 retry append receipt already exists; refusing replay.",
    );
  }
}

function r3Bindings(basis: ThreadSnapshotRef, retryBasis: RetryBasis) {
  return [
    { name: "approvedBrief", source: { kind: "approved-brief" } },
    {
      name: "dripTrayHeightCorrection",
      source: {
        kind: "thread-entity",
        reference: rebasedEvidence(retryBasis.correctionEvidence, basis),
      },
    },
    {
      name: "revisedCadStep",
      source: { kind: "thread-entity", reference: retryBasis.revisedCadStepEvidence },
    },
  ] as const;
}

function assertR3Bindings(
  workItem: Record<string, unknown>,
  basis: ThreadSnapshotRef,
  retryBasis: RetryBasis,
): void {
  const operation = object(workItem.operation, "CM-01 mechanical R3 operation");
  const bindings = array(operation.bindings, "CM-01 mechanical R3 operation.bindings");
  const expected = r3Bindings(basis, retryBasis);
  if (bindings.length !== expected.length) {
    throw new Error("CM-01 mechanical R3 retry has an unexpected binding count.");
  }
  for (const [index, expectedBinding] of expected.entries()) {
    const actual = object(bindings[index], `CM-01 mechanical R3 binding[${index}]`);
    if (
      string(actual.name, `CM-01 mechanical R3 binding[${index}].name`) !==
        expectedBinding.name
    ) {
      throw new Error("CM-01 mechanical R3 retry has an unexpected binding name.");
    }
    const source = object(
      actual.source,
      `CM-01 mechanical R3 binding[${index}].source`,
    );
    if (
      string(source.kind, `CM-01 mechanical R3 binding[${index}].source.kind`) !==
        expectedBinding.source.kind
    ) {
      throw new Error("CM-01 mechanical R3 retry has an unexpected binding source.");
    }
    if (expectedBinding.source.kind === "thread-entity") {
      const actualReference = threadEntityRef(
        source.reference,
        `CM-01 mechanical R3 binding[${index}].source.reference`,
      );
      const expectedReference = expectedBinding.source.reference;
      if (
        actualReference.id !== expectedReference.id ||
        actualReference.kind !== expectedReference.kind ||
        actualReference.snapshotId !== expectedReference.snapshotId ||
        actualReference.snapshotRevision !== expectedReference.snapshotRevision
      ) {
        throw new Error("CM-01 mechanical R3 retry has an unexpected entity binding.");
      }
    }
  }
}

function assertCanonicalProject(project: ProjectView): void {
  const record = project.value;
  if (string(record.schemaVersion, "project.schemaVersion") !== "3.0") {
    throw new Error("CM-01 mechanical R3 retry requires the canonical V3 contract.");
  }
  const identity = object(record.project, "project.project");
  if (
    string(identity.id, "project.project.id") !==
      CM01_V3_MECHANICAL_R3_RETRY_PROJECT_ID ||
    string(identity.subjectId, "project.project.subjectId") !==
      CM01_V3_MECHANICAL_R3_RETRY_SUBJECT_ID
  ) {
    throw new Error("The MCP server did not return the canonical CM-01 V3 project.");
  }
  const framing = object(record.framing, "project.framing");
  object(framing.currentBrief, "project.framing.currentBrief");
  const approval = object(
    framing.currentBriefApproval,
    "project.framing.currentBriefApproval",
  );
  if (
    string(approval.status, "project.framing.currentBriefApproval.status") !==
      "approved"
  ) {
    throw new Error("CM-01 mechanical R3 retry requires an approved current brief.");
  }
}

function requireCompletedBasis(
  run: RunView,
  expectedBasisRevision: number,
  label: string,
): void {
  if (run.status !== "completed") {
    throw new Error(`${label} must be completed before the mechanical R3 retry.`);
  }
  const basis = runBasis(run);
  if (basis.revision !== expectedBasisRevision) {
    throw new Error(
      `${label} must be based on ThreadSnapshot r${expectedBasisRevision}.`,
    );
  }
}

function requiredResultSnapshot(
  run: RunView,
  expectedRevision: number,
  label: string,
): ThreadSnapshotRef {
  const result = threadSnapshotRef(run.value.resultSnapshot, `${label} resultSnapshot`);
  if (result.revision !== expectedRevision) {
    throw new Error(`${label} must publish ThreadSnapshot r${expectedRevision}.`);
  }
  return result;
}

function requireRunBasis(
  run: RunView,
  expected: ThreadSnapshotRef,
  label: string,
): void {
  assertSameSnapshot(runBasis(run), expected, `${label} basis`);
}

function runBasis(run: RunView): ThreadSnapshotRef {
  const basis = object(run.value.basis, `${run.workItemId}.basis`);
  if (string(basis.kind, `${run.workItemId}.basis.kind`) !== "thread-snapshot") {
    throw new Error(`${run.workItemId}.basis must be an exact ThreadSnapshot.`);
  }
  return threadSnapshotRef(basis, `${run.workItemId}.basis`);
}

function exactlyOneSuccessorEvidence(
  run: RunView,
  resultSnapshot: ThreadSnapshotRef,
): ThreadEntityRef {
  const evidence = array(run.value.evidenceRefs, `${run.workItemId}.evidenceRefs`);
  if (evidence.length !== 1) {
    throw new Error(
      `${run.workItemId} must return one and only one artifact evidence ref.`,
    );
  }
  const only = threadEntityRef(evidence[0], `${run.workItemId}.evidenceRefs[0]`);
  if (
    only.snapshotId !== resultSnapshot.snapshotId ||
    only.snapshotRevision !== resultSnapshot.revision
  ) {
    throw new Error(
      `${run.workItemId} evidence must belong to its exact successor snapshot.`,
    );
  }
  return only;
}

function requiredWorkItem(project: ProjectView, id: string): Record<string, unknown> {
  const matching = array(project.value.workItems, "project.workItems").filter((
    value,
    index,
  ) =>
    string(
      object(value, `project.workItems[${index}]`).id,
      `project.workItems[${index}].id`,
    ) === id
  );
  if (matching.length !== 1) {
    throw new Error(`CM-01 V3 must have exactly one work item ${id}.`);
  }
  return object(matching[0], `project.workItem(${id})`);
}

function assertOperation(
  workItem: Record<string, unknown>,
  id: string,
  version: string,
): void {
  const operation = object(workItem.operation, `workItem(${id}).operation`);
  if (
    string(operation.id, `workItem(${id}).operation.id`) !== id ||
    string(operation.version, `workItem(${id}).operation.version`) !== version
  ) {
    throw new Error(`CM-01 V3 work item does not declare ${id}@${version}.`);
  }
}

function requiredRun(project: ProjectView, workItemId: string): RunView {
  const matching = runsForWorkItem(project, workItemId);
  if (matching.length !== 1) {
    throw new Error(`CM-01 V3 must have exactly one run for ${workItemId}.`);
  }
  return matching[0]!;
}

function runsForWorkItem(project: ProjectView, workItemId: string): readonly RunView[] {
  return array(project.value.agentRuns, "project.agentRuns")
    .map((value, index) => runView(value, `project.agentRuns[${index}]`))
    .filter((run) => run.workItemId === workItemId);
}

function runView(value: unknown, name: string): RunView {
  const record = object(value, name);
  return {
    value: record,
    id: string(record.id, `${name}.id`),
    workItemId: string(record.workItemId, `${name}.workItemId`),
    status: string(record.status, `${name}.status`),
  };
}

function projectFromResult(
  result: { readonly structuredContent: Readonly<Record<string, unknown>> },
): ProjectView {
  const value = object(result.structuredContent, "MCP structuredContent");
  const snapshots = array(value.threadSnapshots, "project.threadSnapshots")
    .map((item, index) => threadSnapshotRef(item, `project.threadSnapshots[${index}]`));
  if (snapshots.length === 0) {
    throw new Error("CM-01 V3 has no declared ThreadSnapshot.");
  }
  const head = [...snapshots].sort((left, right) => right.revision - left.revision)[0]!;
  return {
    value,
    revision: positive(value.revision, "project.revision"),
    head,
  };
}

async function readProject(client: McpToolClient): Promise<ProjectView> {
  return projectFromResult(
    await client.callTool({
      name: "project_snapshot",
      arguments: { projectId: CM01_V3_MECHANICAL_R3_RETRY_PROJECT_ID },
    }),
  );
}

function rebasedEvidence(
  evidence: ThreadEntityRef,
  basis: ThreadSnapshotRef,
): ThreadEntityRef {
  return {
    snapshotId: basis.snapshotId,
    snapshotRevision: basis.revision,
    kind: evidence.kind,
    id: evidence.id,
  };
}

function assertSameSnapshot(
  actual: ThreadSnapshotRef,
  expected: ThreadSnapshotRef,
  label: string,
): void {
  if (
    actual.snapshotId !== expected.snapshotId ||
    actual.revision !== expected.revision ||
    actual.subjectId !== expected.subjectId
  ) {
    throw new Error(`${label} must be the exact declared ThreadSnapshot.`);
  }
}

function threadSnapshotRef(value: unknown, name: string): ThreadSnapshotRef {
  const record = object(value, name);
  return {
    snapshotId: string(record.snapshotId, `${name}.snapshotId`),
    revision: positive(record.revision, `${name}.revision`),
    subjectId: string(record.subjectId, `${name}.subjectId`),
  };
}

function threadEntityRef(value: unknown, name: string): ThreadEntityRef {
  const record = object(value, name);
  if (string(record.kind, `${name}.kind`) !== "artifact") {
    throw new Error(`${name}.kind must be artifact.`);
  }
  return {
    snapshotId: string(record.snapshotId, `${name}.snapshotId`),
    snapshotRevision: positive(record.snapshotRevision, `${name}.snapshotRevision`),
    kind: "artifact",
    id: string(record.id, `${name}.id`),
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function assertLoopbackServerMcpUrl(value: string): void {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" &&
      parsed.hostname !== "::1") ||
    parsed.pathname !== "/mcp"
  ) {
    throw new Error(
      "CM-01 mechanical R3 retry accepts only a loopback server.ts /mcp endpoint.",
    );
  }
}

function confirmationRequired(): CoffeeMachineCm01V3MechanicalR3RetryConfirmationRequired {
  return {
    status: "confirmation-required",
    acknowledgement: CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT,
    operations: ["verify.coffee-machine-cm01-drip-tray-mechanical@3"],
    note:
      "No MCP connection, project mutation, provider call, or evidence claim is made until --execute and the exact acknowledgement are both supplied.",
  };
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const result = await runCoffeeMachineCm01V3MechanicalR3Retry({
    execute: Deno.args.includes("--execute"),
    acknowledgement: args["acknowledge"],
    mcpUrl: args["mcp-url"],
  });
  console.log(JSON.stringify(result, null, 2));
}
