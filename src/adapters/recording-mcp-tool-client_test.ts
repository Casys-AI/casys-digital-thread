import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../application/ports/out/mcp-tool-client.ts";
import { LiveThreadUpdateStore } from "./shared/stores/live-thread-update-store.ts";
import {
  RecordingMcpToolClient,
  type RecordingMcpToolEvent,
} from "./recording-mcp-tool-client.ts";

Deno.test("RecordingMcpToolClient publishes running before resolution then fresh on the same node", async () => {
  const deferred = deferredResult();
  let calls = 0;
  const underlying: McpToolClient = {
    callTool() {
      calls++;
      return deferred.promise;
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
  const updates = new LiveThreadUpdateStore();
  const client = recordingClient(underlying, updates);
  const pending = client.callTool({
    name: "build123d_export",
    arguments: { script: "result = Box(1, 2, 3)", token: "private-token" },
  });

  const started = await waitForUpdates(updates, 1);
  assertEquals(calls, 1);
  assertEquals(started.length, 1);
  assertEquals(started[0].state, "running");
  assertEquals(started[0].graph.nodes[0].freshness, "running");

  deferred.resolve({
    text: "exported",
    structuredContent: {
      files: [{ format: "step", sha256: "a".repeat(64) }],
      apiKey: "provider-secret",
    },
  });
  await pending;

  const journal = await updates.list("coffee-machine-cm01");
  assertEquals(calls, 1);
  assertEquals(journal.length, 2);
  assertEquals(journal[1].state, "fresh");
  assertEquals(journal[0].graph.nodes[0].ref, journal[1].graph.nodes[0].ref);
  const persisted = JSON.stringify(journal);
  assertEquals(persisted.includes("result = Box"), false);
  assertEquals(persisted.includes("private-token"), false);
  assertEquals(persisted.includes("provider-secret"), false);
});

Deno.test("RecordingMcpToolClient records failed and never retries", async () => {
  let calls = 0;
  const underlying: McpToolClient = {
    callTool() {
      calls++;
      return Promise.reject(new Error("provider unavailable"));
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
  const updates = new LiveThreadUpdateStore();
  const client = recordingClient(underlying, updates);

  await assertRejects(
    () => client.callTool({ name: "syson_value_read" }),
    Error,
    "provider unavailable",
  );
  const journal = await updates.list("coffee-machine-cm01");
  assertEquals(calls, 1);
  assertEquals(journal.map((update) => update.state), ["running", "failed"]);
  assertEquals(journal[0].graph.nodes[0].ref, journal[1].graph.nodes[0].ref);
  assertEquals(journal[1].graph.nodes[0].summary, "provider unavailable");
});

function recordingClient(
  client: McpToolClient,
  updates: LiveThreadUpdateStore,
): RecordingMcpToolClient {
  return new RecordingMcpToolClient({
    client,
    updates,
    subjectId: "coffee-machine-cm01",
    runId: "coffee-run-1",
    serverId: "mcp-build123d",
    baseRevision: 5,
    operationId: () => "cad-assembly-export",
    now: () => new Date("2026-08-01T10:00:00.000Z"),
    project: projectEvent,
  });
}

function projectEvent(event: RecordingMcpToolEvent) {
  const details = event.phase === "started"
    ? JSON.stringify(event.call.arguments) ?? "Tool call started"
    : event.phase === "completed"
    ? JSON.stringify(event.result?.structuredContent)
    : event.error ?? "failed";
  return {
    nodes: [{
      id: "graph:artifact:cad-assembly",
      ref: { kind: "artifact" as const, id: "cad-assembly" },
      entityKind: "artifact" as const,
      artifactKind: "cad-model",
      label: "CoffeeMachine CAD assembly",
      system: event.serverId,
      freshness: "running" as const,
      summary: details,
      recordedAt: event.recordedAt,
      selection: { kind: "artifact" as const, id: "cad-assembly" },
    }],
    edges: [],
  };
}

async function waitForUpdates(
  updates: LiveThreadUpdateStore,
  count: number,
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const journal = await updates.list("coffee-machine-cm01");
    if (journal.length >= count) return journal;
    await Promise.resolve();
  }
  return updates.list("coffee-machine-cm01");
}

function deferredResult(): {
  promise: Promise<McpToolResult>;
  resolve: (result: McpToolResult) => void;
} {
  let resolve!: (result: McpToolResult) => void;
  const promise = new Promise<McpToolResult>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

// Compile-time proof that the wrapper keeps the original call shape.
const _call: McpToolCall = { name: "unused" };
void _call;
