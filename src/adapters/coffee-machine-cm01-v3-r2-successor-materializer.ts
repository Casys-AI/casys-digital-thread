import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import type {
  ContentFingerprint,
  RequirementEvaluation,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
  TracedRequirement,
} from "../domain/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../domain/thread-snapshot-extension.ts";
import type { Cm01DripTrayMechanicalProofR2 } from "../domain/cm01-drip-tray-mechanical-proof.ts";
import type { Cm01SemanticCadR2Capture } from "./cm01-semantic-cad-capture-r2.ts";
import type { Cm01DripTrayMechanicalR2Capture } from "./cm01-drip-tray-mechanical-capture-r2.ts";
import {
  CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID,
  cm01R2CadSupersedesLinks,
  cm01R2MechanicalSupersedesLinks,
  requireCm01R2CadPredecessors,
  requireCm01R2MechanicalPredecessors,
} from "./cm01-r2-successor-lineage.ts";

export interface Cm01R2Materialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidenceArtifactId: string;
}

/**
 * Pure server-side materializer for the closed 30 mm CAD successor.
 * It neither calls providers nor persists state; the trusted executor owns
 * those concerns and receives this exact immutable descendant snapshot.
 */
export class CoffeeMachineCm01V3CadR2SuccessorMaterializer {
  materialize(
    base: ThreadSnapshot,
    runId: string,
    capture: Cm01SemanticCadR2Capture,
    captureUri: string,
  ): Cm01R2Materialization {
    const correction = requireFreshCorrection(base.artifacts);
    const old = requireCm01R2CadPredecessors(base.artifacts);
    const architecture = requireFreshArchitecture(base.artifacts);
    const step = capture.files.find((file) => file.format === "step");
    if (!step) throw new Error("CM-01 R2 CAD capture has no assembly STEP evidence.");
    const prefix = `coffee-machine-cm01-v3-cad-r2-${capture.fingerprint.digest}`;
    const planId = `${prefix}-plan`;
    const scriptId = `${prefix}-script`;
    const stepId = `${prefix}-step`;
    const compiler: ThreadOperationRef = {
      serverId: "digital-thread",
      tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
      runId,
    };
    const exportOperation: ThreadOperationRef = {
      serverId: "build123d",
      tool: "build123d_export",
      runId,
    };
    const freshness = fresh(capture.capturedAt);
    const planFingerprint = artifactFingerprint(capture.plan, "cad-plan");
    const scriptFingerprint = artifactFingerprint(capture.plan, "cad-script");
    const artifacts: ThreadArtifact[] = [
      artifact(
        planId,
        "CM-01 30 mm DripTray semantic CAD plan",
        "document",
        planFingerprint,
        captureUri,
        "application/json",
        compiler,
        [architecture.id, correction.id],
        freshness,
      ),
      artifact(
        scriptId,
        "CM-01 30 mm DripTray deterministic build123d script",
        "script",
        scriptFingerprint,
        `${captureUri}#script`,
        "text/x-python",
        compiler,
        [planId],
        freshness,
      ),
      artifact(
        stepId,
        "CM-01 30 mm DripTray assembly STEP export",
        "step",
        step.fingerprint,
        `${captureUri}#${step.name}`,
        "model/step",
        exportOperation,
        [scriptId],
        freshness,
      ),
    ];
    const consumptions: ThreadArtifactConsumption[] = [
      consumption(
        `${prefix}-consumes-architecture`,
        architecture.id,
        compiler,
        architecture.fingerprint,
        capture.capturedAt,
      ),
      consumption(
        `${prefix}-consumes-correction`,
        correction.id,
        compiler,
        correction.fingerprint,
        capture.capturedAt,
      ),
      consumption(
        `${prefix}-consumes-plan`,
        planId,
        compiler,
        planFingerprint,
        capture.capturedAt,
      ),
      consumption(
        `${prefix}-consumes-script`,
        scriptId,
        exportOperation,
        scriptFingerprint,
        capture.capturedAt,
      ),
    ];
    const applied = applyThreadSnapshotExtensionIfNew(base, {
      id: `${prefix}-extension`,
      name: "Capture the reviewed CM-01 30 mm CAD successor",
      subjectId: base.subject.id,
      capturedAt: capture.capturedAt,
      artifacts,
      consumptions,
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      proposedActions: [],
      provenance: [
        link(
          `${prefix}-plan-from-architecture`,
          planId,
          architecture.id,
          "derived_from",
          "The R2 plan is compiled from the retained architecture basis.",
        ),
        link(
          `${prefix}-plan-from-correction`,
          planId,
          correction.id,
          "derived_from",
          "The plan is derived from the explicit 28 mm to 30 mm correction record.",
        ),
        link(
          `${prefix}-script-from-plan`,
          scriptId,
          planId,
          "derived_from",
          "The deterministic R2 script is rendered from the captured R2 plan.",
        ),
        link(
          `${prefix}-step-from-script`,
          stepId,
          scriptId,
          "derived_from",
          "build123d_export produced the R2 assembly STEP from the deterministic R2 script.",
        ),
        ...cm01R2CadSupersedesLinks({ planId, scriptId, stepId }, old),
        ...consumptions.map((item) =>
          link(
            `${item.id}-uses`,
            item.id,
            item.artifactId,
            "uses",
            "The operation attested the exact fingerprint it consumed.",
            "consumption",
          )
        ),
      ],
    }, { appliedAt: capture.capturedAt });
    if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
      throw new Error(
        "CM-01 R2 CAD evidence did not produce exactly one successor snapshot.",
      );
    }
    return { snapshot: applied.snapshot, evidenceArtifactId: stepId };
  }
}

/**
 * Pure server-side materializer for the isolated 30 mm mechanical successor.
 * It requires the fresh R2 assembly branch for project lineage, but records
 * plainly that CalculiX consumed the separately exported isolated DripTray.
 */
export class CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer {
  async materialize(
    base: ThreadSnapshot,
    runId: string,
    capture: Cm01DripTrayMechanicalR2Capture,
    captureUri: string,
    proof: Cm01DripTrayMechanicalProofR2,
  ): Promise<Cm01R2Materialization> {
    const correction = requireFreshCorrection(base.artifacts);
    const old = requireCm01R2MechanicalPredecessors(base.artifacts);
    const assemblyStep = requireFreshR2AssemblyStep(base.artifacts);
    const prefix = `coffee-machine-cm01-v3-mechanical-r2-${capture.fingerprint.digest}`;
    const proofId = `${prefix}-proof`;
    const isolatedStepId = `${prefix}-isolated-step`;
    const solveId = `${prefix}-solve`;
    const cad: ThreadOperationRef = {
      serverId: "build123d",
      tool: "build123d_export",
      runId,
    };
    const solver: ThreadOperationRef = {
      serverId: "calculix",
      tool: "calculix_solve_static",
      runId,
    };
    const evaluator: ThreadOperationRef = {
      serverId: "digital-thread",
      tool: "evaluate_cm01_drip_tray_limits_r2",
      runId,
    };
    const freshness = fresh(capture.capturedAt);
    const proofFingerprint = await sha256Fingerprint(proof);
    const artifacts: ThreadArtifact[] = [
      artifact(
        proofId,
        "CM-01 30 mm reviewed isolated DripTray proof case",
        "document",
        proofFingerprint,
        captureUri,
        "application/json",
        evaluator,
        [correction.id, assemblyStep.id],
        freshness,
      ),
      artifact(
        isolatedStepId,
        "CM-01 30 mm isolated DripTray STEP",
        "step",
        capture.step.fingerprint,
        `${captureUri}#${capture.step.name}`,
        "model/step",
        cad,
        [proofId],
        freshness,
      ),
      artifact(
        solveId,
        "CM-01 30 mm CalculiX static result",
        "solver-result",
        capture.fingerprint,
        `${captureUri}#calculix`,
        "application/json",
        solver,
        [isolatedStepId],
        freshness,
      ),
    ];
    const consumedIsolatedStep = consumption(
      `${prefix}-calculix-consumes-isolated-step`,
      isolatedStepId,
      solver,
      capture.handoff.fingerprint,
      capture.capturedAt,
    );
    // Each artifact input is backed by a verified operation consumption. This
    // makes the assembly a traceable proof input without ever claiming that
    // CalculiX consumed the assembly STEP (it consumes only `isolatedStepId`).
    const consumedCorrection = consumption(
      `${prefix}-evaluator-consumes-correction`,
      correction.id,
      evaluator,
      correction.fingerprint,
      capture.capturedAt,
    );
    const consumedAssembly = consumption(
      `${prefix}-evaluator-consumes-assembly`,
      assemblyStep.id,
      evaluator,
      assemblyStep.fingerprint,
      capture.capturedAt,
    );
    const consumedProof = consumption(
      `${prefix}-build123d-consumes-proof`,
      proofId,
      cad,
      proofFingerprint,
      capture.capturedAt,
    );
    const displacementId = `${prefix}-max-displacement`;
    const stressId = `${prefix}-max-von-mises`;
    const observations = [
      observation(
        displacementId,
        "30 mm DripTray maximum displacement",
        "assembly_max_displacement",
        capture.metrics.maximumDisplacement.value,
        "mm",
        solver,
        solveId,
        capture.capturedAt,
        freshness,
      ),
      observation(
        stressId,
        "30 mm DripTray maximum von Mises stress",
        "assembly_max_von_mises",
        capture.metrics.maximumVonMises.value,
        "MPa",
        solver,
        solveId,
        capture.capturedAt,
        freshness,
      ),
    ];
    const requirements = [
      requirement(
        `${prefix}-displacement`,
        "CM-01 30 mm DripTray maximum displacement",
        "assembly_max_displacement",
        proof.limits.maximumDisplacementMm,
        "mm",
        proofId,
        isolatedStepId,
        freshness,
      ),
      requirement(
        `${prefix}-von-mises`,
        "CM-01 30 mm DripTray maximum von Mises stress",
        "assembly_max_von_mises",
        proof.limits.maximumVonMisesMpa,
        "MPa",
        proofId,
        isolatedStepId,
        freshness,
      ),
    ];
    const evaluations = requirements.map((item, index) =>
      evaluation(
        item,
        observations[index]!,
        evaluator,
        solveId,
        capture.capturedAt,
        freshness,
      )
    );
    const applied = applyThreadSnapshotExtensionIfNew(base, {
      id: `${prefix}-extension`,
      name: "Capture the attested CM-01 30 mm isolated DripTray static proof",
      subjectId: base.subject.id,
      capturedAt: capture.capturedAt,
      artifacts,
      consumptions: [
        consumedCorrection,
        consumedAssembly,
        consumedProof,
        consumedIsolatedStep,
      ],
      observations,
      requirements,
      evaluations,
      violations: [],
      proposedActions: [],
      provenance: [
        link(
          `${prefix}-proof-from-correction`,
          proofId,
          correction.id,
          "derived_from",
          "The proof evaluator consumed the exact correction record before producing this proof artifact.",
        ),
        link(
          `${prefix}-proof-from-assembly`,
          proofId,
          assemblyStep.id,
          "derived_from",
          "The proof evaluator consumed the exact fresh assembly STEP for lineage; CalculiX does not consume it.",
        ),
        link(
          `${prefix}-isolated-step-from-proof`,
          isolatedStepId,
          proofId,
          "derived_from",
          "build123d consumed the reviewed proof case before exporting the isolated DripTray STEP.",
        ),
        link(
          `${prefix}-solve-from-isolated-step`,
          solveId,
          isolatedStepId,
          "derived_from",
          "CalculiX consumed and attested the isolated DripTray STEP, never the assembly STEP.",
        ),
        ...[
          [
            consumedCorrection,
            correction.id,
            "The proof evaluator verified the exact correction record it used.",
          ],
          [
            consumedAssembly,
            assemblyStep.id,
            "The proof evaluator traced the exact fresh assembly STEP; CalculiX does not consume it.",
          ],
          [
            consumedProof,
            proofId,
            "build123d verified the reviewed isolated proof before exporting its isolated STEP.",
          ],
          [
            consumedIsolatedStep,
            isolatedStepId,
            "CalculiX reported the SHA-256 of the isolated STEP it consumed.",
          ],
        ].map(([item, artifactId, rationale]) =>
          link(
            `${(item as ThreadArtifactConsumption).id}-uses`,
            (item as ThreadArtifactConsumption).id,
            artifactId as string,
            "uses",
            rationale as string,
            "consumption",
          )
        ),
        ...cm01R2MechanicalSupersedesLinks(
          { proofId, stepId: isolatedStepId, solveId },
          old,
        ),
        ...observations.map((item) =>
          link(
            `${item.id}-from-solve`,
            item.id,
            solveId,
            "derived_from",
            "The normalized observation came from the R2 static solve.",
            "observation",
          )
        ),
        ...requirements.map((item) =>
          link(
            `${item.id}-traces-isolated-step`,
            item.id,
            isolatedStepId,
            "traces_to",
            "The reviewed concept limit constrains the isolated 30 mm DripTray STEP.",
            "requirement",
          )
        ),
        ...evaluations.flatMap((item) => [
          link(
            `${item.id}-evaluates`,
            item.id,
            item.requirementId,
            "evaluates",
            "The local bounded oracle classified the reviewed concept limit.",
            "evaluation",
            "requirement",
          ),
          ...item.observationIds.map((id) =>
            link(
              `${item.id}-uses-${id}`,
              item.id,
              id,
              "uses",
              "The local bounded oracle used the normalized solve observation.",
              "evaluation",
              "observation",
            )
          ),
          ...item.evidenceArtifactIds.map((id) =>
            link(
              `${item.id}-evidences-${id}`,
              item.id,
              id,
              "evidences",
              "The static solve evidence supports the bounded evaluation.",
              "evaluation",
            )
          ),
        ]),
      ],
    }, { appliedAt: capture.capturedAt });
    if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
      throw new Error(
        "CM-01 R2 mechanical evidence did not produce exactly one successor snapshot.",
      );
    }
    return { snapshot: applied.snapshot, evidenceArtifactId: solveId };
  }
}

function requireFreshCorrection(artifacts: readonly ThreadArtifact[]): ThreadArtifact {
  const found = artifacts.filter((item) =>
    item.id === CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID &&
    item.freshness.status === "fresh"
  );
  if (found.length !== 1) {
    throw new Error(
      "CM-01 R2 successor materialization requires the fresh correction record.",
    );
  }
  return found[0]!;
}
function requireFreshArchitecture(
  artifacts: readonly ThreadArtifact[],
): ThreadArtifact {
  const found = artifacts.filter((item) =>
    item.kind === "sysml-model" &&
    item.id.startsWith("coffee-machine-cm01-v3-architecture-") &&
    item.freshness.status === "fresh"
  );
  if (found.length !== 1) {
    throw new Error(
      "CM-01 R2 CAD materialization requires exactly one fresh V3 architecture artifact.",
    );
  }
  return found[0]!;
}
function requireFreshR2AssemblyStep(
  artifacts: readonly ThreadArtifact[],
): ThreadArtifact {
  const found = artifacts.filter((item) =>
    item.kind === "step" && item.name === "CM-01 30 mm DripTray assembly STEP export" &&
    item.freshness.status === "fresh"
  );
  if (found.length !== 1) {
    throw new Error(
      "CM-01 R2 mechanical materialization requires the one fresh R2 assembly STEP successor.",
    );
  }
  return found[0]!;
}
function artifact(
  id: string,
  name: string,
  kind: ThreadArtifact["kind"],
  fingerprint: ContentFingerprint,
  uri: string,
  mediaType: string,
  producer: ThreadOperationRef,
  inputArtifactIds: string[],
  freshness: ThreadFreshness,
): ThreadArtifact {
  return {
    id,
    name,
    kind,
    version: fingerprint.digest,
    fingerprint,
    uri,
    mediaType,
    producer,
    inputArtifactIds,
    freshness,
  };
}
function consumption(
  id: string,
  artifactId: string,
  consumer: ThreadOperationRef,
  observedFingerprint: ContentFingerprint,
  verifiedAt: string,
): ThreadArtifactConsumption {
  return {
    id,
    artifactId,
    consumer,
    observedFingerprint,
    verifiedAt,
    status: "verified",
  };
}
function fresh(at: string): ThreadFreshness {
  return { status: "fresh", changedAt: at, invalidatedByChangeIds: [] };
}
function artifactFingerprint(
  plan: Cm01SemanticCadR2Capture["plan"],
  role: "cad-plan" | "cad-script",
): ContentFingerprint {
  const item = plan.artifacts.find((candidate) => candidate.role === role);
  if (!item) throw new Error(`CM-01 R2 CAD plan is missing ${role}.`);
  return structuredClone(item.fingerprint);
}
function observation(
  id: string,
  name: string,
  metric: string,
  value: number,
  unit: "mm" | "MPa",
  operation: ThreadOperationRef,
  artifactId: string,
  capturedAt: string,
  freshness: ThreadFreshness,
) {
  return {
    id,
    name,
    metric,
    quantity: { value, unit },
    source: { operation, artifactIds: [artifactId], capturedAt },
    freshness,
  };
}
function requirement(
  id: string,
  name: string,
  metric: string,
  value: number,
  unit: "mm" | "MPa",
  sourceArtifactId: string,
  targetArtifactId: string,
  freshness: ThreadFreshness,
): TracedRequirement {
  return {
    id,
    name,
    statement: `${metric} <= ${value} [${unit}]`,
    version: "cm01-v3-r2",
    criterion: { metric, operator: "<=", limit: { value, unit } },
    trace: { sourceArtifactId, elementId: id, targetArtifactIds: [targetArtifactId] },
    freshness,
  };
}
function evaluation(
  requirement: TracedRequirement,
  observation: { id: string; quantity: { value: number; unit: string } },
  evaluator: ThreadOperationRef,
  solveId: string,
  at: string,
  freshness: ThreadFreshness,
): RequirementEvaluation {
  const pass = observation.quantity.value <= requirement.criterion.limit.value;
  return {
    id: `${requirement.id}-evaluation`,
    name: `${requirement.name} evaluation`,
    requirementId: requirement.id,
    observationIds: [observation.id],
    status: pass ? "pass" : "fail",
    evaluatedAt: at,
    evaluator,
    comparison: {
      observationId: observation.id,
      actual: observation.quantity,
      operator: "<=",
      limit: requirement.criterion.limit,
      normalizedUnit: observation.quantity.unit,
      margin: {
        value: requirement.criterion.limit.value - observation.quantity.value,
        unit: observation.quantity.unit,
      },
    },
    evidenceArtifactIds: [solveId],
    message: pass
      ? "The observed value is within the reviewed concept limit."
      : "The observed value exceeds the reviewed concept limit.",
    freshness,
  };
}
function link(
  id: string,
  fromId: string,
  toId: string,
  relation: "derived_from" | "traces_to" | "uses" | "evaluates" | "evidences",
  rationale: string,
  fromKind: "artifact" | "consumption" | "observation" | "requirement" | "evaluation" =
    "artifact",
  toKind: "artifact" | "requirement" | "observation" = "artifact",
) {
  return {
    id,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale,
  };
}
