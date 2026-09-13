/** Closed-parser tests; no storage, provider, or SysON claim. */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { EngineeringDecisionProposalParameter } from "../project/engineering-project.ts";
import type { ProjectBriefItem } from "../project/project-brief.ts";
import {
  DOCUMENTARY_CLAUSE_RESPONSE_SCHEMA,
  documentaryClauseResponseArtifactId,
  documentaryClauseResponseClaimId,
  documentaryClauseResponseItemFingerprint,
  documentaryClauseResponseParameters,
  documentaryClauseResponseUri,
  parseDocumentaryClauseResponseCapture,
  parseDocumentaryClauseResponseParameters,
  RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
} from "./documentary-clause-response.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

function parameter(
  key: string,
  value: string | number | boolean,
): EngineeringDecisionProposalParameter {
  return { key, label: key, value };
}

function sourceItem(): ProjectBriefItem {
  return {
    id: "exclusion.flight",
    kind: "exclusion",
    statement: "No real-world flight is claimed from this bench evidence.",
    sourceRefs: [{ kind: "intent", reference: "conversation:exclusion" }],
  };
}

function agentResourceParameters() {
  return [
    parameter("clause.source.0.kind", "agent-resource"),
    parameter(
      "clause.source.0.uri",
      `casys://agent-resource-capture/sha256/${C}`,
    ),
    parameter("clause.source.0.name", "exclusion-note.md"),
    parameter("clause.source.0.mimeType", "text/markdown"),
    parameter("clause.source.0.representation", "text"),
    parameter("clause.source.0.byteCount", 42),
    parameter("clause.source.0.fingerprint", `sha256:${C}`),
  ];
}

function parameters(successor = false): EngineeringDecisionProposalParameter[] {
  return [
    parameter("clause.sourceItemId", "exclusion.flight"),
    parameter(
      "clause.answer",
      "The approved brief excludes live flight; recorded proofs stay bench-only.",
    ),
    parameter("clause.scope", "context"),
    parameter("clause.brief.kind", "approved-brief"),
    parameter("clause.brief.projectId", "project:clause"),
    parameter("clause.brief.projectSnapshotId", "project:clause:r4"),
    parameter("clause.brief.projectRevision", 4),
    parameter("clause.brief.briefId", "brief:clause"),
    parameter("clause.brief.briefSnapshotId", "brief:clause:r7"),
    parameter("clause.brief.briefRevision", 7),
    parameter("clause.brief.approvedBriefFingerprint", `sha256:${A}`),
    parameter("clause.itemKind", "exclusion"),
    parameter("clause.itemFingerprint", `sha256:${B}`),
    parameter("clause.sourceCount", 1),
    ...agentResourceParameters(),
    ...(successor
      ? [
        parameter("clause.predecessorArtifactId", "documentary-clause-response-prior"),
        parameter("clause.predecessorFingerprint", `sha256:${D}`),
        parameter("clause.predecessorRunId", "run:prior"),
      ]
      : []),
  ];
}

function capture(successor = false) {
  const parsed = parseDocumentaryClauseResponseParameters(parameters(successor));
  return {
    schemaVersion: DOCUMENTARY_CLAUSE_RESPONSE_SCHEMA,
    operation: RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
    mode: "documentary-proposal",
    recording: { status: "proposal", authorKind: "agent" },
    projectId: "project:clause",
    trustedRunId: "run:clause-seal",
    linkedAt: "2026-09-13T10:00:00.000Z",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread:clause:r3",
      revision: 3,
      subjectId: "subject:clause",
    },
    briefBasis: parsed.briefBasis,
    sourceItem: sourceItem(),
    claim: {
      id: `documentary-clause-response-${A}`,
      revision: successor ? 2 : 1,
      sourceItemId: "exclusion.flight",
      ...(successor
        ? {
          predecessor: {
            artifactId: "documentary-clause-response-prior",
            fingerprint: { algorithm: "sha256" as const, digest: D },
            producerRunId: "run:prior",
          },
        }
        : {}),
    },
    answer: parsed.answer,
    scope: parsed.scope,
    sources: parsed.sources,
    decision: {
      decisionId: "decision:clause",
      inputFingerprint: { algorithm: "sha256" as const, digest: B },
    },
    parameters: parameters(successor),
  };
}

Deno.test("clause-response parameters round-trip one agent-resource source", () => {
  const parsed = parseDocumentaryClauseResponseParameters(parameters());
  assertEquals(parsed.sourceItemId, "exclusion.flight");
  assertEquals(parsed.itemKind, "exclusion");
  assertEquals(parsed.sources.length, 1);
  assertEquals(parsed.sources[0]!.kind, "agent-resource");
  assertEquals(parsed.predecessor, undefined);
  const encoded = documentaryClauseResponseParameters(parsed);
  assertEquals(
    parseDocumentaryClauseResponseParameters(encoded),
    parsed,
  );
});

Deno.test("clause-response parameters round-trip a successor with predecessor", () => {
  const parsed = parseDocumentaryClauseResponseParameters(parameters(true));
  assertEquals(parsed.predecessor?.artifactId, "documentary-clause-response-prior");
  assertEquals(
    parseDocumentaryClauseResponseParameters(
      documentaryClauseResponseParameters(parsed),
    ),
    parsed,
  );
});

Deno.test("clause-response parameters refuse a caller URL+digest shortcut", () => {
  const forged = [
    ...parameters().filter((item) => !item.key.startsWith("clause.source.0.")),
    parameter("clause.source.0.kind", "agent-resource"),
    parameter("clause.source.0.url", "https://example.invalid/note.md"),
    parameter("clause.source.0.digest", C),
  ];
  assertThrows(
    () => parseDocumentaryClauseResponseParameters(forged),
    TypeError,
    "clause.source.0.uri is required",
  );
});

Deno.test("clause-response parameters refuse zero sources and oversized answers", () => {
  const none = parameters().map((item) =>
    item.key === "clause.sourceCount" ? parameter(item.key, 0) : item
  );
  assertThrows(
    () => parseDocumentaryClauseResponseParameters(none),
    TypeError,
    "clause.sourceCount",
  );
  const long = parameters().map((item) =>
    item.key === "clause.answer" ? parameter(item.key, "x".repeat(4097)) : item
  );
  assertThrows(
    () => parseDocumentaryClauseResponseParameters(long),
    TypeError,
    "clause.answer",
  );
});

Deno.test("clause-response parameters refuse a partial predecessor", () => {
  assertThrows(
    () =>
      parseDocumentaryClauseResponseParameters([
        ...parameters(),
        parameter("clause.predecessorArtifactId", "documentary-clause-response-prior"),
      ]),
    TypeError,
    "predecessor metadata",
  );
});

Deno.test("clause-response capture parses a first documentary proposal", () => {
  const parsed = parseDocumentaryClauseResponseCapture(capture());
  assertEquals(parsed.recording.status, "proposal");
  assertEquals(parsed.recording.authorKind, "agent");
  assertEquals(parsed.mode, "documentary-proposal");
  assertEquals(parsed.claim.revision, 1);
  assertEquals("approved" in parsed.recording, false);
  assertEquals("agentApproved" in parsed, false);
});

Deno.test("clause-response capture refuses a content-acceptance boolean", () => {
  assertThrows(
    () =>
      parseDocumentaryClauseResponseCapture({
        ...capture(),
        recording: {
          status: "proposal",
          authorKind: "agent",
          agentApproved: true,
        },
      }),
    TypeError,
    "unsupported field",
  );
});

Deno.test("clause-response capture refuses a latest Thread basis", () => {
  const value = capture();
  (value.basis as { snapshotId: string }).snapshotId = "latest";
  assertThrows(
    () => parseDocumentaryClauseResponseCapture(value),
    TypeError,
    "latest",
  );
});

Deno.test("clause-response capture refuses a mismatched source item", () => {
  const value = capture();
  (value.sourceItem as { id: string }).id = "other.item";
  assertThrows(
    () => parseDocumentaryClauseResponseCapture(value),
    TypeError,
    "sourceItem.id",
  );
});

Deno.test("identities are digest-derived and refuse unsafe project ids", async () => {
  const fingerprint = { algorithm: "sha256" as const, digest: A };
  assertEquals(
    documentaryClauseResponseArtifactId(fingerprint),
    `documentary-clause-response-${A}`,
  );
  assertEquals(
    documentaryClauseResponseUri(fingerprint),
    `casys://documentary-clause-response/sha256/${A}`,
  );
  const claim = await documentaryClauseResponseClaimId(
    "project:clause",
    "exclusion.flight",
  );
  assertEquals(claim.startsWith("documentary-clause-response-"), true);
  await assertRejects(
    () => documentaryClauseResponseClaimId("project with space", "item"),
    TypeError,
  );
  const itemFingerprint = await documentaryClauseResponseItemFingerprint(
    sourceItem(),
  );
  assertEquals(itemFingerprint.algorithm, "sha256");
  assertEquals(itemFingerprint.digest.length, 64);
});
