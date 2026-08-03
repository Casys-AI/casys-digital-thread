import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type CoffeeMachineCm01V3GoldenObservation,
  compareCoffeeMachineCm01V3GoldenReference,
  validateCoffeeMachineCm01V3GoldenObservation,
  validateCoffeeMachineCm01V3GoldenReference,
} from "./coffee-machine-cm01-v3-golden-reference.ts";

const CONFIG = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../config/golden-references/coffee-machine-cm01-v3.json",
      import.meta.url,
    ),
  ),
) as unknown;

Deno.test("CM-01 V3 golden reference is static, closed and non-executable", () => {
  const reference = validateCoffeeMachineCm01V3GoldenReference(CONFIG);

  assertEquals(reference.status, "non-executable-reference");
  assertEquals(reference.sourceFixture.projectRevision, 10);
  assertEquals(reference.candidateProject, {
    projectId: "coffee-machine-cm01-v3",
    subjectId: "project:coffee-machine-cm01-v3",
  });
  assertEquals(reference.expected.cad.artifacts.map((item) => item.role), [
    "cad-plan",
    "cad-script",
    "cad-step",
  ]);
  assert(Object.isFrozen(reference));
});

Deno.test("CM-01 V3 golden comparison accepts a fresh semantic projection", () => {
  const result = compareCoffeeMachineCm01V3GoldenReference(
    validateCoffeeMachineCm01V3GoldenReference(CONFIG),
    exactObservation(),
  );
  assertEquals(result, { matches: true, differences: [] });
});

Deno.test("CM-01 V3 golden comparison does not compare r10 identities", () => {
  const observation = exactObservation();
  const candidate: CoffeeMachineCm01V3GoldenObservation = {
    ...observation,
    artifacts: observation.artifacts.map((artifact) => ({
      ...artifact,
      // A candidate can carry completely new concrete artifact IDs elsewhere;
      // this normalized comparison has only the reviewed semantic role.
    })),
  };
  const result = compareCoffeeMachineCm01V3GoldenReference(
    validateCoffeeMachineCm01V3GoldenReference(CONFIG),
    candidate,
  );
  assertEquals(result, { matches: true, differences: [] });
});

Deno.test("CM-01 V3 golden comparison accepts a fresh STEP serialization when CalculiX attests it", () => {
  const observation = exactObservation();
  const candidate: CoffeeMachineCm01V3GoldenObservation = {
    ...observation,
    mechanical: {
      ...observation.mechanical,
      step: { ...observation.mechanical.step, sha256: "b".repeat(64) },
      consumption: {
        ...observation.mechanical.consumption,
        observedSha256: "b".repeat(64),
      },
    },
  };
  assertEquals(
    compareCoffeeMachineCm01V3GoldenReference(
      validateCoffeeMachineCm01V3GoldenReference(CONFIG),
      candidate,
    ),
    { matches: true, differences: [] },
  );
});

Deno.test("CM-01 V3 golden comparison reports tolerance, handoff and project drift", () => {
  const observation = exactObservation();
  const candidate: CoffeeMachineCm01V3GoldenObservation = {
    ...observation,
    project: { ...observation.project, subjectId: "project:other" },
    measurements: observation.measurements.map((measurement) =>
      measurement.metric === "assembly_max_displacement"
        ? { ...measurement, value: measurement.value + 0.01 }
        : measurement
    ),
    mechanical: {
      ...observation.mechanical,
      consumption: { ...observation.mechanical.consumption, status: "mismatch" },
    },
  };
  const result = compareCoffeeMachineCm01V3GoldenReference(
    validateCoffeeMachineCm01V3GoldenReference(CONFIG),
    candidate,
  );

  assertEquals(result.matches, false);
  assert(result.differences.some((item) => item.includes("candidate project")));
  assert(result.differences.some((item) => item.includes("assembly_max_displacement")));
  assert(result.differences.some((item) => item.includes("CalculiX handoff")));
});

Deno.test("CM-01 V3 golden parser rejects raw arguments and missing explicit tolerance", () => {
  const rawArguments = structuredClone(CONFIG) as Record<string, unknown>;
  rawArguments.rawToolArguments = { hidden: true };
  assertThrows(
    () => validateCoffeeMachineCm01V3GoldenReference(rawArguments),
    Error,
    "$reference must contain exactly",
  );

  const noTolerance = structuredClone(CONFIG) as {
    expected: { modelica: { measurements: Array<Record<string, unknown>> } };
  };
  delete noTolerance.expected.modelica.measurements[0]!.absoluteTolerance;
  assertThrows(
    () => validateCoffeeMachineCm01V3GoldenReference(noTolerance),
    Error,
    "absoluteTolerance",
  );
});

Deno.test("CM-01 V3 golden observation rejects unprojected provider payloads", () => {
  const observation = exactObservation() as unknown as Record<string, unknown>;
  observation.rawProviderResult = { secrets: "must-not-cross" };
  assertThrows(
    () => validateCoffeeMachineCm01V3GoldenObservation(observation),
    Error,
    "$observation must contain exactly",
  );
});

function exactObservation(): CoffeeMachineCm01V3GoldenObservation {
  const reference = validateCoffeeMachineCm01V3GoldenReference(CONFIG);
  return {
    project: structuredClone(reference.candidateProject),
    artifacts: [
      reference.expected.architecture.artifact,
      ...reference.expected.cad.artifacts,
      reference.expected.modelica.artifact,
      reference.expected.erp.artifact,
      {
        role: "mechanical-step",
        kind: "step",
        producer: { serverId: "build123d", tool: "build123d_export" },
      },
    ],
    measurements: [
      ...reference.expected.modelica.measurements,
      ...reference.expected.erp.measurements,
      ...reference.expected.mechanical.measurements,
    ].map(({ metric, value, unit }) => ({ metric, value, unit })),
    mechanical: {
      proof: structuredClone(reference.expected.mechanical.proof),
      step: { artifactRole: "mechanical-step", sha256: "a".repeat(64) },
      consumption: {
        ...structuredClone(reference.expected.mechanical.consumption),
        observedSha256: "a".repeat(64),
      },
      evaluations: structuredClone(reference.expected.mechanical.evaluations),
    },
  };
}
