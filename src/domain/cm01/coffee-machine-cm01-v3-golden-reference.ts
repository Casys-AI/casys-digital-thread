/**
 * Static semantic reference for the CM-01 V3 golden path.
 *
 * The historical r10 record is provenance for this reference only. A V3 run
 * is compared through deliberate semantic roles, values and attested handoffs;
 * it must never reuse r10 snapshot, artifact or provider identities.
 */

export const COFFEE_MACHINE_CM01_V3_GOLDEN_REFERENCE_SCHEMA =
  "cm01-v3-golden-reference/1.0" as const;

type ProducerRef = {
  readonly serverId: string;
  readonly tool: string;
};

export type CoffeeMachineCm01V3GoldenArtifactRole =
  | "architecture-model"
  | "cad-plan"
  | "cad-script"
  | "cad-step"
  | "modelica-result"
  | "erp-bom"
  | "mechanical-step";

export interface GoldenArtifactExpectation {
  readonly role: CoffeeMachineCm01V3GoldenArtifactRole;
  readonly kind: string;
  readonly producer: ProducerRef;
}

export interface GoldenMeasurementExpectation {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly absoluteTolerance: number;
}

export interface CoffeeMachineCm01V3GoldenReference {
  readonly schemaVersion: typeof COFFEE_MACHINE_CM01_V3_GOLDEN_REFERENCE_SCHEMA;
  readonly id: "coffee-machine-cm01-v3";
  readonly title: string;
  readonly status: "non-executable-reference";
  /** Provenance only; this is never a run basis or comparison target. */
  readonly sourceFixture: {
    readonly projectId: "coffee-machine-cm01";
    readonly projectSnapshotId: string;
    readonly projectRevision: 10;
  };
  readonly candidateProject: {
    readonly projectId: "coffee-machine-cm01-v3";
    readonly subjectId: "project:coffee-machine-cm01-v3";
  };
  readonly evidenceBoundary: string;
  readonly expected: {
    readonly architecture: { readonly artifact: GoldenArtifactExpectation };
    readonly cad: { readonly artifacts: readonly GoldenArtifactExpectation[] };
    readonly modelica: {
      readonly artifact: GoldenArtifactExpectation;
      readonly measurements: readonly GoldenMeasurementExpectation[];
    };
    readonly erp: {
      readonly artifact: GoldenArtifactExpectation;
      readonly measurements: readonly GoldenMeasurementExpectation[];
    };
    readonly mechanical: {
      readonly evidenceBoundary: string;
      readonly proof: {
        readonly artifactRole: "mechanical-proof";
        readonly sha256: string;
      };
      readonly step: {
        readonly artifactRole: "mechanical-step";
        /** The STEP has a SHA-256, but OpenCascade embeds export time in its bytes. */
        readonly fingerprint: {
          readonly algorithm: "sha256";
          readonly scope: "producer-consumer-handoff";
        };
      };
      readonly consumption: {
        readonly artifactRole: "mechanical-step";
        readonly consumer: ProducerRef;
        readonly status: "verified";
      };
      readonly measurements: readonly GoldenMeasurementExpectation[];
      readonly evaluations: readonly {
        readonly metric: string;
        readonly status: "pass";
      }[];
    };
  };
}

/** A normalized, caller-owned projection of one new V3 run. */
export interface CoffeeMachineCm01V3GoldenObservation {
  readonly project: {
    readonly projectId: string;
    readonly subjectId: string;
  };
  readonly artifacts: readonly GoldenArtifactExpectation[];
  readonly measurements: readonly {
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
  }[];
  readonly mechanical: {
    readonly proof: {
      readonly artifactRole: "mechanical-proof";
      readonly sha256: string;
    };
    readonly step: {
      readonly artifactRole: CoffeeMachineCm01V3GoldenArtifactRole;
      readonly sha256: string;
    };
    readonly consumption: {
      readonly artifactRole: CoffeeMachineCm01V3GoldenArtifactRole;
      readonly consumer: ProducerRef;
      readonly status: string;
      /** Must equal the per-run STEP hash above. */
      readonly observedSha256: string;
    };
    readonly evaluations: readonly {
      readonly metric: string;
      readonly status: string;
    }[];
  };
}

export interface GoldenReferenceComparison {
  readonly matches: boolean;
  readonly differences: readonly string[];
}

/** Parse a future V3 result projection without admitting provider payloads. */
export function validateCoffeeMachineCm01V3GoldenObservation(
  value: unknown,
): CoffeeMachineCm01V3GoldenObservation {
  const root = exactRecord(value, [
    "project",
    "artifacts",
    "measurements",
    "mechanical",
  ], "$observation");
  const project = exactRecord(
    root.project,
    ["projectId", "subjectId"],
    "$observation.project",
  );
  const mechanical = exactRecord(root.mechanical, [
    "proof",
    "step",
    "consumption",
    "evaluations",
  ], "$observation.mechanical");
  const stepRecord = exactRecord(
    mechanical.step,
    ["artifactRole", "sha256"],
    "$observation.mechanical.step",
  );
  const proofRecord = exactRecord(
    mechanical.proof,
    ["artifactRole", "sha256"],
    "$observation.mechanical.proof",
  );
  const consumptionRecord = exactRecord(
    mechanical.consumption,
    ["artifactRole", "consumer", "status", "observedSha256"],
    "$observation.mechanical.consumption",
  );
  const stepSha256 = sha256(stepRecord.sha256, "$observation.mechanical.step.sha256");
  const parsed: CoffeeMachineCm01V3GoldenObservation = {
    project: {
      projectId: identifier(project.projectId, "$observation.project.projectId"),
      subjectId: identifier(project.subjectId, "$observation.project.subjectId"),
    },
    artifacts: artifacts(root.artifacts, "$observation.artifacts"),
    measurements: observedMeasurements(root.measurements, "$observation.measurements"),
    mechanical: {
      proof: {
        artifactRole: exactProofRole(
          proofRecord.artifactRole,
          "$observation.mechanical.proof.artifactRole",
        ),
        sha256: sha256(
          proofRecord.sha256,
          "$observation.mechanical.proof.sha256",
        ),
      },
      step: {
        artifactRole: role(
          stepRecord.artifactRole,
          "$observation.mechanical.step.artifactRole",
        ),
        sha256: stepSha256,
      },
      consumption: {
        artifactRole: role(
          consumptionRecord.artifactRole,
          "$observation.mechanical.consumption.artifactRole",
        ),
        consumer: producer(
          consumptionRecord.consumer,
          "$observation.mechanical.consumption.consumer",
        ),
        status: text(
          consumptionRecord.status,
          "$observation.mechanical.consumption.status",
        ),
        observedSha256: sha256(
          consumptionRecord.observedSha256,
          "$observation.mechanical.consumption.observedSha256",
        ),
      },
      evaluations: observedEvaluations(
        mechanical.evaluations,
        "$observation.mechanical.evaluations",
      ),
    },
  };
  return deepFreeze(parsed);
}

/** Parse the tracked JSON contract fail-closed. */
export function validateCoffeeMachineCm01V3GoldenReference(
  value: unknown,
): CoffeeMachineCm01V3GoldenReference {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "title",
    "status",
    "sourceFixture",
    "candidateProject",
    "evidenceBoundary",
    "expected",
  ], "$reference");
  exact(
    root.schemaVersion,
    COFFEE_MACHINE_CM01_V3_GOLDEN_REFERENCE_SCHEMA,
    "$reference.schemaVersion",
  );
  exact(root.id, "coffee-machine-cm01-v3", "$reference.id");
  exact(root.status, "non-executable-reference", "$reference.status");
  const sourceFixture = exactRecord(
    root.sourceFixture,
    ["projectId", "projectSnapshotId", "projectRevision"],
    "$reference.sourceFixture",
  );
  exact(
    sourceFixture.projectId,
    "coffee-machine-cm01",
    "$reference.sourceFixture.projectId",
  );
  exact(sourceFixture.projectRevision, 10, "$reference.sourceFixture.projectRevision");
  const candidateProject = exactRecord(
    root.candidateProject,
    ["projectId", "subjectId"],
    "$reference.candidateProject",
  );
  exact(
    candidateProject.projectId,
    "coffee-machine-cm01-v3",
    "$reference.candidateProject.projectId",
  );
  exact(
    candidateProject.subjectId,
    "project:coffee-machine-cm01-v3",
    "$reference.candidateProject.subjectId",
  );
  const expected = exactRecord(root.expected, [
    "architecture",
    "cad",
    "modelica",
    "erp",
    "mechanical",
  ], "$reference.expected");
  const architecture = exactRecord(
    expected.architecture,
    ["artifact"],
    "$reference.expected.architecture",
  );
  const cad = exactRecord(expected.cad, ["artifacts"], "$reference.expected.cad");
  const modelica = exactRecord(
    expected.modelica,
    ["artifact", "measurements"],
    "$reference.expected.modelica",
  );
  const erp = exactRecord(
    expected.erp,
    ["artifact", "measurements"],
    "$reference.expected.erp",
  );
  const mechanical = exactRecord(expected.mechanical, [
    "evidenceBoundary",
    "proof",
    "step",
    "consumption",
    "measurements",
    "evaluations",
  ], "$reference.expected.mechanical");

  const parsed: CoffeeMachineCm01V3GoldenReference = {
    schemaVersion: COFFEE_MACHINE_CM01_V3_GOLDEN_REFERENCE_SCHEMA,
    id: "coffee-machine-cm01-v3",
    title: text(root.title, "$reference.title"),
    status: "non-executable-reference",
    sourceFixture: {
      projectId: "coffee-machine-cm01",
      projectSnapshotId: identifier(
        sourceFixture.projectSnapshotId,
        "$reference.sourceFixture.projectSnapshotId",
      ),
      projectRevision: 10,
    },
    candidateProject: {
      projectId: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    evidenceBoundary: text(root.evidenceBoundary, "$reference.evidenceBoundary"),
    expected: {
      architecture: {
        artifact: artifact(
          architecture.artifact,
          "$reference.expected.architecture.artifact",
        ),
      },
      cad: {
        artifacts: artifacts(cad.artifacts, "$reference.expected.cad.artifacts"),
      },
      modelica: {
        artifact: artifact(
          modelica.artifact,
          "$reference.expected.modelica.artifact",
        ),
        measurements: measurements(
          modelica.measurements,
          "$reference.expected.modelica.measurements",
        ),
      },
      erp: {
        artifact: artifact(erp.artifact, "$reference.expected.erp.artifact"),
        measurements: measurements(
          erp.measurements,
          "$reference.expected.erp.measurements",
        ),
      },
      mechanical: {
        evidenceBoundary: text(
          mechanical.evidenceBoundary,
          "$reference.expected.mechanical.evidenceBoundary",
        ),
        proof: mechanicalProof(
          mechanical.proof,
          "$reference.expected.mechanical.proof",
        ),
        step: step(mechanical.step, "$reference.expected.mechanical.step"),
        consumption: consumption(
          mechanical.consumption,
          "$reference.expected.mechanical.consumption",
        ),
        measurements: measurements(
          mechanical.measurements,
          "$reference.expected.mechanical.measurements",
        ),
        evaluations: evaluations(
          mechanical.evaluations,
          "$reference.expected.mechanical.evaluations",
        ),
      },
    },
  };
  assertUniqueRoles(parsed);
  assertNoDuplicateMetrics(parsed);
  return deepFreeze(parsed);
}

/** Compare one fresh V3 run without exposing or matching historical IDs. */
export function compareCoffeeMachineCm01V3GoldenReference(
  reference: CoffeeMachineCm01V3GoldenReference,
  observation: CoffeeMachineCm01V3GoldenObservation,
): GoldenReferenceComparison {
  const differences: string[] = [];
  if (
    observation.project.projectId !== reference.candidateProject.projectId ||
    observation.project.subjectId !== reference.candidateProject.subjectId
  ) {
    differences.push("candidate project does not identify the CM-01 V3 golden run");
  }
  for (const expected of artifactsFor(reference)) {
    if (!observation.artifacts.some((actual) => sameArtifact(actual, expected))) {
      differences.push(`missing semantic artifact role ${expected.role}`);
    }
  }
  for (const expected of measurementsFor(reference)) {
    const actual = observation.measurements.find((candidate) =>
      candidate.metric === expected.metric
    );
    if (!actual) {
      differences.push(`missing measurement ${expected.metric}`);
    } else if (actual.unit !== expected.unit) {
      differences.push(
        `measurement ${expected.metric} unit ${actual.unit} does not equal ${expected.unit}`,
      );
    } else if (Math.abs(actual.value - expected.value) > expected.absoluteTolerance) {
      differences.push(
        `measurement ${expected.metric} differs by more than ${expected.absoluteTolerance} ${expected.unit}`,
      );
    }
  }
  const expectedStep = reference.expected.mechanical.step;
  const actualStep = observation.mechanical.step;
  const expectedProof = reference.expected.mechanical.proof;
  const actualProof = observation.mechanical.proof;
  if (
    actualProof.artifactRole !== expectedProof.artifactRole ||
    actualProof.sha256 !== expectedProof.sha256
  ) {
    differences.push("mechanical proof does not match the reviewed V3 proof case");
  }
  if (actualStep.artifactRole !== expectedStep.artifactRole) {
    differences.push("mechanical STEP does not have the expected semantic role");
  }
  const expectedConsumption = reference.expected.mechanical.consumption;
  const actualConsumption = observation.mechanical.consumption;
  if (
    actualConsumption.artifactRole !== expectedConsumption.artifactRole ||
    actualConsumption.status !== expectedConsumption.status ||
    !sameProducer(actualConsumption.consumer, expectedConsumption.consumer)
  ) {
    differences.push(
      "mechanical STEP consumption is not the expected verified CalculiX handoff",
    );
  }
  if (actualStep.sha256 !== actualConsumption.observedSha256) {
    differences.push(
      "mechanical STEP hash is not the hash attested by the CalculiX handoff",
    );
  }
  for (const expected of reference.expected.mechanical.evaluations) {
    const actual = observation.mechanical.evaluations.find((candidate) =>
      candidate.metric === expected.metric
    );
    if (!actual || actual.status !== expected.status) {
      differences.push(
        `mechanical evaluation ${expected.metric} is not ${expected.status}`,
      );
    }
  }
  return { matches: differences.length === 0, differences };
}

function artifactsFor(
  reference: CoffeeMachineCm01V3GoldenReference,
): readonly GoldenArtifactExpectation[] {
  return [
    reference.expected.architecture.artifact,
    ...reference.expected.cad.artifacts,
    reference.expected.modelica.artifact,
    reference.expected.erp.artifact,
    {
      role: "mechanical-step",
      kind: "step",
      producer: { serverId: "build123d", tool: "build123d_export" },
    },
  ];
}

function measurementsFor(
  reference: CoffeeMachineCm01V3GoldenReference,
): readonly GoldenMeasurementExpectation[] {
  return [
    ...reference.expected.modelica.measurements,
    ...reference.expected.erp.measurements,
    ...reference.expected.mechanical.measurements,
  ];
}

function artifact(value: unknown, path: string): GoldenArtifactExpectation {
  const root = exactRecord(value, ["role", "kind", "producer"], path);
  return {
    role: role(root.role, `${path}.role`),
    kind: text(root.kind, `${path}.kind`),
    producer: producer(root.producer, `${path}.producer`),
  };
}

function artifacts(value: unknown, path: string): readonly GoldenArtifactExpectation[] {
  const items = array(value, path).map((item, index) =>
    artifact(item, `${path}[${index}]`)
  );
  if (items.length === 0) throw new Error(`${path} must not be empty.`);
  if (new Set(items.map((item) => item.role)).size !== items.length) {
    throw new Error(`${path} must contain unique semantic roles.`);
  }
  return items;
}

function measurements(
  value: unknown,
  path: string,
): readonly GoldenMeasurementExpectation[] {
  const items = array(value, path).map((value, index) => {
    const root = exactRecord(
      value,
      ["metric", "value", "unit", "absoluteTolerance"],
      `${path}[${index}]`,
    );
    const expected = {
      metric: identifier(root.metric, `${path}[${index}].metric`),
      value: finite(root.value, `${path}[${index}].value`),
      unit: text(root.unit, `${path}[${index}].unit`),
      absoluteTolerance: finite(
        root.absoluteTolerance,
        `${path}[${index}].absoluteTolerance`,
      ),
    };
    if (expected.absoluteTolerance < 0) {
      throw new Error(`${path}[${index}].absoluteTolerance must be non-negative.`);
    }
    return expected;
  });
  if (items.length === 0) throw new Error(`${path} must not be empty.`);
  return items;
}

function observedMeasurements(
  value: unknown,
  path: string,
): CoffeeMachineCm01V3GoldenObservation["measurements"] {
  const items = array(value, path).map((value, index) => {
    const root = exactRecord(value, ["metric", "value", "unit"], `${path}[${index}]`);
    return {
      metric: identifier(root.metric, `${path}[${index}].metric`),
      value: finite(root.value, `${path}[${index}].value`),
      unit: text(root.unit, `${path}[${index}].unit`),
    };
  });
  if (new Set(items.map((item) => item.metric)).size !== items.length) {
    throw new Error(`${path} must contain unique metrics.`);
  }
  return items;
}

function step(
  value: unknown,
  path: string,
): CoffeeMachineCm01V3GoldenReference["expected"]["mechanical"]["step"] {
  const root = exactRecord(value, ["artifactRole", "fingerprint"], path);
  exact(root.artifactRole, "mechanical-step", `${path}.artifactRole`);
  const fingerprint = exactRecord(
    root.fingerprint,
    ["algorithm", "scope"],
    `${path}.fingerprint`,
  );
  exact(fingerprint.algorithm, "sha256", `${path}.fingerprint.algorithm`);
  exact(
    fingerprint.scope,
    "producer-consumer-handoff",
    `${path}.fingerprint.scope`,
  );
  return {
    artifactRole: "mechanical-step",
    fingerprint: { algorithm: "sha256", scope: "producer-consumer-handoff" },
  };
}

function mechanicalProof(
  value: unknown,
  path: string,
): CoffeeMachineCm01V3GoldenReference["expected"]["mechanical"]["proof"] {
  const root = exactRecord(value, ["artifactRole", "sha256"], path);
  exact(root.artifactRole, "mechanical-proof", `${path}.artifactRole`);
  return {
    artifactRole: "mechanical-proof",
    sha256: sha256(root.sha256, `${path}.sha256`),
  };
}

function exactProofRole(value: unknown, path: string): "mechanical-proof" {
  exact(value, "mechanical-proof", path);
  return "mechanical-proof";
}

function consumption(
  value: unknown,
  path: string,
): CoffeeMachineCm01V3GoldenReference["expected"]["mechanical"]["consumption"] {
  const root = exactRecord(value, ["artifactRole", "consumer", "status"], path);
  exact(root.artifactRole, "mechanical-step", `${path}.artifactRole`);
  exact(root.status, "verified", `${path}.status`);
  return {
    artifactRole: "mechanical-step",
    consumer: producer(root.consumer, `${path}.consumer`),
    status: "verified",
  };
}

function evaluations(
  value: unknown,
  path: string,
): readonly { readonly metric: string; readonly status: "pass" }[] {
  const items = array(value, path).map((value, index) => {
    const root = exactRecord(value, ["metric", "status"], `${path}[${index}]`);
    exact(root.status, "pass", `${path}[${index}].status`);
    return {
      metric: identifier(root.metric, `${path}[${index}].metric`),
      status: "pass" as const,
    };
  });
  if (
    items.length === 0 ||
    new Set(items.map((item) => item.metric)).size !== items.length
  ) {
    throw new Error(`${path} must contain unique pass evaluations.`);
  }
  return items;
}

function observedEvaluations(
  value: unknown,
  path: string,
): CoffeeMachineCm01V3GoldenObservation["mechanical"]["evaluations"] {
  const items = array(value, path).map((value, index) => {
    const root = exactRecord(value, ["metric", "status"], `${path}[${index}]`);
    return {
      metric: identifier(root.metric, `${path}[${index}].metric`),
      status: text(root.status, `${path}[${index}].status`),
    };
  });
  if (new Set(items.map((item) => item.metric)).size !== items.length) {
    throw new Error(`${path} must contain unique metrics.`);
  }
  return items;
}

function producer(value: unknown, path: string): ProducerRef {
  const root = exactRecord(value, ["serverId", "tool"], path);
  return {
    serverId: identifier(root.serverId, `${path}.serverId`),
    tool: identifier(root.tool, `${path}.tool`),
  };
}

function assertUniqueRoles(reference: CoffeeMachineCm01V3GoldenReference): void {
  const roles = artifactsFor(reference).map((item) => item.role);
  if (new Set(roles).size !== roles.length) {
    throw new Error("$reference.expected must not repeat an artifact semantic role.");
  }
}

function assertNoDuplicateMetrics(reference: CoffeeMachineCm01V3GoldenReference): void {
  const metrics = measurementsFor(reference).map((item) => item.metric);
  if (new Set(metrics).size !== metrics.length) {
    throw new Error("$reference.expected must not repeat a measurement metric.");
  }
}

function sameArtifact(
  left: GoldenArtifactExpectation,
  right: GoldenArtifactExpectation,
): boolean {
  return left.role === right.role && left.kind === right.kind &&
    sameProducer(left.producer, right.producer);
}

function sameProducer(left: ProducerRef, right: ProducerRef): boolean {
  return left.serverId === right.serverId && left.tool === right.tool;
}

function role(value: unknown, path: string): CoffeeMachineCm01V3GoldenArtifactRole {
  if (
    value === "architecture-model" || value === "cad-plan" || value === "cad-script" ||
    value === "cad-step" || value === "modelica-result" || value === "erp-bom" ||
    value === "mechanical-step"
  ) return value;
  throw new Error(`${path} must be a reviewed CM-01 semantic artifact role.`);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) throw new Error(`${path} must contain exactly: ${expected.join(", ")}.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(parsed)) {
    throw new Error(`${path} must be a stable identifier.`);
  }
  return parsed;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function sha256(value: unknown, path: string): string {
  const digest = text(value, path);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${path} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new Error(`${path} must equal ${JSON.stringify(expected)}.`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
