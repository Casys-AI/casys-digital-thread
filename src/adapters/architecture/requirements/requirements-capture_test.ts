import { assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  assertRequirementsRecaptureProvenanceContinuity,
  isRecaptureRequirementsCapture,
  isTracedRequirementsCapture,
  isWriteRequirementsCapture,
  parseExactRequirementsCapture,
  REQUIREMENTS_CAPTURE_SCHEMA,
  REQUIREMENTS_RECAPTURE_SCHEMA,
  REQUIREMENTS_TRACED_CAPTURE_SCHEMA,
  REQUIREMENTS_TRACED_RECAPTURE_SCHEMA,
  requirementsCaptureObservedAt,
  requirementsCaptureProducerTool,
} from "./requirements-capture.ts";
import {
  MODEL_RECAPTURE_REQUIREMENTS_PRODUCER_TOOL,
  REQUIREMENTS_WRITE_PRODUCER_TOOL,
} from "../../../domain/architecture/requirements/requirements-recapture-proposal.ts";
import type { RequirementsBriefProvenance } from "../../../domain/architecture/requirements/requirements-brief-provenance.ts";

function fingerprint(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}

function capture(): Record<string, unknown> {
  return {
    schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
    operation: { id: "model.write-requirements", version: "1" },
    trustedRunId: "run:requirements",
    containerComponent: "Wing",
    partDefName: "WingRequirements",
    target: {
      kind: "part-definition",
      label: "Wing",
      elementId: "part-definition:wing",
    },
    architectureBasis: {
      snapshotId: "thread:drone-v4:r2",
      revision: 2,
      fingerprint: "a".repeat(64),
    },
    requirements: [{
      id: "max-tip-displacement",
      name: "Maximum tip displacement",
      metric: "tipDisplacement",
      operator: "<=",
      limit: { value: 3, unit: "mm" },
    }],
    seed: {
      artifactId: "artifact:seed",
      fingerprint: fingerprint("b"),
      producerRunId: "run:seed",
    },
    architecture: {
      artifactId: "artifact:architecture",
      fingerprint: fingerprint("c"),
      producerRunId: "run:architecture",
    },
    requirementsElementId: "requirement-usage:wing",
    requirementUsage: {
      id: "requirement-usage:wing",
      kind: "RequirementUsage",
    },
    constraintUsages: [{
      requirementId: "max-tip-displacement",
      id: "constraint-usage:max-tip-displacement",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage:max-tip-displacement",
    }],
    insertedAt: "2026-08-08T12:15:00.000Z",
  };
}

Deno.test("requirements capture parser preserves exact canonical schema-v3 identities", () => {
  const value = capture();
  const parsed = parseExactRequirementsCapture(value);
  assertEquals(parsed.schemaVersion, REQUIREMENTS_CAPTURE_SCHEMA);
  assertEquals(parsed.target.elementId, "part-definition:wing");
  assertEquals(parsed.requirements[0]?.limit, { value: 3, unit: "mm" });
  assertEquals(parsed.requirementUsage.id, "requirement-usage:wing");
  assertEquals(parsed.constraintUsages[0]?.id, parsed.constraintUsages[0]?.sourceId);
  assertEquals(deterministicJson(parsed), deterministicJson(value));
});

Deno.test("requirements capture parser preserves 3.0 producer and observed-at discriminant", () => {
  const parsed = parseExactRequirementsCapture(capture());
  assertEquals(isWriteRequirementsCapture(parsed), true);
  assertEquals(requirementsCaptureObservedAt(parsed), "2026-08-08T12:15:00.000Z");
  assertEquals(
    requirementsCaptureProducerTool(parsed),
    REQUIREMENTS_WRITE_PRODUCER_TOOL,
  );
});

Deno.test("requirements capture parser rejects every non-3.0 schema", () => {
  for (
    const schemaVersion of [
      "requirements-capture/1.0",
      "requirements-capture/2.0",
    ]
  ) {
    const value = capture();
    value.schemaVersion = schemaVersion;
    assertThrows(
      () => parseExactRequirementsCapture(value),
      Error,
      "schema is not exact",
    );
  }

  const missingIdentities = capture();
  delete missingIdentities.requirementUsage;
  delete missingIdentities.constraintUsages;
  assertThrows(() => parseExactRequirementsCapture(missingIdentities));
});

Deno.test("requirements capture parser requires a bijection of exact native identities", () => {
  const divergentSource = capture();
  const [constraint] = divergentSource.constraintUsages as Record<string, unknown>[];
  constraint!.sourceId = "constraint-usage:foreign";
  assertThrows(
    () => parseExactRequirementsCapture(divergentSource),
    Error,
    "id and sourceId must be identical",
  );

  const foreignRequirement = capture();
  const [foreign] = foreignRequirement.constraintUsages as Record<string, unknown>[];
  foreign!.requirementId = "unreviewed-requirement";
  assertThrows(
    () => parseExactRequirementsCapture(foreignRequirement),
    Error,
    "bijective with the captured requirements",
  );

  const wrongRequirementUsage = capture();
  (wrongRequirementUsage.requirementUsage as Record<string, unknown>).id =
    "requirement-usage:homonym";
  assertThrows(
    () => parseExactRequirementsCapture(wrongRequirementUsage),
    Error,
    "exact captured RequirementUsage identity",
  );
});

Deno.test("requirements capture parser rejects unreviewed root and nested fields", () => {
  assertThrows(() =>
    parseExactRequirementsCapture({ ...capture(), agentSource: "unreviewed" })
  );

  const nested = capture();
  (nested.target as Record<string, unknown>).inferredFromLabel = true;
  assertThrows(() => parseExactRequirementsCapture(nested));
});

Deno.test("requirements capture parser rejects malformed identities and anchors", () => {
  const wrongTarget = capture();
  (wrongTarget.target as Record<string, unknown>).kind = "part-usage";
  assertThrows(() => parseExactRequirementsCapture(wrongTarget));

  const wrongFingerprint = capture();
  (wrongFingerprint.architectureBasis as Record<string, unknown>).fingerprint = "A"
    .repeat(64);
  assertThrows(() => parseExactRequirementsCapture(wrongFingerprint));

  const wrongInstant = capture();
  wrongInstant.insertedAt = "2026-08-08T12:15:00Z";
  assertThrows(() => parseExactRequirementsCapture(wrongInstant));
});

Deno.test("requirements recapture parser preserves exact canonical schema-v4 identities", () => {
  const value = recapture();
  const parsed = parseExactRequirementsCapture(value);
  assertEquals(parsed.schemaVersion, REQUIREMENTS_RECAPTURE_SCHEMA);
  assertEquals(isRecaptureRequirementsCapture(parsed), true);
  assertEquals(isWriteRequirementsCapture(parsed), false);
  assertEquals(requirementsCaptureObservedAt(parsed), "2026-09-07T12:00:00.000Z");
  assertEquals(
    requirementsCaptureProducerTool(parsed),
    MODEL_RECAPTURE_REQUIREMENTS_PRODUCER_TOOL,
  );
  if (!isRecaptureRequirementsCapture(parsed)) {
    throw new Error("expected recapture discriminant");
  }
  assertEquals(parsed.subject.id, "reference-usage:wing-target");
  assertEquals(parsed.predecessor.artifactId, "artifact:prior-requirements");
  assertEquals(parsed.operation.id, "model.recapture-requirements");
  assertEquals(deterministicJson(parsed), deterministicJson(value));
});

Deno.test("requirements recapture parser refuses forged operation or producer pairs", () => {
  const writeAsRecapture = recapture();
  writeAsRecapture.operation = { id: "model.write-requirements", version: "1" };
  assertThrows(
    () => parseExactRequirementsCapture(writeAsRecapture),
    Error,
    "operation is not exact",
  );

  const recaptureAsWrite = capture();
  recaptureAsWrite.schemaVersion = REQUIREMENTS_RECAPTURE_SCHEMA;
  assertThrows(
    () => parseExactRequirementsCapture(recaptureAsWrite),
    Error,
    "non-exact fields",
  );

  const writeWithCapturedAt = capture();
  writeWithCapturedAt.capturedAt = "2026-09-07T12:00:00.000Z";
  assertThrows(
    () => parseExactRequirementsCapture(writeWithCapturedAt),
    Error,
    "non-exact fields",
  );
});

Deno.test("requirements recapture parser records subject without claiming 3.0 continuity", () => {
  const missingSubject = recapture();
  delete missingSubject.subject;
  assertThrows(() => parseExactRequirementsCapture(missingSubject));

  const collidingSubject = recapture();
  (collidingSubject.subject as Record<string, unknown>).id = "requirement-usage:wing";
  assertThrows(
    () => parseExactRequirementsCapture(collidingSubject),
    Error,
    "pairwise disjoint",
  );

  const subjectEqualsTarget = recapture();
  (subjectEqualsTarget.subject as Record<string, unknown>).id = "part-definition:wing";
  assertThrows(
    () => parseExactRequirementsCapture(subjectEqualsTarget),
    Error,
    "pairwise disjoint",
  );

  const constraintEqualsTarget = recapture();
  const [constraint] = constraintEqualsTarget.constraintUsages as Record<
    string,
    unknown
  >[];
  constraint!.id = "part-definition:wing";
  constraint!.sourceId = "part-definition:wing";
  assertThrows(
    () => parseExactRequirementsCapture(constraintEqualsTarget),
    Error,
    "pairwise disjoint",
  );
});

Deno.test("requirements capture parser validates every requirement fail-closed", () => {
  const extra = capture();
  const [requirement] = extra.requirements as Record<string, unknown>[];
  requirement!.comment = "not authoritative";
  assertThrows(() => parseExactRequirementsCapture(extra));

  const duplicate = capture();
  const [first] = duplicate.requirements as Record<string, unknown>[];
  duplicate.requirements = [first, { ...first, id: "second" }];
  assertThrows(
    () => parseExactRequirementsCapture(duplicate),
    Error,
    "repeats a requirement id or metric",
  );

  const unsupportedUnit = capture();
  const [unsupported] = unsupportedUnit.requirements as Record<string, unknown>[];
  unsupported!.limit = { value: 3, unit: "furlong" };
  assertThrows(
    () => parseExactRequirementsCapture(unsupportedUnit),
    Error,
    "not in the supported vocabulary",
  );
});

function recapture(): Record<string, unknown> {
  return {
    schemaVersion: REQUIREMENTS_RECAPTURE_SCHEMA,
    operation: { id: "model.recapture-requirements", version: "1" },
    trustedRunId: "run:requirements-recapture",
    containerComponent: "Wing",
    partDefName: "WingRequirements",
    target: {
      kind: "part-definition",
      label: "Wing",
      elementId: "part-definition:wing",
    },
    architectureBasis: {
      snapshotId: "thread:drone-v4:r70",
      revision: 70,
      fingerprint: "e".repeat(64),
    },
    requirements: [{
      id: "max-tip-displacement",
      name: "Maximum tip displacement",
      metric: "tipDisplacement",
      operator: "<=",
      limit: { value: 3, unit: "mm" },
    }],
    seed: {
      artifactId: "artifact:seed",
      fingerprint: fingerprint("b"),
      producerRunId: "run:seed",
    },
    architecture: {
      artifactId: "artifact:architecture-r70",
      fingerprint: fingerprint("e"),
      producerRunId: "run:architecture-r70",
    },
    predecessor: {
      artifactId: "artifact:prior-requirements",
      fingerprint: fingerprint("d"),
      producerRunId: "run:requirements",
    },
    requirementsElementId: "requirement-usage:wing",
    requirementUsage: {
      id: "requirement-usage:wing",
      kind: "RequirementUsage",
    },
    constraintUsages: [{
      requirementId: "max-tip-displacement",
      id: "constraint-usage:max-tip-displacement",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage:max-tip-displacement",
    }],
    capturedAt: "2026-09-07T12:00:00.000Z",
    subject: {
      id: "reference-usage:wing-target",
      kind: "ReferenceUsage",
      name: "target",
    },
  };
}

function tracedCapture(readOnly = false): Record<string, unknown> {
  const value = readOnly ? recapture() : capture();
  value.schemaVersion = readOnly
    ? REQUIREMENTS_TRACED_RECAPTURE_SCHEMA
    : REQUIREMENTS_TRACED_CAPTURE_SCHEMA;
  value.operation = {
    id: readOnly ? "model.recapture-requirements" : "model.write-requirements",
    version: "2",
  };
  const [requirement] = value.requirements as Record<string, unknown>[];
  requirement!.id = requirement!.metric;
  const [constraint] = value.constraintUsages as Record<string, unknown>[];
  constraint!.requirementId = requirement!.metric;
  value.briefProvenance = {
    schemaVersion: "requirements-brief-provenance/1.0",
    briefBasis: {
      kind: "approved-brief",
      projectId: "project:fixture",
      projectSnapshotId: "project:fixture:r3",
      projectRevision: 3,
      briefId: "brief:fixture",
      briefSnapshotId: "brief:fixture:r1",
      briefRevision: 1,
      approvedBriefFingerprint: fingerprint("d"),
    },
    briefContentFingerprint: fingerprint("e"),
    container: {
      sourceItem: {
        id: "brief-item:wing",
        kind: "objective",
        statement: "Constrain the reusable wing definition.",
        sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
      },
    },
    requirements: [{
      requirementId: "tipDisplacement",
      sourceItem: {
        id: "brief-item:displacement",
        kind: "success-criterion",
        statement: "Bound wing tip displacement under the reviewed load.",
        sourceRefs: [{ kind: "document", reference: "document:fixture:r1" }],
        dependsOnItemIds: ["brief-item:wing"],
      },
      declaredThreshold: { value: 3, unit: "mm" },
      transformation: "identity",
    }],
  } satisfies RequirementsBriefProvenance;
  return value;
}

Deno.test("traced requirements captures preserve exact V5/V6 origins, producers and timestamps", () => {
  for (const readOnly of [false, true]) {
    const value = tracedCapture(readOnly);
    const parsed = parseExactRequirementsCapture(value);
    assertEquals(isTracedRequirementsCapture(parsed), true);
    assertEquals(isWriteRequirementsCapture(parsed), !readOnly);
    assertEquals(isRecaptureRequirementsCapture(parsed), readOnly);
    assertEquals(
      requirementsCaptureProducerTool(parsed),
      readOnly ? "model.recapture-requirements@2" : "model.write-requirements@2",
    );
    assertEquals(
      requirementsCaptureObservedAt(parsed),
      readOnly ? "2026-09-07T12:00:00.000Z" : "2026-08-08T12:15:00.000Z",
    );
    assertEquals(deterministicJson(parsed), deterministicJson(value));
  }
});

Deno.test("traced V5 parser keeps the target and native requirements identities pairwise disjoint", () => {
  const targetEqualsRequirementUsage = tracedCapture();
  (targetEqualsRequirementUsage.target as Record<string, unknown>).elementId =
    "requirement-usage:wing";
  assertThrows(
    () => parseExactRequirementsCapture(targetEqualsRequirementUsage),
    Error,
    "pairwise disjoint",
  );

  const targetEqualsConstraintUsage = tracedCapture();
  (targetEqualsConstraintUsage.target as Record<string, unknown>).elementId =
    "constraint-usage:max-tip-displacement";
  assertThrows(
    () => parseExactRequirementsCapture(targetEqualsConstraintUsage),
    Error,
    "pairwise disjoint",
  );
});

Deno.test("requirements recaptures preserve their exact provenance era and traced origin", () => {
  const v3 = parseExactRequirementsCapture(capture());
  const v4 = parseExactRequirementsCapture(recapture());
  const v5 = parseExactRequirementsCapture(tracedCapture());
  const v6 = parseExactRequirementsCapture(tracedCapture(true));

  assertRequirementsRecaptureProvenanceContinuity(v4, v3);
  assertRequirementsRecaptureProvenanceContinuity(v4, v4);
  assertRequirementsRecaptureProvenanceContinuity(v6, v5);
  assertRequirementsRecaptureProvenanceContinuity(v6, v6);

  assertThrows(
    () => assertRequirementsRecaptureProvenanceContinuity(v4, v5),
    Error,
    "cannot downgrade a traced predecessor",
  );
  assertThrows(
    () => assertRequirementsRecaptureProvenanceContinuity(v4, v6),
    Error,
    "cannot downgrade a traced predecessor",
  );

  const sourceItemDrift = tracedCapture(true);
  const sourceItemProvenance = sourceItemDrift.briefProvenance as Record<
    string,
    unknown
  >;
  const [sourceItemOrigin] = sourceItemProvenance.requirements as Record<
    string,
    unknown
  >[];
  (sourceItemOrigin!.sourceItem as Record<string, unknown>).id =
    "brief-item:forged-origin";
  assertThrows(
    () =>
      assertRequirementsRecaptureProvenanceContinuity(
        parseExactRequirementsCapture(sourceItemDrift),
        v5,
      ),
    Error,
    "not exactly continuous",
  );

  const briefBasisDrift = tracedCapture(true);
  const briefBasisProvenance = briefBasisDrift.briefProvenance as Record<
    string,
    unknown
  >;
  ((briefBasisProvenance.briefBasis as Record<string, unknown>)
    .approvedBriefFingerprint as Record<string, unknown>).digest = "f".repeat(64);
  assertThrows(
    () =>
      assertRequirementsRecaptureProvenanceContinuity(
        parseExactRequirementsCapture(briefBasisDrift),
        v5,
      ),
    Error,
    "not exactly continuous",
  );
});

Deno.test("traced captures preserve 0.2 mm declaration while rechecking exact native 200000 nm", () => {
  for (const readOnly of [false, true]) {
    const value = tracedCapture(readOnly);
    const [requirement] = value.requirements as Record<string, unknown>[];
    requirement!.limit = { value: 200_000, unit: "nm" };
    const provenance = value.briefProvenance as Record<string, unknown>;
    const [origin] = provenance.requirements as Record<string, unknown>[];
    origin!.declaredThreshold = { value: 0.2, unit: "mm" };
    origin!.transformation = "fractional-mm-to-nm";
    const parsed = parseExactRequirementsCapture(value);
    if (!isTracedRequirementsCapture(parsed)) {
      throw new Error("Expected traced capture.");
    }
    assertEquals(parsed.briefProvenance.requirements[0]!.declaredThreshold, {
      value: 0.2,
      unit: "mm",
    });
    assertEquals(
      parsed.briefProvenance.requirements[0]!.transformation,
      "fractional-mm-to-nm",
    );
    assertEquals(parsed.requirements[0]!.limit, { value: 200_000, unit: "nm" });
    origin!.transformation = "identity";
    assertThrows(() => parseExactRequirementsCapture(value));
  }
});

Deno.test("traced captures preserve MPa declaration while rechecking exact native Pa threshold", () => {
  for (const readOnly of [false, true]) {
    const value = tracedCapture(readOnly);
    const [requirement] = value.requirements as Record<string, unknown>[];
    requirement!.limit = { value: 260_000_000, unit: "Pa" };
    const provenance = value.briefProvenance as Record<string, unknown>;
    const [origin] = provenance.requirements as Record<string, unknown>[];
    origin!.declaredThreshold = { value: 260, unit: "MPa" };
    origin!.transformation = "MPa-to-Pa";
    const parsed = parseExactRequirementsCapture(value);
    if (!isTracedRequirementsCapture(parsed)) {
      throw new Error("Expected traced capture.");
    }
    assertEquals(parsed.briefProvenance.requirements[0]!.declaredThreshold, {
      value: 260,
      unit: "MPa",
    });
    assertEquals(parsed.requirements[0]!.limit, { value: 260_000_000, unit: "Pa" });
    origin!.declaredThreshold = { value: 261, unit: "MPa" };
    assertThrows(() => parseExactRequirementsCapture(value));
  }
});

Deno.test("traced captures reject every schema-operation version mismatch", () => {
  for (const readOnly of [false, true]) {
    for (
      const operation of [
        { id: "model.write-requirements", version: "1" },
        { id: "model.recapture-requirements", version: "1" },
        { id: "model.write-requirements", version: "3" },
        {
          id: readOnly ? "model.write-requirements" : "model.recapture-requirements",
          version: "2",
        },
      ]
    ) {
      assertThrows(() =>
        parseExactRequirementsCapture({ ...tracedCapture(readOnly), operation })
      );
    }
    const missing = tracedCapture(readOnly);
    delete missing.briefProvenance;
    assertThrows(() => parseExactRequirementsCapture(missing));
    const unknown = tracedCapture(readOnly);
    unknown.unreviewed = true;
    assertThrows(() => parseExactRequirementsCapture(unknown));
    const wrongTimestamp = tracedCapture(readOnly);
    wrongTimestamp[readOnly ? "insertedAt" : "capturedAt"] = "2026-09-07T12:00:00.000Z";
    assertThrows(() => parseExactRequirementsCapture(wrongTimestamp));
  }
});

Deno.test("traced captures require metric-origin-native constraint bijection", () => {
  for (const readOnly of [false, true]) {
    const orphan = tracedCapture(readOnly);
    const provenance = orphan.briefProvenance as Record<string, unknown>;
    const [origin] = provenance.requirements as Record<string, unknown>[];
    origin!.requirementId = "orphanMetric";
    assertThrows(() => parseExactRequirementsCapture(orphan));

    const duplicate = tracedCapture(readOnly);
    const duplicateProvenance = duplicate.briefProvenance as Record<string, unknown>;
    duplicateProvenance.requirements = [
      ...(duplicateProvenance.requirements as unknown[]),
      ...(duplicateProvenance.requirements as unknown[]),
    ];
    assertThrows(() => parseExactRequirementsCapture(duplicate));

    const missing = tracedCapture(readOnly);
    (missing.briefProvenance as Record<string, unknown>).requirements = [];
    assertThrows(() => parseExactRequirementsCapture(missing));

    const slug = tracedCapture(readOnly);
    const [requirement] = slug.requirements as Record<string, unknown>[];
    requirement!.metric = "anotherMetric";
    assertThrows(() => parseExactRequirementsCapture(slug));

    const foreignNative = tracedCapture(readOnly);
    const [constraint] = foreignNative.constraintUsages as Record<string, unknown>[];
    constraint!.requirementId = "foreignMetric";
    assertThrows(() => parseExactRequirementsCapture(foreignNative));
  }
});

Deno.test("traced captures validate nested source records and declared normalization fail-closed", () => {
  for (
    const mutation of [
      (origin: Record<string, unknown>) => origin.unreviewed = "extra",
      (origin: Record<string, unknown>) =>
        origin.sourceItem = { id: "brief-item:missing" },
      (origin: Record<string, unknown>) => {
        (origin.sourceItem as Record<string, unknown>).sourceRefs = [];
      },
      (origin: Record<string, unknown>) => {
        (origin.sourceItem as Record<string, unknown>).kind = "observed-fact";
      },
      (origin: Record<string, unknown>) =>
        origin.declaredThreshold = { value: 4, unit: "mm" },
      (origin: Record<string, unknown>) =>
        origin.declaredThreshold = { value: 3, unit: "m" },
      (origin: Record<string, unknown>) =>
        origin.declaredThreshold = { value: NaN, unit: "mm" },
      (origin: Record<string, unknown>) => origin.transformation = "MPa-to-Pa",
      (origin: Record<string, unknown>) => origin.transformation = "agent-conversion",
    ]
  ) {
    const value = tracedCapture();
    const provenance = value.briefProvenance as Record<string, unknown>;
    const [origin] = provenance.requirements as Record<string, unknown>[];
    mutation(origin!);
    assertThrows(() => parseExactRequirementsCapture(value));
  }
});

Deno.test("historical V3/V4 remain TRACE GAP and reject invented provenance", () => {
  for (const value of [capture(), recapture()]) {
    const parsed = parseExactRequirementsCapture(value);
    assertEquals(isTracedRequirementsCapture(parsed), false);
    assertEquals("briefProvenance" in parsed, false);
    assertThrows(() =>
      parseExactRequirementsCapture({
        ...value,
        briefProvenance: tracedCapture().briefProvenance,
      })
    );
    assertThrows(() =>
      parseExactRequirementsCapture({
        ...value,
        operation: { ...(value.operation as Record<string, unknown>), version: "2" },
      })
    );
  }
});
