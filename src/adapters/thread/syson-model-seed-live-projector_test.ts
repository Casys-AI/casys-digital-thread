import { assertEquals } from "@std/assert";
import {
  createSysonModelSeedLiveProjector,
} from "./syson-model-seed-live-projector.ts";
import type { RecordingMcpToolEvent } from "../recording-mcp-tool-client.ts";

Deno.test("SysON seed live projector shows the container chain without provider payloads", () => {
  const project = createSysonModelSeedLiveProjector("run:seed-syson");
  const before = project(event("syson_project_create", "started"));
  assertEquals(before.nodes.map((node) => [node.label, node.freshness]), [
    ["SysON project container", "running"],
  ]);
  assertEquals(before.nodes[0]?.activityRole, "milestone");

  const model = project(event("syson_model_create", "completed"));
  assertEquals(model.nodes.map((node) => [node.label, node.freshness]), [
    ["SysON project container", "fresh"],
    ["Editable SysML document", "fresh"],
  ]);
  assertEquals(model.edges.map((edge) => edge.relation), ["source_of"]);

  const root = project(event("syson_element_get", "completed"));
  assertEquals(root.nodes.map((node) => node.label), [
    "SysON project container",
    "Editable SysML document",
    "SysML root package",
  ]);
  assertEquals(root.edges.map((edge) => edge.id), [
    "run:seed-syson:project-contains-document",
    "run:seed-syson:document-contains-root",
  ]);
  assertEquals(JSON.stringify(root).includes("provider-id"), false);
  assertEquals(JSON.stringify(root).includes("hidden provider error"), false);
});

function event(
  toolName: string,
  phase: RecordingMcpToolEvent["phase"],
): RecordingMcpToolEvent {
  return {
    phase,
    subjectId: "project:drone",
    runId: "run:seed-syson",
    operationId: `syson:${toolName}:1`,
    serverId: "syson",
    toolName,
    recordedAt: "2026-08-02T08:00:00.000Z",
    call: { name: toolName, arguments: { private: "provider-id" } },
    ...(phase === "completed"
      ? {
        result: {
          structuredContent: { id: "provider-id" },
          text: "hidden provider error",
        },
      }
      : {}),
  };
}
