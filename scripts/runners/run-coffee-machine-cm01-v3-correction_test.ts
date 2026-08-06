import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import {
  CM01_V3_CORRECTION_EXECUTION_ACKNOWLEDGEMENT,
  runCoffeeMachineCm01V3Correction,
} from "./run-coffee-machine-cm01-v3-correction.ts";

const PROJECT_ID = "coffee-machine-cm01-v3";
const SUBJECT_ID = "project:coffee-machine-cm01-v3";
const CORRECTION = "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record";

Deno.test("CM-01 V3 correction runner remains inert without --execute", async () => {
  const client = new ScriptedClient([]);
  const result = await runCoffeeMachineCm01V3Correction({ client });

  assertEquals(result.status, "confirmation-required");
  assertEquals(client.calls, []);
});

Deno.test("CM-01 V3 correction runner refuses a real run without its exact acknowledgement", async () => {
  const client = new ScriptedClient([]);
  await assertRejects(
    () => runCoffeeMachineCm01V3Correction({ execute: true, client }),
    Error,
    "acknowledge=EXECUTE_CM01_V3_28_TO_30_CORRECTION",
  );
  assertEquals(client.calls, []);
});

Deno.test("CM-01 V3 correction runner drives correction, CAD@2 and mechanical@2 through the MCP control plane", async () => {
  const r7 = thread(7);
  const correctionEvidence = artifact(CORRECTION, r8());
  const cadEvidence = artifact("cm01-r2-assembly-step", r9());
  const mechanicalEvidence = artifact("cm01-r2-calculix-solve", r10());
  const correctionRun = run(
    "run:cm01-v3-r7-r10-28-to-30-queue-correction",
    "record-cm01-v3-drip-tray-height-28-to-30-correction",
    "completed",
    r7,
    r8(),
    correctionEvidence,
  );
  const cadRun = run(
    "run:cm01-v3-r7-r10-28-to-30-queue-cad-r2",
    "build-cm01-v3-drip-tray-height-30-cad",
    "completed",
    r8(),
    r9(),
    cadEvidence,
  );
  const mechanicalRun = run(
    "run:cm01-v3-r7-r10-28-to-30-queue-mechanical-r2",
    "verify-cm01-v3-drip-tray-height-30-mechanical",
    "completed",
    r9(),
    r10(),
    mechanicalEvidence,
  );
  const client = new ScriptedClient([
    response("project_snapshot", project(37, r7, [])),
    response("project_change_append", project(38, r7, [])),
    response(
      "project_agent_run_queue",
      project(39, r7, [queued(correctionRun)]),
    ),
    response(
      "project_agent_run_execute",
      project(43, r8(), [correctionRun]),
    ),
    response("project_change_append", project(44, r8(), [correctionRun])),
    response(
      "project_agent_run_queue",
      project(45, r8(), [correctionRun, queued(cadRun)]),
    ),
    response(
      "project_agent_run_execute",
      project(49, r9(), [correctionRun, cadRun]),
    ),
    response(
      "project_change_append",
      project(50, r9(), [correctionRun, cadRun]),
    ),
    response(
      "project_agent_run_queue",
      project(51, r9(), [correctionRun, cadRun, queued(mechanicalRun)]),
    ),
    response(
      "project_agent_run_execute",
      project(55, r10(), [correctionRun, cadRun, mechanicalRun]),
    ),
  ]);

  const result = await runCoffeeMachineCm01V3Correction({
    execute: true,
    acknowledgement: CM01_V3_CORRECTION_EXECUTION_ACKNOWLEDGEMENT,
    client,
  });

  assertEquals(result.status, "completed");
  if (result.status !== "completed") {
    throw new Error("The acknowledged correction run must complete in this fixture.");
  }
  assertEquals(result.correctionSnapshot, r8());
  assertEquals(result.cadSnapshot, r9());
  assertEquals(result.mechanicalSnapshot, r10());
  assertEquals(result.correctionEvidence, correctionEvidence);
  assertEquals(result.revisedCadStepEvidence, cadEvidence);
  assertEquals(result.mechanicalEvidence, mechanicalEvidence);
  assertEquals(client.calls.map((call) => call.name), [
    "project_snapshot",
    "project_change_append",
    "project_agent_run_queue",
    "project_agent_run_execute",
    "project_change_append",
    "project_agent_run_queue",
    "project_agent_run_execute",
    "project_change_append",
    "project_agent_run_queue",
    "project_agent_run_execute",
  ]);

  const cadAppend = client.calls[4]!.arguments!;
  const cadOperation = (cadAppend.workItems as Array<Record<string, unknown>>)[0]!
    .operation as Record<string, unknown>;
  assertEquals(cadAppend.baseSnapshot, r8());
  assertEquals(cadOperation.bindings, [
    { name: "approvedBrief", source: { kind: "approved-brief" } },
    {
      name: "dripTrayHeightCorrection",
      source: { kind: "thread-entity", reference: correctionEvidence },
    },
  ]);

  const mechanicalAppend = client.calls[7]!.arguments!;
  const mechanicalOperation =
    (mechanicalAppend.workItems as Array<Record<string, unknown>>)[0]!
      .operation as Record<string, unknown>;
  assertEquals(mechanicalAppend.baseSnapshot, r9());
  assertEquals(mechanicalOperation.bindings, [
    { name: "approvedBrief", source: { kind: "approved-brief" } },
    {
      name: "dripTrayHeightCorrection",
      source: {
        kind: "thread-entity",
        reference: artifact(CORRECTION, r9()),
      },
    },
    {
      name: "revisedCadStep",
      source: { kind: "thread-entity", reference: cadEvidence },
    },
  ]);
});

Deno.test("CM-01 V3 correction runner resumes from completed correction and CAD r9 without replaying them", async () => {
  const correctionEvidence = artifact(CORRECTION, r8());
  const cadEvidence = artifact("cm01-r2-assembly-step", r9());
  const mechanicalEvidence = artifact("cm01-r2-calculix-solve", r10());
  const correctionRun = run(
    "run:cm01-v3-r7-r10-28-to-30-queue-correction",
    "record-cm01-v3-drip-tray-height-28-to-30-correction",
    "completed",
    thread(7),
    r8(),
    correctionEvidence,
  );
  const cadRun = run(
    "run:cm01-v3-r7-r10-28-to-30-queue-cad-r2",
    "build-cm01-v3-drip-tray-height-30-cad",
    "completed",
    r8(),
    r9(),
    cadEvidence,
  );
  const mechanicalRun = run(
    "run:cm01-v3-r7-r10-28-to-30-queue-mechanical-r2",
    "verify-cm01-v3-drip-tray-height-30-mechanical",
    "completed",
    r9(),
    r10(),
    mechanicalEvidence,
  );
  const client = new ScriptedClient([
    response("project_snapshot", project(49, r9(), [correctionRun, cadRun])),
    response(
      "project_change_append",
      project(50, r9(), [correctionRun, cadRun]),
    ),
    response(
      "project_agent_run_queue",
      project(51, r9(), [correctionRun, cadRun, queued(mechanicalRun)]),
    ),
    response(
      "project_agent_run_execute",
      project(55, r10(), [correctionRun, cadRun, mechanicalRun]),
    ),
  ]);

  const result = await runCoffeeMachineCm01V3Correction({
    execute: true,
    acknowledgement: CM01_V3_CORRECTION_EXECUTION_ACKNOWLEDGEMENT,
    client,
  });

  assertEquals(result.status, "completed");
  if (result.status !== "completed") {
    throw new Error("The resumed correction run must complete in this fixture.");
  }
  assertEquals(result.correctionSnapshot, r8());
  assertEquals(result.cadSnapshot, r9());
  assertEquals(result.mechanicalSnapshot, r10());
  assertEquals(client.calls.map((call) => call.name), [
    "project_snapshot",
    "project_change_append",
    "project_agent_run_queue",
    "project_agent_run_execute",
  ]);

  const mechanicalAppend = client.calls[1]!.arguments!;
  const operation = (mechanicalAppend.workItems as Array<Record<string, unknown>>)[0]!
    .operation as Record<string, unknown>;
  assertEquals(mechanicalAppend.baseSnapshot, r9());
  assertEquals(operation.bindings, [
    { name: "approvedBrief", source: { kind: "approved-brief" } },
    {
      name: "dripTrayHeightCorrection",
      source: {
        kind: "thread-entity",
        reference: artifact(CORRECTION, r9()),
      },
    },
    {
      name: "revisedCadStep",
      source: { kind: "thread-entity", reference: cadEvidence },
    },
  ]);
});

function project(
  revision: number,
  head: ReturnType<typeof thread>,
  agentRuns: unknown[],
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
    agentRuns,
  };
}

function thread(revision: number) {
  return {
    snapshotId: `project:coffee-machine-cm01-v3:r${revision}:fixture`,
    revision,
    subjectId: SUBJECT_ID,
  };
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
    kind: "artifact",
    id,
  } as const;
}

function run(
  id: string,
  workItemId: string,
  status: string,
  basis: ReturnType<typeof thread>,
  resultSnapshot: ReturnType<typeof thread>,
  evidence: ReturnType<typeof artifact>,
) {
  return {
    id,
    workItemId,
    status,
    basis: { kind: "thread-snapshot", ...basis },
    resultSnapshot,
    evidenceRefs: [evidence],
  };
}

function queued(completed: ReturnType<typeof run>) {
  return {
    ...completed,
    status: "queued",
    resultSnapshot: undefined,
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
