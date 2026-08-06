import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  applyCm01DripTrayHeight28To30Correction,
  CM01_DRIP_TRAY_HEIGHT_28_TO_30_CORRECTION,
  deriveCm01DripTrayHeight30Proof,
  deriveCm01DripTrayHeight30Recipe,
} from "./cm01-drip-tray-height-correction.ts";
import { parseCm01DripTrayMechanicalProof } from "./cm01-drip-tray-mechanical-proof.ts";
import { parseCoffeeMachineCm01SemanticRecipe } from "./coffee-machine-cm01-semantic-recipe.ts";
import type {
  ThreadArtifact,
  ThreadArtifactKind,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../thread-snapshot.ts";
import { validateThreadSnapshot } from "../thread-snapshot-validation.ts";
import {
  compileCm01DripTrayHeight28To30CorrectionPlan,
  prepareCm01DripTrayHeight30MechanicalQueue,
} from "../../orchestration/operations/cm01-drip-tray-height-correction.ts";
import { applyThreadSnapshotExtension } from "../thread-snapshot-extension.ts";

const AT = "2026-08-03T10:00:00.000Z";
const APPLIED_AT = "2026-08-03T10:01:00.000Z";
const RECIPE_URL = new URL(
  "../../../config/product-recipes/coffee-machine-cm01-v1.json",
  import.meta.url,
);
const RECIPE_V1 = JSON.parse(await Deno.readTextFile(RECIPE_URL)) as Record<
  string,
  unknown
>;

Deno.test("CM-01 28 mm to 30 mm correction preserves history and invalidates only CAD and mechanical descendants", async () => {
  const base = cm01Snapshot();
  const result = await applyCm01DripTrayHeight28To30Correction(base, {
    appliedAt: APPLIED_AT,
  });
  const next = result.snapshot;

  assertEquals(base.revision, 7);
  assertEquals(base.freshness.status, "fresh");
  assertEquals(next.revision, 8);
  assertEquals(next.previous, { snapshotId: base.id, revision: base.revision });
  assertEquals(next.freshness.status, "stale");
  assertEquals(validateThreadSnapshot(next), next);

  assertEquals(result.affected.artifactIds, [
    "cm01-cad-plan",
    "cm01-cad-script",
    "cm01-cad-step",
    "cm01-mechanical-proof",
    "cm01-mechanical-solve",
    "cm01-mechanical-step",
  ]);
  assertEquals(result.affected.observationIds, ["cm01-mechanical-von-mises"]);
  assertEquals(result.affected.evaluationIds, ["cm01-mechanical-evaluation"]);
  assertEquals(result.affected.violationIds, []);
  assertEquals(result.unchanged.thermalArtifactIds, ["cm01-thermal-result"]);
  assertEquals(result.unchanged.erpBomArtifactIds, ["cm01-erp-bom"]);

  for (const id of result.affected.artifactIds) {
    const artifact = next.artifacts.find((candidate) => candidate.id === id);
    assertEquals(artifact?.freshness.status, "stale");
    assertEquals(
      artifact?.freshness.invalidatedByChangeIds,
      [`${CM01_DRIP_TRAY_HEIGHT_28_TO_30_CORRECTION.id}:applied`],
    );
  }
  assertEquals(
    next.artifacts.find((artifact) => artifact.id === "cm01-thermal-result")?.freshness
      .status,
    "fresh",
  );
  assertEquals(
    next.artifacts.find((artifact) => artifact.id === "cm01-erp-bom")?.freshness.status,
    "fresh",
  );
  assertEquals(next.requirements[0]?.freshness.status, "fresh");
  assertEquals(next.observations[0]?.freshness.status, "stale");
  assertEquals(next.evaluations[0]?.freshness.status, "stale");

  assertEquals(result.cadRecomputation.operation, {
    id: "design.build-coffee-machine-cm01-cad",
    inputs: {
      operationVersion: "2",
      correctionArtifactId: result.correctionArtifactId,
      semanticComponent: "drip-tray",
      semanticParameter: "size-z",
      fromHeightMm: 28,
      toHeightMm: 30,
      unit: "mm",
      supersedesArtifactIds: ["cm01-cad-plan", "cm01-cad-script", "cm01-cad-step"],
    },
  });
  assertEquals(
    result.mechanicalRecomputation.operation?.id,
    "verify.coffee-machine-cm01-drip-tray-mechanical",
  );
  assertEquals(result.mechanicalRecomputation.operation?.inputs.operationVersion, "2");
  assertEquals(result.mechanicalRecomputation.readiness, "blocked");
  assertEquals(
    result.mechanicalRecomputation.dependsOnActionIds,
    [result.cadRecomputation.id],
  );

  const planned = compileCm01DripTrayHeight28To30CorrectionPlan(result);
  assertEquals(planned.recordCorrection.queueInput, {
    operation: {
      id: "design.correct-coffee-machine-cm01-drip-tray-height",
      version: "1",
      bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(planned.cad.queueInput, {
    operation: {
      id: "design.build-coffee-machine-cm01-cad",
      version: "2",
      bindings: [
        { name: "approvedBrief", source: { kind: "approved-brief" } },
        {
          name: "dripTrayHeightCorrection",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: next.id,
              snapshotRevision: next.revision,
              kind: "artifact",
              id: result.correctionArtifactId,
            },
          },
        },
      ],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(
    planned.mechanical.operation.id,
    "verify.coffee-machine-cm01-drip-tray-mechanical",
  );
  assertEquals(planned.mechanical.operation.version, "2");
  assertEquals(planned.mechanical.requiredCadActionId, result.cadRecomputation.id);
  assertThrows(
    () => prepareCm01DripTrayHeight30MechanicalQueue(planned, next, "cm01-cad-step"),
    Error,
    "later snapshot",
  );

  assertEquals(
    next.provenance.filter((link) => link.relation === "supersedes").map((link) =>
      link.to.id
    ).sort(),
    ["cm01-cad-plan", "cm01-mechanical-proof", "cm01-mechanical-step"],
  );
  assertEquals(
    next.artifacts.find((artifact) => artifact.id === "cm01-architecture")?.freshness
      .status,
    "fresh",
  );
  assertEquals(
    next.artifacts.find((artifact) => artifact.id === result.correctionArtifactId)
      ?.inputArtifactIds,
    ["cm01-architecture"],
  );
  assertEquals(
    next.consumptions.find((consumption) =>
      consumption.id ===
        `${CM01_DRIP_TRAY_HEIGHT_28_TO_30_CORRECTION.id}:consume-architecture`
    )?.artifactId,
    "cm01-architecture",
  );

  const actionTargets = new Set(
    next.proposedActions.flatMap((action) => action.targets.map((target) => target.id)),
  );
  assertEquals(actionTargets.has("cm01-thermal-result"), false);
  assertEquals(actionTargets.has("cm01-erp-bom"), false);
});

Deno.test("CM-01 correction refuses a repeated correction and a missing non-impact branch", async () => {
  const corrected = await applyCm01DripTrayHeight28To30Correction(cm01Snapshot(), {
    appliedAt: APPLIED_AT,
  });
  await assertRejects(
    () =>
      applyCm01DripTrayHeight28To30Correction(corrected.snapshot, {
        appliedAt: "2026-08-03T10:02:00.000Z",
      }),
    Error,
    "already recorded",
  );

  const base = cm01Snapshot();
  const missingErp = {
    ...base,
    artifacts: base.artifacts.filter((artifact) => artifact.id !== "cm01-erp-bom"),
  };
  await assertRejects(
    () =>
      applyCm01DripTrayHeight28To30Correction(missingErp, {
        appliedAt: APPLIED_AT,
      }),
    Error,
    "existing thermal and ERP branches",
  );
});

Deno.test("CM-01 correction queues mechanical R2 only from a traced fresh CAD successor", async () => {
  const correction = await applyCm01DripTrayHeight28To30Correction(cm01Snapshot(), {
    appliedAt: APPLIED_AT,
  });
  const plan = compileCm01DripTrayHeight28To30CorrectionPlan(correction);
  const revisedCadStepId = "cm01-cad-r2-step";
  const cadSuccessor = applyThreadSnapshotExtension(correction.snapshot, {
    id: "cm01-cad-r2-fixture-extension",
    name: "Capture CM-01 30 mm CAD successor fixture",
    subjectId: correction.snapshot.subject.id,
    capturedAt: "2026-08-03T10:02:00.000Z",
    artifacts: [{
      ...artifact(
        revisedCadStepId,
        "step",
        operation("build123d", "build123d_export", "cad-r2"),
        "a",
      ),
      name: "CM-01 30 mm DripTray assembly STEP export",
      freshness: {
        status: "fresh",
        changedAt: "2026-08-03T10:02:00.000Z",
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [{
      id: "cm01-cad-r2-step-supersedes-v1",
      relation: "supersedes",
      from: { kind: "artifact", id: revisedCadStepId },
      to: { kind: "artifact", id: "cm01-cad-step" },
      rationale: "Fixture replacement CAD STEP supersedes the stale V1 STEP.",
    }],
  });

  const queued = prepareCm01DripTrayHeight30MechanicalQueue(
    plan,
    cadSuccessor,
    revisedCadStepId,
  );

  assertEquals(queued.action.id, plan.mechanical.action.id);
  assertEquals(
    queued.correctionArtifact.snapshotRevision,
    cadSuccessor.revision,
  );
  assertEquals(queued.revisedCadStep, {
    snapshotId: cadSuccessor.id,
    snapshotRevision: cadSuccessor.revision,
    kind: "artifact",
    id: revisedCadStepId,
  });
  assertEquals(queued.queueInput.operation, {
    id: "verify.coffee-machine-cm01-drip-tray-mechanical",
    version: "2",
    bindings: [
      { name: "approvedBrief", source: { kind: "approved-brief" } },
      {
        name: "dripTrayHeightCorrection",
        source: {
          kind: "thread-entity",
          reference: {
            snapshotId: cadSuccessor.id,
            snapshotRevision: cadSuccessor.revision,
            kind: "artifact",
            id: correction.correctionArtifactId,
          },
        },
      },
      {
        name: "revisedCadStep",
        source: {
          kind: "thread-entity",
          reference: {
            snapshotId: cadSuccessor.id,
            snapshotRevision: cadSuccessor.revision,
            kind: "artifact",
            id: revisedCadStepId,
          },
        },
      },
    ],
  });
});

Deno.test("CM-01 correction derives only strict R2 recipe and proof inputs", () => {
  const recipe = deriveCm01DripTrayHeight30Recipe(
    parseCoffeeMachineCm01SemanticRecipe(RECIPE_V1),
  );
  assertEquals(recipe.schemaVersion, "coffee-machine-semantic-recipe/2.0");
  assertEquals(recipe.recipeKey, "cm01-drip-tray-height-30");
  assertEquals(recipe.components[9]?.dimensions[2]?.value, 30);

  const proof = deriveCm01DripTrayHeight30Proof(
    parseCm01DripTrayMechanicalProof(proofV1()),
  );
  assertEquals(proof.schemaVersion, "cm01-v3-drip-tray-static-proof/2.0");
  assertEquals(proof.geometry.heightMm, 30);
});

function cm01Snapshot(): ThreadSnapshot {
  const architecture = operation(
    "syson",
    "syson_element_insert_sysml",
    "architecture-r1",
  );
  const cadCompiler = operation(
    "digital-thread",
    "compile_coffee_machine_cm01_semantic_cad_plan",
    "cad-r1",
  );
  const cadBuild = operation("build123d", "build123d_export", "cad-r1");
  const mechanicalBuild = operation("build123d", "build123d_export", "mechanical-r1");
  const calculix = operation("calculix", "calculix_solve_static", "mechanical-r1");
  const modelica = operation("modelica", "modelica_simulate", "thermal-r1");
  const erp = operation("erpnext", "erpnext_bom_get", "bom-r1");
  const proof = operation(
    "digital-thread",
    "evaluate_cm01_drip_tray_limits",
    "mechanical-r1",
  );

  const architectureArtifact = artifact(
    "cm01-architecture",
    "sysml-model",
    architecture,
    "1",
  );
  const cadPlan = artifact("cm01-cad-plan", "document", cadCompiler, "2", [
    architectureArtifact.id,
  ]);
  const cadScript = artifact("cm01-cad-script", "script", cadCompiler, "3", [
    cadPlan.id,
  ]);
  const cadStep = artifact("cm01-cad-step", "step", cadBuild, "4", [cadScript.id]);
  const thermal = artifact("cm01-thermal-result", "solver-result", modelica, "5");
  const bom = artifact("cm01-erp-bom", "bom", erp, "6");
  const proofArtifact = artifact("cm01-mechanical-proof", "document", proof, "7");
  const mechanicalStep = artifact("cm01-mechanical-step", "step", mechanicalBuild, "8");
  const mechanicalSolve = artifact(
    "cm01-mechanical-solve",
    "solver-result",
    calculix,
    "9",
    [mechanicalStep.id],
  );
  const consumption = (
    id: string,
    source: ThreadArtifact,
    consumer: ThreadOperationRef,
  ) => ({
    id,
    artifactId: source.id,
    consumer,
    observedFingerprint: source.fingerprint,
    verifiedAt: AT,
    status: "verified" as const,
  });
  const consumptions = [
    consumption("consume-architecture", architectureArtifact, cadCompiler),
    consumption("consume-cad-plan", cadPlan, cadCompiler),
    consumption("consume-cad-script", cadScript, cadBuild),
    consumption("consume-mechanical-step", mechanicalStep, calculix),
  ];
  const derived = (id: string, from: string, to: string) =>
    link(
      id,
      "derived_from",
      "artifact",
      from,
      "artifact",
      to,
    );
  const uses = (id: string, from: string, to: string) =>
    link(
      id,
      "uses",
      "consumption",
      from,
      "artifact",
      to,
    );

  return {
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r7:fixture",
    revision: 7,
    previous: { snapshotId: "project:coffee-machine-cm01-v3:r6:fixture", revision: 6 },
    generatedAt: AT,
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      kind: "system",
      version: "7",
      modelArtifactId: architectureArtifact.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "cm01-r7",
      name: "CM-01 golden path",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts: [
      architectureArtifact,
      cadPlan,
      cadScript,
      cadStep,
      thermal,
      bom,
      proofArtifact,
      mechanicalStep,
      mechanicalSolve,
    ],
    consumptions,
    observations: [{
      id: "cm01-mechanical-von-mises",
      name: "CM-01 DripTray maximum von Mises stress",
      metric: "drip_tray_von_mises_max",
      quantity: { value: 0.53, unit: "MPa" },
      source: {
        operation: calculix,
        artifactIds: [mechanicalSolve.id],
        capturedAt: AT,
      },
      freshness: fresh(),
    }],
    requirements: [{
      id: "cm01-drip-tray-von-mises",
      name: "CM-01 DripTray stress limit",
      statement: "DripTray von Mises stress shall remain at or below 20 MPa.",
      version: "1",
      criterion: {
        metric: "drip_tray_von_mises_max",
        operator: "<=",
        limit: { value: 20, unit: "MPa" },
      },
      trace: {
        sourceArtifactId: proofArtifact.id,
        elementId: "drip-tray-von-mises",
        targetArtifactIds: [mechanicalStep.id],
      },
      freshness: fresh(),
    }],
    evaluations: [{
      id: "cm01-mechanical-evaluation",
      name: "Evaluate CM-01 DripTray stress",
      requirementId: "cm01-drip-tray-von-mises",
      observationIds: ["cm01-mechanical-von-mises"],
      status: "pass",
      evaluatedAt: AT,
      evaluator: proof,
      comparison: {
        observationId: "cm01-mechanical-von-mises",
        actual: { value: 0.53, unit: "MPa" },
        operator: "<=",
        limit: { value: 20, unit: "MPa" },
        normalizedUnit: "MPa",
        margin: { value: 19.47, unit: "MPa" },
      },
      evidenceArtifactIds: [mechanicalSolve.id],
      message: "The bounded DripTray stress is below the reviewed limit.",
      freshness: fresh(),
    }],
    violations: [],
    provenance: [
      uses("architecture-used", "consume-architecture", architectureArtifact.id),
      derived("cad-plan-from-architecture", cadPlan.id, architectureArtifact.id),
      uses("cad-plan-used", "consume-cad-plan", cadPlan.id),
      derived("cad-script-from-plan", cadScript.id, cadPlan.id),
      uses("cad-script-used", "consume-cad-script", cadScript.id),
      derived("cad-step-from-script", cadStep.id, cadScript.id),
      uses("mechanical-step-used", "consume-mechanical-step", mechanicalStep.id),
      derived("mechanical-solve-from-step", mechanicalSolve.id, mechanicalStep.id),
      link(
        "mechanical-observation-from-solve",
        "derived_from",
        "observation",
        "cm01-mechanical-von-mises",
        "artifact",
        mechanicalSolve.id,
      ),
      link(
        "mechanical-requirement-traces-step",
        "traces_to",
        "requirement",
        "cm01-drip-tray-von-mises",
        "artifact",
        mechanicalStep.id,
      ),
      link(
        "mechanical-evaluation-evaluates-requirement",
        "evaluates",
        "evaluation",
        "cm01-mechanical-evaluation",
        "requirement",
        "cm01-drip-tray-von-mises",
      ),
      link(
        "mechanical-evaluation-uses-observation",
        "uses",
        "evaluation",
        "cm01-mechanical-evaluation",
        "observation",
        "cm01-mechanical-von-mises",
      ),
      link(
        "mechanical-evaluation-evidences-solve",
        "evidences",
        "evaluation",
        "cm01-mechanical-evaluation",
        "artifact",
        mechanicalSolve.id,
      ),
    ],
    proposedActions: [],
  };
}

function artifact(
  id: string,
  kind: ThreadArtifactKind,
  producer: ThreadOperationRef,
  digit: string,
  inputArtifactIds: string[] = [],
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: "1",
    fingerprint: { algorithm: "sha256", digest: digit.repeat(64) },
    producer,
    inputArtifactIds,
    freshness: fresh(),
  };
}

function operation(serverId: string, tool: string, runId: string): ThreadOperationRef {
  return { serverId, tool, runId };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function link(
  id: string,
  relation:
    | "derived_from"
    | "traces_to"
    | "uses"
    | "evaluates"
    | "evidences",
  fromKind: "artifact" | "consumption" | "observation" | "requirement" | "evaluation",
  fromId: string,
  toKind: "artifact" | "observation" | "requirement",
  toId: string,
) {
  return {
    id,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale: "Fixture provenance.",
  } as const;
}

function proofV1(): Record<string, unknown> {
  return {
    schemaVersion: "cm01-v3-drip-tray-static-proof/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-static-proof",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    evidenceBoundary: "Fixture only.",
    geometry: { widthMm: 190, depthMm: 135, heightMm: 28 },
    material: { eMpa: 2200, nu: 0.35 },
    meshSizeMm: 5,
    fixed: { name: "FIXED", box: { min: [-95, -67.5, -14], max: [-90, 67.5, 14] } },
    loaded: {
      name: "LOADED",
      box: { min: [90, -67.5, -14], max: [95, 67.5, 14] },
      forceN: [0, 0, -100],
    },
    limits: { maximumDisplacementMm: 1, maximumVonMisesMpa: 20 },
  };
}
