import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import {
  compareCoffeeMachineCm01V3GoldenReference,
  validateCoffeeMachineCm01V3GoldenReference,
} from "../../../domain/cm01/coffee-machine-cm01-v3-golden-reference.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import {
  projectCoffeeMachineCm01V3GoldenObservation,
} from "./coffee-machine-cm01-v3-golden-observation.ts";

const REFERENCE = validateCoffeeMachineCm01V3GoldenReference(
  JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../config/golden-references/coffee-machine-cm01-v3.json",
        import.meta.url,
      ),
    ),
  ),
);

Deno.test("CM-01 V3 golden observation projects all five fresh completed branches", () => {
  const { project, snapshot } = representativeFinalState();
  const observation = projectCoffeeMachineCm01V3GoldenObservation({
    project,
    finalSnapshot: snapshot,
  });

  assertEquals(
    compareCoffeeMachineCm01V3GoldenReference(REFERENCE, observation),
    { matches: true, differences: [] },
  );
});

Deno.test("CM-01 V3 golden observation binds provider evidence structurally despite clock drift", () => {
  const { project, snapshot } = representativeFinalState();
  const drifted = structuredClone(snapshot);
  // The provider's capture clock can legitimately finish after the control
  // plane has persisted `run.completedAt`. The thermal branch is anchored by
  // its completed run's exact evidence artifact and its producer run ID, not
  // by an incomparable wall-clock interval.
  const capturedAt = "2026-08-03T12:29:00.042Z";
  for (const artifact of drifted.artifacts) {
    if (artifact.producer.runId === "run_cm01_v3_thermal") {
      artifact.freshness.changedAt = capturedAt;
    }
  }
  for (const consumption of drifted.consumptions) {
    if (consumption.consumer.runId === "run_cm01_v3_thermal") {
      consumption.verifiedAt = capturedAt;
    }
  }
  for (const observation of drifted.observations) {
    if (observation.source.operation.runId === "run_cm01_v3_thermal") {
      observation.freshness.changedAt = capturedAt;
      observation.source.capturedAt = capturedAt;
    }
  }

  assertEquals(
    compareCoffeeMachineCm01V3GoldenReference(
      REFERENCE,
      projectCoffeeMachineCm01V3GoldenObservation({
        project,
        finalSnapshot: drifted,
      }),
    ),
    { matches: true, differences: [] },
  );
});

Deno.test("CM-01 V3 golden observation keeps completion evidence exact", () => {
  const { project, snapshot } = representativeFinalState();
  const projectWithMismatchedEvidence = {
    ...project,
    agentRuns: project.agentRuns.map((run) =>
      run.workItemId === "work-thermal"
        ? {
          ...run,
          evidenceRefs: run.evidenceRefs.map((reference) => ({
            ...reference,
            snapshotRevision: reference.snapshotRevision - 1,
          })),
        }
        : run
    ),
  } as EngineeringProjectSnapshot;

  assertThrows(
    () =>
      projectCoffeeMachineCm01V3GoldenObservation({
        project: projectWithMismatchedEvidence,
        finalSnapshot: snapshot,
      }),
    Error,
    "not bound to its exact result snapshot",
  );
});

Deno.test("CM-01 V3 golden observation rejects an invented mechanical STEP input", () => {
  const { project, snapshot } = representativeFinalState();
  const invented = structuredClone(snapshot);
  const proof = invented.artifacts.find((artifact) =>
    artifact.name === "CM-01 V3 reviewed DripTray proof case"
  )!;
  const stepIndex = invented.artifacts.findIndex((artifact) =>
    artifact.name === "CM-01 V3 isolated DripTray STEP"
  );
  invented.artifacts[stepIndex] = {
    ...invented.artifacts[stepIndex]!,
    inputArtifactIds: [proof.id],
  };

  assertThrows(
    () =>
      projectCoffeeMachineCm01V3GoldenObservation({
        project,
        finalSnapshot: invented,
      }),
    Error,
    "must not claim an unobserved build123d input",
  );
});

Deno.test("CM-01 V3 golden observation rejects a foreign project before projecting evidence", () => {
  const { project, snapshot } = representativeFinalState();
  const foreign = {
    ...structuredClone(project),
    project: { ...project.project, id: "coffee-machine-cm01" },
  } as EngineeringProjectSnapshot;
  assertThrows(
    () =>
      projectCoffeeMachineCm01V3GoldenObservation({
        project: foreign,
        finalSnapshot: snapshot,
      }),
    Error,
    "canonical V3 project",
  );
});

Deno.test("CM-01 V3 golden observation rejects an ambiguous CAD branch", () => {
  const { project, snapshot } = representativeFinalState();
  const ambiguous = structuredClone(snapshot);
  const original = ambiguous.artifacts.find((artifact) =>
    artifact.name === "CM-01 semantic CAD plan"
  )!;
  ambiguous.artifacts.push({ ...original, id: `${original.id}-duplicate` });
  assertThrows(
    () =>
      projectCoffeeMachineCm01V3GoldenObservation({
        project,
        finalSnapshot: ambiguous,
      }),
    Error,
    "CAD plan artifact must be present exactly once",
  );
});

Deno.test("CM-01 V3 golden observation will not let a non-V3 thermal branch satisfy the gate", () => {
  const { project, snapshot } = representativeFinalState();
  const legacyOnly = structuredClone(snapshot);
  legacyOnly.artifacts = legacyOnly.artifacts.filter((artifact) =>
    !artifact.id.startsWith("cm01-v3-thermal-")
  );
  legacyOnly.consumptions = legacyOnly.consumptions.filter((consumption) =>
    !consumption.id.startsWith("cm01-v3-thermal-")
  );
  legacyOnly.observations = legacyOnly.observations.filter((observation) =>
    !observation.id.startsWith("cm01-v3-thermal-")
  );
  assertThrows(
    () =>
      projectCoffeeMachineCm01V3GoldenObservation({
        project,
        finalSnapshot: legacyOnly,
      }),
    Error,
    "thermal completion evidence artifact",
  );
});

function representativeFinalState(): {
  project: EngineeringProjectSnapshot;
  snapshot: ThreadSnapshot;
} {
  // Deliberately construct the V3 final state in full. Importing and mutating
  // a historical snapshot here would prove an accidental compatibility path
  // rather than the closed V3 golden-observation contract.
  const snapshot: ThreadSnapshot = {
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r7:golden-final",
    revision: 7,
    generatedAt: "2026-08-03T12:50:00.000Z",
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      kind: "system",
      version: "v3-golden-test",
      modelArtifactId: "v3-bootstrap-model",
    },
    freshness: freshness("2026-08-03T12:50:00.000Z"),
    changeSet: {
      id: "v3-golden-test-final",
      name: "V3 golden observation fixture",
      status: "applied",
      createdAt: "2026-08-03T12:50:00.000Z",
      appliedAt: "2026-08-03T12:50:00.000Z",
      changes: [],
    },
    artifacts: [],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };

  const architectureAt = "2026-08-03T12:05:00.000Z";
  const cadAt = "2026-08-03T12:15:00.000Z";
  const thermalAt = "2026-08-03T12:25:00.000Z";
  const bomAt = "2026-08-03T12:35:00.000Z";
  const mechanicalAt = "2026-08-03T12:45:00.000Z";
  const architectureId = `coffee-machine-cm01-v3-architecture-${hash("a")}`;
  const cadPrefix = `coffee-machine-cm01-v3-cad-${hash("b")}`;
  const modelRun = "run_cm01_v3_thermal";
  const modelId = `cm01-v3-thermal-model-${hash("c").slice(0, 12)}`;
  const scenarioId = `cm01-v3-thermal-scenario-${hash("d").slice(0, 12)}`;
  const modelicaResultId = `cm01-v3-thermal-result-${hash("e").slice(0, 12)}`;
  const modelicaEvidenceId = `cm01-v3-thermal-evidence-${hash("f").slice(0, 12)}`;
  const bomId = `cm01-v3-erp-bom-${hash("1").slice(0, 12)}`;
  const mechanicalProofId = `cm01-v3-mechanical-proof-${hash("2").slice(0, 12)}`;
  const mechanicalStepId = `cm01-v3-mechanical-step-${hash("2").slice(0, 12)}`;
  const mechanicalSolveId = `cm01-v3-mechanical-solve-${hash("3").slice(0, 12)}`;

  snapshot.artifacts.push(
    artifact(
      architectureId,
      "CM-01 V3 SysML architecture",
      "sysml-model",
      hash("4"),
      { serverId: "syson", tool: "syson_element_insert_sysml", runId: "syson-v3" },
      [],
      architectureAt,
    ),
    artifact(
      `${cadPrefix}-plan`,
      "CM-01 semantic CAD plan",
      "document",
      hash("5"),
      {
        serverId: "digital-thread",
        tool: "compile_coffee_machine_cm01_semantic_cad_plan",
        runId: "cad-v3",
      },
      [architectureId],
      cadAt,
    ),
    artifact(
      `${cadPrefix}-script`,
      "CM-01 deterministic build123d script",
      "script",
      hash("6"),
      {
        serverId: "digital-thread",
        tool: "compile_coffee_machine_cm01_semantic_cad_plan",
        runId: "cad-v3",
      },
      [`${cadPrefix}-plan`],
      cadAt,
    ),
    artifact(
      `${cadPrefix}-step`,
      "CM-01 STEP export",
      "step",
      hash("7"),
      { serverId: "build123d", tool: "build123d_export", runId: "cad-v3" },
      [`${cadPrefix}-script`],
      cadAt,
    ),
    artifact(
      modelId,
      "Modelica model",
      "simulation-model",
      "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
      { serverId: "modelica", tool: "modelica_simulate", runId: modelRun },
      [],
      thermalAt,
    ),
    artifact(
      scenarioId,
      "Modelica scenario heat-up-nominal",
      "evidence",
      "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
      { serverId: "modelica", tool: "modelica_run_get", runId: modelRun },
      [],
      thermalAt,
    ),
    artifact(
      modelicaResultId,
      "Simulation result",
      "solver-result",
      hash("8"),
      { serverId: "modelica", tool: "modelica_simulate", runId: modelRun },
      [modelId, scenarioId],
      thermalAt,
    ),
    artifact(
      modelicaEvidenceId,
      "Computed evidence",
      "evidence",
      hash("9"),
      { serverId: "modelica", tool: "modelica_simulate", runId: modelRun },
      [],
      thermalAt,
    ),
    artifact(
      bomId,
      "ERPNext BOM BOM-CASYS-CM01-001",
      "bom",
      hash("0"),
      { serverId: "erpnext", tool: "erpnext_bom_get", runId: "erp-v3" },
      [],
      bomAt,
    ),
    artifact(
      mechanicalProofId,
      "CM-01 V3 reviewed DripTray proof case",
      "document",
      "500579c225561a873636952a990b80a33411b7bc87424f396e8963ae342f8dc2",
      {
        serverId: "digital-thread",
        tool: "evaluate_cm01_drip_tray_limits",
        runId: "mechanical-v3",
      },
      [],
      mechanicalAt,
    ),
    artifact(
      mechanicalStepId,
      "CM-01 V3 isolated DripTray STEP",
      "step",
      "ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84",
      { serverId: "build123d", tool: "build123d_export", runId: "mechanical-v3" },
      [],
      mechanicalAt,
    ),
    artifact(
      mechanicalSolveId,
      "CM-01 V3 CalculiX static result",
      "solver-result",
      hash("a"),
      { serverId: "calculix", tool: "calculix_solve_static", runId: "mechanical-v3" },
      [mechanicalStepId],
      mechanicalAt,
    ),
  );
  snapshot.consumptions.push(
    consumption(
      "cm01-v3-cad-architecture",
      architectureId,
      hash("4"),
      "digital-thread",
      "compile_coffee_machine_cm01_semantic_cad_plan",
      "cad-v3",
      cadAt,
    ),
    consumption(
      "cm01-v3-cad-plan",
      `${cadPrefix}-plan`,
      hash("5"),
      "digital-thread",
      "compile_coffee_machine_cm01_semantic_cad_plan",
      "cad-v3",
      cadAt,
    ),
    consumption(
      "cm01-v3-cad-script",
      `${cadPrefix}-script`,
      hash("6"),
      "build123d",
      "build123d_export",
      "cad-v3",
      cadAt,
    ),
    consumption(
      "cm01-v3-thermal-model",
      modelId,
      "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
      "modelica",
      "modelica_simulate",
      modelRun,
      thermalAt,
    ),
    consumption(
      "cm01-v3-thermal-scenario",
      scenarioId,
      "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
      "modelica",
      "modelica_simulate",
      modelRun,
      thermalAt,
    ),
    consumption(
      "cm01-v3-mechanical-step",
      mechanicalStepId,
      "ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84",
      "calculix",
      "calculix_solve_static",
      "mechanical-v3",
      mechanicalAt,
    ),
  );
  for (
    const [metric, value, unit] of [
      ["heater_energy", 493914.2758438271, "J"],
      ["heater_power_peak", 1500, "W"],
      ["time_to_target_temperature", 138, "s"],
      ["water_temperature_max", 94.00000007343664, "degC"],
    ] as const
  ) {
    snapshot.observations.push(
      observation(
        `cm01-v3-thermal-${metric}`,
        metric,
        value,
        unit,
        "modelica",
        "modelica_simulate",
        modelRun,
        modelicaEvidenceId,
        thermalAt,
      ),
    );
  }
  snapshot.observations.push(
    observation(
      "cm01-v3-erp-quantity",
      "bom_quantity_per_finished_good",
      1,
      "Nos",
      "erpnext",
      "erpnext_bom_get",
      "erp-v3",
      bomId,
      bomAt,
    ),
    observation(
      "cm01-v3-mechanical-displacement",
      "assembly_max_displacement",
      0.10363294359363535,
      "mm",
      "calculix",
      "calculix_solve_static",
      "mechanical-v3",
      mechanicalSolveId,
      mechanicalAt,
    ),
    observation(
      "cm01-v3-mechanical-stress",
      "assembly_max_von_mises",
      0.5309183805726515,
      "MPa",
      "calculix",
      "calculix_solve_static",
      "mechanical-v3",
      mechanicalSolveId,
      mechanicalAt,
    ),
  );
  for (
    const metric of ["assembly_max_displacement", "assembly_max_von_mises"] as const
  ) {
    const requirementId = `cm01-v3-drip-tray-${metric}`;
    const observationId = metric === "assembly_max_displacement"
      ? "cm01-v3-mechanical-displacement"
      : "cm01-v3-mechanical-stress";
    snapshot.requirements.push({
      id: requirementId,
      name: metric,
      statement: metric,
      version: "1",
      criterion: {
        metric,
        operator: "<=",
        limit: {
          value: 1,
          unit: metric === "assembly_max_displacement" ? "mm" : "MPa",
        },
      },
      trace: {
        sourceArtifactId: mechanicalProofId,
        elementId: requirementId,
        targetArtifactIds: [mechanicalStepId],
      },
      freshness: freshness(mechanicalAt),
    });
    snapshot.evaluations.push({
      id: `${requirementId}-evaluation`,
      name: `${metric} evaluation`,
      requirementId,
      observationIds: [observationId],
      status: "pass",
      evaluatedAt: mechanicalAt,
      evaluator: {
        serverId: "digital-thread",
        tool: "evaluate_cm01_drip_tray_limits",
        runId: "mechanical-v3",
      },
      evidenceArtifactIds: [mechanicalSolveId],
      message: "within reviewed concept limit",
      freshness: freshness(mechanicalAt),
    });
  }

  const declaredSnapshots = [2, 3, 4, 5, 6, 7].map((revision) => ({
    snapshotId: revision === snapshot.revision
      ? snapshot.id
      : `project:coffee-machine-cm01-v3:r${revision}:declared`,
    revision,
    subjectId: snapshot.subject.id,
  }));
  const branches = [
    [
      "architecture",
      "architecture.author-coffee-machine-cm01",
      "architect",
      architectureId,
    ],
    ["cad", "design.build-coffee-machine-cm01-cad", "design", `${cadPrefix}-step`],
    [
      "thermal",
      "simulate.coffee-machine-cm01-thermal-nominal",
      "simulate",
      modelicaEvidenceId,
    ],
    ["bom", "industrialize.observe-coffee-machine-cm01-bom", "industrialize", bomId],
    [
      "mechanical",
      "verify.coffee-machine-cm01-drip-tray-mechanical",
      "verify",
      mechanicalSolveId,
    ],
  ] as const;
  const project = {
    schemaVersion: "3.0",
    id: "coffee-machine-cm01-v3:project:r25:aaaaaaaaaaaaaaaa",
    revision: 25,
    generatedAt: "2026-08-03T12:50:00.000Z",
    project: {
      id: "coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      subjectId: "project:coffee-machine-cm01-v3",
      objective: { title: "CM-01", statement: "Review the CM-01 evidence path." },
    },
    threadSnapshots: declaredSnapshots,
    phases: [],
    workItems: branches.map(([label, operation, kind]) => ({
      id: `work-${label}`,
      phaseId: `phase-${label}`,
      title: label,
      description: label,
      kind,
      operation: { id: operation, version: "1", bindings: [] },
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    })),
    agentRuns: branches.map(([label, _operation, _kind, evidenceId], index) => ({
      id: `run-${label}`,
      workItemId: `work-${label}`,
      status: "completed",
      summary: label,
      queuedAt: `2026-08-03T12:${String(index * 10).padStart(2, "0")}:00.000Z`,
      startedAt: `2026-08-03T12:${String(index * 10).padStart(2, "0")}:00.000Z`,
      completedAt: `2026-08-03T12:${String(index * 10 + 9).padStart(2, "0")}:00.000Z`,
      basis: { kind: "thread-snapshot", ...declaredSnapshots[index]! },
      evidenceRefs: [{
        snapshotId: declaredSnapshots[index + 1]!.snapshotId,
        snapshotRevision: declaredSnapshots[index + 1]!.revision,
        kind: "artifact",
        id: evidenceId,
      }],
      resultSnapshot: declaredSnapshots[index + 1]!,
    })),
    decisions: [],
    approvals: [],
    blockers: [],
  } as EngineeringProjectSnapshot;
  return { project, snapshot };
}

function artifact(
  id: string,
  name: string,
  kind: ThreadSnapshot["artifacts"][number]["kind"],
  digest: string,
  producer: { serverId: string; tool: string; runId: string },
  inputArtifactIds: string[],
  changedAt: string,
) {
  return {
    id,
    name,
    kind,
    version: digest.slice(0, 12),
    fingerprint: { algorithm: "sha256" as const, digest },
    producer,
    inputArtifactIds,
    freshness: freshness(changedAt),
  };
}

function consumption(
  id: string,
  artifactId: string,
  digest: string,
  serverId: string,
  tool: string,
  runId: string,
  verifiedAt: string,
) {
  return {
    id,
    artifactId,
    consumer: { serverId, tool, runId },
    observedFingerprint: { algorithm: "sha256" as const, digest },
    verifiedAt,
    status: "verified" as const,
  };
}

function observation(
  id: string,
  metric: string,
  value: number,
  unit: string,
  serverId: string,
  tool: string,
  runId: string,
  artifactId: string,
  capturedAt: string,
) {
  return {
    id,
    name: metric,
    metric,
    quantity: { value, unit },
    source: {
      operation: { serverId, tool, runId },
      artifactIds: [artifactId],
      capturedAt,
    },
    freshness: freshness(capturedAt),
  };
}

function freshness(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}

function hash(character: string): string {
  return character.repeat(64);
}
