import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import {
  CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT,
  runCoffeeMachineCm01V3MechanicalR3Retry,
} from "./run-coffee-machine-cm01-v3-mechanical-r3-retry.ts";

const PROJECT_ID = "coffee-machine-cm01-v3";
const SUBJECT_ID = "project:coffee-machine-cm01-v3";
const CORRECTION = "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record";
const CAD_STEP = `coffee-machine-cm01-v3-cad-r2-${"a".repeat(64)}-step`;
const R3_WORK_ITEM = "verify-cm01-v3-drip-tray-height-30-mechanical-r3-retry";
const R3_PHASE = "cm01-v3-drip-tray-height-30-mechanical-r3-retry";

Deno.test("CM-01 mechanical R3 retry remains inert without --execute", async () => {
  const client = new ScriptedClient([]);
  const result = await runCoffeeMachineCm01V3MechanicalR3Retry({ client });

  assertEquals(result.status, "confirmation-required");
  assertEquals(client.calls, []);
});

Deno.test("CM-01 mechanical R3 retry requires its exact acknowledgement before any MCP call", async () => {
  const client = new ScriptedClient([]);
  await assertRejects(
    () => runCoffeeMachineCm01V3MechanicalR3Retry({ execute: true, client }),
    Error,
    "acknowledge=EXECUTE_CM01_V3_MECHANICAL_R3_RETRY",
  );
  assertEquals(client.calls, []);
});

Deno.test("CM-01 mechanical R3 retry appends one new R3 run from exact R9 evidence", async () => {
  const baseline = r2Baseline();
  const r3Queued = queuedRun(
    "run:cm01-v3-r9-r10-mechanical-r3-retry-queue",
    R3_WORK_ITEM,
    r9(),
  );
  const r3Completed = completedRun(
    "run:cm01-v3-r9-r10-mechanical-r3-retry-queue",
    R3_WORK_ITEM,
    r9(),
    r10(),
    artifact("cm01-r3-calculix-solve", r10()),
  );
  const client = new ScriptedClient([
    response("project_snapshot", project(51, r9(), baseline.workItems, baseline.runs)),
    response(
      "project_change_append",
      project(52, r9(), [...baseline.workItems, r3WorkItem(r9())], baseline.runs, [
        { commandId: "cm01-v3-r9-r10-mechanical-r3-retry-append" },
      ], [r3Phase()]),
    ),
    response(
      "project_agent_run_queue",
      project(
        53,
        r9(),
        [...baseline.workItems, r3WorkItem(r9())],
        [
          ...baseline.runs,
          r3Queued,
        ],
        [{ commandId: "cm01-v3-r9-r10-mechanical-r3-retry-append" }],
        [r3Phase()],
      ),
    ),
    response(
      "project_agent_run_execute",
      project(
        57,
        r10(),
        [...baseline.workItems, r3WorkItem(r9())],
        [
          ...baseline.runs,
          r3Completed,
        ],
        [{ commandId: "cm01-v3-r9-r10-mechanical-r3-retry-append" }],
        [r3Phase()],
      ),
    ),
  ]);

  const result = await runCoffeeMachineCm01V3MechanicalR3Retry({
    execute: true,
    acknowledgement: CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT,
    client,
  });

  assertEquals(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected acknowledged R3 retry.");
  assertEquals(result.mechanicalSnapshot, r10());
  assertEquals(result.correctionEvidence, artifact(CORRECTION, r9()));
  assertEquals(result.revisedCadStepEvidence, artifact(CAD_STEP, r9()));
  assertEquals(result.mechanicalEvidence, artifact("cm01-r3-calculix-solve", r10()));
  assertEquals(client.calls.map((call) => call.name), [
    "project_snapshot",
    "project_change_append",
    "project_agent_run_queue",
    "project_agent_run_execute",
  ]);

  const append = client.calls[1]!.arguments!;
  assertEquals(append.baseSnapshot, r9());
  assertEquals(append.phases, [r3Phase()]);
  assertEquals(append.workItems, [r3WorkItem(r9())]);
  assertEquals(client.calls[2]!.arguments, {
    commandId: "cm01-v3-r9-r10-mechanical-r3-retry-queue",
    projectId: PROJECT_ID,
    expectedRevision: 52,
    issuedAt: "2026-08-03T12:30:00.000Z",
    workItemId: R3_WORK_ITEM,
  });
  assertEquals(client.calls[3]!.arguments, {
    commandId: "cm01-v3-r9-r10-mechanical-r3-retry-execute",
    projectId: PROJECT_ID,
    expectedRevision: 53,
    issuedAt: "2026-08-03T12:30:00.000Z",
    runId: "run:cm01-v3-r9-r10-mechanical-r3-retry-queue",
  });
});

Deno.test("CM-01 mechanical R3 retry refuses an existing R3 work item without mutating", async () => {
  const baseline = r2Baseline();
  const client = new ScriptedClient([
    response(
      "project_snapshot",
      project(52, r9(), [...baseline.workItems, r3WorkItem(r9())], baseline.runs),
    ),
  ]);

  await assertRejects(
    () =>
      runCoffeeMachineCm01V3MechanicalR3Retry({
        execute: true,
        acknowledgement: CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT,
        client,
      }),
    Error,
    "already exists; refusing replay",
  );
  assertEquals(client.calls.map((call) => call.name), ["project_snapshot"]);
});

Deno.test("CM-01 mechanical R3 retry refuses anything other than the recorded R2 failure", async () => {
  const baseline = r2Baseline({ mechanicalStatus: "completed" });
  const client = new ScriptedClient([
    response("project_snapshot", project(51, r9(), baseline.workItems, baseline.runs)),
  ]);

  await assertRejects(
    () =>
      runCoffeeMachineCm01V3MechanicalR3Retry({
        execute: true,
        acknowledgement: CM01_V3_MECHANICAL_R3_RETRY_EXECUTION_ACKNOWLEDGEMENT,
        client,
      }),
    Error,
    "recorded R2 mechanical run to be failed",
  );
  assertEquals(client.calls.map((call) => call.name), ["project_snapshot"]);
});

function r2Baseline(options: { mechanicalStatus?: string } = {}) {
  const correction = completedRun(
    "run:cm01-v3-r7-r10-28-to-30-queue-correction",
    "record-cm01-v3-drip-tray-height-28-to-30-correction",
    r7(),
    r8(),
    artifact(CORRECTION, r8()),
  );
  const cad = completedRun(
    "run:cm01-v3-r7-r10-28-to-30-queue-cad-r2",
    "build-cm01-v3-drip-tray-height-30-cad",
    r8(),
    r9(),
    artifact(CAD_STEP, r9()),
  );
  const failedMechanical = {
    id: "run:cm01-v3-r7-r10-28-to-30-queue-mechanical-r2",
    workItemId: "verify-cm01-v3-drip-tray-height-30-mechanical",
    status: options.mechanicalStatus ?? "failed",
    basis: { kind: "thread-snapshot", ...r9() },
    resultSnapshot: null,
    evidenceRefs: [],
    failure: {
      code: "cm01-r2-mechanical-not-published",
      message: "No durable evidence.",
    },
  };
  return {
    workItems: [
      workItem(
        "record-cm01-v3-drip-tray-height-28-to-30-correction",
        "design.correct-coffee-machine-cm01-drip-tray-height",
        "1",
      ),
      workItem(
        "build-cm01-v3-drip-tray-height-30-cad",
        "design.build-coffee-machine-cm01-cad",
        "2",
      ),
      workItem(
        "verify-cm01-v3-drip-tray-height-30-mechanical",
        "verify.coffee-machine-cm01-drip-tray-mechanical",
        "2",
      ),
    ],
    runs: [correction, cad, failedMechanical],
  };
}

function project(
  revision: number,
  head: ReturnType<typeof thread>,
  workItems: readonly Record<string, unknown>[],
  agentRuns: readonly Record<string, unknown>[],
  planChanges: readonly Record<string, unknown>[] = [],
  phases: readonly Record<string, unknown>[] = [],
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
    planChanges,
    phases,
  };
}

function r3Phase() {
  return {
    id: R3_PHASE,
    name: "Retry the reviewed 30 mm DripTray mechanical proof",
    description:
      "Run the separately reviewed R3 static-proof recovery from the exact R9 correction and CAD evidence; the failed R2 provider attempt remains retained.",
  };
}

function r3WorkItem(basis: ReturnType<typeof thread>) {
  return {
    id: R3_WORK_ITEM,
    phaseId: R3_PHASE,
    owner: "agent",
    dependsOnWorkItemIds: [],
    decisionIds: [],
    operation: {
      id: "verify.coffee-machine-cm01-drip-tray-mechanical",
      version: "3",
      bindings: [
        { name: "approvedBrief", source: { kind: "approved-brief" } },
        {
          name: "dripTrayHeightCorrection",
          source: { kind: "thread-entity", reference: artifact(CORRECTION, basis) },
        },
        {
          name: "revisedCadStep",
          source: { kind: "thread-entity", reference: artifact(CAD_STEP, basis) },
        },
      ],
    },
  };
}

function workItem(id: string, operationId: string, version: string) {
  return {
    id,
    phaseId: "fixture",
    owner: "agent",
    dependsOnWorkItemIds: [],
    decisionIds: [],
    operation: { id: operationId, version, bindings: [] },
  };
}

function thread(revision: number) {
  return {
    snapshotId: `project:coffee-machine-cm01-v3:r${revision}:fixture`,
    revision,
    subjectId: SUBJECT_ID,
  };
}

function r7() {
  return thread(7);
}

function r8() {
  return thread(8);
}

function r9() {
  return thread(9);
}

function r10() {
  return thread(10);
}

function artifact(id: string, snapshot: ReturnType<typeof thread>) {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as const,
    id,
  };
}

function completedRun(
  id: string,
  workItemId: string,
  basis: ReturnType<typeof thread>,
  resultSnapshot: ReturnType<typeof thread>,
  evidence: ReturnType<typeof artifact>,
) {
  return {
    id,
    workItemId,
    status: "completed",
    basis: { kind: "thread-snapshot", ...basis },
    resultSnapshot,
    evidenceRefs: [evidence],
  };
}

function queuedRun(
  id: string,
  workItemId: string,
  basis: ReturnType<typeof thread>,
) {
  return {
    id,
    workItemId,
    status: "queued",
    basis: { kind: "thread-snapshot", ...basis },
    resultSnapshot: null,
    evidenceRefs: [],
  };
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

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

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
