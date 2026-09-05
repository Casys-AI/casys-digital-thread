import { assertEquals } from "@std/assert";
import {
  PrepareProjectPrescribedKinematicsNextHopReview,
  prescribedKinematicsNextHop,
} from "./prepare-project-prescribed-kinematics-next-hop-review.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
} from "../../domain/mechanism/prescribed-kinematics/operations.ts";
import {
  encodePrescribedKinematicsRunProposalParameters,
  parsePrescribedKinematicsRunProposalParameters,
} from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-proposal.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";

Deno.test("prescribed-kinematics L1 next hop preserves its architecture producer and the closed workspace identities", () => {
  const project = {
    revision: 8,
    project: { id: "project-kinematics" },
  } as EngineeringProjectSnapshot;
  const next = prescribedKinematicsNextHop({
    project,
    basis: {
      snapshotId: "thread-kinematics",
      revision: 5,
      subjectId: "subject-kinematics",
    },
    predecessorWorkItemId: "work-architecture",
    operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
    owner: "agent",
    tokenFingerprint: "a".repeat(64),
    phaseName: "Prescribed kinematics case",
    phaseDescription: "Seal L1.",
    decisionTitle: "Review L1.",
    decisionQuestion: "Seal?",
    summary: "Seal L1.",
    parameters: [
      {
        key: "workspaceRevision",
        label: "Exact ProjectSourceWorkspace revision",
        value: 4,
      },
      {
        key: "attachmentId",
        label: "Named mechanism-source attachment id",
        value: "attachment-assembly",
      },
      {
        key: "attachmentRevision",
        label: "Named mechanism-source attachment revision",
        value: 1,
      },
    ],
  });
  assertEquals(next.append.arguments.workItems[0]?.dependsOnWorkItemIds, [
    "work-architecture",
  ]);
  assertEquals("issuedAt" in next.append.arguments, false);
  assertEquals("issuedAt" in next.propose.arguments, false);
  assertEquals(
    next.propose.arguments.proposal.parameters.map((parameter) => parameter.key),
    ["workspaceRevision", "attachmentId", "attachmentRevision"],
  );
});

Deno.test("prescribed-kinematics L3 next hop restates the domain case fingerprint and depends on L1", () => {
  const caseFingerprint = { algorithm: "sha256" as const, digest: "b".repeat(64) };
  const project = {
    revision: 8,
    project: { id: "project-kinematics" },
  } as EngineeringProjectSnapshot;
  const next = prescribedKinematicsNextHop({
    project,
    basis: {
      snapshotId: "thread-kinematics",
      revision: 5,
      subjectId: "subject-kinematics",
    },
    predecessorWorkItemId: "work-l1",
    operation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    owner: "agent",
    tokenFingerprint: caseFingerprint.digest,
    phaseName: "Prescribed kinematics observation",
    phaseDescription: "Run L3.",
    decisionTitle: "Review L3.",
    decisionQuestion: "Observe?",
    summary: "Observe L3.",
    parameters: encodePrescribedKinematicsRunProposalParameters(caseFingerprint),
  });
  assertEquals(next.append.arguments.workItems[0]?.dependsOnWorkItemIds, [
    "work-l1",
  ]);
  assertEquals(next.append.arguments.workItems[0]?.operation, {
    ...VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    bindings: [],
  });
  assertEquals(
    parsePrescribedKinematicsRunProposalParameters(
      next.propose.arguments.proposal.parameters,
    ),
    { caseFingerprint },
  );
  assertEquals("issuedAt" in next.propose.arguments, false);
});

Deno.test("prescribed-kinematics next-hop discovery rejects caller-selected provider data before any project read", async () => {
  let projectReads = 0;
  const review = new PrepareProjectPrescribedKinematicsNextHopReview({
    projects: {
      get: () => {
        projectReads += 1;
        return Promise.resolve(undefined);
      },
    },
    snapshots: {} as never,
    captures: {} as never,
    resources: {} as never,
  });

  const run = await review.review("run", {
    projectId: "project-kinematics",
    provider: "caller-selected",
  });
  assertEquals(run.status, "unavailable");
  if (run.status !== "unavailable") return;
  assertEquals(run.diagnostic.code, "invalid_request");
  const result = await review.review("evaluation", {
    projectId: "project-kinematics",
    provider: "caller-selected",
  });
  assertEquals(result, {
    status: "unavailable",
    family: "prescribed-kinematics",
    stage: "evaluation",
    diagnostic: {
      code: "invalid_request",
      message:
        "The prescribed-kinematics next-hop review request failed exact validation.",
    },
  });
  assertEquals(projectReads, 0);
  const method = await review.review("method", { projectId: "project-kinematics" });
  assertEquals(method.status, "unavailable");
  if (method.status !== "unavailable") return;
  assertEquals(method.diagnostic.code, "project_not_found");
  assertEquals(projectReads, 1);
});

Deno.test("prescribed-kinematics L5 next hop preserves the existing human operation and offers no approval", () => {
  const project = {
    revision: 8,
    project: { id: "project-kinematics" },
  } as EngineeringProjectSnapshot;
  const next = prescribedKinematicsNextHop({
    project,
    basis: {
      snapshotId: "thread-kinematics",
      revision: 5,
      subjectId: "subject-kinematics",
    },
    predecessorWorkItemId: "work-l4",
    operation: DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
    owner: "human",
    tokenFingerprint: "a".repeat(64),
    phaseName: "Prescribed kinematics closeout",
    phaseDescription: "Record existing L5.",
    decisionTitle: "Reject existing L5.",
    decisionQuestion: "Reject?",
    summary: "Reject existing L5.",
    parameters: [],
  });

  const workItem = next.append.arguments.workItems[0]!;
  assertEquals(workItem.owner, "human");
  assertEquals(workItem.dependsOnWorkItemIds, ["work-l4"]);
  assertEquals(workItem.operation, {
    ...DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
    bindings: [],
  });
  assertEquals(next.append.arguments.requiredDecisions.length, 1);
  assertEquals(next.propose.arguments.expectedRevision, 9);
  assertEquals("approve" in next, false);

  const accept = prescribedKinematicsNextHop({
    project,
    basis: {
      snapshotId: "thread-kinematics",
      revision: 5,
      subjectId: "subject-kinematics",
    },
    predecessorWorkItemId: "work-l4",
    operation: DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
    owner: "human",
    tokenFingerprint: "a".repeat(64),
    phaseName: "Prescribed kinematics closeout",
    phaseDescription: "Record existing L5.",
    decisionTitle: "Accept existing L5.",
    decisionQuestion: "Accept?",
    summary: "Accept existing L5.",
    parameters: [],
  });
  assertEquals(
    accept.append.arguments.commandId === next.append.arguments.commandId,
    false,
  );
});
