import { assertRejects } from "@std/assert";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { requirePreSizingWorksheetApproval } from "./pre-sizing-worksheet-approval.ts";

const TIME = "2026-09-13T08:15:30.000Z";

Deno.test("worksheet approval refuses a missing human MRTR", async () => {
  await assertRejects(
    () =>
      requirePreSizingWorksheetApproval({
        schemaVersion: "4.0",
        project: { id: "project:worksheet" },
        workItems: [{
          id: "work:worksheet",
          operation: {
            id: "record.seal-pre-sizing-worksheet",
            version: "1",
            bindings: [],
          },
          decisionIds: ["decision:worksheet"],
        }],
        decisions: [{
          id: "decision:worksheet",
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
          id: "run:worksheet",
          workItemId: "work:worksheet",
          basis: {
            kind: "thread-snapshot",
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
        }],
      } as never, {
        id: "run:worksheet",
        workItemId: "work:worksheet",
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

Deno.test("worksheet approval refuses a forged agent-origin approval", async () => {
  await assertRejects(
    () =>
      requirePreSizingWorksheetApproval({
        schemaVersion: "4.0",
        project: { id: "project:worksheet" },
        workItems: [{
          id: "work:worksheet",
          operation: {
            id: "record.seal-pre-sizing-worksheet",
            version: "1",
            bindings: [],
          },
          decisionIds: ["decision:worksheet"],
        }],
        decisions: [{
          id: "decision:worksheet",
          status: "approved",
          proposal: { summary: "x", parameters: [] },
          inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          baseSnapshot: {
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
          inputEvidenceRefs: [],
          approvalIds: ["approval:worksheet"],
        }],
        approvals: [{
          id: "approval:worksheet",
          decisionId: "decision:worksheet",
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
          id: "run:worksheet",
          workItemId: "work:worksheet",
          basis: {
            kind: "thread-snapshot",
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
        }],
      } as never, {
        id: "run:worksheet",
        workItemId: "work:worksheet",
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

Deno.test("worksheet approval refuses a smuggled binding", async () => {
  await assertRejects(
    () =>
      requirePreSizingWorksheetApproval({
        schemaVersion: "4.0",
        project: { id: "project:worksheet" },
        workItems: [{
          id: "work:worksheet",
          operation: {
            id: "record.seal-pre-sizing-worksheet",
            version: "1",
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
          decisionIds: ["decision:worksheet"],
        }],
        decisions: [],
        approvals: [],
        agentRuns: [{
          id: "run:worksheet",
          workItemId: "work:worksheet",
          basis: {
            kind: "thread-snapshot",
            snapshotId: "thread:r1",
            revision: 1,
            subjectId: "subject",
          },
        }],
      } as never, {
        id: "run:worksheet",
        workItemId: "work:worksheet",
        basis: {
          kind: "thread-snapshot",
          snapshotId: "thread:r1",
          revision: 1,
          subjectId: "subject",
        },
      } as never),
    EngineeringProjectCommandError,
    "no bindings",
  );
});
