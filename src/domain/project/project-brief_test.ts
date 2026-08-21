import { assertEquals } from "@std/assert";
import type { ProjectBriefItem, ProjectBriefRevision } from "./project-brief.ts";
import { projectBriefIndependentQuestionBranches } from "./project-brief.ts";

Deno.test(
  "independent question branches stay sibling declared facts and never roll up into pass",
  () => {
    const brief = briefOf([
      criterion("success-mechanical", "Mechanical question.", []),
      criterion("success-thermal", "Thermal question.", []),
      criterion("success-lamp", "Combined lamp question.", [
        "success-mechanical",
        "success-thermal",
      ]),
      verification("verify-mechanical", ["success-mechanical"]),
      verification("verify-thermal", ["success-thermal"]),
    ]);

    const branches = projectBriefIndependentQuestionBranches(brief);
    assertEquals(
      branches.map((branch) => ({
        id: branch.successCriterionId,
        verificationActivityIds: branch.verificationActivityIds,
        state: branch.state,
      })),
      [
        {
          id: "success-mechanical",
          verificationActivityIds: ["verify-mechanical"],
          state: "declared",
        },
        {
          id: "success-thermal",
          verificationActivityIds: ["verify-thermal"],
          state: "declared",
        },
        {
          id: "success-lamp",
          verificationActivityIds: [],
          state: "declared",
        },
      ],
    );
    assertEquals(
      branches.some((branch) => (branch.state as string) === "pass"),
      false,
    );
  },
);

function briefOf(items: readonly ProjectBriefItem[]): ProjectBriefRevision {
  return {
    contractVersion: "2.0",
    briefId: "fixture:brief",
    id: "fixture:brief:r1",
    revision: 1,
    items,
    proposedAt: "2026-08-21T12:00:00.000Z",
    proposedBy: { id: "agent:fixture", origin: "agent" },
  };
}

function criterion(
  id: string,
  statement: string,
  dependsOnItemIds: readonly string[],
): ProjectBriefItem {
  return {
    id,
    kind: "success-criterion",
    statement,
    sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
    dependsOnItemIds,
  };
}

function verification(
  id: string,
  dependsOnItemIds: readonly string[],
): ProjectBriefItem {
  return {
    id,
    kind: "verification-activity",
    statement: id,
    sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
    dependsOnItemIds,
  };
}
