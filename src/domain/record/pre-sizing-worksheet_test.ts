/** Closed-parser tests; no storage, provider, or SysON claim. */
import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringDecisionProposalParameter } from "../project/engineering-project.ts";
import {
  parsePreSizingWorksheetCapture,
  parsePreSizingWorksheetParameters,
  preSizingWorksheetArtifactId,
  preSizingWorksheetParameters,
  preSizingWorksheetUri,
  RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION,
} from "./pre-sizing-worksheet.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function parameter(
  key: string,
  value: string | number | boolean,
): EngineeringDecisionProposalParameter {
  return { key, label: key, value };
}

function agentResourceParameters() {
  return [
    parameter("presizing.source.0.kind", "agent-resource"),
    parameter(
      "presizing.source.0.uri",
      `casys://agent-resource-capture/sha256/${C}`,
    ),
    parameter("presizing.source.0.name", "hover-power-sheet.md"),
    parameter("presizing.source.0.mimeType", "text/markdown"),
    parameter("presizing.source.0.representation", "text"),
    parameter("presizing.source.0.byteCount", 42),
    parameter("presizing.source.0.fingerprint", `sha256:${C}`),
  ];
}

function parameters(): EngineeringDecisionProposalParameter[] {
  return [
    parameter("presizing.worksheetId", "hover-power"),
    parameter("presizing.revision", 1),
    parameter("presizing.title", "Hover power pre-sizing"),
    parameter("presizing.quantityCount", 2),
    parameter("presizing.sourceCount", 1),
    parameter("presizing.quantity.0.id", "hover-current"),
    parameter("presizing.quantity.0.label", "Hover current per motor"),
    parameter("presizing.quantity.0.value", "3.25"),
    parameter("presizing.quantity.0.unit", "A"),
    parameter("presizing.quantity.0.sourceIndex", 0),
    parameter("presizing.quantity.1.id", "hover-voltage"),
    parameter("presizing.quantity.1.value", "14.8"),
    parameter("presizing.quantity.1.unit", "V"),
    parameter("presizing.quantity.1.sourceIndex", 0),
    parameter(
      "presizing.quantity.1.assumption",
      "Nominal 4S pack voltage; no discharge curve.",
    ),
    ...agentResourceParameters(),
  ];
}

Deno.test("pre-sizing worksheet parameters round-trip", () => {
  const proposal = parsePreSizingWorksheetParameters(parameters());
  assertEquals(proposal.worksheetId, "hover-power");
  assertEquals(proposal.revision, 1);
  assertEquals(proposal.quantities.length, 2);
  assertEquals(proposal.quantities[1]?.assumption?.includes("4S"), true);
  assertEquals(proposal.sources.length, 1);
  const encoded = preSizingWorksheetParameters(proposal);
  assertEquals(parsePreSizingWorksheetParameters(encoded), proposal);
});

Deno.test("pre-sizing worksheet parameters refuse gaps and junk", () => {
  assertThrows(
    () =>
      parsePreSizingWorksheetParameters(
        parameters().filter((item) => item.key !== "presizing.quantity.0.value"),
      ),
    TypeError,
    "presizing.quantity.0.value",
  );
  assertThrows(
    () =>
      parsePreSizingWorksheetParameters([
        ...parameters(),
        parameter("presizing.extra", "nope"),
      ]),
    TypeError,
    "Unexpected pre-sizing parameter",
  );
  assertThrows(
    () =>
      parsePreSizingWorksheetParameters(
        parameters().map((item) =>
          item.key === "presizing.quantity.0.value" ? { ...item, value: "3.25A" } : item
        ),
      ),
    TypeError,
    "strict decimal",
  );
  assertThrows(
    () =>
      parsePreSizingWorksheetParameters(
        parameters().map((item) =>
          item.key === "presizing.quantity.0.sourceIndex" ? { ...item, value: 7 } : item
        ),
      ),
    TypeError,
    "out of range",
  );
  assertThrows(
    () =>
      parsePreSizingWorksheetParameters(
        parameters().map((item) =>
          item.key === "presizing.quantity.1.id"
            ? { ...item, value: "hover-current" }
            : item
        ),
      ),
    TypeError,
    "duplicate",
  );
  assertThrows(
    () =>
      parsePreSizingWorksheetParameters(
        parameters().map((item) =>
          item.key === "presizing.quantity.0.value" ? { ...item, unit: "A" } : item
        ),
      ),
    TypeError,
    "must not carry a unit",
  );
  assertThrows(
    () =>
      parsePreSizingWorksheetParameters(
        parameters().map((item) =>
          item.key === "presizing.quantity.0.value"
            ? ({
              key: item.key,
              value: item.value,
            } as unknown as EngineeringDecisionProposalParameter)
            : item
        ),
      ),
    TypeError,
    "label",
  );
});

Deno.test("pre-sizing worksheet capture validates the sealed shape", () => {
  const proposal = parsePreSizingWorksheetParameters(parameters());
  const encoded = preSizingWorksheetParameters(proposal);
  const capture = parsePreSizingWorksheetCapture({
    schemaVersion: "pre-sizing-worksheet/1.0",
    operation: { ...RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION },
    mode: "documentary-evidence",
    recording: { status: "recorded", authorKind: "agent" },
    projectId: "project:drone",
    trustedRunId: "run:seal",
    linkedAt: "2026-09-25T00:00:00.000Z",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "snapshot:r1",
      revision: 1,
      subjectId: "project:drone",
    },
    claim: {
      id: `pre-sizing-worksheet-${B}`,
      revision: 1,
      worksheetId: "hover-power",
    },
    title: proposal.title,
    quantities: [...proposal.quantities],
    sources: [...proposal.sources],
    decision: {
      decisionId: "decision:1",
      inputFingerprint: { algorithm: "sha256", digest: C },
    },
    parameters: [...encoded],
  });
  assertEquals(capture.claim.worksheetId, "hover-power");
  assertEquals(capture.quantities.length, 2);
  assertThrows(
    () =>
      parsePreSizingWorksheetCapture({
        schemaVersion: "pre-sizing-worksheet/1.0",
        operation: { ...RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION },
        mode: "documentary-evidence",
        recording: { status: "recorded", authorKind: "agent" },
        projectId: "project:drone",
        trustedRunId: "run:seal",
        linkedAt: "2026-09-25T00:00:00.000Z",
        basis: {
          kind: "thread-snapshot",
          snapshotId: "snapshot:r1",
          revision: 1,
          subjectId: "project:drone",
        },
        claim: {
          id: "wrong-prefix",
          revision: 1,
          worksheetId: "hover-power",
        },
        title: proposal.title,
        quantities: [...proposal.quantities],
        sources: [...proposal.sources],
        decision: {
          decisionId: "decision:1",
          inputFingerprint: { algorithm: "sha256", digest: C },
        },
        parameters: [...encoded],
      }),
    TypeError,
    "claim.id",
  );
});

Deno.test("pre-sizing worksheet artifact addressing is digest-pinned", () => {
  assertEquals(
    preSizingWorksheetArtifactId(A),
    `pre-sizing-worksheet-${A}`,
  );
  assertEquals(
    preSizingWorksheetUri(A),
    `casys://pre-sizing-worksheet/pre-sizing-worksheet-${A}`,
  );
  assertThrows(
    () => preSizingWorksheetArtifactId("nope"),
    TypeError,
    "SHA-256",
  );
});
