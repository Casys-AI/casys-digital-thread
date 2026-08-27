import { assertEquals, assertThrows } from "@std/assert";
import {
  parseUncertainWriterBasisReleaseProposal,
  UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
  UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
} from "./uncertain-writer-basis-release.ts";

const VALID = [
  {
    key: "releaseAction",
    label: "Action",
    value: UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
  },
  {
    key: "releaseOutcome",
    label: "Outcome",
    value: UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
  },
  { key: "failedRunId", label: "Run", value: "run:failed" },
  { key: "failureCode", label: "Failure", value: "provider-outcome-unknown" },
  { key: "subjectId", label: "Subject", value: "subject" },
  { key: "snapshotId", label: "Snapshot", value: "subject:r4" },
  { key: "revision", label: "Revision", value: 4 },
  { key: "blockerId", label: "Blocker", value: "blocker:failed" },
  {
    key: "reconciliationDecisionId",
    label: "Reconciliation",
    value: "decision:reconcile",
  },
  {
    key: "reconciliationOutcome",
    label: "Reconciliation outcome",
    value: "write-effect-accepted",
  },
  {
    key: "releaseAttestation",
    label: "Attestation",
    value: "Provider state reviewed.",
  },
];

Deno.test("basis-release grammar accepts only the exact typed contract", () => {
  assertEquals(parseUncertainWriterBasisReleaseProposal(VALID), {
    releaseAction: UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
    releaseOutcome: UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
    failedRunId: "run:failed",
    failureCode: "provider-outcome-unknown",
    subjectId: "subject",
    snapshotId: "subject:r4",
    revision: 4,
    blockerId: "blocker:failed",
    reconciliationDecisionId: "decision:reconcile",
    reconciliationOutcome: "write-effect-accepted",
    releaseAttestation: "Provider state reviewed.",
  });

  for (
    const invalid of [
      [...VALID, VALID[0]!],
      [...VALID, { key: "extra", label: "Extra", value: "forged" }],
      VALID.filter((parameter) => parameter.key !== "blockerId"),
      VALID.map((parameter) =>
        parameter.key === "revision" ? { ...parameter, value: "4" } : parameter
      ),
      VALID.map((parameter) =>
        parameter.key === "releaseAttestation" ? { ...parameter, value: "" } : parameter
      ),
      VALID.map((parameter) =>
        parameter.key === "reconciliationOutcome"
          ? { ...parameter, value: "provider-did-not-write" }
          : parameter
      ),
    ]
  ) {
    assertThrows(() => parseUncertainWriterBasisReleaseProposal(invalid));
  }
});
