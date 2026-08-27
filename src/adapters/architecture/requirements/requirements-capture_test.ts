import { assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  parseExactRequirementsCapture,
  REQUIREMENTS_CAPTURE_SCHEMA,
} from "./requirements-capture.ts";

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
