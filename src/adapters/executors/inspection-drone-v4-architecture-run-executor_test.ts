import { assertEquals, assertRejects } from "@std/assert";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "../../orchestration/operations/inspection-drone-v4.ts";
import { InspectionDroneV4ArchitectureRunExecutor } from "./inspection-drone-v4-architecture-run-executor.ts";

const COMMAND = {
  commandId: "execute-drone-architecture",
  projectId: "inspection-drone-v4",
  expectedRevision: 1,
  issuedAt: "2026-08-08T04:00:00.000Z",
  runId: "run:architecture",
};

Deno.test("inspection-drone architecture rejects a wrong subject before reading a capture or provider", async () => {
  let providerCalled = false;
  const executor = new InspectionDroneV4ArchitectureRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "3.0",
          project: { id: "inspection-drone-v4", subjectId: "project:other" },
          agentRuns: [{
            id: COMMAND.runId,
            workItemId: "architecture",
            status: "queued",
          }],
          workItems: [{
            id: "architecture",
            operation: {
              ...INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
              bindings: [
                { name: "approvedBrief", source: { kind: "approved-brief" } },
                {
                  name: "sysonModelSeed",
                  source: { kind: "thread-entity", reference: {} },
                },
              ],
            },
          }],
        } as never),
    } as never,
    commands: {} as never,
    snapshots: { get: () => Promise.reject(new Error("must not read")) } as never,
    seedCaptures: { read: () => Promise.reject(new Error("must not read")) } as never,
    captures: {} as never,
    attempts: {} as never,
    syson: {
      callTool: () => {
        providerCalled = true;
        return Promise.reject(new Error("must not call"));
      },
    } as never,
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:engineering" }, COMMAND),
    Error,
    "canonical inspection-drone-v4 architecture",
  );
  assertEquals(providerCalled, false);
});

Deno.test("inspection-drone architecture rejects a human before reading project state", async () => {
  const executor = new InspectionDroneV4ArchitectureRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read")) } as never,
    commands: {} as never,
    snapshots: {} as never,
    seedCaptures: {} as never,
    captures: {} as never,
    attempts: {} as never,
    syson: {} as never,
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human:reviewer" }, COMMAND),
    Error,
    "Only an authenticated agent",
  );
});
