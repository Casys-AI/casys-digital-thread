import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import type { Cm01DripTrayMechanicalProofR3 } from "../domain/cm01-drip-tray-mechanical-proof.ts";
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
import {
  evaluationFromOracle,
  type ParsedOracleResult,
} from "./cm01-drip-tray-mechanical-oracle.ts";
import type { Cm01DripTrayMechanicalR3Capture } from "./cm01-drip-tray-mechanical-capture-r3.ts";

export interface Cm01R3MechanicalMaterialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidenceArtifactId: string;
}

interface MechanicalPredecessors {
  readonly proof: ThreadArtifact;
  readonly step: ThreadArtifact;
  readonly solve: ThreadArtifact;
  readonly requirements?: ReadonlyMap<string, TracedRequirement>;
  readonly recovery: boolean;
}

/**
 * Materializes only R3-named evidence.  This is deliberately separate from
 * the historical R2 materializer: an R3 operation must never emit an R2
 * artifact, requirement, evaluator or snapshot-extension identity.
 */
export class CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer {
  async materialize(
    base: ThreadSnapshot,
    runId: string,
    capture: Cm01DripTrayMechanicalR3Capture,
    captureUri: string,
    proof: Cm01DripTrayMechanicalProofR3,
    oracleResults: ReadonlyMap<string, ParsedOracleResult>,
  ): Promise<Cm01R3MechanicalMaterialization> {
    return await this.#materialize(
      base,
      capture,
      captureUri,
      proof,
      stalePredecessors(base.artifacts),
      runId,
      runId,
      oracleResults,
    );
  }

  /**
   * Reprojects one already-captured R3 provider result under its correct
   * identity.  It does not call a provider and it leaves the malformed R10
   * snapshot intact as the explicit superseded historical record.
   *
   * The executor must obtain oracle results (by calling callDripTrayMechanicalOracle)
   * before calling this method; the materializer itself remains pure.
   */
  async materializeIdentityRecovery(
    base: ThreadSnapshot,
    recoveryRunId: string,
    historicalProviderRunId: string,
    capture: Cm01DripTrayMechanicalR3Capture,
    captureUri: string,
    proof: Cm01DripTrayMechanicalProofR3,
    oracleResults: ReadonlyMap<string, ParsedOracleResult>,
  ): Promise<Cm01R3MechanicalMaterialization> {
    return await this.#materialize(
      base,
      capture,
      captureUri,
      proof,
      historicalR2NamedPredecessors(base, capture),
      recoveryRunId,
      historicalProviderRunId,
      oracleResults,
    );
  }

  async #materialize(
    base: ThreadSnapshot,
    capture: Cm01DripTrayMechanicalR3Capture,
    captureUri: string,
    proof: Cm01DripTrayMechanicalProofR3,
    predecessor: MechanicalPredecessors,
    evaluatorRunId: string,
    providerRunId: string,
    oracleResults: ReadonlyMap<string, ParsedOracleResult>,
  ): Promise<Cm01R3MechanicalMaterialization> {
    const correction = freshCorrection(base.artifacts);
    const assemblyStep = freshAssemblyStep(base.artifacts);
    const prefix = `coffee-machine-cm01-v3-mechanical-r3-${capture.fingerprint.digest}`;
    const proofId = `${prefix}-proof`;
    const isolatedStepId = `${prefix}-isolated-step`;
    const solveId = `${prefix}-solve`;
    const evaluator: ThreadOperationRef = {
      serverId: "digital-thread",
      tool: "evaluate_cm01_drip_tray_limits_r3",
      runId: evaluatorRunId,
    };
    const cad: ThreadOperationRef = {
      serverId: "build123d",
      tool: "build123d_export",
      runId: providerRunId,
    };
    const solver: ThreadOperationRef = {
      serverId: "calculix",
      tool: "calculix_solve_static",
      runId: providerRunId,
    };
    const freshness = fresh(capture.capturedAt);
    const proofFingerprint = await sha256Fingerprint(proof);
    const artifacts: ThreadArtifact[] = [
      artifact(
        proofId,
        "CM-01 R3 30 mm reviewed isolated DripTray proof case",
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
        "CM-01 R3 30 mm isolated DripTray STEP",
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
        "CM-01 R3 30 mm CalculiX static result",
        "solver-result",
        capture.fingerprint,
        `${captureUri}#calculix`,
        "application/json",
        solver,
        [isolatedStepId],
        freshness,
      ),
    ];
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
    const consumedIsolatedStep = consumption(
      `${prefix}-calculix-consumes-isolated-step`,
      isolatedStepId,
      solver,
      capture.handoff.fingerprint,
      capture.capturedAt,
    );
    const displacementId = `${prefix}-max-displacement`;
    const stressId = `${prefix}-max-von-mises`;
    const observations = [
      observation(
        displacementId,
        "CM-01 R3 30 mm DripTray maximum displacement",
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
        "CM-01 R3 30 mm DripTray maximum von Mises stress",
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
        "CM-01 R3 30 mm DripTray maximum displacement",
        "assembly_max_displacement",
        proof.limits.maximumDisplacementMm,
        "mm",
        proofId,
        isolatedStepId,
        freshness,
      ),
      requirement(
        `${prefix}-von-mises`,
        "CM-01 R3 30 mm DripTray maximum von Mises stress",
        "assembly_max_von_mises",
        proof.limits.maximumVonMisesMpa,
        "MPa",
        proofId,
        isolatedStepId,
        freshness,
      ),
    ];
    const evaluations: RequirementEvaluation[] = requirements.map((item, index) => {
      const oracleResult = oracleResults.get(item.criterion.metric);
      if (!oracleResult) {
        throw new Error(
          `Oracle result missing for metric "${item.criterion.metric}" in R3 evaluation.`,
        );
      }
      return evaluationFromOracle(
        item,
        observations[index]!,
        oracleResult,
        evaluator,
        solveId,
        capture.capturedAt,
        freshness,
      );
    });
    const consumed = [
      consumedCorrection,
      consumedAssembly,
      consumedProof,
      consumedIsolatedStep,
    ];
    const recoveryLinks = predecessor.recovery
      ? requirementSupersedesLinks(requirements, predecessor.requirements!)
      : [];
    const applied = applyThreadSnapshotExtensionIfNew(base, {
      id: `${prefix}-extension`,
      name: predecessor.recovery
        ? "Correct the persisted CM-01 R3 mechanical evidence identity"
        : "Capture the attested CM-01 R3 30 mm isolated DripTray static proof",
      subjectId: base.subject.id,
      capturedAt: capture.capturedAt,
      artifacts,
      consumptions: consumed,
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
          "The R3 evaluator consumed the exact correction record before producing this proof artifact.",
        ),
        link(
          `${prefix}-proof-from-assembly`,
          proofId,
          assemblyStep.id,
          "derived_from",
          "The R3 evaluator traced the exact fresh assembly STEP; CalculiX does not consume it.",
        ),
        link(
          `${prefix}-isolated-step-from-proof`,
          isolatedStepId,
          proofId,
          "derived_from",
          "build123d consumed the R3 proof case before exporting the isolated DripTray STEP.",
        ),
        link(
          `${prefix}-solve-from-isolated-step`,
          solveId,
          isolatedStepId,
          "derived_from",
          "CalculiX consumed and attested the isolated R3 DripTray STEP, never the assembly STEP.",
        ),
        ...consumed.map((item) =>
          link(
            `${item.id}-uses`,
            item.id,
            item.artifactId,
            "uses",
            "The operation attested the exact fingerprint it consumed.",
            "consumption",
          )
        ),
        ...artifactSupersedesLinks(
          { proofId, stepId: isolatedStepId, solveId },
          predecessor,
        ),
        ...recoveryLinks,
        ...observations.map((item) =>
          link(
            `${item.id}-from-solve`,
            item.id,
            solveId,
            "derived_from",
            "The normalized observation came from the R3 static solve.",
            "observation",
          )
        ),
        ...requirements.map((item) =>
          link(
            `${item.id}-traces-isolated-step`,
            item.id,
            isolatedStepId,
            "traces_to",
            "The reviewed R3 concept limit constrains the isolated 30 mm DripTray STEP.",
            "requirement",
          )
        ),
        ...evaluations.flatMap((item) => [
          link(
            `${item.id}-evaluates`,
            item.id,
            item.requirementId,
            "evaluates",
            "The local bounded R3 oracle classified the reviewed concept limit.",
            "evaluation",
            "requirement",
          ),
          ...item.observationIds.map((id) =>
            link(
              `${item.id}-uses-${id}`,
              item.id,
              id,
              "uses",
              "The local bounded R3 oracle used the normalized solve observation.",
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
              "The R3 static solve evidence supports the bounded evaluation.",
              "evaluation",
            )
          ),
        ]),
      ],
    }, { appliedAt: capture.capturedAt });
    if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
      throw new Error(
        "CM-01 R3 mechanical evidence did not produce exactly one successor snapshot.",
      );
    }
    return { snapshot: applied.snapshot, evidenceArtifactId: solveId };
  }
}

function stalePredecessors(
  artifacts: readonly ThreadArtifact[],
): MechanicalPredecessors {
  return {
    proof: exactlyOne(
      artifacts,
      "CM-01 stale DripTray proof",
      (item) =>
        item.kind === "document" &&
        item.name === "CM-01 V3 reviewed DripTray proof case" &&
        item.freshness.status === "stale",
    ),
    step: exactlyOne(
      artifacts,
      "CM-01 stale isolated DripTray STEP",
      (item) =>
        item.kind === "step" && item.name === "CM-01 V3 isolated DripTray STEP" &&
        item.freshness.status === "stale",
    ),
    solve: exactlyOne(
      artifacts,
      "CM-01 stale CalculiX result",
      (item) =>
        item.kind === "solver-result" &&
        item.name === "CM-01 V3 CalculiX static result" &&
        item.freshness.status === "stale",
    ),
    recovery: false,
  };
}

function historicalR2NamedPredecessors(
  base: ThreadSnapshot,
  capture: Cm01DripTrayMechanicalR3Capture,
): MechanicalPredecessors {
  const historicalPrefix =
    `coffee-machine-cm01-v3-mechanical-r2-${capture.fingerprint.digest}`;
  const proof = requiredArtifact(
    base.artifacts,
    `${historicalPrefix}-proof`,
    "document",
  );
  const step = requiredArtifact(
    base.artifacts,
    `${historicalPrefix}-isolated-step`,
    "step",
  );
  const solve = requiredArtifact(
    base.artifacts,
    `${historicalPrefix}-solve`,
    "solver-result",
  );
  if (
    step.fingerprint.digest !== capture.step.fingerprint.digest ||
    solve.fingerprint.digest !== capture.fingerprint.digest ||
    solve.producer.runId === ""
  ) {
    throw new Error(
      "The persisted historical R3 capture does not match its R10 evidence.",
    );
  }
  const requirements = new Map<string, TracedRequirement>();
  for (
    const metric of ["assembly_max_displacement", "assembly_max_von_mises"] as const
  ) {
    const found = base.requirements.filter((item) =>
      item.id.startsWith(`${historicalPrefix}-`) && item.criterion.metric === metric
    );
    if (found.length !== 1) {
      throw new Error(
        `The historical R10 evidence lacks exactly one ${metric} requirement.`,
      );
    }
    requirements.set(metric, found[0]!);
  }
  return { proof, step, solve, requirements, recovery: true };
}

function freshCorrection(artifacts: readonly ThreadArtifact[]): ThreadArtifact {
  return exactlyOne(
    artifacts,
    "CM-01 R3 correction record",
    (item) =>
      item.id === "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record" &&
      item.freshness.status === "fresh",
  );
}

function freshAssemblyStep(artifacts: readonly ThreadArtifact[]): ThreadArtifact {
  return exactlyOne(
    artifacts,
    "CM-01 R3 revised assembly STEP",
    (item) =>
      item.kind === "step" &&
      item.name === "CM-01 30 mm DripTray assembly STEP export" &&
      item.freshness.status === "fresh",
  );
}

function exactlyOne(
  artifacts: readonly ThreadArtifact[],
  label: string,
  matches: (item: ThreadArtifact) => boolean,
): ThreadArtifact {
  const found = artifacts.filter(matches);
  if (found.length !== 1) {
    throw new Error(`${label} must resolve to exactly one artifact.`);
  }
  return found[0]!;
}

function requiredArtifact(
  artifacts: readonly ThreadArtifact[],
  id: string,
  kind: ThreadArtifact["kind"],
): ThreadArtifact {
  return exactlyOne(
    artifacts,
    `historical artifact ${id}`,
    (item) => item.id === id && item.kind === kind,
  );
}

function artifactSupersedesLinks(
  successor: { proofId: string; stepId: string; solveId: string },
  predecessor: MechanicalPredecessors,
) {
  const recovery = predecessor.recovery
    ? "The correctly identified R3 evidence replaces the historically misidentified record without changing its preserved bytes."
    : "The R3 30 mm proof replaces the stale 28 mm predecessor.";
  return [
    supersedes(successor.proofId, predecessor.proof.id, recovery),
    supersedes(successor.stepId, predecessor.step.id, recovery),
    supersedes(successor.solveId, predecessor.solve.id, recovery),
  ];
}

function requirementSupersedesLinks(
  requirements: readonly TracedRequirement[],
  historical: ReadonlyMap<string, TracedRequirement>,
) {
  return requirements.map((item) => {
    const previous = historical.get(item.criterion.metric);
    if (!previous) {
      throw new Error(
        `Historical R10 requirement missing for ${item.criterion.metric}.`,
      );
    }
    return supersedes(
      item.id,
      previous.id,
      "The R3 criterion replaces a historical criterion whose retained R10 identity was mislabeled.",
      "requirement",
    );
  });
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
    version: "cm01-v3-r3",
    criterion: { metric, operator: "<=", limit: { value, unit } },
    trace: { sourceArtifactId, elementId: id, targetArtifactIds: [targetArtifactId] },
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

function supersedes(
  fromId: string,
  toId: string,
  rationale: string,
  kind: "artifact" | "requirement" = "artifact",
) {
  return {
    id: `${fromId}:supersedes:${toId}`,
    relation: "supersedes" as const,
    from: { kind, id: fromId },
    to: { kind, id: toId },
    rationale,
  };
}
