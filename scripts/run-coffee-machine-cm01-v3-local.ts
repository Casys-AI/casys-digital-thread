import { parseArgs } from "./cli.ts";
import { ApprovedBriefBaselineRunExecutor } from "../src/adapters/executors/approved-brief-baseline-run-executor.ts";
import { Cm01ErpNextBomCaptureAdapter } from "../src/adapters/captures/cm01-erpnext-bom-capture.ts";
import { Cm01NominalModelicaCaptureAdapter } from "../src/adapters/captures/cm01-nominal-modelica-capture.ts";
import {
  CoffeeMachineCm01V3ArchitectureRunExecutor,
} from "../src/adapters/executors/coffee-machine-cm01-v3-architecture-run-executor.ts";
import {
  CoffeeMachineCm01V3CadRunExecutor,
} from "../src/adapters/executors/coffee-machine-cm01-v3-cad-run-executor.ts";
import {
  CoffeeMachineCm01V3ErpNextBomRunExecutor,
} from "../src/adapters/executors/coffee-machine-cm01-v3-erpnext-bom-run-executor.ts";
import {
  projectCoffeeMachineCm01V3GoldenObservation,
} from "../src/adapters/executors/coffee-machine-cm01-v3-golden-observation.ts";
import {
  CoffeeMachineCm01V3MechanicalRunExecutor,
} from "../src/adapters/executors/coffee-machine-cm01-v3-mechanical-run-executor.ts";
import {
  CoffeeMachineCm01V3ThermalRunExecutor,
} from "../src/adapters/executors/coffee-machine-cm01-v3-thermal-run-executor.ts";
import { FileCm01DripTrayMechanicalAttemptStore } from "../src/adapters/wal/file-cm01-drip-tray-mechanical-attempt-store.ts";
import { FileCm01ErpNextBomRunCaptureStore } from "../src/adapters/captures/file-cm01-erpnext-bom-run-capture-store.ts";
import { FileCm01NominalModelicaAttemptStore } from "../src/adapters/wal/file-cm01-nominal-modelica-attempt-store.ts";
import { FileCm01SemanticCadAttemptStore } from "../src/adapters/wal/file-cm01-semantic-cad-attempt-store.ts";
import { FileCoffeeMachineCm01V3ArchitectureAttemptStore } from "../src/adapters/wal/file-coffee-machine-cm01-v3-architecture-attempt-store.ts";
import {
  CoffeeMachineCm01V3SensitivityRunExecutor,
} from "../src/adapters/executors/coffee-machine-cm01-v3-sensitivity-run-executor.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
  CM01_ERPNEXT_BOM_CAPTURE_DESCRIPTOR,
  CM01_NOMINAL_MODELICA_CAPTURE_DESCRIPTOR,
  CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  ORACLE_REQUIREMENTS_SEED_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../src/adapters/captures/file-capture-store.ts";
import { FileSensitivityRunAttemptStore } from "../src/adapters/wal/file-sensitivity-run-attempt-store.ts";
import { FileEngineeringProjectRunLease } from "../src/adapters/stores/file-engineering-project-run-lease.ts";
import { FileEngineeringProjectRevisionStore } from "../src/adapters/stores/engineering-project-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../src/adapters/validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../src/adapters/validators/engineering-project-initial-baseline-evidence-validator.ts";
import { FileLiveThreadUpdateStore } from "../src/adapters/stores/live-thread-update-store.ts";
import { loadFleetManifest } from "../src/adapters/manifest.ts";
import { HttpMcpToolClient } from "../src/adapters/mcp/http-mcp-tool-client.ts";
import { FileSysonModelSeedAttemptStore } from "../src/adapters/wal/file-syson-model-seed-attempt-store.ts";
import { FileThreadSnapshotStore } from "../src/adapters/stores/file-thread-snapshot-store.ts";
import { SysonModelSeedRunExecutor } from "../src/adapters/executors/syson-model-seed-run-executor.ts";
import { parseCm01DripTrayMechanicalProof } from "../src/domain/cm01/cm01-drip-tray-mechanical-proof.ts";
import { parseCoffeeMachineCm01SemanticRecipe } from "../src/domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import { validateSensitivityStudyCase } from "../src/domain/analysis/sensitivity-study.ts";
import {
  compareCoffeeMachineCm01V3GoldenReference,
  type GoldenReferenceComparison,
  validateCoffeeMachineCm01V3GoldenReference,
} from "../src/domain/cm01/coffee-machine-cm01-v3-golden-reference.ts";
import {
  type EngineeringProjectCommandOrigin,
  EngineeringProjectCommandService,
} from "../src/domain/engineering-project-command-service.ts";
import type {
  EngineeringBasisRef,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../src/domain/engineering-project.ts";
import { ProjectBriefCommandService } from "../src/domain/project-brief-command-service.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../src/domain/platform/syson-model-seed.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../src/orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../src/orchestration/operations/registry.ts";

export const CM01_V3_LOCAL_EXECUTION_ACKNOWLEDGEMENT =
  "EXECUTE_CM01_V3_LOCAL_RUN" as const;
/**
 * A separate acknowledgement is required before a local integration fixture
 * becomes a persistent project in the same stores served by `server.ts`.
 */
export const CM01_V3_CANONICAL_PERSISTENCE_ACKNOWLEDGEMENT =
  "PERSIST_CM01_V3_CANONICAL_PROJECT" as const;

const PROJECT_ID = "coffee-machine-cm01-v3";
const SUBJECT_ID = "project:coffee-machine-cm01-v3";
const AGENT: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "agent:cm01-v3-local-integration",
};
const LOCAL_REVIEWER: EngineeringProjectCommandOrigin = {
  kind: "human",
  actorId: "human:cm01-v3-local-integration",
};

export interface RunCoffeeMachineCm01V3LocalOptions {
  /** Required together with the exact acknowledgement before any state or MCP call. */
  readonly execute?: boolean;
  readonly acknowledgement?: string;
  /** Must not already exist; the runner never overwrites or clears a prior run. */
  readonly outputDirectory?: string;
  /** Local, loopback-only fleet manifest. */
  readonly manifestPath?: string;
  /**
   * `isolated` is the safe default. `canonical` records a new project in the
   * stores served by server.ts, so the Cockpit can project it.
   */
  readonly stateScope?: "isolated" | "canonical";
  /** Required together with `stateScope: "canonical"`. */
  readonly canonicalAcknowledgement?: string;
}

export interface CoffeeMachineCm01V3StateDirectories {
  readonly projects: string;
  readonly snapshots: string;
  readonly baselineCaptures: string;
  readonly sysonSeedCaptures: string;
  readonly sysonSeedAttempts: string;
  readonly architectureCaptures: string;
  readonly architectureAttempts: string;
  readonly cadCaptures: string;
  readonly cadAttempts: string;
  readonly thermalCaptures: string;
  readonly thermalAttempts: string;
  readonly erpBomCaptures: string;
  readonly erpBomRunCaptures: string;
  readonly oracleRequirementsSeedCaptures: string;
  readonly mechanicalCaptures: string;
  readonly mechanicalAttempts: string;
  readonly sensitivityCaptures: string;
  readonly sensitivityAttempts: string;
  readonly liveUpdates: string;
  readonly leases: string;
}

export interface CoffeeMachineCm01V3LocalConfirmationRequired {
  readonly status: "confirmation-required";
  readonly acknowledgement: typeof CM01_V3_LOCAL_EXECUTION_ACKNOWLEDGEMENT;
  readonly operations: readonly string[];
  readonly note: string;
}

export interface CoffeeMachineCm01V3LocalRunResult {
  readonly status: "completed";
  readonly outputDirectory: string;
  readonly observationPath: string;
  readonly stateScope: "isolated" | "canonical";
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
    readonly revision: number;
    readonly finalSnapshot: EngineeringThreadSnapshotRef;
  };
  readonly comparison: GoldenReferenceComparison;
  readonly note: string;
}

/**
 * Execute the bounded CM-01 V3 technical integration path against the local
 * MCP fleet. This is deliberately a test harness, not an approval shortcut:
 * it records one explicit local-fixture approval so the real command service
 * and server-owned executors can be exercised without pretending that a host
 * chat confirmation happened.
 *
 * The harness never reads an older CM-01 state directory. Each invocation has
 * a new state root and produces only normalized project, ThreadSnapshot,
 * live-feed, capture, and golden-observation records.
 */
export async function runCoffeeMachineCm01V3Local(
  options: RunCoffeeMachineCm01V3LocalOptions = {},
): Promise<
  | CoffeeMachineCm01V3LocalConfirmationRequired
  | CoffeeMachineCm01V3LocalRunResult
> {
  if (!options.execute) return confirmationRequired();
  if (options.acknowledgement !== CM01_V3_LOCAL_EXECUTION_ACKNOWLEDGEMENT) {
    throw new Error(
      `Refusing local CM-01 V3 execution without --acknowledge=${CM01_V3_LOCAL_EXECUTION_ACKNOWLEDGEMENT}.`,
    );
  }

  const stateScope = options.stateScope ?? "isolated";
  if (
    stateScope === "canonical" &&
    options.canonicalAcknowledgement !==
      CM01_V3_CANONICAL_PERSISTENCE_ACKNOWLEDGEMENT
  ) {
    throw new Error(
      "Refusing canonical CM-01 V3 persistence without " +
        `--canonical-acknowledge=${CM01_V3_CANONICAL_PERSISTENCE_ACKNOWLEDGEMENT}.`,
    );
  }
  const outputDirectory = requireNewOutputDirectory(
    options.outputDirectory ?? defaultOutputDirectory(),
  );
  const state = coffeeMachineCm01V3StateDirectories({
    outputDirectory,
    stateScope,
  });
  if (stateScope === "canonical") {
    await requireProjectAbsent(state.projects, PROJECT_ID);
  }
  await createNewDirectory(outputDirectory);

  const manifest = await loadFleetManifest(
    options.manifestPath ?? "config/mcp-fleet.json",
  );
  const syson = new HttpMcpToolClient({
    mcpUrl: localMcpUrl(manifest, "syson"),
    timeoutMs: 30_000,
  });
  const build123d = new HttpMcpToolClient({
    mcpUrl: localMcpUrl(manifest, "build123d"),
    timeoutMs: 120_000,
  });
  const calculix = new HttpMcpToolClient({
    mcpUrl: localMcpUrl(manifest, "calculix"),
    timeoutMs: 120_000,
  });
  const modelica = new HttpMcpToolClient({
    mcpUrl: localMcpUrl(manifest, "modelica"),
    timeoutMs: 120_000,
  });
  const erpnext = new HttpMcpToolClient({
    mcpUrl: localMcpUrl(manifest, "erpnext"),
    timeoutMs: 30_000,
  });

  const projects = new FileEngineeringProjectRevisionStore(state.projects);
  const snapshots = new FileThreadSnapshotStore(state.snapshots);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: state.baselineCaptures,
  });
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: state.sysonSeedCaptures,
  });
  const liveUpdates = new FileLiveThreadUpdateStore(state.liveUpdates);
  const lease = new FileEngineeringProjectRunLease(state.leases);
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );

  const recipe = parseCoffeeMachineCm01SemanticRecipe(
    await readJson("config/product-recipes/coffee-machine-cm01-v1.json"),
  );
  const mechanicalProof = parseCm01DripTrayMechanicalProof(
    await readJson(
      "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-static.json",
    ),
  );
  const sensitivityCase = validateSensitivityStudyCase(
    await readJson(
      "config/sensitivity-cases/coffee-machine-cm01-v3-drip-tray-size-z.json",
    ),
  );

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "local-cm01-v3-start",
    projectId: PROJECT_ID,
    projectName: stateScope === "canonical"
      ? "CoffeeMachine CM-01 V3"
      : "CM-01 coffee machine V3 local integration",
    issuedAt: now(),
    intent:
      "Exercise the bounded CM-01 V3 technical evidence path against the local MCP fleet.",
    intentSource: { kind: "human", reference: "local-integration-harness" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...commandContext(project, "local-cm01-v3-propose-brief"),
    items: [
      {
        id: "objective",
        kind: "objective",
        statement:
          "Capture a reviewable CM-01 V3 evidence chain through local MCP providers.",
        sourceRefs: [{ kind: "intent", reference: "local-integration-harness" }],
      },
      {
        id: "boundary",
        kind: "exclusion",
        statement:
          "The run is an integration proof only; it does not certify, release, or prove the complete coffee machine.",
        sourceRefs: [{ kind: "intent", reference: "local-integration-harness" }],
      },
      {
        id: "mission",
        kind: "mission-scenario",
        statement:
          "Exercise one bounded CoffeeMachine CM-01 evidence loop across local SysON, CAD, simulation, ERP, and mechanical-verification providers.",
        sourceRefs: [{ kind: "intent", reference: "local-integration-harness" }],
      },
      {
        id: "success",
        kind: "success-criterion",
        statement:
          "Produce one normalized V3 project/thread observation that the static CM-01 golden gate can compare.",
        sourceRefs: [{ kind: "intent", reference: "local-integration-harness" }],
      },
    ],
  });
  project = await briefs.approveBrief(LOCAL_REVIEWER, {
    ...commandContext(project, "local-cm01-v3-approve-brief"),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale:
      "Explicit local integration-fixture approval; not a substitute for a paired-conversation review.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  project = await commands.publishPlan(AGENT, {
    ...commandContext(project, "local-cm01-v3-publish-baseline"),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Engineering baseline",
      description: "Record the explicit local-fixture reviewed brief.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: approvedBriefOperation("baseline.from-approved-brief", "1"),
    }],
    requiredDecisions: [],
  });
  project = await queueAndExecute({
    project,
    commands,
    workItemId: "record-approved-brief",
    runId: "run:local-cm01-v3-brief-baseline",
    summary: "Record the explicit local-fixture approved brief.",
    basis: project.plan!.basis,
    execute: (queued) =>
      new ApprovedBriefBaselineRunExecutor({
        projects,
        commands,
        captures: baselineCaptures,
        snapshots,
        lease,
        liveUpdates,
        now,
      }).execute(AGENT, queued),
  });

  project = await appendOperation({
    project,
    commands,
    changeId: "local-cm01-v3-add-architecture",
    phase: {
      id: "architecture",
      name: "System architecture",
      description: "Create the SysON container and insert the reviewed CM-01 V3 model.",
    },
    workItems: [
      {
        id: "seed-syson-model",
        dependsOnWorkItemIds: ["record-approved-brief"],
        operation: {
          ...SYSON_MODEL_SEED_OPERATION,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      },
      {
        id: "author-cm01-architecture",
        dependsOnWorkItemIds: ["seed-syson-model"],
        operation: approvedBriefOperation(
          COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture.id,
          COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture.version,
        ),
      },
    ],
  });
  project = await queueAndExecute({
    project,
    commands,
    workItemId: "seed-syson-model",
    runId: "run:local-cm01-v3-syson-seed",
    summary: "Create the local CM-01 SysON model container.",
    basis: threadBasis(project),
    execute: (queued) =>
      new SysonModelSeedRunExecutor({
        projects,
        commands,
        snapshots,
        captures: seedCaptures,
        attempts: new FileSysonModelSeedAttemptStore(
          state.sysonSeedAttempts,
        ),
        syson,
        lease,
        liveUpdates,
        now,
      }).execute(AGENT, queued),
  });
  project = await queueAndExecute({
    project,
    commands,
    workItemId: "author-cm01-architecture",
    runId: "run:local-cm01-v3-architecture",
    summary: "Insert and read back the reviewed CM-01 V3 SysML architecture.",
    basis: threadBasis(project),
    execute: (queued) =>
      new CoffeeMachineCm01V3ArchitectureRunExecutor({
        projects,
        commands,
        snapshots,
        seedCaptures,
        captures: new FileCaptureStore({
          ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
          directory: state.architectureCaptures,
        }),
        attempts: new FileCoffeeMachineCm01V3ArchitectureAttemptStore(
          state.architectureAttempts,
        ),
        recipe,
        syson,
        lease,
        liveUpdates,
        now,
      }).execute(AGENT, queued),
  });

  project = await appendSingleOperation({
    project,
    commands,
    changeId: "local-cm01-v3-add-cad",
    phaseId: "cad",
    phaseName: "CAD evidence",
    phaseDescription: "Compile and export the reviewed semantic CM-01 CAD assembly.",
    workItemId: "build-cm01-cad",
    dependsOnWorkItemIds: ["author-cm01-architecture"],
    operation: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cad,
  });
  project = await queueAndExecute({
    project,
    commands,
    workItemId: "build-cm01-cad",
    runId: "run:local-cm01-v3-cad",
    summary: "Export the reviewed CM-01 semantic CAD assembly.",
    basis: threadBasis(project),
    execute: (queued) =>
      new CoffeeMachineCm01V3CadRunExecutor({
        projects,
        commands,
        snapshots,
        recipe,
        build123d,
        attempts: new FileCm01SemanticCadAttemptStore(
          state.cadAttempts,
        ),
        captures: new FileCaptureStore({
          ...CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR,
          directory: state.cadCaptures,
        }),
        lease,
        liveUpdates,
        now,
      }).execute(AGENT, queued),
  });

  project = await appendSingleOperation({
    project,
    commands,
    changeId: "local-cm01-v3-add-thermal",
    phaseId: "thermal",
    phaseName: "Thermal evidence",
    phaseDescription: "Run the closed nominal CM-01 OpenModelica heat-up scenario.",
    workItemId: "simulate-cm01-thermal",
    dependsOnWorkItemIds: ["author-cm01-architecture"],
    operation: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.thermal,
  });
  project = await queueAndExecute({
    project,
    commands,
    workItemId: "simulate-cm01-thermal",
    runId: "run:local-cm01-v3-thermal",
    summary: "Run the reviewed CM-01 nominal thermal scenario.",
    basis: threadBasis(project),
    execute: (queued) =>
      new CoffeeMachineCm01V3ThermalRunExecutor({
        projects,
        commands,
        snapshots,
        capture: new Cm01NominalModelicaCaptureAdapter({ modelica }),
        attempts: new FileCm01NominalModelicaAttemptStore(
          state.thermalAttempts,
        ),
        captures: new FileCaptureStore({
          ...CM01_NOMINAL_MODELICA_CAPTURE_DESCRIPTOR,
          directory: state.thermalCaptures,
        }),
        lease,
        liveUpdates,
        now,
      }).execute(AGENT, queued),
  });

  project = await appendSingleOperation({
    project,
    commands,
    changeId: "local-cm01-v3-add-bom",
    phaseId: "supply",
    phaseName: "Supply evidence",
    phaseDescription: "Observe the reviewed external CM-01 ERPNext BOM.",
    workItemId: "observe-cm01-bom",
    dependsOnWorkItemIds: ["build-cm01-cad"],
    operation: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.bom,
  });
  project = await queueAndExecute({
    project,
    commands,
    workItemId: "observe-cm01-bom",
    runId: "run:local-cm01-v3-erp-bom",
    summary: "Observe the reviewed external CM-01 ERPNext BOM.",
    basis: threadBasis(project),
    execute: (queued) =>
      new CoffeeMachineCm01V3ErpNextBomRunExecutor({
        projects,
        commands,
        snapshots,
        capture: new Cm01ErpNextBomCaptureAdapter({ erpnext }),
        captures: new FileCaptureStore({
          ...CM01_ERPNEXT_BOM_CAPTURE_DESCRIPTOR,
          directory: state.erpBomCaptures,
        }),
        runCaptures: new FileCm01ErpNextBomRunCaptureStore(
          state.erpBomRunCaptures,
        ),
        lease,
        liveUpdates,
        now,
      }).execute(AGENT, queued),
  });

  project = await appendSingleOperation({
    project,
    commands,
    changeId: "local-cm01-v3-add-mechanical",
    phaseId: "verification",
    phaseName: "Mechanical proof",
    phaseDescription: "Run the bounded isolated DripTray static proof.",
    workItemId: "verify-cm01-drip-tray",
    dependsOnWorkItemIds: ["build-cm01-cad"],
    operation: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanical,
  });
  project = await queueAndExecute({
    project,
    commands,
    workItemId: "verify-cm01-drip-tray",
    runId: "run:local-cm01-v3-mechanical",
    summary: "Verify the reviewed isolated CM-01 V3 DripTray proof case.",
    basis: threadBasis(project),
    execute: (queued) =>
      new CoffeeMachineCm01V3MechanicalRunExecutor({
        projects,
        commands,
        snapshots,
        proof: mechanicalProof,
        syson,
        build123d,
        calculix,
        attempts: new FileCm01DripTrayMechanicalAttemptStore(
          state.mechanicalAttempts,
        ),
        captures: new FileCaptureStore({
          ...CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
          directory: state.mechanicalCaptures,
        }),
        requirementsCaptures: new FileCaptureStore({
          ...ORACLE_REQUIREMENTS_SEED_CAPTURE_DESCRIPTOR,
          directory: state.oracleRequirementsSeedCaptures,
        }),
        lease,
        liveUpdates,
        now,
      }).execute(AGENT, queued),
  });

  project = await appendSingleOperation({
    project,
    commands,
    changeId: "local-cm01-v3-add-sensitivity",
    phaseId: "sensitivity",
    phaseName: "Sensitivity study",
    phaseDescription:
      "Measure the DripTray size-z finite-difference sensitivities; data, not a verdict.",
    workItemId: "analyze-cm01-drip-tray-size-z-sensitivity",
    dependsOnWorkItemIds: ["verify-cm01-drip-tray"],
    operation: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityDripTrayBaseZ,
  });
  project = await queueAndExecute({
    project,
    commands,
    workItemId: "analyze-cm01-drip-tray-size-z-sensitivity",
    runId: "run:local-cm01-v3-sensitivity",
    summary:
      "Record the reviewed CM-01 V3 DripTray size-z first-order finite-difference sensitivity study.",
    basis: threadBasis(project),
    execute: (queued) =>
      new CoffeeMachineCm01V3SensitivityRunExecutor({
        projects,
        commands,
        snapshots,
        sensitivityCase,
        build123d,
        calculix,
        attempts: new FileSensitivityRunAttemptStore(
          state.sensitivityAttempts,
        ),
        captures: new FileCaptureStore({
          ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
          directory: state.sensitivityCaptures,
        }),
        lease,
        liveUpdates,
        now,
      }).execute(AGENT, queued),
  });

  const finalSnapshotRef = threadBasis(project);
  const finalSnapshot = await snapshots.get(finalSnapshotRef.snapshotId);
  if (!finalSnapshot) {
    throw new Error("The final CM-01 V3 ThreadSnapshot was not persisted.");
  }
  const observation = projectCoffeeMachineCm01V3GoldenObservation({
    project,
    finalSnapshot,
  });
  const observationPath = `${outputDirectory}/golden-observation.json`;
  await Deno.writeTextFile(
    observationPath,
    `${JSON.stringify(observation, null, 2)}\n`,
  );
  const comparison = compareCoffeeMachineCm01V3GoldenReference(
    validateCoffeeMachineCm01V3GoldenReference(
      await readJson("config/golden-references/coffee-machine-cm01-v3.json"),
    ),
    observation,
  );
  const result: CoffeeMachineCm01V3LocalRunResult = {
    status: "completed",
    outputDirectory,
    observationPath,
    stateScope,
    project: {
      id: project.project.id,
      subjectId: project.project.subjectId,
      revision: project.revision,
      finalSnapshot: finalSnapshotRef,
    },
    comparison,
    note:
      `Technical local integration evidence only (${stateScope} state scope). The explicit fixture approval is not a production human-review record, and a matching comparison is not certification or manufacturing release.`,
  };
  await Deno.writeTextFile(
    `${outputDirectory}/run-summary.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}

async function queueAndExecute(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly commands: EngineeringProjectCommandService;
  readonly workItemId: string;
  readonly runId: string;
  readonly summary: string;
  readonly basis: EngineeringBasisRef;
  readonly execute: (command: {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly issuedAt: string;
    readonly runId: string;
  }) => Promise<EngineeringProjectSnapshot>;
}): Promise<EngineeringProjectSnapshot> {
  const queued = await input.commands.queueRun(AGENT, {
    ...commandContext(input.project, `local-cm01-v3-queue-${input.workItemId}`),
    runId: input.runId,
    workItemId: input.workItemId,
    summary: input.summary,
    basis: input.basis,
  });
  return await input.execute({
    ...commandContext(queued, `local-cm01-v3-execute-${input.workItemId}`),
    runId: input.runId,
  });
}

async function appendSingleOperation(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly commands: EngineeringProjectCommandService;
  readonly changeId: string;
  readonly phaseId: string;
  readonly phaseName: string;
  readonly phaseDescription: string;
  readonly workItemId: string;
  readonly dependsOnWorkItemIds: readonly string[];
  readonly operation: { readonly id: string; readonly version: "1" };
}): Promise<EngineeringProjectSnapshot> {
  return await appendOperation({
    project: input.project,
    commands: input.commands,
    changeId: input.changeId,
    phase: {
      id: input.phaseId,
      name: input.phaseName,
      description: input.phaseDescription,
    },
    workItems: [{
      id: input.workItemId,
      dependsOnWorkItemIds: input.dependsOnWorkItemIds,
      operation: approvedBriefOperation(input.operation.id, input.operation.version),
    }],
  });
}

async function appendOperation(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly commands: EngineeringProjectCommandService;
  readonly changeId: string;
  readonly phase: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  };
  readonly workItems: readonly {
    readonly id: string;
    readonly dependsOnWorkItemIds: readonly string[];
    readonly operation: {
      readonly id: string;
      readonly version: string;
      readonly bindings: readonly {
        readonly name: string;
        readonly source: { readonly kind: "approved-brief" };
      }[];
    };
  }[];
}): Promise<EngineeringProjectSnapshot> {
  return await input.commands.appendChange(AGENT, {
    ...commandContext(input.project, input.changeId),
    baseSnapshot: threadBasis(input.project),
    phases: [input.phase],
    workItems: input.workItems.map((item) => ({
      id: item.id,
      phaseId: input.phase.id,
      owner: "agent" as const,
      dependsOnWorkItemIds: item.dependsOnWorkItemIds,
      decisionIds: [],
      operation: item.operation,
    })),
    requiredDecisions: [],
  });
}

function approvedBriefOperation(id: string, version: "1") {
  return {
    id,
    version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
}

function commandContext(
  project: EngineeringProjectSnapshot,
  commandId: string,
) {
  return {
    commandId,
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: now(),
  };
}

function threadBasis(project: EngineeringProjectSnapshot): {
  readonly kind: "thread-snapshot";
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
} {
  const current = project.threadSnapshots.at(-1);
  if (!current || current.subjectId !== SUBJECT_ID) {
    throw new Error("The CM-01 V3 project has no current exact ThreadSnapshot basis.");
  }
  return { kind: "thread-snapshot", ...current };
}

function localMcpUrl(
  manifest: Awaited<ReturnType<typeof loadFleetManifest>>,
  id: string,
): string {
  const url = manifest.servers.find((server) => server.id === id)?.mcpUrl;
  if (!url) throw new Error(`The local fleet has no ${id} MCP endpoint.`);
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !isLoopbackHost(parsed.hostname)) {
    throw new Error(`Refusing non-loopback ${id} MCP endpoint in the local harness.`);
  }
  return parsed.toString();
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function confirmationRequired(): CoffeeMachineCm01V3LocalConfirmationRequired {
  return {
    status: "confirmation-required",
    acknowledgement: CM01_V3_LOCAL_EXECUTION_ACKNOWLEDGEMENT,
    operations: [
      "baseline.from-approved-brief@1",
      "architecture.seed-syson-model@2",
      "architecture.author-coffee-machine-cm01@1",
      "design.build-coffee-machine-cm01-cad@1",
      "simulate.coffee-machine-cm01-thermal-nominal@1",
      "industrialize.observe-coffee-machine-cm01-bom@1",
      "verify.coffee-machine-cm01-drip-tray-mechanical@1",
      "analyze.coffee-machine-cm01-drip-tray-size-z-sensitivity@1",
    ],
    note:
      "No state directory, MCP client, provider call, or simulated human approval is created until --execute and the exact acknowledgement are both present.",
  };
}

function defaultOutputDirectory(): string {
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  return `state/local/cm01-v3-local-runs/${suffix}`;
}

/**
 * Returns every mutable store used by the runner. The canonical mapping is
 * intentionally literal: it must stay aligned with the defaults in server.ts
 * so a persistent V3 project is visible to the existing Cockpit projection.
 */
export function coffeeMachineCm01V3StateDirectories(input: {
  readonly outputDirectory: string;
  readonly stateScope: "isolated" | "canonical";
}): CoffeeMachineCm01V3StateDirectories {
  if (input.stateScope === "isolated") {
    return {
      projects: `${input.outputDirectory}/projects`,
      snapshots: `${input.outputDirectory}/thread-snapshots`,
      baselineCaptures: `${input.outputDirectory}/approved-brief-captures`,
      sysonSeedCaptures: `${input.outputDirectory}/syson-seed-captures`,
      sysonSeedAttempts: `${input.outputDirectory}/syson-seed-attempts`,
      architectureCaptures: `${input.outputDirectory}/architecture-captures`,
      architectureAttempts: `${input.outputDirectory}/architecture-attempts`,
      cadCaptures: `${input.outputDirectory}/cad-captures`,
      cadAttempts: `${input.outputDirectory}/cad-attempts`,
      thermalCaptures: `${input.outputDirectory}/thermal-captures`,
      thermalAttempts: `${input.outputDirectory}/thermal-attempts`,
      erpBomCaptures: `${input.outputDirectory}/erp-bom-captures`,
      erpBomRunCaptures: `${input.outputDirectory}/erp-bom-run-captures`,
      oracleRequirementsSeedCaptures:
        `${input.outputDirectory}/oracle-requirements-seed-captures`,
      mechanicalCaptures: `${input.outputDirectory}/mechanical-captures`,
      mechanicalAttempts: `${input.outputDirectory}/mechanical-attempts`,
      sensitivityCaptures: `${input.outputDirectory}/sensitivity-captures`,
      sensitivityAttempts: `${input.outputDirectory}/sensitivity-attempts`,
      liveUpdates: `${input.outputDirectory}/live-updates`,
      leases: `${input.outputDirectory}/leases`,
    };
  }
  const root = "state/local";
  return {
    projects: `${root}/engineering-projects`,
    snapshots: `${root}/thread-snapshots`,
    baselineCaptures: `${root}/approved-brief-captures`,
    sysonSeedCaptures: `${root}/syson-model-seed-captures`,
    sysonSeedAttempts: `${root}/syson-model-seed-attempts`,
    architectureCaptures: `${root}/coffee-machine-cm01-v3-architecture-captures`,
    architectureAttempts: `${root}/coffee-machine-cm01-v3-architecture-attempts`,
    cadCaptures: `${root}/cm01-semantic-cad-captures`,
    cadAttempts: `${root}/cm01-semantic-cad-attempts`,
    thermalCaptures: `${root}/cm01-nominal-modelica-captures`,
    thermalAttempts: `${root}/cm01-nominal-modelica-attempts`,
    erpBomCaptures: `${root}/cm01-erpnext-bom-captures`,
    erpBomRunCaptures: `${root}/cm01-erpnext-bom-run-captures`,
    oracleRequirementsSeedCaptures: `${root}/oracle-requirements-seed-captures`,
    mechanicalCaptures: `${root}/cm01-drip-tray-mechanical-captures`,
    mechanicalAttempts: `${root}/cm01-drip-tray-mechanical-attempts`,
    sensitivityCaptures: `${root}/sensitivity-study-captures`,
    sensitivityAttempts: `${root}/sensitivity-run-attempts`,
    liveUpdates: `${root}/live-thread-updates`,
    leases: `${root}/engineering-project-run-leases`,
  };
}

function requireNewOutputDirectory(value: string): string {
  if (value.trim() === "") throw new Error("outputDirectory must not be empty.");
  return value.replace(/\/$/, "");
}

async function createNewDirectory(directory: string): Promise<void> {
  try {
    await Deno.stat(directory);
    throw new Error(
      `Refusing to reuse existing local CM-01 V3 output directory ${directory}.`,
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(directory, { recursive: true });
}

async function requireProjectAbsent(
  projectsDirectory: string,
  projectId: string,
): Promise<void> {
  try {
    await Deno.stat(`${projectsDirectory}/${projectId}`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error(
    `Refusing canonical CM-01 V3 execution because ${projectId} already exists in ${projectsDirectory}.`,
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(path));
}

function now(): string {
  return new Date().toISOString();
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const result = await runCoffeeMachineCm01V3Local({
    execute: Deno.args.includes("--execute"),
    acknowledgement: args["acknowledge"],
    outputDirectory: args["output"],
    manifestPath: args["manifest"],
    stateScope: Deno.args.includes("--canonical") ? "canonical" : "isolated",
    canonicalAcknowledgement: args["canonical-acknowledge"],
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "completed" && !result.comparison.matches) {
    Deno.exitCode = 1;
  }
}
