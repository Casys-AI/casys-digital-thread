import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../src/adapters/http-mcp-tool-client.ts";
import {
  CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT,
  recoverCoffeeMachineCm01V3MechanicalR3Identity,
} from "./recover-coffee-machine-cm01-v3-mechanical-r3-identity.ts";

const PROJECT_ID = "coffee-machine-cm01-v3";
const SUBJECT_ID = "project:coffee-machine-cm01-v3";
const ORIGINAL_WORK_ITEM = "verify-cm01-v3-drip-tray-height-30-mechanical-r3-retry";
const RECOVERY_WORK_ITEM = "recover-cm01-v3-drip-tray-height-30-mechanical-r3-identity";
const DIGEST = "a".repeat(64);

Deno.test("CM-01 R3 identity recovery remains inert without --execute", async () => {
  const client = new ScriptedClient([]);

  const result = await recoverCoffeeMachineCm01V3MechanicalR3Identity({ client });

  assertEquals(result.status, "confirmation-required");
  assertEquals(client.calls, []);
});

Deno.test("CM-01 R3 identity recovery requires its exact acknowledgement before any MCP call", async () => {
  const client = new ScriptedClient([]);

  await assertRejects(
    () => recoverCoffeeMachineCm01V3MechanicalR3Identity({ execute: true, client }),
    Error,
    "acknowledge=RECOVER_CM01_V3_MECHANICAL_R3_IDENTITY",
  );

  assertEquals(client.calls, []);
});

Deno.test("CM-01 R3 identity recovery creates only R11 through MCP control-plane tools", async () => {
  const original = originalR3Run();
  const recoveryQueued = queuedRecoveryRun();
  const recoveryCompleted = completedRecoveryRun();
  const client = new ScriptedClient([
    response(
      "project_snapshot",
      project(56, r10(), [original.workItem], [original.run]),
    ),
    response(
      "project_change_append",
      project(57, r10(), [original.workItem, recoveryWorkItem()], [original.run]),
    ),
    response(
      "project_agent_run_queue",
      project(
        58,
        r10(),
        [original.workItem, recoveryWorkItem()],
        [original.run, recoveryQueued],
      ),
    ),
    response(
      "project_agent_run_execute",
      project(
        62,
        r11(),
        [original.workItem, recoveryWorkItem()],
        [original.run, recoveryCompleted],
      ),
    ),
  ]);

  const result = await recoverCoffeeMachineCm01V3MechanicalR3Identity({
    execute: true,
    acknowledgement: CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT,
    client,
  });

  assertEquals(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected completed recovery.");
  assertEquals(result.snapshot, r11());
  assertEquals(result.historicalR10Evidence, r10Solve());
  assertEquals(result.r3Evidence, r11Solve());
  assertEquals(client.calls.map((call) => call.name), [
    "project_snapshot",
    "project_change_append",
    "project_agent_run_queue",
    "project_agent_run_execute",
  ]);
  assertEquals(client.calls[1]!.arguments, {
    commandId: "cm01-v3-r10-r11-mechanical-r3-identity-recovery-append",
    projectId: PROJECT_ID,
    expectedRevision: 56,
    issuedAt: "2026-08-03T13:15:00.000Z",
    baseSnapshot: r10(),
    phases: [{
      id: "cm01-v3-drip-tray-height-30-mechanical-r3-identity-recovery",
      name: "Correct the CM-01 R3 mechanical evidence identity",
      description:
        "Create one correctly identified R3 successor from the immutable completed capture. The R10 record remains visible as superseded history.",
    }],
    workItems: [recoveryWorkItem()],
    requiredDecisions: [],
  });
  assertEquals(client.calls[2]!.arguments, {
    commandId: "cm01-v3-r10-r11-mechanical-r3-identity-recovery-queue",
    projectId: PROJECT_ID,
    expectedRevision: 57,
    issuedAt: "2026-08-03T13:15:00.000Z",
    workItemId: RECOVERY_WORK_ITEM,
  });
  assertEquals(client.calls[3]!.arguments, {
    commandId: "cm01-v3-r10-r11-mechanical-r3-identity-recovery-execute",
    projectId: PROJECT_ID,
    expectedRevision: 58,
    issuedAt: "2026-08-03T13:15:00.000Z",
    runId: recoveryQueued.id,
  });
});

Deno.test("CM-01 R3 identity recovery reuses an already-completed R11 without mutation", async () => {
  const original = originalR3Run();
  const completed = completedRecoveryRun();
  const client = new ScriptedClient([
    response(
      "project_snapshot",
      project(62, r11(), [original.workItem, recoveryWorkItem()], [
        original.run,
        completed,
      ]),
    ),
  ]);

  const result = await recoverCoffeeMachineCm01V3MechanicalR3Identity({
    execute: true,
    acknowledgement: CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT,
    client,
  });

  assertEquals(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected completed recovery.");
  assertEquals(result.snapshot, r11());
  assertEquals(result.historicalR10Evidence, r10Solve());
  assertEquals(client.calls.map((call) => call.name), ["project_snapshot"]);
});

Deno.test("CM-01 R3 identity recovery resumes a durable append before any provider work", async () => {
  const original = originalR3Run();
  const queued = queuedRecoveryRun();
  const completed = completedRecoveryRun();
  const client = new ScriptedClient([
    response(
      "project_snapshot",
      project(57, r10(), [original.workItem, recoveryWorkItem()], [original.run]),
    ),
    response(
      "project_agent_run_queue",
      project(
        58,
        r10(),
        [original.workItem, recoveryWorkItem()],
        [original.run, queued],
      ),
    ),
    response(
      "project_agent_run_execute",
      project(
        62,
        r11(),
        [original.workItem, recoveryWorkItem()],
        [original.run, completed],
      ),
    ),
  ]);

  const result = await recoverCoffeeMachineCm01V3MechanicalR3Identity({
    execute: true,
    acknowledgement: CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_ACKNOWLEDGEMENT,
    client,
  });

  assertEquals(result.status, "completed");
  assertEquals(client.calls.map((call) => call.name), [
    "project_snapshot",
    "project_agent_run_queue",
    "project_agent_run_execute",
  ]);
  assertEquals(client.calls[1]!.arguments?.expectedRevision, 57);
});

function project(
  revision: number,
  head: ReturnType<typeof snapshot>,
  workItems: readonly Record<string, unknown>[],
  agentRuns: readonly Record<string, unknown>[],
) {
  return {
    schemaVersion: "3.0",
    project: { id: PROJECT_ID, subjectId: SUBJECT_ID, name: "CoffeeMachine CM-01 V3" },
    revision,
    framing: {
      currentBrief: { id: "cm01-v3-brief" },
      currentBriefApproval: { status: "approved" },
    },
    threadSnapshots: [head],
    workItems,
    agentRuns,
  };
}

function originalR3Run() {
  return {
    workItem: {
      id: ORIGINAL_WORK_ITEM,
      phaseId: "fixture",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "verify.coffee-machine-cm01-drip-tray-mechanical",
        version: "3",
        bindings: [],
      },
    },
    run: {
      id: "run:cm01-v3-r9-r10-mechanical-r3-retry-queue",
      workItemId: ORIGINAL_WORK_ITEM,
      status: "completed",
      basis: { kind: "thread-snapshot", ...r9() },
      resultSnapshot: r10(),
      evidenceRefs: [r10Solve()],
    },
  };
}

function recoveryWorkItem() {
  return {
    id: RECOVERY_WORK_ITEM,
    phaseId: "cm01-v3-drip-tray-height-30-mechanical-r3-identity-recovery",
    owner: "agent",
    dependsOnWorkItemIds: [],
    decisionIds: [],
    operation: {
      id: "repair.coffee-machine-cm01-drip-tray-mechanical-r3-identity",
      version: "1",
      bindings: [
        { name: "approvedBrief", source: { kind: "approved-brief" } },
        {
          name: "historicalMechanicalR3Result",
          source: { kind: "thread-entity", reference: r10Solve() },
        },
      ],
    },
  };
}

function queuedRecoveryRun() {
  return {
    id: "run:cm01-v3-r10-r11-mechanical-r3-identity-recovery-queue",
    workItemId: RECOVERY_WORK_ITEM,
    status: "queued",
    basis: { kind: "thread-snapshot", ...r10() },
    resultSnapshot: null,
    evidenceRefs: [],
  };
}

function completedRecoveryRun() {
  return {
    id: "run:cm01-v3-r10-r11-mechanical-r3-identity-recovery-queue",
    workItemId: RECOVERY_WORK_ITEM,
    status: "completed",
    basis: { kind: "thread-snapshot", ...r10() },
    resultSnapshot: r11(),
    evidenceRefs: [r11Solve()],
  };
}

function snapshot(revision: number, identity: string) {
  return {
    snapshotId: `project:coffee-machine-cm01-v3:r${revision}:${identity}`,
    revision,
    subjectId: SUBJECT_ID,
  };
}

function r9() {
  return snapshot(9, "cad-r2-fixture-extension");
}

function r10() {
  return snapshot(10, `mechanical-r2-${DIGEST}-extension`);
}

function r11() {
  return snapshot(11, `mechanical-r3-${DIGEST}-extension`);
}

function artifact(
  id: string,
  thread: ReturnType<typeof snapshot>,
) {
  return {
    snapshotId: thread.snapshotId,
    snapshotRevision: thread.revision,
    kind: "artifact" as const,
    id,
  };
}

function r10Solve() {
  return artifact(`coffee-machine-cm01-v3-mechanical-r2-${DIGEST}-solve`, r10());
}

function r11Solve() {
  return artifact(`coffee-machine-cm01-v3-mechanical-r3-${DIGEST}-solve`, r11());
}

function response(name: string, structuredContent: Record<string, unknown>) {
  return { name, structuredContent };
}

class ScriptedClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  constructor(
    private readonly responses: Array<{
      readonly name: string;
      readonly structuredContent: Record<string, unknown>;
    }>,
  ) {}

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    const next = this.responses.shift();
    if (!next) return Promise.reject(new Error(`Unexpected MCP call ${call.name}.`));
    if (next.name !== call.name) {
      return Promise.reject(
        new Error(`Expected MCP call ${next.name}, received ${call.name}.`),
      );
    }
    return Promise.resolve({
      structuredContent: next.structuredContent,
      text: "fixture",
    });
  }
}
