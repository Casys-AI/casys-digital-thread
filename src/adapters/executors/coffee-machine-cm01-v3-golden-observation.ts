import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../domain/engineering-project.ts";
import {
  type CoffeeMachineCm01V3GoldenObservation,
  validateCoffeeMachineCm01V3GoldenObservation,
} from "../../domain/coffee-machine-cm01-v3-golden-reference.ts";
import type {
  ThreadArtifact,
  ThreadObservation,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  coffeeMachineCm01V3ArchitectureGoldenArtifact,
} from "./coffee-machine-cm01-v3-architecture-run-executor.ts";
import {
  coffeeMachineCm01V3ErpNextBomGoldenArtifact,
} from "./coffee-machine-cm01-v3-erpnext-bom-run-executor.ts";
import {
  coffeeMachineCm01V3MechanicalGoldenProjection,
} from "./coffee-machine-cm01-v3-mechanical-run-executor.ts";

/** The only project/subject accepted by the CM-01 V3 reference gate. */
export const COFFEE_MACHINE_CM01_V3_GOLDEN_PROJECT_ID =
  "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_GOLDEN_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;

/**
 * Minimal, caller-owned input to the final CM-01 V3 comparison gate.
 *
 * The ThreadSnapshot is deliberately passed explicitly.  The projector never
 * resolves a `latest` alias, reads a provider, follows historical CM-01
 * records, or accepts raw MCP payloads.
 */
export interface CoffeeMachineCm01V3GoldenObservationInput {
  readonly project: EngineeringProjectSnapshot;
  readonly finalSnapshot: ThreadSnapshot;
}

interface CompletedBranch {
  readonly label: string;
  readonly operation: { readonly id: string; readonly version: string };
  readonly run: EngineeringAgentRun;
  readonly workItem: EngineeringWorkItem;
  /**
   * Exact result-snapshot artifacts named by the completed run.  Their
   * producer run identities are the structural branch boundary: provider
   * clocks are not synchronized with the control-plane clock.
   */
  readonly evidenceArtifactIds: readonly string[];
  readonly producerRunIds: readonly string[];
}

const CM01_MODELICA = Object.freeze({
  modelSha256: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
  scenarioSha256: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
  scenarioName: "Modelica scenario heat-up-nominal",
  modelName: "Modelica model",
  resultName: "Simulation result",
  evidenceName: "Computed evidence",
  metrics: [
    "heater_energy",
    "heater_power_peak",
    "time_to_target_temperature",
    "water_temperature_max",
  ] as const,
});

/**
 * Project an actual, final V3 project/thread pair into the tiny golden
 * comparison contract.  Every expected branch must be uniquely present in
 * the supplied final snapshot and structurally belong to its one completed V3
 * operation. Provider timestamps remain audited freshness metadata, not a
 * cross-system join key. Missing, duplicate, stale, or differently-bound evidence is an
 * error rather than a best-effort projection.
 */
export function projectCoffeeMachineCm01V3GoldenObservation(
  input: CoffeeMachineCm01V3GoldenObservationInput,
): CoffeeMachineCm01V3GoldenObservation {
  // `ThreadSnapshot` is already a validated, canonical storage contract at
  // every executor boundary.  This projector intentionally accepts that typed
  // value only; it has no `unknown`/provider-payload parsing surface.
  const snapshot = input.finalSnapshot;
  const project = input.project;
  assertCanonicalProject(project, snapshot);

  const branches = {
    architecture: completedBranch(
      project,
      snapshot,
      "architecture",
      COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
    ),
    cad: completedBranch(
      project,
      snapshot,
      "CAD",
      COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cad,
    ),
    thermal: completedBranch(
      project,
      snapshot,
      "thermal",
      COFFEE_MACHINE_CM01_V3_OPERATION_REFS.thermal,
    ),
    bom: completedBranch(
      project,
      snapshot,
      "ERP BOM",
      COFFEE_MACHINE_CM01_V3_OPERATION_REFS.bom,
    ),
    mechanical: completedBranch(
      project,
      snapshot,
      "mechanical",
      COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanical,
    ),
  } as const;

  const architecture = architectureArtifact(snapshot, branches.architecture);
  const cad = cadArtifacts(snapshot, branches.cad, architecture);
  const modelica = modelicaEvidence(snapshot, branches.thermal);
  const erp = erpBomEvidence(snapshot, branches.bom);
  const mechanical = mechanicalEvidence(snapshot, branches.mechanical);

  assertBranchEvidenceAppearsInFinalSnapshot(snapshot, branches.architecture);
  assertBranchEvidenceAppearsInFinalSnapshot(snapshot, branches.cad);
  assertBranchEvidenceAppearsInFinalSnapshot(snapshot, branches.thermal);
  assertBranchEvidenceAppearsInFinalSnapshot(snapshot, branches.bom);
  assertBranchEvidenceAppearsInFinalSnapshot(snapshot, branches.mechanical);

  return validateCoffeeMachineCm01V3GoldenObservation({
    project: {
      projectId: project.project.id,
      subjectId: project.project.subjectId,
    },
    artifacts: [
      architecture,
      ...cad,
      modelica.artifact,
      erp.artifact,
      mechanical.artifact,
    ],
    measurements: [
      ...modelica.measurements,
      erp.measurement,
      ...mechanical.measurements,
    ],
    mechanical: mechanical.projection,
  });
}

function assertCanonicalProject(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
): void {
  if (
    project.schemaVersion !== "3.0" ||
    !project.id.startsWith(`${COFFEE_MACHINE_CM01_V3_GOLDEN_PROJECT_ID}:project:r`) ||
    project.project.id !== COFFEE_MACHINE_CM01_V3_GOLDEN_PROJECT_ID ||
    project.project.subjectId !== COFFEE_MACHINE_CM01_V3_GOLDEN_SUBJECT_ID ||
    snapshot.subject.id !== COFFEE_MACHINE_CM01_V3_GOLDEN_SUBJECT_ID
  ) {
    throw new Error(
      "CM-01 golden observation requires the canonical V3 project and subject.",
    );
  }
  const matching = project.threadSnapshots.filter((reference) =>
    sameSnapshot(reference, snapshot)
  );
  if (matching.length !== 1) {
    throw new Error(
      "The supplied final ThreadSnapshot is not uniquely declared by the V3 project.",
    );
  }
  const headRevision = Math.max(
    ...project.threadSnapshots.map((item) => item.revision),
  );
  if (snapshot.revision !== headRevision) {
    throw new Error(
      "The supplied ThreadSnapshot is not the declared final V3 project head.",
    );
  }
  if (!Number.isFinite(Date.parse(snapshot.generatedAt))) {
    throw new Error("The final ThreadSnapshot has an invalid generatedAt timestamp.");
  }
}

function completedBranch(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
  label: string,
  operation: { readonly id: string; readonly version: string },
): CompletedBranch {
  const workItems = project.workItems.filter((item) =>
    item.operation?.id === operation.id && item.operation.version === operation.version
  );
  if (workItems.length !== 1) {
    throw new Error(
      `CM-01 ${label} branch must have exactly one ${operation.id}@${operation.version} work item.`,
    );
  }
  const workItem = workItems[0]!;
  const runs = project.agentRuns.filter((run) => run.workItemId === workItem.id);
  if (runs.length !== 1 || runs[0]!.status !== "completed") {
    throw new Error(`CM-01 ${label} branch must have exactly one completed run.`);
  }
  const run = runs[0]!;
  const basis = run.basis;
  if (
    !run.startedAt || !run.completedAt || !run.resultSnapshot ||
    run.evidenceRefs.length === 0 || basis?.kind !== "thread-snapshot"
  ) {
    throw new Error(
      `CM-01 ${label} completed run lacks its exact timing, result, or evidence references.`,
    );
  }
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error(`CM-01 ${label} run has invalid temporal evidence.`);
  }
  if (
    basis.subjectId !== project.project.subjectId ||
    run.resultSnapshot.subjectId !== project.project.subjectId ||
    run.resultSnapshot.revision <= basis.revision ||
    !project.threadSnapshots.some((reference) =>
      sameSnapshotReference(reference, {
        snapshotId: basis.snapshotId,
        revision: basis.revision,
        subjectId: basis.subjectId,
      })
    ) ||
    !project.threadSnapshots.some((reference) =>
      sameSnapshotReference(reference, run.resultSnapshot!)
    )
  ) {
    throw new Error(
      `CM-01 ${label} run result is not an exact snapshot declared by the V3 project.`,
    );
  }
  const artifactReferences = run.evidenceRefs.filter((reference) =>
    reference.kind === "artifact"
  );
  if (artifactReferences.length === 0) {
    throw new Error(`CM-01 ${label} completed run has no artifact evidence.`);
  }
  if (
    run.evidenceRefs.some((reference) =>
      reference.snapshotId !== run.resultSnapshot!.snapshotId ||
      reference.snapshotRevision !== run.resultSnapshot!.revision
    )
  ) {
    throw new Error(
      `CM-01 ${label} completion evidence is not bound to its exact result snapshot.`,
    );
  }
  const evidenceArtifacts = artifactReferences.map((reference) =>
    exactlyOne(
      snapshot.artifacts.filter((artifact) => artifact.id === reference.id),
      `CM-01 ${label} completion evidence artifact ${reference.id}`,
    )
  );
  const producerRunIds = [
    ...new Set(evidenceArtifacts.map((artifact) => artifact.producer.runId)),
  ];
  if (producerRunIds.length === 0) {
    throw new Error(`CM-01 ${label} completion evidence has no producer run ID.`);
  }
  return {
    label,
    operation,
    run,
    workItem,
    evidenceArtifactIds: artifactReferences.map((reference) => reference.id),
    producerRunIds,
  };
}

function architectureArtifact(
  snapshot: ThreadSnapshot,
  branch: CompletedBranch,
) {
  const artifact = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.id.startsWith("coffee-machine-cm01-v3-architecture-") &&
      candidate.kind === "sysml-model" &&
      sameProducer(candidate, "syson", "syson_element_insert_sysml") &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 architecture-model artifact",
  );
  // Keep the role projection owned by the architecture executor; this wrapper
  // adds the uniqueness and temporal checks which a generic find() cannot.
  const projected = coffeeMachineCm01V3ArchitectureGoldenArtifact(snapshot);
  if (
    projected.kind !== artifact.kind ||
    !sameProducer(artifact, projected.producer.serverId, projected.producer.tool)
  ) {
    throw new Error(
      "CM-01 V3 architecture role projection disagrees with final evidence.",
    );
  }
  return projected;
}

function cadArtifacts(
  snapshot: ThreadSnapshot,
  branch: CompletedBranch,
  architecture: { readonly role: string },
) {
  if (architecture.role !== "architecture-model") {
    throw new Error("CM-01 CAD branch has no canonical architecture basis.");
  }
  const architectureArtifact = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.id.startsWith("coffee-machine-cm01-v3-architecture-") &&
      candidate.kind === "sysml-model" &&
      sameProducer(candidate, "syson", "syson_element_insert_sysml")
    ),
    "CM-01 V3 architecture basis",
  );
  const prefix = "coffee-machine-cm01-v3-cad-";
  const compiler = [
    "digital-thread",
    "compile_coffee_machine_cm01_semantic_cad_plan",
  ] as const;
  const plan = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.id.startsWith(prefix) && candidate.name === "CM-01 semantic CAD plan" &&
      candidate.kind === "document" && sameProducer(candidate, ...compiler) &&
      exactIds(candidate.inputArtifactIds, [architectureArtifact.id]) &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 CAD plan artifact",
  );
  const script = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.id.startsWith(prefix) &&
      candidate.name === "CM-01 deterministic build123d script" &&
      candidate.kind === "script" && sameProducer(candidate, ...compiler) &&
      exactIds(candidate.inputArtifactIds, [plan.id]) &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 CAD script artifact",
  );
  const step = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.id.startsWith(prefix) && candidate.name === "CM-01 STEP export" &&
      candidate.kind === "step" &&
      sameProducer(candidate, "build123d", "build123d_export") &&
      exactIds(candidate.inputArtifactIds, [script.id]) &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 CAD STEP artifact",
  );
  assertVerifiedConsumption(
    snapshot,
    architectureArtifact,
    "digital-thread",
    compiler[1],
  );
  assertVerifiedConsumption(snapshot, plan, "digital-thread", compiler[1]);
  assertVerifiedConsumption(snapshot, script, "build123d", "build123d_export");
  return [
    { role: "cad-plan" as const, kind: plan.kind, producer: producer(plan) },
    { role: "cad-script" as const, kind: script.kind, producer: producer(script) },
    { role: "cad-step" as const, kind: step.kind, producer: producer(step) },
  ];
}

function modelicaEvidence(snapshot: ThreadSnapshot, branch: CompletedBranch) {
  const result = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.kind === "solver-result" &&
      candidate.name === CM01_MODELICA.resultName &&
      sameProducer(candidate, "modelica", "modelica_simulate") &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 Modelica result artifact",
  );
  const runId = result.producer.runId;
  const model = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.kind === "simulation-model" &&
      candidate.name === CM01_MODELICA.modelName &&
      sameProducer(candidate, "modelica", "modelica_simulate", runId) &&
      candidate.fingerprint.digest === CM01_MODELICA.modelSha256 &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 Modelica model artifact",
  );
  const scenario = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.kind === "evidence" && candidate.name === CM01_MODELICA.scenarioName &&
      sameProducer(candidate, "modelica", "modelica_run_get", runId) &&
      candidate.fingerprint.digest === CM01_MODELICA.scenarioSha256 &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 Modelica scenario artifact",
  );
  const evidence = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.kind === "evidence" && candidate.name === CM01_MODELICA.evidenceName &&
      sameProducer(candidate, "modelica", "modelica_simulate", runId) &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 Modelica computed-evidence artifact",
  );
  if (!exactIds(result.inputArtifactIds, [model.id, scenario.id])) {
    throw new Error(
      "CM-01 V3 Modelica result does not attest its reviewed model and scenario inputs.",
    );
  }
  assertVerifiedConsumption(snapshot, model, "modelica", "modelica_simulate", runId);
  assertVerifiedConsumption(snapshot, scenario, "modelica", "modelica_simulate", runId);
  const measurements = CM01_MODELICA.metrics.map((metric) =>
    observation(
      snapshot,
      metric,
      branch,
      { serverId: "modelica", tool: "modelica_simulate", runId },
      evidence.id,
    )
  ).map((item) => ({
    metric: item.metric,
    value: item.quantity.value,
    unit: item.quantity.unit,
  }));
  return {
    artifact: {
      role: "modelica-result" as const,
      kind: result.kind,
      producer: producer(result),
    },
    measurements,
  };
}

function erpBomEvidence(snapshot: ThreadSnapshot, branch: CompletedBranch) {
  const bom = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.kind === "bom" && candidate.name === "ERPNext BOM BOM-CASYS-CM01-001" &&
      sameProducer(candidate, "erpnext", "erpnext_bom_get") &&
      candidate.inputArtifactIds.length === 0 && belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 ERPNext BOM artifact",
  );
  const projected = coffeeMachineCm01V3ErpNextBomGoldenArtifact(snapshot);
  if (
    projected.kind !== bom.kind ||
    !sameProducer(bom, projected.producer.serverId, projected.producer.tool)
  ) {
    throw new Error("CM-01 V3 ERPNext role projection disagrees with final evidence.");
  }
  const measurement = observation(
    snapshot,
    "bom_quantity_per_finished_good",
    branch,
    bom.producer,
    bom.id,
  );
  return {
    artifact: projected,
    measurement: {
      metric: measurement.metric,
      value: measurement.quantity.value,
      unit: measurement.quantity.unit,
    },
  };
}

function mechanicalEvidence(snapshot: ThreadSnapshot, branch: CompletedBranch) {
  const proof = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.name === "CM-01 V3 reviewed DripTray proof case" &&
      candidate.kind === "document" &&
      sameProducer(candidate, "digital-thread", "evaluate_cm01_drip_tray_limits") &&
      candidate.inputArtifactIds.length === 0 && belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 mechanical proof artifact",
  );
  const step = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.name === "CM-01 V3 isolated DripTray STEP" &&
      candidate.kind === "step" &&
      sameProducer(candidate, "build123d", "build123d_export") &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 mechanical STEP artifact",
  );
  if (step.inputArtifactIds.length !== 0) {
    throw new Error(
      "CM-01 V3 mechanical STEP must not claim an unobserved build123d input.",
    );
  }
  const solve = exactlyOne(
    snapshot.artifacts.filter((candidate) =>
      candidate.name === "CM-01 V3 CalculiX static result" &&
      candidate.kind === "solver-result" &&
      sameProducer(candidate, "calculix", "calculix_solve_static") &&
      exactIds(candidate.inputArtifactIds, [step.id]) &&
      belongsToBranch(candidate, branch)
    ),
    "CM-01 V3 mechanical solver result",
  );
  const consumption = exactlyOne(
    snapshot.consumptions.filter((candidate) =>
      candidate.artifactId === step.id &&
      candidate.consumer.serverId === "calculix" &&
      candidate.consumer.tool === "calculix_solve_static" &&
      candidate.observedFingerprint.digest === step.fingerprint.digest &&
      candidate.status === "verified"
    ),
    "CM-01 V3 CalculiX STEP consumption",
  );
  if (!belongsToBranchOperation(consumption.consumer.runId, branch)) {
    throw new Error(
      "CM-01 V3 CalculiX consumption does not belong to its completed mechanical branch.",
    );
  }
  const metrics = ["assembly_max_displacement", "assembly_max_von_mises"] as const;
  for (const metric of metrics) {
    exactlyOne(
      snapshot.requirements.filter((candidate) =>
        candidate.criterion.metric === metric &&
        candidate.id.includes("drip-tray") &&
        candidate.trace.sourceArtifactId === proof.id &&
        exactIds(candidate.trace.targetArtifactIds, [step.id]) &&
        isFresh(candidate.freshness.status, candidate.freshness.changedAt)
      ),
      `CM-01 V3 ${metric} requirement traced from the reviewed proof to the STEP`,
    );
  }
  const readings = metrics.map((metric) =>
    observation(
      snapshot,
      metric,
      branch,
      solve.producer,
      solve.id,
    )
  );
  const evaluations = metrics.map((metric) =>
    evaluation(snapshot, metric, branch, solve.id)
  );
  // Preserve the executor's semantic role projection while the explicit
  // selection above prevents an arbitrary similarly named branch from winning.
  const projected = coffeeMachineCm01V3MechanicalGoldenProjection(snapshot);
  if (
    projected.step.sha256 !== step.fingerprint.digest ||
    projected.consumption.status !== consumption.status ||
    projected.evaluations.length !== metrics.length
  ) {
    throw new Error(
      "CM-01 V3 mechanical role projection disagrees with final evidence.",
    );
  }
  return {
    artifact: {
      role: "mechanical-step" as const,
      kind: step.kind,
      producer: producer(step),
    },
    measurements: readings.map((item) => ({
      metric: item.metric,
      value: item.quantity.value,
      unit: item.quantity.unit,
    })),
    projection: {
      proof: {
        artifactRole: "mechanical-proof" as const,
        sha256: proof.fingerprint.digest,
      },
      step: {
        artifactRole: "mechanical-step" as const,
        sha256: step.fingerprint.digest,
      },
      consumption: {
        artifactRole: "mechanical-step" as const,
        consumer: { serverId: "calculix", tool: "calculix_solve_static" },
        status: consumption.status,
        observedSha256: consumption.observedFingerprint.digest,
      },
      evaluations: evaluations.map((item) => ({
        metric: item.metric,
        status: item.status,
      })),
    },
  };
}

function observation(
  snapshot: ThreadSnapshot,
  metric: string,
  branch: CompletedBranch,
  operation: {
    readonly serverId: string;
    readonly tool: string;
    readonly runId: string;
  },
  artifactId: string,
): ThreadObservation {
  return exactlyOne(
    snapshot.observations.filter((candidate) =>
      candidate.metric === metric &&
      candidate.source.operation.serverId === operation.serverId &&
      candidate.source.operation.tool === operation.tool &&
      candidate.source.operation.runId === operation.runId &&
      exactIds(candidate.source.artifactIds, [artifactId]) &&
      belongsToBranchOperation(candidate.source.operation.runId, branch) &&
      isFresh(candidate.freshness.status, candidate.freshness.changedAt) &&
      isValidTimestamp(candidate.source.capturedAt)
    ),
    `CM-01 V3 ${metric} observation`,
  );
}

function evaluation(
  snapshot: ThreadSnapshot,
  metric: string,
  branch: CompletedBranch,
  evidenceArtifactId: string,
): { readonly metric: string; readonly status: "pass" } {
  const requirement = exactlyOne(
    snapshot.requirements.filter((candidate) =>
      candidate.criterion.metric === metric && candidate.id.includes("drip-tray") &&
      isFresh(candidate.freshness.status, candidate.freshness.changedAt)
    ),
    `CM-01 V3 ${metric} requirement`,
  );
  const result = exactlyOne(
    snapshot.evaluations.filter((candidate) =>
      candidate.requirementId === requirement.id && candidate.status === "pass" &&
      candidate.evidenceArtifactIds.includes(evidenceArtifactId) &&
      belongsToBranchOperation(candidate.evaluator.runId, branch) &&
      isFresh(candidate.freshness.status, candidate.freshness.changedAt) &&
      isValidTimestamp(candidate.evaluatedAt)
    ),
    `CM-01 V3 ${metric} passing evaluation`,
  );
  if (result.status !== "pass") throw new Error(`CM-01 V3 ${metric} is not passing.`);
  return { metric, status: "pass" };
}

function assertBranchEvidenceAppearsInFinalSnapshot(
  snapshot: ThreadSnapshot,
  branch: CompletedBranch,
): void {
  if (
    branch.evidenceArtifactIds.length === 0 ||
    !branch.evidenceArtifactIds.every((id) =>
      snapshot.artifacts.some((artifact) => artifact.id === id)
    )
  ) {
    throw new Error(
      `CM-01 ${branch.label} completion evidence is absent from the supplied final ThreadSnapshot.`,
    );
  }
}

function assertVerifiedConsumption(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  serverId: string,
  tool: string,
  runId?: string,
): void {
  const matches = snapshot.consumptions.filter((candidate) =>
    candidate.artifactId === artifact.id && candidate.status === "verified" &&
    candidate.observedFingerprint.digest === artifact.fingerprint.digest &&
    candidate.consumer.serverId === serverId && candidate.consumer.tool === tool &&
    (runId === undefined || candidate.consumer.runId === runId)
  );
  if (matches.length !== 1) {
    throw new Error(
      `CM-01 artifact ${artifact.id} lacks one verified ${serverId}/${tool} consumption.`,
    );
  }
}

function belongsToBranch(artifact: ThreadArtifact, branch: CompletedBranch): boolean {
  // A provider can finalize its capture immediately after the control plane
  // records the agent-run completion. The exact evidence ref anchors the
  // provider run ID, so wall-clock containment would reject genuine evidence.
  return isFresh(artifact.freshness.status, artifact.freshness.changedAt) &&
    belongsToBranchOperation(artifact.producer.runId, branch);
}

function belongsToBranchOperation(
  producerRunId: string,
  branch: CompletedBranch,
): boolean {
  return branch.producerRunIds.includes(producerRunId);
}

function isFresh(status: string, changedAt: string): boolean {
  return status === "fresh" && isValidTimestamp(changedAt);
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function sameProducer(
  artifact: ThreadArtifact,
  serverId: string,
  tool: string,
  runId?: string,
): boolean {
  return artifact.producer.serverId === serverId && artifact.producer.tool === tool &&
    (runId === undefined || artifact.producer.runId === runId);
}

function producer(artifact: ThreadArtifact) {
  return { serverId: artifact.producer.serverId, tool: artifact.producer.tool };
}

function exactIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    actual.every((id, index) => id === expected[index]);
}

function exactlyOne<T>(items: readonly T[], label: string): T {
  if (items.length !== 1) {
    throw new Error(`${label} must be present exactly once; found ${items.length}.`);
  }
  return items[0]!;
}

function sameSnapshot(
  reference: EngineeringThreadSnapshotRef,
  snapshot: ThreadSnapshot,
): boolean {
  return reference.snapshotId === snapshot.id &&
    reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id;
}

function sameSnapshotReference(
  left: EngineeringThreadSnapshotRef,
  right: EngineeringThreadSnapshotRef,
): boolean {
  return left.snapshotId === right.snapshotId && left.revision === right.revision &&
    left.subjectId === right.subjectId;
}
