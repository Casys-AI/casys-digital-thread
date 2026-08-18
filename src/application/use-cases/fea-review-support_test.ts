import { assertEquals } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  feaReviewNext,
  threadSnapshotRefFromBasis,
  validateFeaReviewNextState,
} from "./fea-review-support.ts";

Deno.test("fea review next names the two MCP hops and strips kind from the append basis", () => {
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: "snap-r7",
    revision: 7,
    subjectId: "project:desk-lamp-dl06",
  };
  const next = feaReviewNext({
    basis,
    expectedRevision: 9,
    phaseId: "verification",
    phaseName: "Verification",
    phaseDescription: "Verify the exact proof case.",
    workItemId: "wi-proof",
    decisionId: "dec-proof",
    decisionTitle: "Approve the proof",
    decisionQuestion: "Approve this exact proof?",
    operation: {
      id: "verify.seal-proof-case",
      version: "1",
      bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
    },
    summary: "Seal the catalogued case.",
    parameters: [{
      key: "fea.proof.id",
      label: "Case",
      value: "desk-lamp-dl06-arm-cantilever",
    }],
  });
  assertEquals(next.append.tool, "project_change_append");
  assertEquals(next.propose.tool, "project_decision_propose");
  assertEquals(
    next.append.arguments.baseSnapshot,
    threadSnapshotRefFromBasis(basis),
  );
  assertEquals("kind" in next.append.arguments.baseSnapshot, false);
  assertEquals(next.append.arguments.expectedRevision, 9);
  assertEquals(next.append.arguments.workItems[0]?.id, "wi-proof");
  assertEquals(next.propose.arguments.decisionId, "dec-proof");
  assertEquals(next.queue, {
    tool: "project_agent_run_queue",
    workItemId: "wi-proof",
  });
});

Deno.test("FEA review next-state guard rejects historical bases and conflicting catalog identities", () => {
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: "snapshot-old",
    revision: 4,
    subjectId: "project:desk-lamp-dl06",
  };
  const project = {
    revision: 9,
    project: {
      id: "desk-lamp-dl06",
      subjectId: "project:desk-lamp-dl06",
    },
    threadSnapshots: [
      {
        snapshotId: basis.snapshotId,
        revision: basis.revision,
        subjectId: basis.subjectId,
      },
      {
        snapshotId: "snapshot-head",
        revision: 5,
        subjectId: basis.subjectId,
      },
    ],
    phases: [{ id: "verification" }],
    workItems: [{
      id: "wi-proof",
      phaseId: "verification",
      decisionIds: ["dec-other"],
      operation: { id: "verify.seal-proof-case", version: "1" },
    }],
    decisions: [{ id: "dec-proof", phaseId: "verification" }],
  } as unknown as EngineeringProjectSnapshot;

  const historical = validateFeaReviewNextState({
    projectId: "desk-lamp-dl06",
    project,
    basis,
    phaseId: "verification",
    workItemId: "wi-proof",
    decisionId: "dec-proof",
  });
  assertEquals(historical.status, "unavailable");
  assertEquals(
    historical.status === "unavailable" ? historical.diagnostic.code : null,
    "basis-not-current",
  );

  const conflicting = validateFeaReviewNextState({
    projectId: "desk-lamp-dl06",
    project: {
      ...project,
      threadSnapshots: [project.threadSnapshots[0]],
    },
    basis,
    phaseId: "verification",
    workItemId: "wi-proof",
    decisionId: "dec-proof",
  });
  assertEquals(conflicting.status, "unresolved");
  assertEquals(
    conflicting.status === "unresolved" ? conflicting.diagnostic.code : null,
    "compiled-identities-conflict",
  );
});
