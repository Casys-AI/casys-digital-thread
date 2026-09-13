import { assertRejects } from "@std/assert";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { requireDocumentaryClauseResponseApproval } from "./documentary-clause-response-approval.ts";

const TIME = "2026-09-13T08:15:30.000Z";

Deno.test("clause-response approval refuses a missing human MRTR", async () => {
  await assertRejects(
    () =>
      requireDocumentaryClauseResponseApproval({
        schemaVersion: "4.0",
        project: { id: "project:clause" },
        workItems: [{
          id: "work:clause",
          operation: {
            id: "record.seal-documentary-clause-response",
            version: "1",
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
          decisionIds: ["decision:clause"],
        }],
        decisions: [{
          id: "decision:clause",
          status: "proposed",
          proposal: { summary: "x", parameters: [] },
          inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          baseSnapshot: {
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
          inputEvidenceRefs: [],
          approvalIds: [],
        }],
        approvals: [],
        agentRuns: [{
          id: "run:clause",
          workItemId: "work:clause",
          basis: {
            kind: "thread-snapshot",
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
        }],
      } as never, {
        id: "run:clause",
        workItemId: "work:clause",
        basis: {
          kind: "thread-snapshot",
          snapshotId: "thread:r1",
          revision: 1,
          subjectId: "subject",
        },
      } as never),
    EngineeringProjectCommandError,
    "exact approved MRTR",
  );
});

Deno.test("clause-response approval refuses a forged agent-origin approval", async () => {
  await assertRejects(
    () =>
      requireDocumentaryClauseResponseApproval({
        schemaVersion: "4.0",
        project: { id: "project:clause" },
        workItems: [{
          id: "work:clause",
          operation: {
            id: "record.seal-documentary-clause-response",
            version: "1",
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
          decisionIds: ["decision:clause"],
        }],
        decisions: [{
          id: "decision:clause",
          status: "approved",
          proposal: { summary: "x", parameters: [] },
          inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          baseSnapshot: {
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
          inputEvidenceRefs: [],
          approvalIds: ["approval:clause"],
        }],
        approvals: [{
          id: "approval:clause",
          decisionId: "decision:clause",
          status: "approved",
          decidedByOrigin: "agent",
          decidedBy: "agent:forged",
          decidedAt: TIME,
          baseSnapshot: {
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
          inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          inputEvidenceRefs: [],
        }],
        agentRuns: [{
          id: "run:clause",
          workItemId: "work:clause",
          basis: {
            kind: "thread-snapshot",
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
        }],
      } as never, {
        id: "run:clause",
        workItemId: "work:clause",
        basis: {
          kind: "thread-snapshot",
          snapshotId: "thread:r1",
          revision: 1,
          subjectId: "subject",
        },
      } as never),
    EngineeringProjectCommandError,
    "one human approval",
  );
});
