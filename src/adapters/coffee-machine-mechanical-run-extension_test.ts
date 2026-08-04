import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import { validateThreadSnapshot } from "../domain/thread-snapshot-validation.ts";
import { applyThreadSnapshotExtension } from "../domain/thread-snapshot-extension.ts";
import {
  COFFEE_MACHINE_MECHANICAL_CAPTURE_SCHEMA,
  materializeCoffeeMachineMechanicalRunExtension,
} from "./coffee-machine-mechanical-run-extension.ts";

const BASELINE = new URL(
  "../../config/projects/baselines/coffee-machine-cm01.r5.thread-snapshot.json",
  import.meta.url,
);
const RUN_ID = "run:mechanical-materializer-test";
const STEP_SHA = "a".repeat(64);

Deno.test("successful mechanical capture becomes a complete validated thread branch", async () => {
  const value = await capture();
  const extension = await materializeCoffeeMachineMechanicalRunExtension(value, {
    runId: RUN_ID,
    sourceUri: "state/local/coffee-machine-mechanical-runs/run.json",
  });
  const base = validateThreadSnapshot(JSON.parse(await Deno.readTextFile(BASELINE)));
  const snapshot = applyThreadSnapshotExtension(base, extension);

  assertEquals(extension.artifacts.length, 5);
  assertEquals(extension.artifacts.map((item) => item.kind), [
    "document",
    "sysml-model",
    "step",
    "solver-result",
    "evidence",
  ]);
  assertEquals(extension.consumptions.length, 1);
  assertEquals(extension.consumptions[0].status, "verified");
  assertEquals(extension.consumptions[0].observedFingerprint.digest, STEP_SHA);
  assertEquals(extension.capturedAt, value.workflow.completedAt);
  assertEquals(snapshot.generatedAt, value.workflow.completedAt);
  assertEquals(
    value.workflow.nodes.every((node) =>
      Date.parse(node.completedAt) <= Date.parse(snapshot.generatedAt)
    ),
    true,
  );
  assertEquals(extension.observations.map((item) => item.quantity), [
    { value: 0.2, unit: "mm" },
    { value: 4, unit: "MPa" },
  ]);
  assertEquals(extension.requirements.map((item) => item.criterion.limit), [
    { value: 1, unit: "mm" },
    { value: 20_000_000, unit: "Pa" },
  ]);
  assertEquals(extension.evaluations.map((item) => item.status), ["pass", "pass"]);
  assertEquals(extension.violations, []);
  assertEquals(extension.proposedActions, []);
  assertEquals(
    extension.artifacts.every((item) =>
      item.uri?.startsWith("state/local/coffee-machine-mechanical-runs/run.json#") ||
      item.kind === "step"
    ),
    true,
  );
  assertEquals(snapshot.revision, base.revision + 1);
  assertEquals(snapshot.requirements.length, base.requirements.length + 2);
  assertEquals(snapshot.evaluations.length, base.evaluations.length + 2);
});

Deno.test("materializer binds the proof to the canonical CM-01 SysON target", async () => {
  for (const field of ["editingContextId", "requirementsElementId"] as const) {
    const drift = await capture();
    drift.sysml[field] = "11111111-1111-4111-8111-111111111111";
    await assertRejects(
      () => materializeCoffeeMachineMechanicalRunExtension(drift, { runId: RUN_ID }),
      Error,
      `$capture.sysml.${field} must equal`,
    );
  }
});

Deno.test("mechanical publication time covers every captured workflow event", async () => {
  const lateNode = await persistedCapture();
  lateNode.workflow.nodes[3].completedAt = "2026-08-02T06:00:05.000Z";
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(lateNode, {
        runId: RUN_ID,
      }),
    Error,
    "workflow.completedAt must not precede captured evaluation evidence",
  );

  const reversedEnvelope = await persistedCapture();
  reversedEnvelope.workflow.startedAt = "2026-08-02T06:00:05.000Z";
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(reversedEnvelope, {
        runId: RUN_ID,
      }),
    Error,
    "workflow.completedAt must not precede workflow start",
  );
});

Deno.test("mechanical workflow rejects every reversed causal edge", async () => {
  const mutations = [
    {
      successor: 1,
      startedAt: "2026-08-02T06:00:00.999Z",
      message:
        "workflow.nodes.mechanical.startedAt must not precede $capture.workflow.nodes.requirements.completedAt",
    },
    {
      successor: 2,
      startedAt: "2026-08-02T06:00:01.999Z",
      message:
        "workflow.nodes.observations.startedAt must not precede $capture.workflow.nodes.mechanical.completedAt",
    },
    {
      successor: 3,
      startedAt: "2026-08-02T06:00:02.999Z",
      message:
        "workflow.nodes.evaluation.startedAt must not precede $capture.workflow.nodes.observations.completedAt",
    },
  ] as const;

  for (const mutation of mutations) {
    const value = await persistedCapture();
    value.workflow.nodes[mutation.successor].startedAt = mutation.startedAt;
    await assertRejects(
      () => materializeCoffeeMachineMechanicalRunExtension(value, { runId: RUN_ID }),
      Error,
      mutation.message,
    );
  }
});

Deno.test("failed SysON result produces one named violation and one ready correction", async () => {
  const extension = await materializeCoffeeMachineMechanicalRunExtension(
    await capture("fail"),
    { runId: RUN_ID },
  );
  const base = validateThreadSnapshot(JSON.parse(await Deno.readTextFile(BASELINE)));
  applyThreadSnapshotExtension(base, extension);

  assertEquals(extension.evaluations.map((item) => item.status), ["pass", "fail"]);
  assertEquals(extension.violations.length, 1);
  assertEquals(extension.violations[0].name.includes("stress"), true);
  assertEquals(extension.violations[0].status, "open");
  assertEquals(extension.proposedActions.length, 1);
  assertEquals(extension.proposedActions[0].readiness, "ready");
  assertEquals(extension.proposedActions[0].addressesViolationIds, [
    extension.violations[0].id,
  ]);
});

Deno.test("materializer rejects failed workflow, empty constraints and extraction errors", async () => {
  const failed = await capture();
  failed.workflow.status = "failed";
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(failed, { runId: RUN_ID }),
    Error,
    "must equal succeeded",
  );

  const empty = await capture();
  empty.sysml.constraints = [];
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(empty, { runId: RUN_ID }),
    Error,
    "exactly two constraints",
  );

  const errors = await capture();
  errors.workflow.nodes[0].structuredContent.errors = [{
    id: "broken",
    name: "Broken constraint",
    error: "No body expression found",
  }];
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(errors, { runId: RUN_ID }),
    Error,
    "contains errors",
  );
});

Deno.test("materializer rejects missing or duplicate SysON result identities", async () => {
  const missing = await capture();
  const results = missing.workflow.nodes[3].structuredContent.results as unknown[];
  missing.workflow.nodes[3].structuredContent.results = [results[0]];
  missing.workflow.nodes[3].outputs.results = [results[0]];
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(missing, { runId: RUN_ID }),
    Error,
    "exactly one result per constraint",
  );

  const duplicate = await capture();
  const first = (duplicate.workflow.nodes[3].structuredContent.results as unknown[])[0];
  duplicate.workflow.nodes[3].structuredContent.results = [first, first];
  duplicate.workflow.nodes[3].outputs.results = [first, first];
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(duplicate, { runId: RUN_ID }),
    Error,
    "duplicates a constraint result",
  );
});

Deno.test("materializer rejects STEP substitution and effective argument drift", async () => {
  const mismatch = await capture();
  const inputArtifact = mismatch.workflow.nodes[1].structuredContent.inputArtifact as {
    sha256: string;
  };
  inputArtifact.sha256 = "b".repeat(64);
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(mismatch, { runId: RUN_ID }),
    Error,
    "one exact STEP fingerprint",
  );

  const drift = await capture();
  const loads = drift.workflow.nodes[1].arguments.loads as Array<{
    force_n: number[];
  }>;
  loads[0].force_n[2] = -200;
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(drift, { runId: RUN_ID }),
    Error,
    "mechanical arguments does not match",
  );
});

Deno.test("materializer rejects solver constraint or force drift", async () => {
  const fixed = await capture();
  const fixedConstraints = fixed.workflow.nodes[1].structuredContent.constraints as {
    fixedSelections: string[];
    loads: Array<{ selection: string; forceN: number[] }>;
  };
  fixedConstraints.fixedSelections = ["LOADED"];
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(fixed, { runId: RUN_ID }),
    Error,
    "mechanical fixed selections does not match",
  );

  const force = await capture();
  const forceConstraints = force.workflow.nodes[1].structuredContent.constraints as {
    fixedSelections: string[];
    loads: Array<{ selection: string; forceN: number[] }>;
  };
  forceConstraints.loads[0].forceN[2] = -200;
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(force, { runId: RUN_ID }),
    Error,
    "mechanical loads does not match",
  );
});

Deno.test("materializer requires the stable CalculiX static-solve contract", async () => {
  const schema = await capture();
  schema.workflow.nodes[1].structuredContent.schemaVersion = "1.0";
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(schema, { runId: RUN_ID }),
    Error,
    "mechanical.schemaVersion must equal 2.0",
  );

  const kind = await capture();
  kind.workflow.nodes[1].structuredContent.kind = "modal-solve";
  await assertRejects(
    () => materializeCoffeeMachineMechanicalRunExtension(kind, { runId: RUN_ID }),
    Error,
    "mechanical.kind must equal static-solve",
  );
});

Deno.test("materializer rejects normalization detached from CalculiX metrics", async () => {
  const changedValue = await persistedCapture();
  changedValue.workflow.nodes[2].structuredContent.values
    .assembly_max_von_mises.value = 5;
  changedValue.workflow.nodes[2].outputs.values = structuredClone(
    changedValue.workflow.nodes[2].structuredContent.values,
  );
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(changedValue, {
        runId: RUN_ID,
      }),
    Error,
    "normalized values derived from CalculiX",
  );

  const changedUnit = await persistedCapture();
  changedUnit.workflow.nodes[2].structuredContent.values
    .assembly_max_von_mises = { value: 4_000_000, unit: "Pa" };
  changedUnit.workflow.nodes[2].outputs.values = structuredClone(
    changedUnit.workflow.nodes[2].structuredContent.values,
  );
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(changedUnit, {
        runId: RUN_ID,
      }),
    Error,
    "normalized values derived from CalculiX",
  );
});

Deno.test("materializer rejects physically impossible negative CalculiX maxima", async () => {
  const negativeDisplacement = await persistedCapture();
  mutatePhysicalMetric(negativeDisplacement, {
    feature: "assembly_max_displacement",
    mechanicalMetric: "maxDisplacement",
    mechanicalOutput: "max_displacement",
    resultIndex: 0,
    solverValue: -0.2,
    solverUnit: "mm",
    targetUnit: "mm",
    computedValue: -0.2,
    threshold: 1,
  });
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(negativeDisplacement, {
        runId: RUN_ID,
      }),
    Error,
    "mechanical.metrics.maxDisplacement.value must not be negative",
  );

  const negativeStress = await persistedCapture();
  mutatePhysicalMetric(negativeStress, {
    feature: "assembly_max_von_mises",
    mechanicalMetric: "maxVonMises",
    mechanicalOutput: "max_von_mises",
    resultIndex: 1,
    solverValue: -0.5,
    solverUnit: "MPa",
    targetUnit: "Pa",
    computedValue: -500_000,
    threshold: 20_000_000,
  });
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(negativeStress, {
        runId: RUN_ID,
      }),
    Error,
    "mechanical.metrics.maxVonMises.value must not be negative",
  );
});

Deno.test("materializer recomputes conversion, verdict and every reported margin", async () => {
  const conversion = await persistedCapture();
  mutateResult(conversion, 1, (result) => {
    result.computedValue = 4;
  });
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(conversion, {
        runId: RUN_ID,
      }),
    Error,
    "computedValue does not match the recomputed value 4000000",
  );

  const status = await persistedCapture();
  mutateResult(status, 1, (result) => {
    result.status = "fail";
  });
  status.workflow.nodes[3].structuredContent.summary = {
    total: 2,
    pass: 1,
    fail: 1,
    error: 0,
    unresolved: 0,
  };
  status.workflow.nodes[3].outputs.summary = structuredClone(
    status.workflow.nodes[3].structuredContent.summary,
  );
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(status, {
        runId: RUN_ID,
      }),
    Error,
    "status does not match the recomputed assembly_max_von_mises verdict",
  );

  const margin = await persistedCapture();
  mutateResult(margin, 1, (result) => {
    result.margin = 15_999_999;
  });
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(margin, {
        runId: RUN_ID,
      }),
    Error,
    "margin does not match the recomputed value 16000000",
  );

  const marginPercent = await persistedCapture();
  mutateResult(marginPercent, 1, (result) => {
    result.marginPercent = 79.99;
  });
  await assertRejects(
    () =>
      materializeCoffeeMachineMechanicalRunExtension(marginPercent, {
        runId: RUN_ID,
      }),
    Error,
    "marginPercent does not match the recomputed value 80",
  );
});

Deno.test(
  "oracle unresolved status reaches the published evaluation without exception",
  async () => {
    const value = await persistedCapture();
    mutateResult(value, 1, (result) => {
      result.status = "unresolved";
      result.unresolvedRefs = ["assembly_max_von_mises"];
      delete result.computedValue;
      delete result.threshold;
      delete result.margin;
      delete result.marginPercent;
      delete result.unit;
    });
    value.workflow.nodes[3].structuredContent.summary = {
      total: 2,
      pass: 1,
      fail: 0,
      error: 0,
      unresolved: 1,
    };
    value.workflow.nodes[3].outputs.summary = structuredClone(
      value.workflow.nodes[3].structuredContent.summary,
    );
    const extension = await materializeCoffeeMachineMechanicalRunExtension(value, {
      runId: RUN_ID,
    });
    assertEquals(extension.evaluations.map((item) => item.status), [
      "pass",
      "unresolved",
    ]);
    assertEquals(
      extension.evaluations.find((item) => item.status === "unresolved")?.comparison,
      undefined,
    );
    assertEquals(extension.violations, []);
    assertEquals(extension.proposedActions, []);
  },
);

Deno.test(
  "oracle error status reaches the published evaluation without exception",
  async () => {
    const value = await persistedCapture();
    mutateResult(value, 1, (result) => {
      result.status = "error";
      result.error = "SysON evaluation service unavailable";
      delete result.computedValue;
      delete result.threshold;
      delete result.margin;
      delete result.marginPercent;
      delete result.unit;
    });
    value.workflow.nodes[3].structuredContent.summary = {
      total: 2,
      pass: 1,
      fail: 0,
      error: 1,
      unresolved: 0,
    };
    value.workflow.nodes[3].outputs.summary = structuredClone(
      value.workflow.nodes[3].structuredContent.summary,
    );
    const extension = await materializeCoffeeMachineMechanicalRunExtension(value, {
      runId: RUN_ID,
    });
    assertEquals(extension.evaluations.map((item) => item.status), ["pass", "error"]);
    assertEquals(
      extension.evaluations.find((item) => item.status === "error")?.comparison,
      undefined,
    );
    assertEquals(extension.violations, []);
  },
);

async function persistedCapture(stressStatus: "pass" | "fail" = "pass") {
  return JSON.parse(JSON.stringify(await capture(stressStatus)));
}

function mutateResult(
  value: Awaited<ReturnType<typeof persistedCapture>>,
  index: number,
  mutate: (result: Record<string, unknown>) => void,
): void {
  const result = value.workflow.nodes[3].structuredContent.results[index] as Record<
    string,
    unknown
  >;
  mutate(result);
  value.workflow.nodes[3].outputs.results = structuredClone(
    value.workflow.nodes[3].structuredContent.results,
  );
}

function mutatePhysicalMetric(
  value: Awaited<ReturnType<typeof persistedCapture>>,
  input: {
    feature: "assembly_max_displacement" | "assembly_max_von_mises";
    mechanicalMetric: "maxDisplacement" | "maxVonMises";
    mechanicalOutput: "max_displacement" | "max_von_mises";
    resultIndex: number;
    solverValue: number;
    solverUnit: string;
    targetUnit: string;
    computedValue: number;
    threshold: number;
  },
): void {
  const metric = {
    ...value.workflow.nodes[1].structuredContent.metrics[input.mechanicalMetric],
    value: input.solverValue,
    unit: input.solverUnit,
  };
  const quantity = { value: input.solverValue, unit: input.solverUnit };
  value.workflow.nodes[1].structuredContent.metrics[input.mechanicalMetric] = metric;
  value.workflow.nodes[1].outputs[input.mechanicalOutput] = structuredClone(metric);
  value.workflow.nodes[2].arguments.observations[input.feature].quantity =
    structuredClone(
      metric,
    );
  value.workflow.nodes[2].structuredContent.values[input.feature] = structuredClone(
    quantity,
  );
  value.workflow.nodes[2].outputs.values[input.feature] = structuredClone(quantity);
  value.workflow.nodes[3].arguments.values[input.feature] = structuredClone(quantity);
  value.workflow.nodes[3].structuredContent.resolvedValues[input.feature] =
    structuredClone(
      quantity,
    );
  value.workflow.nodes[3].outputs.resolved_values[input.feature] = structuredClone(
    quantity,
  );
  const margin = input.threshold - input.computedValue;
  mutateResult(value, input.resultIndex, (result) => {
    Object.assign(result, {
      status: "pass",
      computedValue: input.computedValue,
      threshold: input.threshold,
      margin,
      marginPercent: Math.round((margin / input.threshold) * 10_000) / 100,
      unit: input.targetUnit,
    });
  });
}

async function capture(stressStatus: "pass" | "fail" = "pass") {
  const at = "2026-08-02T06:00:00.000Z";
  const baseSnapshot = {
    snapshotId:
      "coffee-machine-cm01:r5:coffee-machine-build-coffee-machine-cm01-cad-baseline-extension",
    revision: 5,
    subjectId: "coffee-machine-cm01",
  };
  const proposal = {
    summary: "One bounded component proof.",
    parameters: proposalParameters(),
  };
  const inputEvidenceRefs = [{
    snapshotId: baseSnapshot.snapshotId,
    snapshotRevision: 5,
    kind: "artifact",
    id: "coffee-machine-build-coffee-machine-cm01-cad-baseline-step",
  }];
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot,
    inputEvidenceRefs,
    proposal,
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: "verify-current-mechanical-design",
    baseSnapshot,
    decisionBindings: [{
      id: "review-mechanical-proof-case",
      inputFingerprint: decisionFingerprint,
    }],
  });
  const proofCase = {
    analysisScope: "CM-01 drip tray; isolated current CAD component, 190 x 135 x 28 mm",
    dimensionsMm: [190, 135, 28],
    materialBasis: "ABS-like concept model",
    youngModulusMpa: 2200,
    poissonRatio: 0.35,
    fixedRegion: "rear-vertical-face",
    loadCase:
      "100 N total downward force on the front vertical face (about 10 kg static load)",
    loadForceN: [0, 0, -100],
    meshSizeMm: 5,
    maxVonMisesMpa: 20,
    maxDisplacementMm: 1,
    evidenceBoundary: "Concept verification only",
  };
  const constraints = [
    constraint("constraint-displacement", "assembly_max_displacement", 1, "mm"),
    constraint("constraint-stress", "assembly_max_von_mises", 20_000_000, "Pa"),
  ];
  const script = "from build123d import Align, Box\n\n" +
    "result = Box(190, 135, 28, align=(Align.CENTER, Align.CENTER, Align.CENTER))";
  const mechanicalArguments = {
    step_path: "/exports/cm01-drip-tray.step",
    expected_step_sha256: STEP_SHA,
    mesh_size_mm: 5,
    material: { e_mpa: 2200, nu: 0.35 },
    selections: [
      { name: "FIXED", box: { min: [-96, 66.5, -15], max: [96, 68.5, 15] } },
      { name: "LOADED", box: { min: [-96, -68.5, -15], max: [96, -66.5, 15] } },
    ],
    fixed: ["FIXED"],
    loads: [{ selection: "LOADED", force_n: [0, 0, -100] }],
  };
  const displacement = { value: 0.2, unit: "mm" };
  const stress = { value: stressStatus === "pass" ? 4 : 25, unit: "MPa" };
  const mechanicalContent = {
    schemaVersion: "2.0",
    kind: "static-solve",
    constraints: {
      fixedSelections: ["FIXED"],
      loads: [{ selection: "LOADED", forceN: [0, 0, -100] }],
    },
    inputArtifact: {
      path: "/runs/cm01/input.step",
      sourcePath: "/exports/cm01-drip-tray.step",
      sha256: STEP_SHA,
      bytes: 1024,
    },
    metrics: { maxDisplacement: displacement, maxVonMises: stress },
  };
  const normalizeArguments = {
    observations: {
      assembly_max_displacement: {
        quantity: displacement,
        produced_by: "mechanical",
      },
      assembly_max_von_mises: {
        quantity: stress,
        produced_by: "mechanical",
      },
    },
    artifact_attestations: [{
      producer_sha256: STEP_SHA,
      consumer_sha256: STEP_SHA,
      relation: "consumed_exact_artifact",
    }],
  };
  const values = {
    assembly_max_displacement: displacement,
    assembly_max_von_mises: stress,
  };
  const normalization = {
    values,
    provenance: {
      observations: {
        assembly_max_displacement: { producedBy: "mechanical" },
        assembly_max_von_mises: { producedBy: "mechanical" },
      },
      artifactAttestations: [{
        relation: "consumed_exact_artifact",
        producerSha256: STEP_SHA,
        consumerSha256: STEP_SHA,
        status: "verified",
      }],
    },
  };
  const results = [
    {
      constraintId: "constraint-displacement",
      constraintName: "constraint-displacement",
      status: "pass",
      expression: "assembly_max_displacement <= 1 [mm]",
      computedValue: 0.2,
      threshold: 1,
      margin: 0.8,
      marginPercent: 80,
      unit: "mm",
    },
    {
      constraintId: "constraint-stress",
      constraintName: "constraint-stress",
      status: stressStatus,
      expression: "assembly_max_von_mises <= 20000000 [Pa]",
      computedValue: stressStatus === "pass" ? 4_000_000 : 25_000_000,
      threshold: 20_000_000,
      margin: stressStatus === "pass" ? 16_000_000 : -5_000_000,
      marginPercent: stressStatus === "pass" ? 80 : -25,
      unit: "Pa",
    },
  ];
  const summary = {
    total: 2,
    pass: stressStatus === "pass" ? 2 : 1,
    fail: stressStatus === "fail" ? 1 : 0,
    error: 0,
    unresolved: 0,
  };
  return {
    schemaVersion: COFFEE_MACHINE_MECHANICAL_CAPTURE_SCHEMA,
    capturedAt: at,
    runId: RUN_ID,
    subjectId: "coffee-machine-cm01",
    project: {
      id: "coffee-machine-cm01",
      snapshotId: "coffee-machine-cm01:project:r7:test",
      revision: 7,
    },
    authorization: {
      decisionId: "review-mechanical-proof-case",
      decisionInputFingerprint: decisionFingerprint.digest,
      approvedBy: "erwan",
      approvedProposal: proposal,
      inputEvidenceRefs,
      runInputFingerprint: runFingerprint.digest,
      queuedBy: "erwan",
      claimedBy: "mcp:casys-digital-thread-orchestrator@0.1.0",
      baseSnapshotId: baseSnapshot.snapshotId,
      baseSnapshotRevision: baseSnapshot.revision,
      baseSnapshotSubjectId: baseSnapshot.subjectId,
    },
    proofCase,
    sysml: {
      editingContextId: "01942665-3ded-4d3a-9902-08691eae190e",
      requirementsElementId: "09e35cdc-5bca-4234-a765-5640b313e93f",
      inserted: true,
      constraints,
    },
    cad: {
      script,
      toolCall: {
        name: "build123d_export",
        arguments: {
          script,
          formats: ["step"],
          name: `cm01-drip-tray-${decisionFingerprint.digest.slice(0, 16)}`,
          timeout_ms: 120000,
        },
      },
      artifact: {
        format: "step",
        path: "/exports/cm01-drip-tray.step",
        bytes: 1024,
        sha256: STEP_SHA,
      },
    },
    workflow: {
      workflowId: "coffee-machine-mechanical-v1",
      status: "succeeded",
      startedAt: at,
      completedAt: "2026-08-02T06:00:04.000Z",
      nodes: [
        node(
          "requirements",
          "syson",
          "syson_constraint_extract",
          {
            editing_context_id: "01942665-3ded-4d3a-9902-08691eae190e",
            element_id: "09e35cdc-5bca-4234-a765-5640b313e93f",
          },
          { constraints },
          { constraints },
        ),
        node(
          "mechanical",
          "calculix",
          "calculix_solve_static",
          mechanicalArguments,
          {
            input_step_sha256: STEP_SHA,
            max_displacement: displacement,
            max_von_mises: stress,
          },
          mechanicalContent,
        ),
        node(
          "observations",
          "digital-thread",
          "thread_observations_normalize",
          normalizeArguments,
          normalization,
          normalization,
        ),
        node(
          "evaluation",
          "syson",
          "syson_constraint_evaluate",
          { constraints, values },
          { results, summary, resolved_values: values },
          { results, summary, resolvedValues: values },
        ),
      ],
    },
  };
}

function node(
  nodeId: string,
  server: string,
  tool: string,
  args: Record<string, unknown>,
  outputs: Record<string, unknown>,
  structuredContent: Record<string, unknown>,
) {
  const timing = {
    requirements: ["2026-08-02T06:00:00.000Z", "2026-08-02T06:00:01.000Z"],
    mechanical: ["2026-08-02T06:00:01.000Z", "2026-08-02T06:00:02.000Z"],
    observations: ["2026-08-02T06:00:02.000Z", "2026-08-02T06:00:03.000Z"],
    evaluation: ["2026-08-02T06:00:03.000Z", "2026-08-02T06:00:04.000Z"],
  }[nodeId];
  if (!timing) throw new Error(`Unknown fixture node ${nodeId}.`);
  return {
    nodeId,
    server,
    tool,
    status: "succeeded",
    startedAt: timing[0],
    completedAt: timing[1],
    durationMs: 1000,
    arguments: args,
    outputs,
    structuredContent,
    summary: `${nodeId} completed`,
  };
}

function constraint(id: string, feature: string, value: number, unit: string) {
  return {
    id,
    name: id,
    sourceId: id,
    expression: {
      kind: "binary",
      op: "<=",
      left: { kind: "ref", featurePath: [feature] },
      right: { kind: "literal", value, unit },
    },
  };
}

function proposalParameters() {
  return [
    {
      key: "analysis_scope",
      label: "Part and scope",
      value: "CM-01 drip tray; isolated current CAD component, 190 x 135 x 28 mm",
    },
    { key: "material_basis", label: "Material basis", value: "ABS-like concept model" },
    { key: "young_modulus_mpa", label: "Young modulus", value: 2200, unit: "MPa" },
    { key: "poisson_ratio", label: "Poisson ratio", value: 0.35, unit: "1" },
    { key: "fixed_region", label: "Support", value: "Rear vertical face fully fixed" },
    {
      key: "load_case",
      label: "Reference load",
      value:
        "100 N total downward force on the front vertical face (about 10 kg static load)",
    },
    { key: "mesh_size_mm", label: "Target mesh size", value: 5, unit: "mm" },
    {
      key: "max_von_mises_mpa",
      label: "Preliminary stress limit",
      value: 20,
      unit: "MPa",
    },
    {
      key: "max_displacement_mm",
      label: "Preliminary displacement limit",
      value: 1,
      unit: "mm",
    },
    {
      key: "evidence_boundary",
      label: "Evidence boundary",
      value: "Concept verification only",
    },
  ];
}
