import { assertEquals } from "@std/assert";
import { assemblyIntegrityEvaluationGateClaimIssue } from "./assembly-integrity-evaluation-gate-policy.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../project/engineering-project.ts";

Deno.test("L4 allows distinct current contributes-to claims and refuses duplicates or satisfaction", () => {
  const project = {
    framing: {
      currentBrief: {
        contractVersion: "2.0",
        items: [
          { id: "gate-a", kind: "success-criterion" },
          { id: "gate-b", kind: "verification-activity" },
        ],
      },
      currentBriefApproval: { status: "approved" },
    },
  } as unknown as EngineeringProjectSnapshot;

  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-a", role: "contributes-to", status: "current" },
        { gateItemId: "gate-b", role: "contributes-to", status: "current" },
      ]),
    ),
    undefined,
  );
  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-a", role: "contributes-to", status: "current" },
        { gateItemId: "gate-a", role: "contributes-to", status: "current" },
      ]),
    ),
    "L4 may claim each current Brief V2 gate at most once.",
  );
  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-a", role: "satisfies", status: "current" },
      ]),
    ),
    "L4 may retain only current contributes-to claims targeting existing Brief V2 gates.",
  );
});

function work(gateClaims: EngineeringWorkItem["gateClaims"]): EngineeringWorkItem {
  return { gateClaims } as EngineeringWorkItem;
}
