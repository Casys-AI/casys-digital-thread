import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { McpToolCall, McpToolResult } from "./http-mcp-tool-client.ts";
import {
  LiveThreadUpdateStore,
  overlayLiveThreadUpdates,
} from "./live-thread-update-store.ts";
import {
  RecordingMcpToolClient,
  type RecordingMcpToolEvent,
} from "./recording-mcp-tool-client.ts";
import {
  COFFEE_MACHINE_CAD_OPERATION_ID,
  COFFEE_MACHINE_SYSON_OPERATION_ID,
  coffeeMachineBuildCadArtifactId,
  coffeeMachineBuildSourceArtifactId,
  createCoffeeMachineCadLiveProjector,
  createCoffeeMachineSysonLiveProjector,
  SerializedLiveThreadUpdateJournal,
} from "./coffee-machine-build-live-projector.ts";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "../ui/src/thread/fixture.ts";

const RUN_ID = "build-20260801T100000000Z";
const NOW = "2026-08-01T10:00:00.000Z";

Deno.test("SysON projection coalesces concurrent reads into one stable progress node", async () => {
  const inner = new LiveThreadUpdateStore();
  const updates = new SerializedLiveThreadUpdateJournal(inner, {
    expectedSysonReads: 3,
  });
  const client = new RecordingMcpToolClient({
    client: {
      callTool: (call) =>
        Promise.resolve({
          text: "read",
          structuredContent: {
            element_id: call.arguments?.element_id,
            value: 1,
          },
        }),
      callToolTextResult(call: McpToolCall) {
        return Promise.reject(
          new Error(
            `callToolTextResult is not implemented by this stub (${call.name})`,
          ),
        );
      },
    },
    updates,
    subjectId: "coffee-machine-cm01",
    runId: RUN_ID,
    serverId: "mcp-syson",
    baseRevision: 5,
    operationId: () => COFFEE_MACHINE_SYSON_OPERATION_ID,
    now: () => new Date(NOW),
    project: createCoffeeMachineSysonLiveProjector({
      runId: RUN_ID,
      expectedSysonReads: 3,
    }),
  });

  await Promise.all(
    ["attribute-a", "attribute-b", "attribute-c"].map((id) =>
      client.callTool({ name: "syson_value_read", arguments: { element_id: id } })
    ),
  );

  const journal = await updates.list("coffee-machine-cm01");
  assertEquals(
    journal.slice(0, -1).every((update) => update.state === "running"),
    true,
  );
  assertEquals(journal.at(-1)?.state, "fresh");
  const refs = journal.map((update) => update.graph.nodes[0]?.ref);
  assertEquals(
    refs.every((ref) =>
      ref?.kind === "artifact" &&
      ref.id === coffeeMachineBuildSourceArtifactId(RUN_ID)
    ),
    true,
  );
  assertEquals(
    journal.some((update) => update.graph.nodes[0]?.summary.includes("1/3 completed")),
    true,
  );
  const overlay = overlayLiveThreadUpdates(
    COFFEE_MACHINE_THREAD_FIXTURE,
    5,
    journal,
  );
  const sourceNodes = overlay.graph.nodes.filter((node) =>
    node.ref.id === coffeeMachineBuildSourceArtifactId(RUN_ID)
  );
  assertEquals(sourceNodes.length, 1);
  assertEquals(sourceNodes[0].freshness, "fresh");
  assertEquals(
    sourceNodes[0].summary,
    "3/3 completed · exact SysON source captured",
  );
  assertEquals(overlay.live.active.length, 1);
});

Deno.test("CAD projection keeps one node and one source-to-result edge without secrets", async () => {
  const secretScript = "from build123d import Box\nresult = Box(1, 2, 3)";
  const secretToken = "private-build-token";
  const providerSecret = "provider-api-secret";
  const inner = new LiveThreadUpdateStore();
  const updates = new SerializedLiveThreadUpdateJournal(inner);
  const client = new RecordingMcpToolClient({
    client: {
      callTool: () => Promise.resolve(exportResult(providerSecret)),
      callToolTextResult(call: McpToolCall) {
        return Promise.reject(
          new Error(
            `callToolTextResult is not implemented by this stub (${call.name})`,
          ),
        );
      },
    },
    updates,
    subjectId: "coffee-machine-cm01",
    runId: RUN_ID,
    serverId: "mcp-build123d",
    baseRevision: 5,
    operationId: () => COFFEE_MACHINE_CAD_OPERATION_ID,
    now: () => new Date(NOW),
    project: createCoffeeMachineCadLiveProjector({ runId: RUN_ID }),
  });

  await client.callTool({
    name: "build123d_export",
    arguments: { script: secretScript, token: secretToken },
  });

  const journal = await updates.list("coffee-machine-cm01");
  assertEquals(journal.map((update) => update.state), ["running", "fresh"]);
  assertEquals(journal[0].graph.nodes[0].ref, journal[1].graph.nodes[0].ref);
  assertEquals(
    journal[1].graph.nodes[0].ref.id,
    coffeeMachineBuildCadArtifactId(RUN_ID),
  );
  assertEquals(journal[0].graph.edges[0].id, journal[1].graph.edges[0].id);
  assertEquals(journal[1].graph.edges[0].from, {
    kind: "artifact",
    id: coffeeMachineBuildSourceArtifactId(RUN_ID),
  });
  assertEquals(journal[1].graph.edges[0].to, {
    kind: "artifact",
    id: coffeeMachineBuildCadArtifactId(RUN_ID),
  });
  assertEquals(journal[1].graph.edges[0].relation, "derived_from");
  assertEquals(
    journal[1].graph.nodes[0].summary,
    "3 exports completed · STEP sha256:aaaaaaaaaaaa…",
  );
  const persisted = JSON.stringify(journal);
  for (const sensitive of [secretScript, secretToken, providerSecret]) {
    assertEquals(persisted.includes(sensitive), false);
  }
});

Deno.test("CAD provider failure updates the same node to failed without leaking the error", async () => {
  const updates = new LiveThreadUpdateStore();
  const client = new RecordingMcpToolClient({
    client: {
      callTool: () => Promise.reject(new Error("Bearer private-failure-token")),
      callToolTextResult(call: McpToolCall) {
        return Promise.reject(
          new Error(
            `callToolTextResult is not implemented by this stub (${call.name})`,
          ),
        );
      },
    },
    updates,
    subjectId: "coffee-machine-cm01",
    runId: RUN_ID,
    serverId: "mcp-build123d",
    baseRevision: 5,
    operationId: () => COFFEE_MACHINE_CAD_OPERATION_ID,
    now: () => new Date(NOW),
    project: createCoffeeMachineCadLiveProjector({ runId: RUN_ID }),
  });

  await assertRejects(
    () => client.callTool({ name: "build123d_export", arguments: {} }),
    Error,
    "private-failure-token",
  );
  const journal = await updates.list("coffee-machine-cm01");
  assertEquals(journal.map((update) => update.state), ["running", "failed"]);
  assertEquals(journal[0].graph.nodes[0].ref, journal[1].graph.nodes[0].ref);
  assertEquals(journal[1].graph.nodes[0].summary, "CoffeeMachine CAD export failed");
  assertEquals(JSON.stringify(journal).includes("private-failure-token"), false);
});

Deno.test("projectors reject another run or tool instead of mixing operations", () => {
  const syson = createCoffeeMachineSysonLiveProjector({ runId: RUN_ID });
  const cad = createCoffeeMachineCadLiveProjector({ runId: RUN_ID });
  assertThrows(
    () => syson(event({ runId: "another-run" })),
    TypeError,
    "runId mismatch",
  );
  assertThrows(
    () => cad(event({ toolName: "build123d_execute" })),
    TypeError,
    "only accepts build123d_export",
  );
});

function event(
  overrides: Partial<RecordingMcpToolEvent> = {},
): RecordingMcpToolEvent {
  return {
    phase: "started",
    subjectId: "coffee-machine-cm01",
    runId: RUN_ID,
    operationId: COFFEE_MACHINE_CAD_OPERATION_ID,
    serverId: "mcp-build123d",
    toolName: "build123d_export",
    recordedAt: NOW,
    call: { name: "build123d_export", arguments: {} },
    ...overrides,
  };
}

function exportResult(providerSecret: string): McpToolResult {
  return {
    text: "exported",
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      apiKey: providerSecret,
      metrics: {},
      files: [
        {
          format: "step",
          path: "/exports/coffee-machine.step",
          bytes: 100,
          sha256: "a".repeat(64),
        },
        {
          format: "gltf",
          path: "/exports/coffee-machine.glb",
          bytes: 90,
          sha256: "b".repeat(64),
        },
        {
          format: "stl",
          path: "/exports/coffee-machine.stl",
          bytes: 80,
          sha256: "c".repeat(64),
        },
      ],
    },
  };
}
