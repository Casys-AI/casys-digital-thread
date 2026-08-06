import { parseArgs } from "./cli.ts";
import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../src/adapters/mcp/http-mcp-tool-client.ts";

/**
 * Explicit local consent for the only real CM-01 V3 28 mm -> 30 mm feedback
 * run.  The runner never opens an MCP connection unless this is supplied with
 * --execute.
 */
export const CM01_V3_CORRECTION_EXECUTION_ACKNOWLEDGEMENT =
  "EXECUTE_CM01_V3_28_TO_30_CORRECTION" as const;

export const CM01_V3_CORRECTION_PROJECT_ID = "coffee-machine-cm01-v3" as const;
export const CM01_V3_CORRECTION_SUBJECT_ID = "project:coffee-machine-cm01-v3" as const;

const MCP_URL = "http://127.0.0.1:3020/mcp";
const ISSUED_AT = "2026-08-03T12:00:00.000Z";
const COMMAND_PREFIX = "cm01-v3-r7-r10-28-to-30";
const CORRECTION_ARTIFACT_ID =
  "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record";

const STEP = {
  correction: {
    phaseId: "cm01-v3-drip-tray-height-correction",
    workItemId: "record-cm01-v3-drip-tray-height-28-to-30-correction",
    appendCommandId: `${COMMAND_PREFIX}-append-correction`,
    queueCommandId: `${COMMAND_PREFIX}-queue-correction`,
    executeCommandId: `${COMMAND_PREFIX}-execute-correction`,
    operation: {
      id: "design.correct-coffee-machine-cm01-drip-tray-height",
      version: "1",
      bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
    },
  },
  cad: {
    phaseId: "cm01-v3-drip-tray-height-30-cad",
    workItemId: "build-cm01-v3-drip-tray-height-30-cad",
    appendCommandId: `${COMMAND_PREFIX}-append-cad-r2`,
    queueCommandId: `${COMMAND_PREFIX}-queue-cad-r2`,
    executeCommandId: `${COMMAND_PREFIX}-execute-cad-r2`,
    operation: {
      id: "design.build-coffee-machine-cm01-cad",
      version: "2",
    },
  },
  mechanical: {
    phaseId: "cm01-v3-drip-tray-height-30-mechanical",
    workItemId: "verify-cm01-v3-drip-tray-height-30-mechanical",
    appendCommandId: `${COMMAND_PREFIX}-append-mechanical-r2`,
    queueCommandId: `${COMMAND_PREFIX}-queue-mechanical-r2`,
    executeCommandId: `${COMMAND_PREFIX}-execute-mechanical-r2`,
    operation: {
      id: "verify.coffee-machine-cm01-drip-tray-mechanical",
      version: "2",
    },
  },
} as const;

export interface RunCoffeeMachineCm01V3CorrectionOptions {
  /** Required together with the exact acknowledgement before any MCP call. */
  readonly execute?: boolean;
  readonly acknowledgement?: string;
  /** Test seam; production uses the local server's streamable MCP endpoint. */
  readonly client?: McpToolClient;
  /** Loopback endpoint only; the production default is server.ts on 3020. */
  readonly mcpUrl?: string;
}

export interface CoffeeMachineCm01V3CorrectionConfirmationRequired {
  readonly status: "confirmation-required";
  readonly acknowledgement: typeof CM01_V3_CORRECTION_EXECUTION_ACKNOWLEDGEMENT;
  readonly operations: readonly string[];
  readonly note: string;
}

export interface CoffeeMachineCm01V3CorrectionCompleted {
  readonly status: "completed";
  readonly projectId: typeof CM01_V3_CORRECTION_PROJECT_ID;
  readonly projectRevision: number;
  readonly correctionSnapshot: ThreadSnapshotRef;
  readonly cadSnapshot: ThreadSnapshotRef;
  readonly mechanicalSnapshot: ThreadSnapshotRef;
  readonly correctionEvidence: ThreadEntityRef;
  readonly revisedCadStepEvidence: ThreadEntityRef;
  readonly mechanicalEvidence: ThreadEntityRef;
  readonly note: string;
}

export type CoffeeMachineCm01V3CorrectionResult =
  | CoffeeMachineCm01V3CorrectionConfirmationRequired
  | CoffeeMachineCm01V3CorrectionCompleted;

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

interface StepDescriptor {
  readonly phaseId: string;
  readonly workItemId: string;
  readonly appendCommandId: string;
  readonly queueCommandId: string;
  readonly executeCommandId: string;
  readonly operation: {
    readonly id: string;
    readonly version: string;
    readonly bindings?: readonly unknown[];
  };
}

/**
 * Runs the canonical feedback path strictly through server.ts MCP tools.
 *
 * It does not write state, call providers, manufacture evidence, or claim
 * certification itself.  The three registered server-owned executors decide
 * whether their reviewed operations can run and publish their own evidence.
 */
export async function runCoffeeMachineCm01V3Correction(
  options: RunCoffeeMachineCm01V3CorrectionOptions = {},
): Promise<CoffeeMachineCm01V3CorrectionResult> {
  if (!options.execute) return confirmationRequired();
  if (options.acknowledgement !== CM01_V3_CORRECTION_EXECUTION_ACKNOWLEDGEMENT) {
    throw new Error(
      "Refusing the CM-01 V3 correction without " +
        `--acknowledge=${CM01_V3_CORRECTION_EXECUTION_ACKNOWLEDGEMENT}.`,
    );
  }
  const mcpUrl = options.mcpUrl ?? MCP_URL;
  assertLoopbackServerMcpUrl(mcpUrl);
  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl,
    timeoutMs: 120_000,
  });

  let project = await readProject(client);
  assertCanonicalProject(project);

  const correction = await runStep({
    client,
    project,
    step: STEP.correction,
    expectedBasisRevision: 7,
    phase: {
      name: "Record the CM-01 DripTray height correction",
      description:
        "Record the reviewed 28 mm to 30 mm correction and invalidate only its bounded stale descendants.",
    },
    completion: (completed, _basis, resultSnapshot) =>
      correctionEvidence(completed, STEP.correction, resultSnapshot),
  });
  project = correction.project;

  const cad = await runStep({
    client,
    project,
    step: STEP.cad,
    expectedBasisRevision: 8,
    phase: {
      name: "Build the reviewed 30 mm CAD successor",
      description:
        "Materialize a fresh build123d assembly successor linked to the exact correction record.",
    },
    operationBindings: (_basis) => [
      approvedBriefBinding(),
      threadEntityBinding("dripTrayHeightCorrection", correction.evidence),
    ],
    completion: (completed, basis, resultSnapshot) =>
      cadStepEvidence(completed, STEP.cad, basis, resultSnapshot),
  });
  project = cad.project;

  const mechanical = await runStep({
    client,
    project,
    step: STEP.mechanical,
    expectedBasisRevision: 9,
    phase: {
      name: "Verify the reviewed 30 mm isolated DripTray",
      description:
        "Run the server-owned isolated DripTray mechanical successor after the exact R2 assembly STEP exists.",
    },
    operationBindings: (basis) => [
      approvedBriefBinding(),
      threadEntityBinding(
        "dripTrayHeightCorrection",
        rebaseThreadEntityEvidence(correction.evidence, basis),
      ),
      threadEntityBinding("revisedCadStep", cad.evidence),
    ],
    completion: (completed, _basis, resultSnapshot) =>
      mechanicalEvidence(completed, STEP.mechanical, resultSnapshot),
  });
  project = mechanical.project;

  if (project.head.revision !== 10) {
    throw new Error(
      `CM-01 V3 correction did not reach ThreadSnapshot r10 (received r${project.head.revision}).`,
    );
  }
  return {
    status: "completed",
    projectId: CM01_V3_CORRECTION_PROJECT_ID,
    projectRevision: project.revision,
    correctionSnapshot: correction.snapshot,
    cadSnapshot: cad.snapshot,
    mechanicalSnapshot: mechanical.snapshot,
    correctionEvidence: correction.evidence,
    revisedCadStepEvidence: cad.evidence,
    mechanicalEvidence: mechanical.evidence,
    note:
      "This is a local technical evidence run through registered MCP operations. It is not a certification, release, manufacturing authorization, or a claim that the complete coffee machine was mechanically solved.",
  };
}

async function runStep<T extends ThreadEntityRef>(input: {
  readonly client: McpToolClient;
  readonly project: ProjectView;
  readonly step: StepDescriptor;
  readonly expectedBasisRevision: number;
  readonly phase: { readonly name: string; readonly description: string };
  readonly operationBindings?: (basis: ThreadSnapshotRef) => readonly unknown[];
  readonly completion: (
    project: ProjectView,
    basis: ThreadSnapshotRef,
    resultSnapshot: ThreadSnapshotRef,
  ) => T;
}): Promise<{ project: ProjectView; snapshot: ThreadSnapshotRef; evidence: T }> {
  let project = input.project;
  let run = existingRun(project, input.step.workItemId);
  if (!run) {
    assertHead(project, input.expectedBasisRevision, input.step.workItemId);
  }
  const appendBasis = project.head;
  const bindings = input.operationBindings?.(appendBasis) ??
    input.step.operation.bindings ??
    [approvedBriefBinding()];

  const existing = run;
  if (!existing && !changeRecorded(project, input.step.appendCommandId)) {
    project = projectFromResult(
      await input.client.callTool({
        name: "project_change_append",
        arguments: {
          commandId: input.step.appendCommandId,
          projectId: CM01_V3_CORRECTION_PROJECT_ID,
          expectedRevision: project.revision,
          issuedAt: ISSUED_AT,
          baseSnapshot: appendBasis,
          phases: [{
            id: input.step.phaseId,
            name: input.phase.name,
            description: input.phase.description,
          }],
          workItems: [{
            id: input.step.workItemId,
            phaseId: input.step.phaseId,
            owner: "agent",
            dependsOnWorkItemIds: [],
            decisionIds: [],
            operation: {
              id: input.step.operation.id,
              version: input.step.operation.version,
              bindings,
            },
          }],
          requiredDecisions: [],
        },
      }),
    );
  }

  run = existingRun(project, input.step.workItemId);
  if (!run) {
    project = projectFromResult(
      await input.client.callTool({
        name: "project_agent_run_queue",
        arguments: {
          commandId: input.step.queueCommandId,
          projectId: CM01_V3_CORRECTION_PROJECT_ID,
          expectedRevision: project.revision,
          issuedAt: ISSUED_AT,
          workItemId: input.step.workItemId,
        },
      }),
    );
    run = requiredRun(project, input.step.workItemId);
  }
  if (run.status === "failed") {
    throw new Error(
      `CM-01 V3 ${input.step.workItemId} previously failed. Inspect its durable failure record; this driver will not silently queue a second run.`,
    );
  }
  if (run.status !== "completed") {
    if (run.status === "queued") {
      project = projectFromResult(
        await input.client.callTool({
          name: "project_agent_run_execute",
          arguments: executionCommand(input.step, project, run.id),
        }),
      );
    } else if (run.status === "running" || run.status === "publishing") {
      project = projectFromResult(
        await input.client.callTool({
          name: "project_agent_run_execute",
          arguments: executionCommand(input.step, project, run.id),
        }),
      );
    } else {
      throw new Error(
        `CM-01 V3 ${input.step.workItemId} has unsupported run status ${run.status}.`,
      );
    }
    run = requiredRun(project, input.step.workItemId);
  }

  if (run.status !== "completed") {
    throw new Error(`CM-01 V3 ${input.step.workItemId} did not complete.`);
  }
  const resultSnapshot = threadSnapshotRef(
    run.value.resultSnapshot,
    `${input.step.workItemId}.resultSnapshot`,
  );
  const evidence = input.completion(project, runBasis(run), resultSnapshot);
  return { project, snapshot: resultSnapshot, evidence };
}

function executionCommand(step: StepDescriptor, project: ProjectView, runId: string) {
  return {
    commandId: step.executeCommandId,
    projectId: CM01_V3_CORRECTION_PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: ISSUED_AT,
    runId,
  };
}

function correctionEvidence(
  project: ProjectView,
  step: StepDescriptor,
  resultSnapshot: ThreadSnapshotRef,
): ThreadEntityRef {
  const evidence = completedRunEvidence(project, step.workItemId, resultSnapshot);
  if (evidence.id !== CORRECTION_ARTIFACT_ID) {
    throw new Error("CM-01 V3 correction did not return its exact correction record.");
  }
  return evidence;
}

function cadStepEvidence(
  project: ProjectView,
  step: StepDescriptor,
  basis: ThreadSnapshotRef,
  resultSnapshot: ThreadSnapshotRef,
): ThreadEntityRef {
  const evidence = completedRunEvidence(project, step.workItemId, resultSnapshot);
  if (
    evidence.snapshotId !== resultSnapshot.snapshotId ||
    evidence.snapshotRevision !== resultSnapshot.revision ||
    resultSnapshot.revision !== basis.revision + 1
  ) {
    throw new Error(
      "CM-01 V3 CAD@2 did not return an exact successor STEP evidence ref.",
    );
  }
  return evidence;
}

function mechanicalEvidence(
  project: ProjectView,
  step: StepDescriptor,
  resultSnapshot: ThreadSnapshotRef,
): ThreadEntityRef {
  return completedRunEvidence(project, step.workItemId, resultSnapshot);
}

function completedRunEvidence(
  project: ProjectView,
  workItemId: string,
  resultSnapshot: ThreadSnapshotRef,
): ThreadEntityRef {
  const run = requiredRun(project, workItemId);
  const evidenceRefs = array(run.value.evidenceRefs, `${workItemId}.evidenceRefs`);
  const matching = evidenceRefs.map((value, index) =>
    threadEntityRef(value, `${workItemId}.evidenceRefs[${index}]`)
  ).filter((item) =>
    item.kind === "artifact" && item.snapshotId === resultSnapshot.snapshotId &&
    item.snapshotRevision === resultSnapshot.revision
  );
  if (matching.length !== 1) {
    throw new Error(
      `CM-01 V3 ${workItemId} must return exactly one artifact evidence ref on its successor snapshot.`,
    );
  }
  return matching[0]!;
}

function existingRun(project: ProjectView, workItemId: string): RunView | undefined {
  const runs = array(project.value.agentRuns, "project.agentRuns");
  const matching = runs.map((value, index) => runView(value, `agentRuns[${index}]`))
    .filter((run) => run.workItemId === workItemId);
  if (matching.length > 1) {
    throw new Error(`CM-01 V3 has more than one run for ${workItemId}.`);
  }
  return matching[0];
}

function changeRecorded(project: ProjectView, commandId: string): boolean {
  return array(project.value.planChanges ?? [], "project.planChanges").some((
    value,
    index,
  ) =>
    string(
      object(value, `project.planChanges[${index}]`).commandId,
      `project.planChanges[${index}].commandId`,
    ) ===
      commandId
  );
}

function requiredRun(project: ProjectView, workItemId: string): RunView {
  const run = existingRun(project, workItemId);
  if (run) return run;
  return queueRun(project, workItemId);
}

function queueRun(_project: ProjectView, workItemId: string): never {
  throw new Error(
    `CM-01 V3 ${workItemId} was not queued after its append-only project change.`,
  );
}

interface RunView {
  readonly value: Record<string, unknown>;
  readonly id: string;
  readonly workItemId: string;
  readonly status: string;
}

function runBasis(run: RunView): ThreadSnapshotRef {
  const basis = object(run.value.basis, `${run.workItemId}.basis`);
  if (string(basis.kind, `${run.workItemId}.basis.kind`) !== "thread-snapshot") {
    throw new Error(`${run.workItemId}.basis must be an exact ThreadSnapshot.`);
  }
  return threadSnapshotRef(basis, `${run.workItemId}.basis`);
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
  return projectView(result.structuredContent);
}

async function readProject(client: McpToolClient): Promise<ProjectView> {
  return projectFromResult(
    await client.callTool({
      name: "project_snapshot",
      arguments: { projectId: CM01_V3_CORRECTION_PROJECT_ID },
    }),
  );
}

function projectView(value: Readonly<Record<string, unknown>>): ProjectView {
  const record = object(value, "project_snapshot.structuredContent");
  const project = object(record.project, "project.project");
  if (
    string(project.id, "project.project.id") !== CM01_V3_CORRECTION_PROJECT_ID ||
    string(project.subjectId, "project.project.subjectId") !==
      CM01_V3_CORRECTION_SUBJECT_ID
  ) {
    throw new Error("The MCP server did not return the canonical CM-01 V3 project.");
  }
  const snapshots = array(record.threadSnapshots, "project.threadSnapshots")
    .map((item, index) => threadSnapshotRef(item, `project.threadSnapshots[${index}]`));
  if (snapshots.length === 0) {
    throw new Error("CM-01 V3 has no declared ThreadSnapshot.");
  }
  const head = [...snapshots].sort((left, right) => right.revision - left.revision)[0]!;
  return {
    value: record,
    revision: positive(record.revision, "project.revision"),
    head,
  };
}

function assertCanonicalProject(project: ProjectView): void {
  if (string(project.value.schemaVersion, "project.schemaVersion") !== "3.0") {
    throw new Error(
      "CM-01 correction requires the canonical V3 EngineeringProject contract.",
    );
  }
  const framing = object(project.value.framing, "project.framing");
  object(framing.currentBrief, "project.framing.currentBrief");
  const approval = object(
    framing.currentBriefApproval,
    "project.framing.currentBriefApproval",
  );
  if (
    string(approval.status, "project.framing.currentBriefApproval.status") !==
      "approved"
  ) {
    throw new Error(
      "CM-01 correction requires the current V3 project brief to be approved.",
    );
  }
  if (project.head.revision < 7 || project.head.revision > 10) {
    throw new Error(
      `CM-01 correction expects the bounded r7-r10 path, not ThreadSnapshot r${project.head.revision}.`,
    );
  }
}

function assertHead(
  project: ProjectView,
  expectedRevision: number,
  workItemId: string,
): void {
  if (project.head.revision === expectedRevision) return;
  throw new Error(
    `CM-01 V3 ${workItemId} requires ThreadSnapshot r${expectedRevision}; received r${project.head.revision}.`,
  );
}

function approvedBriefBinding() {
  return { name: "approvedBrief", source: { kind: "approved-brief" } };
}

function threadEntityBinding(name: string, reference: ThreadEntityRef) {
  return { name, source: { kind: "thread-entity", reference } };
}

/**
 * A ThreadSnapshot entity ref is anchored to the run basis, not the first
 * snapshot which introduced that entity. The CAD successor retains the exact
 * correction artifact; mechanical@2 must therefore cite that retained entity
 * at its r9 basis while preserving its immutable kind and id.
 */
function rebaseThreadEntityEvidence(
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
      "CM-01 correction accepts only a loopback server.ts /mcp endpoint.",
    );
  }
}

function confirmationRequired(): CoffeeMachineCm01V3CorrectionConfirmationRequired {
  return {
    status: "confirmation-required",
    acknowledgement: CM01_V3_CORRECTION_EXECUTION_ACKNOWLEDGEMENT,
    operations: [
      "design.correct-coffee-machine-cm01-drip-tray-height@1",
      "design.build-coffee-machine-cm01-cad@2",
      "verify.coffee-machine-cm01-drip-tray-mechanical@2",
    ],
    note:
      "No MCP connection, project mutation, provider call, or certification claim is made until --execute and the exact acknowledgement are both present.",
  };
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const result = await runCoffeeMachineCm01V3Correction({
    execute: Deno.args.includes("--execute"),
    acknowledgement: args["acknowledge"],
    mcpUrl: args["mcp-url"],
  });
  console.log(JSON.stringify(result, null, 2));
}
