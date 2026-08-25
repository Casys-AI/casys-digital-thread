import { assertEquals } from "@std/assert";
import { assemblyIntegrityEvaluationGateClaimIssue } from "./assembly-integrity-evaluation-gate-policy.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../project/engineering-project.ts";

Deno.test("L4 allows zero or many exact authority claims and refuses other gates", () => {
  const project = {
    framing: {
      currentBrief: {
        contractVersion: "2.0",
        id: "brief-r1",
        revision: 1,
        items: [
          { id: "gate-a", kind: "success-criterion" },
          {
            id: "gate-b",
            kind: "verification-activity",
            verificationAuthority: { id: "assembly-integrity", version: "1.0" },
          },
          {
            id: "gate-c",
            kind: "verification-activity",
            verificationAuthority: { id: "assembly-integrity", version: "1.0" },
          },
          {
            id: "gate-other",
            kind: "verification-activity",
            verificationAuthority: { id: "other-method", version: "1.0" },
          },
          { id: "gate-unqualified", kind: "verification-activity" },
        ],
      },
      currentBriefApproval: {
        status: "approved",
        briefSnapshotId: "brief-r1",
        briefRevision: 1,
      },
    },
  } as unknown as EngineeringProjectSnapshot;

  assertEquals(assemblyIntegrityEvaluationGateClaimIssue(project, work([])), undefined);
  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-b", role: "contributes-to", status: "current" },
        { gateItemId: "gate-c", role: "contributes-to", status: "current" },
      ]),
    ),
    undefined,
  );
  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-b", role: "contributes-to", status: "current" },
        { gateItemId: "gate-b", role: "contributes-to", status: "current" },
      ]),
    ),
    "L4 may claim each current Brief V2 gate at most once.",
  );
  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-b", role: "satisfies", status: "current" },
      ]),
    ),
    "L4 may retain only current contributes-to claims targeting current approved Brief V2 assembly-integrity verification activities.",
  );
  for (const gateItemId of ["gate-a", "gate-other", "gate-unqualified"]) {
    assertEquals(
      assemblyIntegrityEvaluationGateClaimIssue(
        project,
        work([{ gateItemId, role: "contributes-to", status: "current" }]),
      ),
      "L4 may retain only current contributes-to claims targeting current approved Brief V2 assembly-integrity verification activities.",
    );
  }
});

function work(gateClaims: EngineeringWorkItem["gateClaims"]): EngineeringWorkItem {
  return { gateClaims } as EngineeringWorkItem;
}
