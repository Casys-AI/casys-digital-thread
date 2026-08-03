import {
  type Cm01DripTrayMechanicalProof,
  type Cm01DripTrayMechanicalProofR2,
  parseCm01DripTrayMechanicalProof,
  parseCm01DripTrayMechanicalProofR2,
} from "./cm01-drip-tray-mechanical-proof.ts";
import {
  COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY,
  COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA,
  type CoffeeMachineCm01SemanticRecipe,
  type CoffeeMachineCm01SemanticRecipeR2,
  parseCoffeeMachineCm01SemanticRecipe,
  parseCoffeeMachineCm01SemanticRecipeR2,
} from "./coffee-machine-cm01-semantic-recipe.ts";
import { sha256Fingerprint } from "./deterministic-json.ts";
import type {
  ProposedThreadAction,
  RequirementEvaluation,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityRef,
  ThreadFreshness,
  ThreadObservation,
  ThreadSnapshot,
  ThreadViolation,
} from "./thread-snapshot.ts";
import { validateThreadSnapshot } from "./thread-snapshot-validation.ts";

/**
 * The only correction admitted by this first feedback-loop slice.
 *
 * It deliberately does not accept a product id, free parameter name, numeric
 * range, provider operation, CAD program, or solver request. A different
 * engineering correction needs its own reviewed domain contract.
 */
export const CM01_DRIP_TRAY_HEIGHT_28_TO_30_CORRECTION = Object.freeze({
  schemaVersion: "cm01-drip-tray-height-correction/1.0" as const,
  id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30" as const,
  subjectId: "project:coffee-machine-cm01-v3" as const,
  parameter: {
    semanticComponent: "drip-tray" as const,
    semanticParameter: "size-z" as const,
    proofField: "geometry.heightMm" as const,
    unit: "mm" as const,
    from: 28 as const,
    to: 30 as const,
  },
  /** CAD then mechanical only; thermal and ERP are intentionally excluded. */
  impact: {
    recomputeOperationIds: [
      "design.build-coffee-machine-cm01-cad",
      "verify.coffee-machine-cm01-drip-tray-mechanical",
    ] as const,
    unchangedBranches: ["thermal-nominal", "erp-bom"] as const,
  },
});

export type Cm01DripTrayHeight28To30Correction =
  typeof CM01_DRIP_TRAY_HEIGHT_28_TO_30_CORRECTION;

export interface Cm01DripTrayHeight28To30CorrectionResult {
  readonly snapshot: ThreadSnapshot;
  /** Fresh code-owned correction record, not a CAD or solver result. */
  readonly correctionArtifactId: string;
  /** Ready first step: CAD must be regenerated from the R2 recipe. */
  readonly cadRecomputation: ProposedThreadAction;
  /** Blocked second step: it must consume the replacement CAD STEP. */
  readonly mechanicalRecomputation: ProposedThreadAction;
  readonly affected: {
    readonly artifactIds: readonly string[];
    readonly observationIds: readonly string[];
    readonly evaluationIds: readonly string[];
    readonly violationIds: readonly string[];
  };
  /** Explicit negative scope; these remain fresh in the returned snapshot. */
  readonly unchanged: {
    readonly thermalArtifactIds: readonly string[];
    readonly erpBomArtifactIds: readonly string[];
  };
}

/**
 * Derive the one closed R2 product recipe from a validated V1 recipe.
 *
 * This helper is useful to a future executor or fixture builder, but it
 * cannot invent a new recipe value: V1 is reparsed and the result is reparsed
 * through the R2 contract before it is returned.
 */
export function deriveCm01DripTrayHeight30Recipe(
  value: CoffeeMachineCm01SemanticRecipe,
): CoffeeMachineCm01SemanticRecipeR2 {
  const v1 = parseCoffeeMachineCm01SemanticRecipe(value);
  const candidate = structuredClone(v1) as unknown as Record<string, unknown>;
  candidate.schemaVersion = COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA;
  candidate.recipeKey = COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY;
  const components = candidate.components as Record<string, unknown>[];
  const dripTray = components[9]!;
  const dimensions = dripTray.dimensions as Record<string, unknown>[];
  dimensions[2] = { ...dimensions[2]!, value: 30 };
  return parseCoffeeMachineCm01SemanticRecipeR2(candidate);
}

/** Derive the one closed 30 mm proof from a validated V1 proof. */
export function deriveCm01DripTrayHeight30Proof(
  value: Cm01DripTrayMechanicalProof,
): Cm01DripTrayMechanicalProofR2 {
  const v1 = parseCm01DripTrayMechanicalProof(value);
  const candidate = structuredClone(v1) as unknown as Record<string, unknown>;
  candidate.schemaVersion = "cm01-v3-drip-tray-static-proof/2.0";
  candidate.id = "coffee-machine-cm01-v3-drip-tray-height-30-static-proof";
  const geometry = candidate.geometry as Record<string, unknown>;
  geometry.heightMm = 30;
  return parseCm01DripTrayMechanicalProofR2(candidate);
}

/**
 * Create a new immutable ThreadSnapshot revision that records the approved
 * 28 mm -> 30 mm design correction, leaves the old evidence visible, marks
 * only its bounded descendants stale, and schedules CAD@2 before mechanical@2.
 *
 * No provider call, data synthesis, new CAD fingerprint or new solver verdict
 * occurs here. The two actions describe precisely what a later trusted
 * executor must recompute and what it must supersede.
 */
export async function applyCm01DripTrayHeight28To30Correction(
  base: ThreadSnapshot,
  options: { readonly appliedAt: string },
): Promise<Cm01DripTrayHeight28To30CorrectionResult> {
  const checked = validateThreadSnapshot(base);
  if (checked.subject.id !== CM01_DRIP_TRAY_HEIGHT_28_TO_30_CORRECTION.subjectId) {
    throw new Error(
      "The CM-01 DripTray correction can only be applied to the CM-01 V3 project subject.",
    );
  }
  const appliedAt = isoUtc(options.appliedAt, "appliedAt");
  if (Date.parse(appliedAt) < Date.parse(checked.generatedAt)) {
    throw new Error("The CM-01 DripTray correction cannot predate its base snapshot.");
  }

  const correction = CM01_DRIP_TRAY_HEIGHT_28_TO_30_CORRECTION;
  const correctionArtifactId = `${correction.id}:record`;
  const changeId = `${correction.id}:applied`;
  const cadActionId = `${correction.id}:recompute-cad-r2`;
  const mechanicalActionId = `${correction.id}:recompute-mechanical-r2`;
  if (
    checked.changeSet.changes.some((change) => change.id === changeId) ||
    checked.artifacts.some((artifact) => artifact.id === correctionArtifactId) ||
    checked.proposedActions.some((action) =>
      action.id === cadActionId || action.id === mechanicalActionId
    )
  ) {
    throw new Error(
      "The CM-01 DripTray 28 mm to 30 mm correction is already recorded.",
    );
  }

  const resolved = resolveCm01CorrectionBranches(checked);
  assertFresh(resolved.affectedArtifacts, "CM-01 correction targets");
  assertFresh(resolved.unchangedThermal, "CM-01 thermal non-impact branch");
  assertFresh(resolved.unchangedErpBom, "CM-01 ERP non-impact branch");

  const correctionRecord = {
    schemaVersion: correction.schemaVersion,
    id: correction.id,
    baseSnapshot: { snapshotId: checked.id, revision: checked.revision },
    architecture: {
      artifactId: resolved.architecture.id,
      fingerprint: resolved.architecture.fingerprint,
    },
    parameter: correction.parameter,
    impact: correction.impact,
  };
  const correctionFingerprint = await sha256Fingerprint(correctionRecord);
  const correctionArtifact: ThreadArtifact = {
    id: correctionArtifactId,
    name: "CM-01 DripTray height correction (28 mm to 30 mm)",
    kind: "document",
    version: "1",
    fingerprint: correctionFingerprint,
    mediaType: "application/json",
    producer: {
      serverId: "casys-digital-thread",
      tool: "record_cm01_drip_tray_height_28_to_30_correction",
      runId: correction.id,
    },
    // The correction is not a replacement SysML model. It is a code-owned
    // record which attests the exact still-fresh architecture it applies to.
    inputArtifactIds: [resolved.architecture.id],
    freshness: fresh(appliedAt),
  };
  const architectureConsumption: ThreadArtifactConsumption = {
    id: `${correction.id}:consume-architecture`,
    artifactId: resolved.architecture.id,
    consumer: correctionArtifact.producer,
    observedFingerprint: resolved.architecture.fingerprint,
    verifiedAt: appliedAt,
    status: "verified",
  };

  const staleArtifactIds = new Set(
    resolved.affectedArtifacts.map((artifact) => artifact.id),
  );
  const staleObservations = checked.observations.filter((observation) =>
    observation.source.artifactIds.some((id) => staleArtifactIds.has(id))
  );
  const staleObservationIds = new Set(
    staleObservations.map((observation) => observation.id),
  );
  const staleEvaluations = checked.evaluations.filter((evaluation) =>
    evaluation.observationIds.some((id) => staleObservationIds.has(id)) ||
    evaluation.evidenceArtifactIds.some((id) => staleArtifactIds.has(id))
  );
  const staleEvaluationIds = new Set(
    staleEvaluations.map((evaluation) => evaluation.id),
  );
  const staleViolations = checked.violations.filter((violation) =>
    staleEvaluationIds.has(violation.evaluationId) ||
    violation.observationIds.some((id) => staleObservationIds.has(id)) ||
    violation.evidenceArtifactIds.some((id) => staleArtifactIds.has(id))
  );

  const cadArtifactIds = resolved.cadArtifacts.map((artifact) => artifact.id);
  const mechanicalArtifactIds = resolved.mechanicalArtifacts.map((artifact) =>
    artifact.id
  );
  const staleConsumptions = checked.consumptions.filter((consumption) =>
    staleArtifactIds.has(consumption.artifactId)
  );
  const cadAction: ProposedThreadAction = {
    id: cadActionId,
    name: "Recompute CM-01 CAD with 30 mm DripTray",
    kind: "recompute",
    readiness: "ready",
    rationale:
      "The 28 mm DripTray geometry basis was replaced by the code-owned 30 mm correction. Rebuild only the affected CM-01 CAD evidence before any mechanical verification.",
    targets: [
      { kind: "artifact", id: correctionArtifactId },
      ...cadArtifactIds.map(artifactRef),
    ],
    addressesViolationIds: [],
    dependsOnActionIds: [],
    operation: {
      id: "design.build-coffee-machine-cm01-cad",
      inputs: {
        operationVersion: "2",
        correctionArtifactId,
        semanticComponent: "drip-tray",
        semanticParameter: "size-z",
        fromHeightMm: 28,
        toHeightMm: 30,
        unit: "mm",
        supersedesArtifactIds: cadArtifactIds,
      },
    },
  };
  const mechanicalAction: ProposedThreadAction = {
    id: mechanicalActionId,
    name: "Recompute CM-01 30 mm DripTray mechanical proof",
    kind: "recompute",
    readiness: "blocked",
    rationale:
      "The prior CalculiX result consumed the historic 28 mm DripTray STEP. It cannot be reused after the geometry correction.",
    targets: [
      { kind: "artifact", id: correctionArtifactId },
      ...mechanicalArtifactIds.map(artifactRef),
      ...staleConsumptions.map(consumptionRef),
      ...staleObservations.map(observationRef),
      ...staleEvaluations.map(evaluationRef),
      ...staleViolations.map(violationRef),
    ],
    addressesViolationIds: [],
    dependsOnActionIds: [cadActionId],
    operation: {
      id: "verify.coffee-machine-cm01-drip-tray-mechanical",
      inputs: {
        operationVersion: "2",
        correctionArtifactId,
        requiredCadActionId: cadActionId,
        requiredRevisedCadStep: true,
        proofHeightMm: 30,
        unit: "mm",
        supersedesArtifactIds: mechanicalArtifactIds,
      },
    },
    blockedReason:
      "Requires the replacement CAD STEP produced by the preceding CAD@2 recomputation.",
  };

  const staleReason =
    "Superseded by the code-owned CM-01 DripTray height correction from 28 mm to 30 mm; replacement evidence is required.";
  const next: ThreadSnapshot = {
    ...structuredClone(checked),
    id: `${checked.subject.id}:r${checked.revision + 1}:${correction.id}`,
    revision: checked.revision + 1,
    previous: { snapshotId: checked.id, revision: checked.revision },
    generatedAt: appliedAt,
    freshness: {
      status: "stale",
      changedAt: appliedAt,
      reason: staleReason,
      invalidatedByChangeIds: appendChangeId(
        checked.freshness.invalidatedByChangeIds,
        changeId,
      ),
    },
    changeSet: {
      id: changeId,
      name: "Increase CM-01 DripTray height from 28 mm to 30 mm",
      status: "applied",
      createdAt: appliedAt,
      appliedAt,
      changes: [
        ...checked.changeSet.changes,
        {
          id: changeId,
          kind: "created",
          target: { kind: "artifact", id: correctionArtifactId },
          summary:
            "Recorded the code-owned CM-01 DripTray size-z correction from 28 mm to 30 mm; CAD and mechanical evidence now require replacement.",
          afterFingerprint: correctionFingerprint,
        },
      ],
    },
    artifacts: [
      ...checked.artifacts.map((artifact) =>
        staleArtifactIds.has(artifact.id)
          ? {
            ...artifact,
            freshness: stale(artifact.freshness, changeId, appliedAt, staleReason),
          }
          : artifact
      ),
      correctionArtifact,
    ],
    consumptions: [...checked.consumptions, architectureConsumption],
    observations: checked.observations.map((observation) =>
      staleObservationIds.has(observation.id)
        ? {
          ...observation,
          freshness: stale(observation.freshness, changeId, appliedAt, staleReason),
        }
        : observation
    ),
    evaluations: checked.evaluations.map((evaluation) =>
      staleEvaluationIds.has(evaluation.id)
        ? {
          ...evaluation,
          freshness: stale(evaluation.freshness, changeId, appliedAt, staleReason),
        }
        : evaluation
    ),
    violations: checked.violations.map((violation) =>
      staleViolations.some((candidate) => candidate.id === violation.id)
        ? {
          ...violation,
          freshness: stale(violation.freshness, changeId, appliedAt, staleReason),
        }
        : violation
    ),
    provenance: [
      ...checked.provenance,
      {
        id: `${changeId}:changes:${correctionArtifactId}`,
        relation: "changes",
        from: { kind: "change", id: changeId },
        to: { kind: "artifact", id: correctionArtifactId },
        rationale:
          "This immutable snapshot records the reviewed CM-01 geometry correction.",
      },
      {
        id: `${correction.id}:derived-from:${resolved.architecture.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: correctionArtifactId },
        to: { kind: "artifact", id: resolved.architecture.id },
        rationale:
          "The correction record is bound to the exact fresh SysML architecture that supplies its CM-01 product context; it does not replace that architecture.",
      },
      {
        id: `${correction.id}:uses:${resolved.architecture.id}`,
        relation: "uses",
        from: { kind: "consumption", id: architectureConsumption.id },
        to: { kind: "artifact", id: resolved.architecture.id },
        rationale:
          "The code-owned correction record attested the architecture fingerprint before scheduling successor CAD evidence.",
      },
      ...[
        resolved.cadPlan,
        resolved.mechanicalProof,
        resolved.mechanicalStep,
      ].map((artifact) => ({
        id: `${correction.id}:supersedes:${artifact.id}`,
        relation: "supersedes" as const,
        from: { kind: "artifact" as const, id: correctionArtifactId },
        to: { kind: "artifact" as const, id: artifact.id },
        rationale:
          "The code-owned 30 mm DripTray correction supersedes this historic 28 mm geometry basis for subsequent recomputation; it does not claim replacement evidence yet.",
      })),
    ],
    proposedActions: [...checked.proposedActions, cadAction, mechanicalAction],
  };
  const snapshot = validateThreadSnapshot(next);
  return {
    snapshot,
    correctionArtifactId,
    cadRecomputation: action(snapshot, cadActionId),
    mechanicalRecomputation: action(snapshot, mechanicalActionId),
    affected: {
      artifactIds: sorted(staleArtifactIds),
      observationIds: sorted(staleObservationIds),
      evaluationIds: sorted(staleEvaluationIds),
      violationIds: staleViolations.map((violation) => violation.id).sort(),
    },
    unchanged: {
      thermalArtifactIds: resolved.unchangedThermal.map((artifact) => artifact.id)
        .sort(),
      erpBomArtifactIds: resolved.unchangedErpBom.map((artifact) => artifact.id).sort(),
    },
  };
}

interface ResolvedCm01CorrectionBranches {
  readonly architecture: ThreadArtifact;
  readonly cadPlan: ThreadArtifact;
  readonly mechanicalProof: ThreadArtifact;
  readonly mechanicalStep: ThreadArtifact;
  readonly cadArtifacts: readonly ThreadArtifact[];
  readonly mechanicalArtifacts: readonly ThreadArtifact[];
  readonly affectedArtifacts: readonly ThreadArtifact[];
  readonly unchangedThermal: readonly ThreadArtifact[];
  readonly unchangedErpBom: readonly ThreadArtifact[];
}

function resolveCm01CorrectionBranches(
  snapshot: ThreadSnapshot,
): ResolvedCm01CorrectionBranches {
  const architecture = exactlyOne(
    snapshot.artifacts,
    (artifact) =>
      artifact.kind === "sysml-model" && artifact.producer.serverId === "syson" &&
      artifact.producer.tool === "syson_element_insert_sysml",
    "one CM-01 architecture model",
  );
  const cadPlan = exactlyOne(
    snapshot.artifacts,
    (artifact) =>
      artifact.kind === "document" && artifact.producer.serverId === "digital-thread" &&
      artifact.producer.tool === "compile_coffee_machine_cm01_semantic_cad_plan" &&
      artifact.inputArtifactIds.includes(architecture.id),
    "one CM-01 semantic CAD plan derived from the architecture",
  );
  const cadArtifacts = descendantArtifacts(snapshot, cadPlan.id);
  if (!cadArtifacts.some((artifact) => artifact.kind === "script")) {
    throw new Error("The CM-01 CAD correction requires a derived CAD script.");
  }
  if (!cadArtifacts.some((artifact) => artifact.kind === "step")) {
    throw new Error("The CM-01 CAD correction requires a derived CAD STEP.");
  }
  const mechanicalSolve = exactlyOne(
    snapshot.artifacts,
    (artifact) =>
      artifact.kind === "solver-result" && artifact.producer.serverId === "calculix" &&
      artifact.producer.tool === "calculix_solve_static",
    "one CM-01 CalculiX static result",
  );
  const mechanicalProof = exactlyOne(
    snapshot.artifacts,
    (artifact) =>
      artifact.kind === "document" &&
      artifact.producer.serverId === "digital-thread" &&
      artifact.producer.tool === "evaluate_cm01_drip_tray_limits",
    "one CM-01 DripTray mechanical proof",
  );
  if (mechanicalSolve.inputArtifactIds.length !== 1) {
    throw new Error(
      "The CM-01 mechanical correction requires exactly one attested STEP input.",
    );
  }
  const mechanicalStep = snapshot.artifacts.find((artifact) =>
    artifact.id === mechanicalSolve.inputArtifactIds[0]
  );
  if (
    !mechanicalStep || mechanicalStep.kind !== "step" ||
    mechanicalStep.producer.serverId !== "build123d" ||
    mechanicalStep.producer.tool !== "build123d_export"
  ) {
    throw new Error(
      "The CM-01 CalculiX result does not consume a reviewed build123d STEP.",
    );
  }
  const mechanicalArtifacts = uniqueArtifacts([
    mechanicalProof,
    ...descendantArtifacts(snapshot, mechanicalStep.id),
  ]);
  if (!mechanicalArtifacts.some((artifact) => artifact.id === mechanicalSolve.id)) {
    throw new Error(
      "The CM-01 mechanical result is not a descendant of its attested STEP.",
    );
  }
  const unchangedThermal = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "solver-result" && artifact.producer.serverId === "modelica" &&
    artifact.producer.tool === "modelica_simulate"
  );
  const unchangedErpBom = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "bom" && artifact.producer.serverId === "erpnext"
  );
  if (unchangedThermal.length === 0 || unchangedErpBom.length === 0) {
    throw new Error(
      "The CM-01 correction requires existing thermal and ERP branches to prove their explicit non-impact.",
    );
  }
  const affectedArtifacts = uniqueArtifacts([
    ...cadArtifacts,
    ...mechanicalArtifacts,
  ]);
  return {
    architecture,
    cadPlan,
    mechanicalProof,
    mechanicalStep,
    cadArtifacts,
    mechanicalArtifacts,
    affectedArtifacts,
    unchangedThermal,
    unchangedErpBom,
  };
}

function descendantArtifacts(
  snapshot: ThreadSnapshot,
  rootId: string,
): ThreadArtifact[] {
  const byInput = new Map<string, ThreadArtifact[]>();
  for (const artifact of snapshot.artifacts) {
    for (const inputId of artifact.inputArtifactIds) {
      const entries = byInput.get(inputId) ?? [];
      entries.push(artifact);
      byInput.set(inputId, entries);
    }
  }
  const descendants: ThreadArtifact[] = [];
  const queue = [rootId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const artifact = snapshot.artifacts.find((candidate) => candidate.id === id);
    if (!artifact) throw new Error(`CM-01 correction cannot resolve artifact ${id}.`);
    descendants.push(artifact);
    for (const child of byInput.get(id) ?? []) queue.push(child.id);
  }
  return descendants.sort((left, right) => left.id.localeCompare(right.id));
}

function exactlyOne<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
  label: string,
): T {
  const matches = values.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`CM-01 correction requires ${label}; found ${matches.length}.`);
  }
  return matches[0]!;
}

function uniqueArtifacts(values: readonly ThreadArtifact[]): ThreadArtifact[] {
  return [...new Map(values.map((artifact) => [artifact.id, artifact])).values()].sort((
    left,
    right,
  ) => left.id.localeCompare(right.id));
}

function assertFresh(
  artifacts: readonly ThreadArtifact[],
  label: string,
): void {
  const nonFresh = artifacts.find((artifact) => artifact.freshness.status !== "fresh");
  if (nonFresh) {
    throw new Error(`${label} must be fresh before the bounded correction is applied.`);
  }
}

function fresh(at: string): ThreadFreshness {
  return { status: "fresh", changedAt: at, invalidatedByChangeIds: [] };
}

function stale(
  previous: ThreadFreshness,
  changeId: string,
  at: string,
  reason: string,
): ThreadFreshness {
  return {
    status: "stale",
    changedAt: at,
    reason,
    invalidatedByChangeIds: appendChangeId(previous.invalidatedByChangeIds, changeId),
  };
}

function appendChangeId(values: readonly string[], changeId: string): string[] {
  return [...new Set([...values, changeId])].sort();
}

function isoUtc(value: string, label: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) throw new Error(`${label} must be a canonical UTC instant.`);
  return value;
}

function artifactRef(artifactId: string): ThreadEntityRef {
  return { kind: "artifact", id: artifactId };
}

function consumptionRef(consumption: ThreadArtifactConsumption): ThreadEntityRef {
  return { kind: "consumption", id: consumption.id };
}

function observationRef(observation: ThreadObservation): ThreadEntityRef {
  return { kind: "observation", id: observation.id };
}

function evaluationRef(evaluation: RequirementEvaluation): ThreadEntityRef {
  return { kind: "evaluation", id: evaluation.id };
}

function violationRef(violation: ThreadViolation): ThreadEntityRef {
  return { kind: "violation", id: violation.id };
}

function action(snapshot: ThreadSnapshot, id: string): ProposedThreadAction {
  const found = snapshot.proposedActions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`CM-01 correction did not retain action ${id}.`);
  return structuredClone(found);
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort();
}
