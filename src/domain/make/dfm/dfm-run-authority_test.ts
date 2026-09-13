import { assertEquals } from "@std/assert";
import type {
  EngineeringApproval,
  EngineeringDecision,
  EngineeringThreadSnapshotRef,
} from "../../project/engineering-project.ts";
import {
  DFM_RUN_AUTHORITY_AMBIGUOUS_REASON,
  DFM_RUN_AUTHORITY_DIVERGENT_REASON,
  DFM_RUN_AUTHORITY_MISSING_REASON,
  recrossDfmRunAuthority,
} from "./dfm-run-authority.ts";

const RUN_BASIS: EngineeringThreadSnapshotRef = {
  snapshotId: "project:inspection-drone-id01:r117:analyze-seal",
  revision: 117,
  subjectId: "project:inspection-drone-id01",
};
const SIGNED_BASIS: EngineeringThreadSnapshotRef = {
  snapshotId: "project:inspection-drone-id01:r115:industrialize-seal",
  revision: 115,
  subjectId: "project:inspection-drone-id01",
};
const FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "2a3e87eaac08eb56a96d16d7d83a43cb7854bd8bd151665c9dc2626306e5453a",
};

Deno.test("DFM run authority accepts one unique human-approved decision on the run basis", () => {
  const authority = recrossDfmRunAuthority(
    projectFor([decisionOn(RUN_BASIS)], [approvalOn(RUN_BASIS)]),
    { decisionIds: ["decision.dfm"] },
    RUN_BASIS,
  );
  assertEquals(authority.status, "available");
  if (authority.status !== "available") return;
  assertEquals(authority.decision.id, "decision.dfm");
  assertEquals(authority.proposal.summary, "Run measured DFM checks");
});

Deno.test("DFM run authority is missing without a Thread run basis", () => {
  const authority = recrossDfmRunAuthority(
    projectFor([decisionOn(RUN_BASIS)], [approvalOn(RUN_BASIS)]),
    { decisionIds: ["decision.dfm"] },
    undefined,
  );
  assertEquals(authority, {
    status: "unavailable",
    reason: DFM_RUN_AUTHORITY_MISSING_REASON,
  });
});

Deno.test("DFM run authority is missing without a bound approved decision", () => {
  const authority = recrossDfmRunAuthority(
    projectFor([decisionOn(RUN_BASIS)], [approvalOn(RUN_BASIS)]),
    { decisionIds: [] },
    RUN_BASIS,
  );
  assertEquals(authority, {
    status: "unavailable",
    reason: DFM_RUN_AUTHORITY_MISSING_REASON,
  });
});

Deno.test("DFM run authority is missing for a non-human approval", () => {
  const authority = recrossDfmRunAuthority(
    projectFor(
      [decisionOn(RUN_BASIS)],
      [{ ...approvalOn(RUN_BASIS), decidedByOrigin: "agent" }],
    ),
    { decisionIds: ["decision.dfm"] },
    RUN_BASIS,
  );
  assertEquals(authority, {
    status: "unavailable",
    reason: DFM_RUN_AUTHORITY_MISSING_REASON,
  });
});

Deno.test("DFM run authority is missing when approval and decision fingerprints differ", () => {
  const authority = recrossDfmRunAuthority(
    projectFor(
      [decisionOn(RUN_BASIS)],
      [{
        ...approvalOn(RUN_BASIS),
        inputFingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
      }],
    ),
    { decisionIds: ["decision.dfm"] },
    RUN_BASIS,
  );
  assertEquals(authority, {
    status: "unavailable",
    reason: DFM_RUN_AUTHORITY_MISSING_REASON,
  });
});

Deno.test("DFM run authority is missing when the approval snapshot is not the decision snapshot", () => {
  const authority = recrossDfmRunAuthority(
    projectFor([decisionOn(RUN_BASIS)], [approvalOn(SIGNED_BASIS)]),
    { decisionIds: ["decision.dfm"] },
    RUN_BASIS,
  );
  assertEquals(authority, {
    status: "unavailable",
    reason: DFM_RUN_AUTHORITY_MISSING_REASON,
  });
});

Deno.test("DFM run authority is missing when the decision has no concrete proposal", () => {
  const { proposal: _proposal, ...decision } = decisionOn(RUN_BASIS);
  const authority = recrossDfmRunAuthority(
    projectFor([decision], [approvalOn(RUN_BASIS)]),
    { decisionIds: ["decision.dfm"] },
    RUN_BASIS,
  );
  assertEquals(authority, {
    status: "unavailable",
    reason: DFM_RUN_AUTHORITY_MISSING_REASON,
  });
});

Deno.test("DFM run authority is divergent when the signed basis is an earlier revision", () => {
  assertDivergent(SIGNED_BASIS);
});

Deno.test("DFM run authority is divergent when the signed snapshot id differs", () => {
  assertDivergent({
    ...RUN_BASIS,
    snapshotId: "project:inspection-drone-id01:r115:industrialize-seal",
  });
});

Deno.test("DFM run authority is divergent when the signed subject differs", () => {
  assertDivergent({
    ...RUN_BASIS,
    subjectId: "project:other-subject",
  });
});

Deno.test("DFM run authority is ambiguous when two matching human approvals share the run basis", () => {
  const second = {
    decisionId: "decision.dfm-2",
    approvalId: "approval.dfm-2",
  };
  const authority = recrossDfmRunAuthority(
    projectFor(
      [decisionOn(RUN_BASIS), decisionOn(RUN_BASIS, second)],
      [approvalOn(RUN_BASIS), approvalOn(RUN_BASIS, second)],
    ),
    { decisionIds: ["decision.dfm", second.decisionId] },
    RUN_BASIS,
  );
  assertEquals(authority, {
    status: "unavailable",
    reason: DFM_RUN_AUTHORITY_AMBIGUOUS_REASON,
  });
});

function assertDivergent(signed: EngineeringThreadSnapshotRef): void {
  const authority = recrossDfmRunAuthority(
    projectFor([decisionOn(signed)], [approvalOn(signed)]),
    { decisionIds: ["decision.dfm"] },
    RUN_BASIS,
  );
  assertEquals(authority, {
    status: "unavailable",
    reason: DFM_RUN_AUTHORITY_DIVERGENT_REASON,
  });
}

function projectFor(
  decisions: readonly EngineeringDecision[],
  approvals: readonly EngineeringApproval[],
) {
  return { decisions, approvals };
}

function decisionOn(
  baseSnapshot: EngineeringThreadSnapshotRef,
  ids: { readonly decisionId?: string; readonly approvalId?: string } = {},
): EngineeringDecision {
  const decisionId = ids.decisionId ?? "decision.dfm";
  const approvalId = ids.approvalId ?? "approval.dfm";
  return {
    id: decisionId,
    phaseId: "phase.industrialize",
    title: "Approve DFM run",
    question: "Run the sealed DFM case?",
    status: "approved",
    requestedAt: "2026-09-11T14:16:10.521Z",
    baseSnapshot,
    inputFingerprint: FINGERPRINT,
    inputEvidenceRefs: [],
    approvalIds: [approvalId],
    proposal: {
      summary: "Run measured DFM checks",
      parameters: [],
      proposedAt: "2026-09-11T14:16:10.521Z",
      proposedBy: { id: "agent:test", origin: "agent" },
    },
  };
}

function approvalOn(
  baseSnapshot: EngineeringThreadSnapshotRef,
  ids: { readonly decisionId?: string; readonly approvalId?: string } = {},
): EngineeringApproval {
  return {
    id: ids.approvalId ?? "approval.dfm",
    decisionId: ids.decisionId ?? "decision.dfm",
    status: "approved",
    requestedAt: "2026-09-11T14:16:10.521Z",
    decidedAt: "2026-09-11T14:16:33.395Z",
    decidedBy: "human:test",
    decidedByOrigin: "human",
    rationale: "Reviewed the sealed DFM case.",
    baseSnapshot,
    inputFingerprint: FINGERPRINT,
    inputEvidenceRefs: [],
  };
}
