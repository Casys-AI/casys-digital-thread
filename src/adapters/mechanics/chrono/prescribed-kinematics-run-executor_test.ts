import { assertRejects } from "@std/assert";
import { PrescribedKinematicsRunExecutor } from "./prescribed-kinematics-run-executor.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
} from "../../../domain/mechanism/prescribed-kinematics/operations.ts";

Deno.test("prescribed-kinematics executor refuses L3 without a qualified observer", async () => {
  const executor = fixture(VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:test" }, command),
    Error,
    "qualified mechanics observation runtime",
  );
});

Deno.test("prescribed-kinematics executor refuses agent origin before any L5 side effect", async () => {
  const executor = fixture(DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:test" }, command),
    Error,
    "human origin",
  );
});

const command = {
  commandId: "execute",
  projectId: "project",
  expectedRevision: 1,
  issuedAt: "2026-08-29T00:00:00.000Z",
  runId: "run",
} as const;

function fixture(operation: { readonly id: string; readonly version: string }) {
  return new PrescribedKinematicsRunExecutor({
    projects: {
      get: async () =>
        ({
          project: { id: "project" },
          agentRuns: [{ id: "run", workItemId: "work", status: "queued" }],
          workItems: [{ id: "work", operation }],
        }) as never,
    },
    commands: {} as never,
    snapshots: {} as never,
    lease: {} as never,
    caseReview: {} as never,
    captures: {} as never,
    sealMethod: {} as never,
    evaluate: {} as never,
    decideCloseout: {} as never,
  });
}
