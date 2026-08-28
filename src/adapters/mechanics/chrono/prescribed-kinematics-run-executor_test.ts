import { assertEquals, assertRejects } from "@std/assert";
import {
  prescribedKinematicsObservationCommandFromResolvedAction,
  PrescribedKinematicsRunExecutor,
} from "./prescribed-kinematics-run-executor.ts";
import {
  resolvedOperationPlanRequestIdFor,
} from "../../compile/plans/resolved-operation-plan-resolver.ts";
import type {
  ResolvedPrescribedKinematicsObservationAction,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
} from "../../../domain/mechanism/prescribed-kinematics/operations.ts";

Deno.test("prescribed-kinematics executor refuses L3 without sealed runtime composition", async () => {
  const executor = fixture(VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:test" }, command),
    Error,
    "sealed runtime, plan, and host-session composition",
  );
});

Deno.test("an unavailable L3 session composition cannot claim a run or reach L3 persistence", async () => {
  let claims = 0;
  let captures = 0;
  const executor = fixture(VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION, {
    commands: {
      claimRun: () => {
        claims++;
        throw new Error("A failed session must preclude claimRun.");
      },
    },
    captures: {
      saveObservation: () => {
        captures++;
        throw new Error("A failed session must preclude the L3 capture lane.");
      },
    },
  });

  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:test" }, command),
    Error,
    "sealed runtime, plan, and host-session composition",
  );
  assertEquals(claims, 0);
  assertEquals(captures, 0);
});

Deno.test("prescribed-kinematics executor refuses agent origin before any L5 side effect", async () => {
  const executor = fixture(DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:test" }, command),
    Error,
    "human origin",
  );
});

Deno.test("the Chrono executor carries the resolver's sealed ROP request identity unchanged", async () => {
  const requestId = await resolvedOperationPlanRequestIdFor(
    "run",
    "prescribed-kinematics",
  );
  const action: ResolvedPrescribedKinematicsObservationAction = {
    kind: "prescribed-kinematics-observation",
    lowering: { id: "prescribed-kinematics.case-json", version: "1.0" },
    requestId,
    input: {
      prescribedKinematicsCase: {
        id: "case-capture",
        fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        sourceBinding: "case",
      },
    },
  };
  const command = prescribedKinematicsObservationCommandFromResolvedAction({
    action,
    projectId: "project",
    agentRunId: "run",
    startedAt: "2026-08-29T00:00:00.000Z",
    runtime: {} as never,
    sealedCase: {} as never,
  });

  assertEquals(command.requestId, requestId);
  assertEquals(command.requestId.startsWith("rop2-prescribed-kinematics-"), true);
});

const command = {
  commandId: "execute",
  projectId: "project",
  expectedRevision: 1,
  issuedAt: "2026-08-29T00:00:00.000Z",
  runId: "run",
} as const;

function fixture(
  operation: { readonly id: string; readonly version: string },
  overrides: {
    readonly commands?: object;
    readonly captures?: object;
  } = {},
) {
  return new PrescribedKinematicsRunExecutor({
    projects: {
      get: async () =>
        ({
          project: { id: "project" },
          agentRuns: [{ id: "run", workItemId: "work", status: "queued" }],
          workItems: [{ id: "work", operation }],
        }) as never,
      getRevision: async () => undefined,
    },
    commands: (overrides.commands ?? {}) as never,
    snapshots: {} as never,
    lease: {} as never,
    caseReview: {} as never,
    captures: (overrides.captures ?? {}) as never,
    sealMethod: {} as never,
    evaluate: {} as never,
    decideCloseout: {} as never,
  });
}
