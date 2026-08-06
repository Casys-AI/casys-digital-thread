import { parseArgs, stableId } from "./cli.ts";
import {
  FileLiveThreadUpdateStore,
  type LiveThreadGraphPatch,
  type LiveThreadUpdate,
  type LiveThreadUpdateJournal,
} from "../src/adapters/stores/live-thread-update-store.ts";
import { RecordingMcpToolClient } from "../src/adapters/recording-mcp-tool-client.ts";
import {
  HttpMcpToolClient,
  type McpToolCall,
  type McpToolClient,
  type McpToolResult,
} from "../src/adapters/mcp/http-mcp-tool-client.ts";
import { FileEngineeringProjectRevisionStore } from "../src/adapters/stores/engineering-project-store.ts";
import {
  COFFEE_MACHINE_MECHANICAL_SYSON_EDITING_CONTEXT_ID,
  COFFEE_MACHINE_MECHANICAL_SYSON_REQUIREMENTS_ELEMENT_ID,
} from "../src/adapters/historical/coffee-machine-mechanical-run-extension.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../src/domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecision,
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
} from "../src/domain/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../src/domain/engineering-project-validation.ts";
import { type WorkflowExecution, WorkflowExecutor } from "../src/workflow/executor.ts";
import { InternalThreadToolClient } from "../src/workflow/internal-thread-tools.ts";
import { loadAndCompileThreadWorkflow } from "../src/workflow/loader.ts";
import type {
  ThreadGraphNode,
  ThreadGraphRef,
} from "../src/contracts/thread-workbench.ts";
import type {
  CompiledBinding,
  CompiledThreadWorkflow,
  WorkflowOutputType,
} from "../src/workflow/types.ts";

export const COFFEE_MACHINE_MECHANICAL_RUN_SCHEMA =
  "coffee-machine-mechanical-run/1.0" as const;
export const COFFEE_MACHINE_PROJECT_ID = "coffee-machine-cm01" as const;
export const COFFEE_MACHINE_MECHANICAL_DECISION_ID =
  "review-mechanical-proof-case" as const;
export const COFFEE_MACHINE_MECHANICAL_WORK_ITEM_ID =
  "verify-current-mechanical-design" as const;
const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_MECHANICAL_WORKFLOW = new URL(
  "../config/thread-workflows/coffee-machine-mechanical-v1.yaml",
  import.meta.url,
);
const EXPECTED_PARAMETER_KEYS = [
  "analysis_scope",
  "evidence_boundary",
  "fixed_region",
  "load_case",
  "material_basis",
  "max_displacement_mm",
  "max_von_mises_mpa",
  "mesh_size_mm",
  "poisson_ratio",
  "young_modulus_mpa",
] as const;
const TARGET_MODEL_NAMES = new Set([
  "assembly_max_displacement",
  "assembly_max_von_mises",
  "assembly_displacement_limit",
  "assembly_von_mises_limit",
]);

export interface CoffeeMachineMechanicalProofCase {
  readonly analysisScope: string;
  readonly dimensionsMm: readonly [number, number, number];
  readonly materialBasis: string;
  readonly youngModulusMpa: number;
  readonly poissonRatio: number;
  readonly fixedRegion: "rear-vertical-face";
  readonly loadCase: string;
  readonly loadForceN: readonly [number, number, number];
  readonly meshSizeMm: number;
  readonly maxVonMisesMpa: number;
  readonly maxDisplacementMm: number;
  readonly evidenceBoundary: string;
}

export interface CoffeeMachineMechanicalStepArtifact {
  readonly format: "step";
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CoffeeMachineMechanicalRunCapture {
  readonly schemaVersion: typeof COFFEE_MACHINE_MECHANICAL_RUN_SCHEMA;
  readonly capturedAt: string;
  readonly runId: string;
  readonly subjectId: string;
  readonly project: {
    readonly id: string;
    readonly snapshotId: string;
    readonly revision: number;
  };
  readonly authorization: {
    readonly decisionId: string;
    readonly decisionInputFingerprint: string;
    readonly approvedBy: string;
    readonly approvedProposal: {
      readonly summary: string;
      readonly parameters: readonly EngineeringDecisionProposalParameter[];
    };
    readonly inputEvidenceRefs: EngineeringDecision["inputEvidenceRefs"];
    readonly runInputFingerprint: string;
    readonly queuedBy: string;
    readonly claimedBy: string;
    readonly baseSnapshotId: string;
    readonly baseSnapshotRevision: number;
    readonly baseSnapshotSubjectId: string;
  };
  readonly proofCase: CoffeeMachineMechanicalProofCase;
  readonly sysml: {
    readonly editingContextId: string;
    readonly requirementsElementId: string;
    readonly inserted: boolean;
    readonly constraints: readonly unknown[];
  };
  readonly cad: {
    readonly script: string;
    readonly toolCall: McpToolCall;
    readonly artifact: CoffeeMachineMechanicalStepArtifact;
  };
  readonly workflow: WorkflowExecution;
}

export interface MechanicalCaptureStore {
  prepare(path: string): Promise<void>;
  persist(path: string, deterministicContents: string): Promise<void>;
  /** Release a production claim after success or failure. Test stores may omit it. */
  release?(path: string): Promise<void>;
}

export interface RunCoffeeMachineMechanicalOptions {
  readonly runId: string;
  readonly projectSnapshot?: EngineeringProjectSnapshot;
  readonly projectDirectory?: string;
  readonly outputDirectory?: string;
  readonly liveUpdateDirectory?: string;
  readonly sysonMcpUrl?: string;
  readonly build123dMcpUrl?: string;
  readonly calculixMcpUrl?: string;
  /** Test seams: no network is used when all three clients are supplied. */
  readonly sysonClient?: McpToolClient;
  readonly build123dClient?: McpToolClient;
  readonly calculixClient?: McpToolClient;
  readonly liveUpdates?: LiveThreadUpdateJournal;
  readonly captureStore?: MechanicalCaptureStore;
  /** Test seam only: the canonical URL and exact executable contract stay fixed. */
  readonly readCanonicalWorkflowForTest?: (
    path: string | URL,
  ) => Promise<string>;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
}

export interface RunCoffeeMachineMechanicalResult {
  readonly capturePath: string;
  readonly capture: CoffeeMachineMechanicalRunCapture;
}

async function loadCanonicalMechanicalWorkflow(
  readTextFile?: (path: string | URL) => Promise<string>,
): Promise<CompiledThreadWorkflow> {
  const workflow = await loadAndCompileThreadWorkflow(
    CANONICAL_MECHANICAL_WORKFLOW,
    readTextFile ? { readTextFile } : {},
  );
  assertCanonicalMechanicalWorkflow(workflow);
  return workflow;
}

/**
 * The YAML is authoring input, not an execution extension point. Attest every
 * executable field after compilation so comments and prose may evolve while a
 * changed tool, binding, output, dependency, input, or node fails closed.
 */
function assertCanonicalMechanicalWorkflow(
  workflow: CompiledThreadWorkflow,
): void {
  const actual = {
    schemaVersion: workflow.schemaVersion,
    kind: workflow.kind,
    id: workflow.id,
    inputs: Object.fromEntries(
      Object.entries(workflow.inputs).map(([id, input]) => [id, input.type]),
    ),
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      server: node.server,
      tool: node.tool,
      arguments: node.arguments,
      outputs: Object.fromEntries(
        Object.entries(node.outputs).map(([id, output]) => [id, {
          select: output.select,
          type: output.type,
          ...(output.minItems === undefined ? {} : { minItems: output.minItems }),
        }]),
      ),
      explicitDependencies: node.explicitDependencies,
      inferredDependencies: node.inferredDependencies,
      dependencies: node.dependencies,
    })),
  };
  const expected = {
    schemaVersion: "1.0",
    kind: "thread-workflow-dag",
    id: "coffee-machine-mechanical-v1",
    inputs: {
      cad_step_path: "artifact-uri",
      cad_step_sha256: "string",
      reviewed_fixed_box_max: "array",
      reviewed_fixed_box_min: "array",
      reviewed_load_force_x_n: "number",
      reviewed_load_force_y_n: "number",
      reviewed_load_force_z_n: "number",
      reviewed_loaded_box_max: "array",
      reviewed_loaded_box_min: "array",
      reviewed_material_e_mpa: "number",
      reviewed_material_nu: "number",
      reviewed_mesh_size_mm: "number",
      syson_editing_context_id: "string",
      syson_mechanical_requirements_element_id: "string",
    },
    nodes: [
      {
        id: "requirements",
        server: "syson",
        tool: "syson_constraint_extract",
        arguments: {
          editing_context_id: inputBinding(
            "syson_editing_context_id",
            "string",
          ),
          element_id: inputBinding(
            "syson_mechanical_requirements_element_id",
            "string",
          ),
        },
        outputs: {
          constraints: output("constraints", "array", 2),
        },
        explicitDependencies: [],
        inferredDependencies: [],
        dependencies: [],
      },
      {
        id: "mechanical",
        server: "calculix",
        tool: "calculix_solve_static",
        arguments: {
          expected_step_sha256: inputBinding("cad_step_sha256", "string"),
          fixed: ["FIXED"],
          loads: [{
            force_n: [
              inputBinding("reviewed_load_force_x_n", "number"),
              inputBinding("reviewed_load_force_y_n", "number"),
              inputBinding("reviewed_load_force_z_n", "number"),
            ],
            selection: "LOADED",
          }],
          material: {
            e_mpa: inputBinding("reviewed_material_e_mpa", "number"),
            nu: inputBinding("reviewed_material_nu", "number"),
          },
          mesh_size_mm: inputBinding("reviewed_mesh_size_mm", "number"),
          selections: [
            {
              box: {
                max: inputBinding("reviewed_fixed_box_max", "array"),
                min: inputBinding("reviewed_fixed_box_min", "array"),
              },
              name: "FIXED",
            },
            {
              box: {
                max: inputBinding("reviewed_loaded_box_max", "array"),
                min: inputBinding("reviewed_loaded_box_min", "array"),
              },
              name: "LOADED",
            },
          ],
          step_path: inputBinding("cad_step_path", "artifact-uri"),
        },
        outputs: {
          input_step_sha256: output("inputArtifact.sha256", "string"),
          max_displacement: output("metrics.maxDisplacement", "quantity"),
          max_von_mises: output("metrics.maxVonMises", "quantity"),
        },
        explicitDependencies: ["requirements"],
        inferredDependencies: [],
        dependencies: ["requirements"],
      },
      {
        id: "observations",
        server: "digital-thread",
        tool: "thread_observations_normalize",
        arguments: {
          artifact_attestations: [{
            consumer_sha256: nodeBinding(
              "mechanical",
              "input_step_sha256",
              "string",
            ),
            producer_sha256: inputBinding("cad_step_sha256", "string"),
            relation: "consumed_exact_artifact",
          }],
          observations: {
            assembly_max_displacement: {
              produced_by: "mechanical",
              quantity: nodeBinding(
                "mechanical",
                "max_displacement",
                "quantity",
              ),
            },
            assembly_max_von_mises: {
              produced_by: "mechanical",
              quantity: nodeBinding(
                "mechanical",
                "max_von_mises",
                "quantity",
              ),
            },
          },
        },
        outputs: {
          provenance: output("provenance", "object"),
          values: output("values", "object"),
        },
        explicitDependencies: [],
        inferredDependencies: ["mechanical"],
        dependencies: ["mechanical"],
      },
      {
        id: "evaluation",
        server: "syson",
        tool: "syson_constraint_evaluate",
        arguments: {
          constraints: nodeBinding(
            "requirements",
            "constraints",
            "array",
          ),
          values: nodeBinding("observations", "values", "object"),
        },
        outputs: {
          resolved_values: output("resolvedValues", "object"),
          results: output("results", "array"),
          summary: output("summary", "object"),
        },
        explicitDependencies: [],
        inferredDependencies: ["observations", "requirements"],
        dependencies: ["observations", "requirements"],
      },
    ],
  };
  if (!sameJson(actual, expected)) {
    throw new Error(
      "Canonical CM-01 mechanical workflow does not match its exact executable contract.",
    );
  }
}

function inputBinding(
  input: string,
  type: WorkflowOutputType,
): CompiledBinding {
  return {
    kind: "binding",
    expression: `\${inputs.${input}}`,
    source: { kind: "workflow-input", input, type },
  };
}

function nodeBinding(
  nodeId: string,
  outputName: string,
  type: WorkflowOutputType,
): CompiledBinding {
  return {
    kind: "binding",
    expression: `\${${nodeId}.${outputName}}`,
    source: {
      kind: "node-output",
      nodeId,
      output: outputName,
      path: [],
      type,
    },
  };
}

function output(
  select: string,
  type: WorkflowOutputType,
  minItems?: number,
): { select: string; type: WorkflowOutputType; minItems?: number } {
  return { select, type, ...(minItems === undefined ? {} : { minItems }) };
}

/**
 * Execute the one human-authorized CM-01 mechanical run.
 *
 * This is deliberately a thin product runner: it grants no approval, claims no
 * run and publishes no canonical snapshot. It only accepts an already running
 * agent claim whose queue transition was authored by a human.
 */
export async function runCoffeeMachineMechanical(
  options: RunCoffeeMachineMechanicalOptions,
): Promise<RunCoffeeMachineMechanicalResult> {
  const runId = stableId(options.runId, "runId");
  const workflow = await loadCanonicalMechanicalWorkflow(
    options.readCanonicalWorkflowForTest,
  );
  const now = options.now ?? (() => new Date());
  const capturedAt = validDate(now(), "now").toISOString();
  const outputDirectory = options.outputDirectory ??
    "state/local/coffee-machine-mechanical-runs";
  const capturePath = joinPath(outputDirectory, `${runId}.json`);
  const captureStore = options.captureStore ?? new FileMechanicalCaptureStore();
  const project = validateEngineeringProjectSnapshot(
    options.projectSnapshot ?? await readActiveProject(options.projectDirectory),
  );
  const authorization = await authorizeRun(project, runId);
  const proofCase = extractApprovedProofCase(authorization.decision);
  const editingContextId = COFFEE_MACHINE_MECHANICAL_SYSON_EDITING_CONTEXT_ID;
  const requirementsElementId = COFFEE_MACHINE_MECHANICAL_SYSON_REQUIREMENTS_ELEMENT_ID;
  const updates = options.liveUpdates ?? new FileLiveThreadUpdateStore(
    options.liveUpdateDirectory ?? "state/local/live-thread-updates",
  );
  const baseRevision = authorization.run.baseSnapshot!.revision;
  assertSafePreflightResume(
    (await updates.list(project.project.subjectId)).filter((entry) =>
      entry.runId === runId
    ),
    runId,
    baseRevision,
  );
  await captureStore.prepare(capturePath);

  try {
    const sysonProvider = options.sysonClient ?? new HttpMcpToolClient({
      mcpUrl: options.sysonMcpUrl ?? "http://127.0.0.1:3009/mcp",
      timeoutMs: 30_000,
    });
    const build123dProvider = options.build123dClient ?? new HttpMcpToolClient({
      mcpUrl: options.build123dMcpUrl ?? "http://127.0.0.1:3014/mcp",
      timeoutMs: 120_000,
    });
    const calculixProvider = options.calculixClient ?? new HttpMcpToolClient({
      mcpUrl: options.calculixMcpUrl ?? "http://127.0.0.1:3015/mcp",
      timeoutMs: 180_000,
    });
    const projector = createMechanicalLiveProjector(runId);
    const guardedSyson = new ConstraintGuardingSysonClient(sysonProvider, proofCase);
    const recordedSyson = recordingClient({
      client: guardedSyson,
      updates,
      project,
      runId,
      serverId: "mcp-syson",
      baseRevision,
      now,
      projector,
    });
    const recordedBuild123d = recordingClient({
      client: build123dProvider,
      updates,
      project,
      runId,
      serverId: "mcp-build123d",
      baseRevision,
      now,
      projector,
    });
    const recordedCalculix = recordingClient({
      client: calculixProvider,
      updates,
      project,
      runId,
      serverId: "mcp-calculix",
      baseRevision,
      now,
      projector,
    });
    const recordedInternal = recordingClient({
      client: new InternalThreadToolClient(),
      updates,
      project,
      runId,
      serverId: "digital-thread",
      baseRevision,
      now,
      projector,
    });

    const preflight = await ensureApprovedConstraints({
      syson: recordedSyson,
      editingContextId,
      requirementsElementId,
      proofCase,
    });
    guardedSyson.requireExactConstraintsForWorkflow();
    const script = dripTrayScript(proofCase.dimensionsMm);
    const cadCall: McpToolCall = {
      name: "build123d_export",
      arguments: {
        script,
        formats: ["step"],
        name: `cm01-drip-tray-${
          authorization.decision.inputFingerprint!.digest.slice(0, 16)
        }`,
        timeout_ms: 120_000,
      },
    };
    const cadResult = await recordedBuild123d.callTool(cadCall);
    const artifact = exactStepArtifact(cadResult);
    const workflowInputs = mechanicalWorkflowInputs({
      editingContextId,
      requirementsElementId,
      proofCase,
      artifact,
    });
    const execution = await new WorkflowExecutor({
      resolveClient: (serverId) => {
        if (serverId === "syson") return recordedSyson;
        if (serverId === "calculix") return recordedCalculix;
        if (serverId === "digital-thread") return recordedInternal;
        throw new Error(`Mechanical workflow requested unapproved server: ${serverId}`);
      },
      now,
      monotonicNow: options.monotonicNow,
    }).execute(workflow, workflowInputs);
    const executionConstraints = exactExecutionConstraints(execution, proofCase);

    const capture: CoffeeMachineMechanicalRunCapture = {
      schemaVersion: COFFEE_MACHINE_MECHANICAL_RUN_SCHEMA,
      capturedAt,
      runId,
      subjectId: project.project.subjectId,
      project: {
        id: project.project.id,
        snapshotId: project.id,
        revision: project.revision,
      },
      authorization: {
        decisionId: authorization.decision.id,
        decisionInputFingerprint: authorization.decision.inputFingerprint!.digest,
        approvedBy: authorization.approvedBy,
        approvedProposal: {
          summary: authorization.decision.proposal!.summary,
          parameters: structuredClone(authorization.decision.proposal!.parameters),
        },
        inputEvidenceRefs: structuredClone(authorization.decision.inputEvidenceRefs),
        runInputFingerprint: authorization.run.inputFingerprint!.digest,
        queuedBy: authorization.queuedBy,
        claimedBy: authorization.run.claimedBy!.id,
        baseSnapshotId: authorization.run.baseSnapshot!.snapshotId,
        baseSnapshotRevision: authorization.run.baseSnapshot!.revision,
        baseSnapshotSubjectId: authorization.run.baseSnapshot!.subjectId,
      },
      proofCase,
      sysml: {
        editingContextId,
        requirementsElementId,
        inserted: preflight.inserted,
        constraints: executionConstraints,
      },
      cad: {
        script,
        toolCall: structuredClone(cadCall),
        artifact,
      },
      workflow: execution,
    };
    await captureStore.persist(capturePath, `${deterministicJson(capture)}\n`);
    return { capturePath, capture: structuredClone(capture) };
  } finally {
    await captureStore.release?.(capturePath);
  }
}

/**
 * A failed SysON preflight may have committed its bounded model mutation before
 * an older server response was rejected by the client contract. Resuming is
 * safe only because the runner re-reads and validates the exact two approved
 * constraints before it reaches CAD. Any evidence that execution progressed
 * beyond that preflight fails closed.
 */
function assertSafePreflightResume(
  entries: readonly LiveThreadUpdate[],
  runId: string,
  baseRevision: number,
): void {
  const safeOperation =
    /^cm01-mechanical:syson_(?:constraint_extract|element_children|element_insert_sysml):[0-9]{2}$/;
  const latestByOperation = new Map<string, LiveThreadUpdate>();
  for (const entry of entries) {
    const nodesAreBoundedSysOnPreflight = entry.graph.edges.length === 0 &&
      entry.graph.nodes.length === 1 &&
      entry.graph.nodes.every((node) =>
        node.ref.kind === "artifact" &&
        node.ref.id === `${runId}:requirements` &&
        node.entityKind === "artifact" &&
        node.artifactKind === "sysml-constraints" &&
        node.system === "mcp-syson"
      );
    if (
      entry.state === "reconciled" || entry.baseRevision !== baseRevision ||
      !safeOperation.test(entry.operationId) || !nodesAreBoundedSysOnPreflight
    ) {
      throw new Error(
        `Live activity for runId ${runId} progressed beyond resumable SysON preflight.`,
      );
    }
    const previous = latestByOperation.get(entry.operationId);
    if (!previous || entry.sequence > previous.sequence) {
      latestByOperation.set(entry.operationId, entry);
    }
  }
  if ([...latestByOperation.values()].some((entry) => entry.state === "running")) {
    throw new Error(
      `Live activity for runId ${runId} contains an unfinished SysON preflight operation.`,
    );
  }
}

/**
 * The persistent `.lock` file is only a rendezvous point; the OS file lock is
 * the claim. A process crash releases that claim automatically, so recovery
 * never depends on an unsafe age-based stale-lock heuristic.
 */
class FileMechanicalCaptureStore implements MechanicalCaptureStore {
  readonly #claims = new Map<string, Deno.FsFile>();

  async prepare(path: string): Promise<void> {
    if (this.#claims.has(path)) {
      throw new Error(`Mechanical capture is already claimed at ${path}.`);
    }
    await Deno.mkdir(directoryName(path), { recursive: true });
    const claim = await Deno.open(`${path}.lock`, {
      create: true,
      read: true,
      write: true,
    });
    let locked = false;
    try {
      locked = await claim.tryLock(true);
      if (!locked) {
        throw new Error(
          `Mechanical capture is already claimed by another runner at ${path}.`,
        );
      }
      try {
        await Deno.stat(path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          this.#claims.set(path, claim);
          return;
        }
        throw error;
      }
      throw new Error(`Mechanical capture already exists at ${path}.`);
    } catch (error) {
      if (locked) await claim.unlock();
      claim.close();
      throw error;
    }
  }

  async persist(path: string, contents: string): Promise<void> {
    if (!this.#claims.has(path)) {
      throw new Error(`Mechanical capture has no active claim at ${path}.`);
    }
    await Deno.writeTextFile(path, contents, { createNew: true });
  }

  async release(path: string): Promise<void> {
    const claim = this.#claims.get(path);
    if (!claim) return;
    this.#claims.delete(path);
    try {
      await claim.unlock();
    } finally {
      claim.close();
    }
  }
}

interface Authorization {
  decision: EngineeringDecision;
  run: EngineeringAgentRun;
  approvedBy: string;
  queuedBy: string;
}

async function authorizeRun(
  project: EngineeringProjectSnapshot,
  runId: string,
): Promise<Authorization> {
  if (project.project.id !== COFFEE_MACHINE_PROJECT_ID) {
    throw new Error(`Expected project ${COFFEE_MACHINE_PROJECT_ID}.`);
  }
  const workItem = project.workItems.find((item) =>
    item.id === COFFEE_MACHINE_MECHANICAL_WORK_ITEM_ID
  );
  if (!workItem) throw new Error("Mechanical work item is absent.");
  if (
    workItem.decisionIds.length !== 1 ||
    workItem.decisionIds[0] !== COFFEE_MACHINE_MECHANICAL_DECISION_ID
  ) {
    throw new Error(
      "Mechanical work item is not bound to exactly one reviewed decision.",
    );
  }
  const decision = project.decisions.find((item) =>
    item.id === COFFEE_MACHINE_MECHANICAL_DECISION_ID
  );
  if (
    !decision || decision.status !== "approved" || !decision.proposal ||
    !decision.baseSnapshot || !decision.inputFingerprint
  ) {
    throw new Error("Mechanical proof decision is not exactly approved.");
  }
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(decision.inputFingerprint, expectedDecisionFingerprint)) {
    throw new Error("Mechanical decision fingerprint does not match its proposal.");
  }
  const approvals = project.approvals.filter((approval) =>
    decision.approvalIds.includes(approval.id) &&
    approval.decisionId === decision.id && approval.status === "approved" &&
    approval.decidedByOrigin === "human" &&
    fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) &&
    sameJson(approval.baseSnapshot, decision.baseSnapshot) &&
    sameJson(approval.inputEvidenceRefs, decision.inputEvidenceRefs)
  );
  if (approvals.length !== 1 || !approvals[0].decidedBy) {
    throw new Error(
      "Mechanical proof has no unique human approval for its exact inputs.",
    );
  }
  const run = project.agentRuns.find((item) => item.id === runId);
  if (
    !run || run.workItemId !== workItem.id || run.status !== "running" ||
    !run.baseSnapshot || !run.inputFingerprint || !run.claimedBy ||
    run.claimedBy.origin !== "agent"
  ) {
    throw new Error(
      "Mechanical run must already be running under an explicit agent claim.",
    );
  }
  const queued = run.statusHistory?.find((transition) =>
    transition.status === "queued" && transition.actor.origin === "human"
  );
  const running = run.statusHistory?.find((transition) =>
    transition.status === "running" && transition.actor.origin === "agent" &&
    transition.actor.id === run.claimedBy!.id
  );
  if (!queued || !running) {
    throw new Error(
      "Mechanical run lacks its human queue or matching agent claim receipt.",
    );
  }
  if (!sameJson(run.baseSnapshot, decision.baseSnapshot)) {
    throw new Error("Mechanical run does not use the exact approved base snapshot.");
  }
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    baseSnapshot: run.baseSnapshot,
    decisionBindings: [{
      id: decision.id,
      inputFingerprint: decision.inputFingerprint,
    }],
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new Error(
      "Mechanical run input fingerprint does not bind the approved decision.",
    );
  }
  return {
    decision,
    run,
    approvedBy: approvals[0].decidedBy,
    queuedBy: queued.actor.id,
  };
}

export function extractApprovedProofCase(
  decision: EngineeringDecision,
): CoffeeMachineMechanicalProofCase {
  if (decision.status !== "approved" || !decision.proposal) {
    throw new Error("Cannot extract an unapproved mechanical proposal.");
  }
  const parameters = parameterMap(decision.proposal.parameters);
  const analysisScope = textParameter(parameters, "analysis_scope");
  const dimensionsMatch = analysisScope.match(
    /^CM-01 drip tray; isolated current CAD component, ([0-9]+(?:\.[0-9]+)?) x ([0-9]+(?:\.[0-9]+)?) x ([0-9]+(?:\.[0-9]+)?) mm$/,
  );
  if (!dimensionsMatch) {
    throw new TypeError(
      "analysis_scope does not identify one typed CM-01 drip-tray box.",
    );
  }
  const dimensionsMm = dimensionsMatch.slice(1).map(Number) as [number, number, number];
  dimensionsMm.forEach((value) => positive(value, "analysis_scope dimension"));
  const fixed = textParameter(parameters, "fixed_region");
  if (fixed !== "Rear vertical face fully fixed") {
    throw new TypeError(
      "fixed_region is not the supported reviewed rear-face condition.",
    );
  }
  const loadCase = textParameter(parameters, "load_case");
  const loadMatch = loadCase.match(
    /^([0-9]+(?:\.[0-9]+)?) N total downward force on the front vertical face(?: \(about [^)]+\))?$/,
  );
  if (!loadMatch) {
    throw new TypeError("load_case is not one typed front-face downward force.");
  }
  const loadN = positive(Number(loadMatch[1]), "load_case force");
  const poissonRatio = numberParameter(parameters, "poisson_ratio", "1");
  if (poissonRatio <= 0 || poissonRatio >= 0.5) {
    throw new TypeError("poisson_ratio must be greater than zero and below 0.5.");
  }
  return {
    analysisScope,
    dimensionsMm,
    materialBasis: textParameter(parameters, "material_basis"),
    youngModulusMpa: positive(
      numberParameter(parameters, "young_modulus_mpa", "MPa"),
      "young_modulus_mpa",
    ),
    poissonRatio,
    fixedRegion: "rear-vertical-face",
    loadCase,
    loadForceN: [0, 0, -loadN],
    meshSizeMm: positive(
      numberParameter(parameters, "mesh_size_mm", "mm"),
      "mesh_size_mm",
    ),
    maxVonMisesMpa: positive(
      numberParameter(parameters, "max_von_mises_mpa", "MPa"),
      "max_von_mises_mpa",
    ),
    maxDisplacementMm: positive(
      numberParameter(parameters, "max_displacement_mm", "mm"),
      "max_displacement_mm",
    ),
    evidenceBoundary: textParameter(parameters, "evidence_boundary"),
  };
}

async function ensureApprovedConstraints(input: {
  syson: McpToolClient;
  editingContextId: string;
  requirementsElementId: string;
  proofCase: CoffeeMachineMechanicalProofCase;
}): Promise<{ inserted: boolean; constraints: readonly unknown[] }> {
  let extracted = await extractConstraints(input);
  if (extracted.length > 0) {
    assertApprovedConstraints(extracted, input.proofCase);
    return { inserted: false, constraints: extracted };
  }
  const children = await input.syson.callTool({
    name: "syson_element_children",
    arguments: coordinates(input),
  });
  assertNoReservedChildren(children);
  const sysmlText = approvedConstraintSysml(input.proofCase);
  const insertion = await input.syson.callTool({
    name: "syson_element_insert_sysml",
    arguments: {
      editing_context_id: input.editingContextId,
      parent_id: input.requirementsElementId,
      sysml_text: sysmlText,
    },
  });
  const inserted = record(insertion.structuredContent, "constraint insertion");
  if (
    inserted.inserted !== true || inserted.parentId !== input.requirementsElementId
  ) {
    throw new Error("SysON did not attest the bounded constraint insertion.");
  }
  extracted = await extractConstraints(input);
  assertApprovedConstraints(extracted, input.proofCase);
  return { inserted: true, constraints: extracted };
}

async function extractConstraints(input: {
  syson: McpToolClient;
  editingContextId: string;
  requirementsElementId: string;
}): Promise<unknown[]> {
  const result = await input.syson.callTool({
    name: "syson_constraint_extract",
    arguments: coordinates(input),
  });
  const output = record(result.structuredContent, "constraint extraction");
  if (Array.isArray(output.errors) && output.errors.length > 0) {
    throw new Error("SysON constraint extraction returned parse errors.");
  }
  if (!Array.isArray(output.constraints)) {
    throw new TypeError("SysON constraint extraction omitted constraints.");
  }
  return structuredClone(output.constraints);
}

function approvedConstraintSysml(proofCase: CoffeeMachineMechanicalProofCase): string {
  return [
    "private import SI::*;",
    "",
    "attribute assembly_max_displacement : Real;",
    "attribute assembly_max_von_mises : Real;",
    "constraint assembly_displacement_limit {",
    `  assembly_max_displacement <= ${decimal(proofCase.maxDisplacementMm)} [mm]`,
    "}",
    "constraint assembly_von_mises_limit {",
    `  assembly_max_von_mises <= ${decimal(mpaToPa(proofCase.maxVonMisesMpa))} [Pa]`,
    "}",
  ].join("\n");
}

function assertNoReservedChildren(result: McpToolResult): void {
  const output = record(result.structuredContent, "element children");
  if (!Array.isArray(output.children)) {
    throw new TypeError("SysON element children omitted children.");
  }
  const collisions = output.children.filter(isRecord).filter((child) =>
    typeof child.label === "string" && TARGET_MODEL_NAMES.has(child.label.trim())
  );
  if (collisions.length > 0) {
    throw new Error(
      "Mechanical constraint names already exist without two coherent extracted constraints.",
    );
  }
}

function assertApprovedConstraints(
  rawConstraints: readonly unknown[],
  proofCase: CoffeeMachineMechanicalProofCase,
): void {
  if (rawConstraints.length !== 2) {
    throw new Error(
      "Mechanical requirement scope must contain exactly two constraints.",
    );
  }
  const expected = new Map<string, { value: number; unit: string }>([
    [
      "assembly_max_displacement",
      { value: proofCase.maxDisplacementMm, unit: "mm" },
    ],
    [
      "assembly_max_von_mises",
      { value: mpaToPa(proofCase.maxVonMisesMpa), unit: "Pa" },
    ],
  ]);
  const seen = new Set<string>();
  for (const [index, raw] of rawConstraints.entries()) {
    const constraint = record(raw, `constraints[${index}]`);
    const expression = record(
      constraint.expression,
      `constraints[${index}].expression`,
    );
    const left = record(expression.left, `constraints[${index}].expression.left`);
    const right = record(expression.right, `constraints[${index}].expression.right`);
    if (
      expression.kind !== "binary" || expression.op !== "<=" ||
      left.kind !== "ref" || !Array.isArray(left.featurePath) ||
      left.featurePath.length !== 1 || typeof left.featurePath[0] !== "string" ||
      right.kind !== "literal"
    ) {
      throw new Error("Mechanical constraints are not simple approved upper bounds.");
    }
    const feature = left.featurePath[0];
    const approved = expected.get(feature);
    if (
      !approved || seen.has(feature) || right.value !== approved.value ||
      right.unit !== approved.unit
    ) {
      throw new Error(
        "SysON mechanical constraints differ from the approved thresholds.",
      );
    }
    seen.add(feature);
  }
  if (seen.size !== expected.size) {
    throw new Error("SysON mechanical constraints are incomplete.");
  }
}

class ConstraintGuardingSysonClient implements McpToolClient {
  #requireExactConstraints = false;
  #executionConstraints?: readonly unknown[];

  constructor(
    private readonly inner: McpToolClient,
    private readonly proofCase: CoffeeMachineMechanicalProofCase,
  ) {}

  requireExactConstraintsForWorkflow(): void {
    this.#requireExactConstraints = true;
  }

  /**
   * Delegates text-result calls (e.g. syson_constraint_solve) without
   * constraint guarding.
   *
   * The guard intercepts syson_constraint_extract and syson_constraint_evaluate,
   * both of which use callTool(). syson_constraint_solve uses callToolTextResult
   * because its result lives in content[0].text, not structuredContent. No guard
   * is needed for the solve path: z3 is diagnostic-only and does not gate the
   * mechanical run (see decision D4 in CLAUDE.md).
   */
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return this.inner.callToolTextResult(call);
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_constraint_evaluate") {
      if (!this.#executionConstraints) {
        throw new Error(
          "SysON evaluation cannot run before exact workflow constraints are attested.",
        );
      }
      assertExactEvaluationArguments(call, this.#executionConstraints);
    }
    const result = await this.inner.callTool(call);
    if (call.name === "syson_constraint_extract") {
      const output = record(result.structuredContent, "constraint extraction");
      if (!Array.isArray(output.constraints)) {
        throw new TypeError("SysON constraint extraction omitted constraints.");
      }
      if (this.#requireExactConstraints) {
        assertApprovedConstraints(output.constraints, this.proofCase);
        this.#executionConstraints = structuredClone(output.constraints);
      } else if (output.constraints.length > 0) {
        assertApprovedConstraints(output.constraints, this.proofCase);
      }
    } else if (call.name === "syson_constraint_evaluate") {
      assertExactEvaluationResult(result, this.#executionConstraints!);
    }
    return result;
  }
}

function exactExecutionConstraints(
  execution: WorkflowExecution,
  proofCase: CoffeeMachineMechanicalProofCase,
): readonly unknown[] {
  const requirements = execution.nodes.find((node) => node.nodeId === "requirements");
  if (requirements?.status !== "succeeded") {
    throw new Error(
      "Mechanical workflow did not attest its requirements before execution.",
    );
  }
  const constraints = record(
    requirements.structuredContent,
    "workflow requirements structuredContent",
  ).constraints;
  if (!Array.isArray(constraints)) {
    throw new TypeError("Mechanical workflow requirements omitted constraints.");
  }
  assertApprovedConstraints(constraints, proofCase);
  return structuredClone(constraints);
}

function assertExactEvaluationArguments(
  call: McpToolCall,
  constraints: readonly unknown[],
): void {
  const supplied = record(call.arguments, "SysON evaluation arguments").constraints;
  if (!Array.isArray(supplied) || !sameJson(supplied, constraints)) {
    throw new Error(
      "SysON evaluation is not bound to the attested workflow constraints.",
    );
  }
}

function assertExactEvaluationResult(
  result: McpToolResult,
  constraints: readonly unknown[],
): void {
  const expectedIds = new Set(constraints.map((constraint, index) => {
    const id = record(constraint, `attested constraints[${index}]`).id;
    if (typeof id !== "string" || id.trim() === "") {
      throw new TypeError("Attested mechanical constraints must have stable IDs.");
    }
    return id;
  }));
  if (expectedIds.size !== constraints.length) {
    throw new Error("Attested mechanical constraints must have distinct stable IDs.");
  }
  const output = record(result.structuredContent, "constraint evaluation");
  if (!Array.isArray(output.results) || output.results.length !== expectedIds.size) {
    throw new Error(
      "SysON evaluation did not return exactly the attested constraints.",
    );
  }
  const seen = new Set<string>();
  for (const [index, raw] of output.results.entries()) {
    const id = record(raw, `evaluation results[${index}]`).constraintId;
    if (typeof id !== "string" || !expectedIds.has(id) || seen.has(id)) {
      throw new Error(
        "SysON evaluation returned a result outside the attested constraints.",
      );
    }
    seen.add(id);
  }
}

function exactStepArtifact(result: McpToolResult): CoffeeMachineMechanicalStepArtifact {
  const output = record(result.structuredContent, "build123d export");
  if (!Array.isArray(output.files)) {
    throw new TypeError("build123d export omitted files.");
  }
  const steps = output.files.filter(isRecord).filter((file) => file.format === "step");
  if (steps.length !== 1) {
    throw new Error("build123d must return exactly one STEP artifact.");
  }
  const step = steps[0];
  if (
    typeof step.path !== "string" || step.path.trim() === "" ||
    typeof step.bytes !== "number" || !Number.isSafeInteger(step.bytes) ||
    step.bytes < 1 || typeof step.sha256 !== "string" || !SHA256.test(step.sha256)
  ) {
    throw new TypeError("build123d returned an invalid STEP attestation.");
  }
  return {
    format: "step",
    path: step.path,
    bytes: step.bytes,
    sha256: step.sha256,
  };
}

function mechanicalWorkflowInputs(input: {
  editingContextId: string;
  requirementsElementId: string;
  proofCase: CoffeeMachineMechanicalProofCase;
  artifact: CoffeeMachineMechanicalStepArtifact;
}): Readonly<Record<string, unknown>> {
  const [x, y, z] = input.proofCase.dimensionsMm;
  const halfX = x / 2;
  const halfY = y / 2;
  const halfZ = z / 2;
  return {
    syson_editing_context_id: input.editingContextId,
    syson_mechanical_requirements_element_id: input.requirementsElementId,
    cad_step_path: input.artifact.path,
    cad_step_sha256: input.artifact.sha256,
    reviewed_mesh_size_mm: input.proofCase.meshSizeMm,
    reviewed_material_e_mpa: input.proofCase.youngModulusMpa,
    reviewed_material_nu: input.proofCase.poissonRatio,
    reviewed_fixed_box_min: [-halfX - 1, halfY - 1, -halfZ - 1],
    reviewed_fixed_box_max: [halfX + 1, halfY + 1, halfZ + 1],
    reviewed_loaded_box_min: [-halfX - 1, -halfY - 1, -halfZ - 1],
    reviewed_loaded_box_max: [halfX + 1, -halfY + 1, halfZ + 1],
    reviewed_load_force_x_n: input.proofCase.loadForceN[0],
    reviewed_load_force_y_n: input.proofCase.loadForceN[1],
    reviewed_load_force_z_n: input.proofCase.loadForceN[2],
  };
}

function dripTrayScript(dimensions: readonly [number, number, number]): string {
  return [
    "from build123d import Align, Box",
    "",
    `result = Box(${
      dimensions.map(decimal).join(", ")
    }, align=(Align.CENTER, Align.CENTER, Align.CENTER))`,
  ].join("\n");
}

function recordingClient(input: {
  client: McpToolClient;
  updates: LiveThreadUpdateJournal;
  project: EngineeringProjectSnapshot;
  runId: string;
  serverId: string;
  baseRevision: number;
  now: () => Date;
  projector: (
    event: import("../src/adapters/recording-mcp-tool-client.ts").RecordingMcpToolEvent,
  ) => LiveThreadGraphPatch;
}): RecordingMcpToolClient {
  return new RecordingMcpToolClient({
    client: input.client,
    updates: input.updates,
    subjectId: input.project.project.subjectId,
    runId: input.runId,
    serverId: input.serverId,
    baseRevision: input.baseRevision,
    operationId: (call, index) =>
      `cm01-mechanical:${call.name}:${String(index).padStart(2, "0")}`,
    now: input.now,
    project: input.projector,
  });
}

function createMechanicalLiveProjector(runId: string) {
  return (
    event: import("../src/adapters/recording-mcp-tool-client.ts").RecordingMcpToolEvent,
  ): LiveThreadGraphPatch => {
    if (event.runId !== runId) throw new Error("Mechanical live run mismatch.");
    const projection = toolProjection(runId, event.toolName, event.serverId);
    const summary = event.phase === "started"
      ? `${projection.label} started`
      : event.phase === "failed"
      ? `${projection.label} failed`
      : `${projection.label} completed`;
    const node: ThreadGraphNode = {
      id: `graph:${projection.ref.kind}:${projection.ref.id}`,
      ref: projection.ref,
      entityKind: projection.ref.kind,
      ...(projection.ref.kind === "artifact"
        ? { artifactKind: projection.artifactKind }
        : {}),
      label: projection.label,
      system: event.serverId,
      freshness: "running",
      summary,
      recordedAt: event.recordedAt,
    };
    return { nodes: [node], edges: projection.edges };
  };
}

function toolProjection(runId: string, tool: string, server: string): {
  ref: ThreadGraphRef;
  label: string;
  artifactKind?: string;
  edges: LiveThreadGraphPatch["edges"];
} {
  const requirements: ThreadGraphRef = {
    kind: "artifact",
    id: `${runId}:requirements`,
  };
  const cad: ThreadGraphRef = { kind: "artifact", id: `${runId}:cad` };
  const fea: ThreadGraphRef = { kind: "artifact", id: `${runId}:fea` };
  const observations: ThreadGraphRef = {
    kind: "observation",
    id: `${runId}:observations`,
  };
  const verdict: ThreadGraphRef = { kind: "evaluation", id: `${runId}:verdict` };
  if (server === "mcp-syson" && tool !== "syson_constraint_evaluate") {
    return {
      ref: requirements,
      label: tool === "syson_element_insert_sysml"
        ? "Model-owned mechanical limits"
        : "Reviewed mechanical requirements",
      artifactKind: "sysml-constraints",
      edges: [],
    };
  }
  if (tool === "build123d_export") {
    return {
      ref: cad,
      label: "CM-01 drip-tray CAD",
      artifactKind: "cad-model",
      edges: [
        edge(
          requirements,
          cad,
          "input_to",
          "Reviewed scope and limits bound the generated proof geometry.",
        ),
      ],
    };
  }
  if (tool === "calculix_solve_static") {
    return {
      ref: fea,
      label: "CM-01 static mechanical solve",
      artifactKind: "fea-result",
      edges: [
        edge(
          cad,
          fea,
          "input_to",
          "CalculiX consumes the exact content-addressed STEP artifact.",
        ),
      ],
    };
  }
  if (tool === "thread_observations_normalize") {
    return {
      ref: observations,
      label: "Normalized mechanical observations",
      edges: [
        edge(
          fea,
          observations,
          "source_of",
          "The solver metrics produce unit-bearing observations.",
        ),
      ],
    };
  }
  if (tool === "syson_constraint_evaluate") {
    return {
      ref: verdict,
      label: "SysON mechanical verdict",
      edges: [
        edge(
          requirements,
          verdict,
          "input_to",
          "The model-owned constraints are evaluated.",
        ),
        edge(
          observations,
          verdict,
          "evidences",
          "The attested solver observations provide the evaluated values.",
        ),
      ],
    };
  }
  throw new Error(`No mechanical live projection for ${server}/${tool}.`);
}

function edge(
  from: ThreadGraphRef,
  to: ThreadGraphRef,
  relation: LiveThreadGraphPatch["edges"][number]["relation"],
  rationale: string,
): LiveThreadGraphPatch["edges"][number] {
  return {
    id: `live-edge:${from.kind}:${from.id}:${relation}:${to.kind}:${to.id}`,
    from,
    to,
    relation,
    rationale,
    origin: "provenance",
  };
}

function parameterMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ReadonlyMap<string, EngineeringDecisionProposalParameter> {
  const result = new Map<string, EngineeringDecisionProposalParameter>();
  for (const parameter of parameters) {
    if (result.has(parameter.key)) {
      throw new TypeError(`Duplicate proposal parameter: ${parameter.key}.`);
    }
    result.set(parameter.key, parameter);
  }
  const actual = [...result.keys()].sort();
  if (!sameJson(actual, EXPECTED_PARAMETER_KEYS)) {
    throw new TypeError(
      "Mechanical proposal parameters do not match the exact runner contract.",
    );
  }
  return result;
}

function textParameter(
  parameters: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  key: string,
): string {
  const value = parameters.get(key)?.value;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${key} must be a non-empty reviewed string.`);
  }
  return value;
}

function numberParameter(
  parameters: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  key: string,
  unit: string,
): number {
  const parameter = parameters.get(key);
  if (
    typeof parameter?.value !== "number" || !Number.isFinite(parameter.value) ||
    parameter.unit !== unit
  ) {
    throw new TypeError(`${key} must be a finite reviewed number in ${unit}.`);
  }
  return parameter.value;
}

function coordinates(input: {
  editingContextId: string;
  requirementsElementId: string;
}): Readonly<Record<string, unknown>> {
  return {
    editing_context_id: input.editingContextId,
    element_id: input.requirementsElementId,
  };
}

async function readActiveProject(
  directory = "state/local/engineering-projects",
): Promise<EngineeringProjectSnapshot> {
  const project = await new FileEngineeringProjectRevisionStore(directory).get(
    COFFEE_MACHINE_PROJECT_ID,
  );
  if (!project) {
    throw new Error(`Active project ${COFFEE_MACHINE_PROJECT_ID} is absent.`);
  }
  return project;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number.`);
  }
  return value;
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Cannot render a non-finite number.");
  }
  return String(value);
}

function mpaToPa(value: number): number {
  const converted = value * 1_000_000;
  if (!Number.isFinite(converted)) {
    throw new TypeError("Approved von Mises limit cannot be represented in Pa.");
  }
  return converted;
}

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.valueOf())) {
    throw new TypeError(`${label} returned an invalid date.`);
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function joinPath(directory: string, name: string): string {
  if (directory.trim() === "") throw new TypeError("directory must not be empty");
  return `${directory.replace(/\/$/, "")}/${name}`;
}

function directoryName(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "." : path.slice(0, index) || "/";
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const runId = args["run-id"];
  if (!runId) throw new TypeError("Missing required --run-id=<human-queued-run-id>.");
  const result = await runCoffeeMachineMechanical({
    runId,
    projectDirectory: args["project-dir"],
    outputDirectory: args["output-dir"],
    liveUpdateDirectory: args["live-update-dir"],
    sysonMcpUrl: args["syson-mcp-url"],
    build123dMcpUrl: args["build123d-mcp-url"],
    calculixMcpUrl: args["calculix-mcp-url"],
  });
  console.log(deterministicJson({
    runId: result.capture.runId,
    projectRevision: result.capture.project.revision,
    insertedSysmlConstraints: result.capture.sysml.inserted,
    cadStep: result.capture.cad.artifact,
    workflowStatus: result.capture.workflow.status,
    capturePath: result.capturePath,
  }));
}
