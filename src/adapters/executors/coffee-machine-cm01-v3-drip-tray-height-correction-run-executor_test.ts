import { assertEquals, assertRejects } from "@std/assert";
import {
  COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION,
  CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutor,
} from "./coffee-machine-cm01-v3-drip-tray-height-correction-run-executor.ts";

const COMMAND = {
  commandId: "test-cm01-correction",
  projectId: "coffee-machine-cm01-v3",
  expectedRevision: 1,
  issuedAt: "2026-08-03T12:00:00.000Z",
  runId: "run:cm01-correction",
} as const;

Deno.test("CM-01 correction executor rejects a human before any state read", async () => {
  let projectRead = false;
  const executor = new CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutor({
    projects: {
      get: () => {
        projectRead = true;
        return Promise.reject(new Error("must not read"));
      },
    } as never,
    commands: {} as never,
    snapshots: {} as never,
    lease: {} as never,
  });

  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human:reviewer" }, COMMAND),
    Error,
    "Only an authenticated agent",
  );
  assertEquals(projectRead, false);
});

Deno.test("CM-01 correction executor refuses a differently shaped queued run before snapshot mutation", async () => {
  let snapshotRead = false;
  const executor = new CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "3.0",
          project: {
            id: "coffee-machine-cm01-v3",
            subjectId: "project:coffee-machine-cm01-v3",
          },
          agentRuns: [{
            id: COMMAND.runId,
            workItemId: "wrong-operation",
            basis: {
              kind: "thread-snapshot",
              snapshotId: "project:coffee-machine-cm01-v3:r7:fixture",
              revision: 7,
              subjectId: "project:coffee-machine-cm01-v3",
            },
          }],
          workItems: [{
            id: "wrong-operation",
            operation: {
              ...COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION,
              version: "999",
              bindings: [{
                name: "approvedBrief",
                source: { kind: "approved-brief" },
              }],
            },
          }],
        } as never),
    } as never,
    commands: {} as never,
    snapshots: {
      get: () => {
        snapshotRead = true;
        return Promise.reject(new Error("must not read"));
      },
    } as never,
    lease: {} as never,
  });

  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:engineering" }, COMMAND),
    Error,
    "exact queued CM-01 V3 DripTray height correction",
  );
  assertEquals(snapshotRead, false);
});
