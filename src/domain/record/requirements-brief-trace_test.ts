/** Synthetic closed-parser tests; no storage, provider, or SysON claim. */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { EngineeringDecisionProposalParameter } from "../project/engineering-project.ts";
import {
  parseRequirementsBriefTraceCapture,
  parseRequirementsBriefTraceParameters,
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
  REQUIREMENTS_BRIEF_TRACE_SCHEMA,
  requirementsBriefTraceArtifactId,
  requirementsBriefTraceClaimId,
  requirementsBriefTraceParameters,
  requirementsBriefTraceUri,
} from "./requirements-brief-trace.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const CLAIM = `requirements-brief-claim-${D}`;
type CaptureSchema =
  | "requirements-capture/3.0"
  | "requirements-capture/4.0"
  | "requirements-capture/5.0"
  | "requirements-capture/6.0";

function parameter(
  key: string,
  value: string | number | boolean,
  unit?: string,
): EngineeringDecisionProposalParameter {
  return unit === undefined
    ? { key, label: key, value }
    : { key, label: key, value, unit };
}

function predecessorParameters(): EngineeringDecisionProposalParameter[] {
  return [
    parameter("trace.predecessorArtifactId", "requirements-brief-trace:prior"),
    parameter("trace.predecessorFingerprint", `sha256:${D}`),
    parameter("trace.predecessorRunId", "run:prior"),
  ];
}

function parameters(
  schema: CaptureSchema = "requirements-capture/3.0",
  successor = false,
): EngineeringDecisionProposalParameter[] {
  return [
    parameter("requirements.containerComponent", "ArticulatedArm"),
    parameter("requirements.sourceProjectId", "project:trace"),
    parameter("requirements.sourceProjectSnapshotId", "project:trace:r3"),
    parameter("requirements.sourceProjectRevision", 3),
    parameter("requirements.sourceBriefId", "brief:trace"),
    parameter("requirements.sourceBriefSnapshotId", "brief:trace:r1"),
    parameter("requirements.sourceBriefRevision", 1),
    parameter("requirements.sourceBriefFingerprint", `sha256:${A}`),
    parameter("requirements.sourceBriefContentFingerprint", `sha256:${B}`),
    parameter("requirements.containerSourceItemId", "item:container"),
    parameter("requirement.displacement.name", "Maximum arm displacement"),
    parameter("requirement.displacement.metric", "arm_max_displacement"),
    parameter("requirement.displacement.operator", "<="),
    parameter("requirement.displacement.threshold", 2, "mm"),
    parameter("requirement.displacement.sourceItemId", "item:displacement"),
    parameter("requirement.displacement.declaredThreshold", 2, "mm"),
    parameter("trace.artifactId", "requirements-capture:exact"),
    parameter("trace.captureFingerprint", `sha256:${C}`),
    parameter("trace.producerRunId", "run:requirements"),
    parameter("trace.captureSchema", schema),
    ...(successor ? predecessorParameters() : []),
  ];
}

function sourceItem(id: string, kind: "mission-scenario" | "success-criterion") {
  return {
    id,
    kind,
    statement: `${id} reviewed statement.`,
    sourceRefs: [{ kind: "intent", reference: "conversation:trace" }],
  };
}

function predecessor() {
  return {
    artifactId: "requirements-brief-trace:prior",
    fingerprint: { algorithm: "sha256" as const, digest: D },
    producerRunId: "run:prior",
  };
}

function capture(
  schema: CaptureSchema = "requirements-capture/3.0",
  successor = false,
) {
  const prior = successor ? predecessor() : undefined;
  return {
    schemaVersion: REQUIREMENTS_BRIEF_TRACE_SCHEMA,
    operation: RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
    mode: "retrospective-documentary",
    projectId: "project:trace",
    trustedRunId: "run:trace-seal",
    linkedAt: "2026-09-07T08:15:30.000Z",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread:trace:r8",
      revision: 8,
      subjectId: "subject:arm",
    },
    requirementsCapture: {
      artifactId: "requirements-capture:exact",
      fingerprint: { algorithm: "sha256", digest: C },
      producerRunId: "run:requirements",
      schemaVersion: schema,
    },
    claim: {
      id: CLAIM,
      revision: successor ? 2 : 1,
      targetElementId: "element:part-definition:arm",
      requirementId: "arm_max_displacement",
      ...(prior ? { predecessor: prior } : {}),
    },
    decision: {
      decisionId: "decision:trace",
      inputFingerprint: { algorithm: "sha256", digest: D },
    },
    parameters: parameters(schema, successor),
    briefProvenance: {
      schemaVersion: "requirements-brief-provenance/1.0",
      briefBasis: {
        kind: "approved-brief",
        projectId: "project:trace",
        projectSnapshotId: "project:trace:r3",
        projectRevision: 3,
        briefId: "brief:trace",
        briefSnapshotId: "brief:trace:r1",
        briefRevision: 1,
        approvedBriefFingerprint: { algorithm: "sha256", digest: A },
      },
      briefContentFingerprint: { algorithm: "sha256", digest: B },
      container: { sourceItem: sourceItem("item:container", "mission-scenario") },
      requirements: [{
        requirementId: "arm_max_displacement",
        sourceItem: sourceItem("item:displacement", "success-criterion"),
        declaredThreshold: { value: 2, unit: "mm" },
        transformation: "identity",
      }],
    },
  };
}

Deno.test("first atomic claim round-trips all accepted schemas", () => {
  for (
    const schema of [
      "requirements-capture/3.0",
      "requirements-capture/4.0",
      "requirements-capture/5.0",
      "requirements-capture/6.0",
    ] as const
  ) {
    const parsed = parseRequirementsBriefTraceCapture(capture(schema));
    assertEquals(parsed.requirementsCapture.schemaVersion, schema);
    assertEquals(parsed.claim.revision, 1);
    assertEquals(
      parseRequirementsBriefTraceCapture(JSON.parse(JSON.stringify(parsed))),
      parsed,
    );
  }
});

Deno.test("successor round-trips exact optional predecessor triple", () => {
  const parsed = parseRequirementsBriefTraceCapture(
    capture("requirements-capture/6.0", true),
  );
  assertEquals(parsed.claim, {
    id: CLAIM,
    revision: 2,
    targetElementId: "element:part-definition:arm",
    requirementId: "arm_max_displacement",
    predecessor: predecessor(),
  });
  assertEquals(
    parseRequirementsBriefTraceParameters(parsed.parameters).predecessor,
    predecessor(),
  );
  assertEquals(
    parseRequirementsBriefTraceParameters(
      requirementsBriefTraceParameters(
        parseRequirementsBriefTraceParameters(parsed.parameters),
      ),
    ).predecessor,
    predecessor(),
  );
  assertEquals(
    parseRequirementsBriefTraceCapture(JSON.parse(JSON.stringify(parsed))),
    parsed,
  );
});

Deno.test("predecessor triple is all-or-nothing, unitless, and must equal the claim", () => {
  const base = parameters();
  for (
    const changed of [
      [...base, predecessorParameters()[0]!],
      [...base, predecessorParameters()[0]!, predecessorParameters()[1]!],
      [
        ...base,
        ...predecessorParameters().map((item) =>
          item.key === "trace.predecessorRunId" ? { ...item, unit: "run" } : item
        ),
      ],
      [
        ...base,
        ...predecessorParameters().map((item) =>
          item.key === "trace.predecessorFingerprint"
            ? parameter(item.key, "sha256:BAD")
            : item
        ),
      ],
    ]
  ) assertThrows(() => parseRequirementsBriefTraceParameters(changed), TypeError);
  const baseCapture = capture("requirements-capture/5.0", true);
  assertThrows(
    () =>
      parseRequirementsBriefTraceCapture({
        ...baseCapture,
        claim: {
          ...baseCapture.claim,
          predecessor: {
            ...predecessor(),
            artifactId: "requirements-brief-trace:other",
          },
        },
      }),
    TypeError,
  );
});

Deno.test("one trace claim selects exactly one existing requirement and source", () => {
  const second = [
    parameter("requirement.stress.name", "Maximum arm stress"),
    parameter("requirement.stress.metric", "arm_max_stress"),
    parameter("requirement.stress.operator", "<="),
    parameter("requirement.stress.threshold", 90, "MPa"),
    parameter("requirement.stress.sourceItemId", "item:stress"),
    parameter("requirement.stress.declaredThreshold", 90, "MPa"),
  ];
  assertThrows(
    () => parseRequirementsBriefTraceParameters([...parameters(), ...second]),
  );
});

Deno.test("claim requires exact metric, target, id and lineage revision", () => {
  const base = capture();
  for (
    const changed of [
      { ...base, claim: { ...base.claim, id: "requirements-brief-claim-no" } },
      { ...base, claim: { ...base.claim, revision: 2 } },
      { ...base, claim: { ...base.claim, targetElementId: "not a stable id" } },
      { ...base, claim: { ...base.claim, requirementId: "arm_max_stress" } },
      { ...base, claim: { ...base.claim, extra: true } },
    ]
  ) assertThrows(() => parseRequirementsBriefTraceCapture(changed), TypeError);
  const successor = capture("requirements-capture/6.0", true);
  assertThrows(
    () =>
      parseRequirementsBriefTraceCapture({
        ...successor,
        claim: { ...successor.claim, revision: 1 },
      }),
    TypeError,
  );
});

Deno.test("metadata is closed and only exact capture schemas are accepted", () => {
  const base = parameters();
  for (
    const changed of [
      [...base, parameter("trace.artifactId", "requirements-capture:duplicate")],
      base.filter((item) => item.key !== "trace.producerRunId"),
      base.map((item) =>
        item.key === "trace.captureSchema"
          ? parameter(item.key, "requirements-capture/7.0")
          : item
      ),
      [...base, parameter("trace.extra", "forged")],
    ]
  ) assertThrows(() => parseRequirementsBriefTraceParameters(changed), TypeError);
});

Deno.test("capture rejects all material provenance mismatch", () => {
  const base = capture();
  const provenance = base.briefProvenance;
  for (
    const changed of [
      {
        ...base,
        requirementsCapture: {
          ...base.requirementsCapture,
          artifactId: "requirements-capture:other",
        },
      },
      {
        ...base,
        briefProvenance: {
          ...provenance,
          briefBasis: { ...provenance.briefBasis, projectId: "project:other" },
        },
      },
      {
        ...base,
        briefProvenance: {
          ...provenance,
          briefContentFingerprint: { algorithm: "sha256", digest: A },
        },
      },
      {
        ...base,
        briefProvenance: {
          ...provenance,
          container: { sourceItem: sourceItem("item:other", "mission-scenario") },
        },
      },
      {
        ...base,
        briefProvenance: {
          ...provenance,
          requirements: [{
            ...provenance.requirements[0],
            sourceItem: sourceItem("item:other", "success-criterion"),
          }],
        },
      },
      {
        ...base,
        briefProvenance: {
          ...provenance,
          requirements: [{
            ...provenance.requirements[0],
            declaredThreshold: { value: 3, unit: "mm" },
          }],
        },
      },
      {
        ...base,
        briefProvenance: {
          ...provenance,
          requirements: [{
            ...provenance.requirements[0],
            transformation: "MPa-to-Pa",
          }],
        },
      },
    ]
  ) assertThrows(() => parseRequirementsBriefTraceCapture(changed), TypeError);
});

Deno.test("capture rejects malformed date and scalar type canonicalization", () => {
  const base = capture();
  for (
    const changed of [
      { ...base, linkedAt: "2026-09-07T08:15:30Z" },
      {
        ...base,
        parameters: base.parameters.map((item) =>
          item.key === "requirement.displacement.threshold"
            ? parameter(item.key, "2", "mm")
            : item
        ),
      },
    ]
  ) assertThrows(() => parseRequirementsBriefTraceCapture(changed));
});

Deno.test("claim and capture artifact identities are deterministic", async () => {
  const fingerprint = { algorithm: "sha256" as const, digest: D };
  assertEquals(
    requirementsBriefTraceArtifactId(fingerprint),
    `requirements-brief-trace-${D}`,
  );
  assertEquals(
    requirementsBriefTraceUri(fingerprint),
    `casys://requirements-brief-trace/sha256/${D}`,
  );
  assertEquals(
    (await requirementsBriefTraceClaimId(
      "project:trace",
      "element:part-definition:arm",
      "arm_max_displacement",
    )).startsWith("requirements-brief-claim-"),
    true,
  );
  await assertRejects(
    () => requirementsBriefTraceClaimId("project with space", "element:arm", "metric"),
    TypeError,
  );
});
