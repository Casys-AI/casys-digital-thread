import { assertEquals } from "@std/assert";
import {
  createInspectionDroneArchitectureLiveProjector,
} from "./inspection-drone-architecture-live-projector.ts";
import type { RecordingMcpToolEvent } from "./recording-mcp-tool-client.ts";

const RUN_ID = "run:author-inspection-drone";

Deno.test("inspection-drone architecture live projector distinguishes all guarded SysON milestones", () => {
  const project = createInspectionDroneArchitectureLiveProjector(RUN_ID);

  const preflightStarted = project(event(
    "syson_element_children",
    "started",
    "same-operation-id",
  ));
  assertEquals(preflightStarted.nodes.map((node) => [node.ref.id, node.freshness]), [
    [`${RUN_ID}:root-preflight`, "running"],
  ]);

  const preflightCompleted = project(event(
    "syson_element_children",
    "completed",
    "same-operation-id",
  ));
  assertEquals(preflightCompleted.nodes[0]?.freshness, "fresh");

  const insertStarted = project(event(
    "syson_element_insert_sysml",
    "started",
    "same-operation-id",
  ));
  assertEquals(insertStarted.nodes.map((node) => node.ref.id), [
    `${RUN_ID}:architecture-insert`,
  ]);
  assertEquals(insertStarted.edges.map((edge) => edge.id), [
    `${RUN_ID}:root-preflight-to-architecture-insert`,
  ]);
  project(event("syson_element_insert_sysml", "completed", "same-operation-id"));

  const rootReadback = project(event(
    "syson_element_children",
    "started",
    "same-operation-id",
  ));
  assertEquals(rootReadback.nodes.map((node) => node.ref.id), [
    `${RUN_ID}:root-readback`,
  ]);
  assertEquals(rootReadback.edges.map((edge) => edge.id), [
    `${RUN_ID}:architecture-insert-to-root-readback`,
  ]);
  project(event("syson_element_children", "completed", "same-operation-id"));

  const packageReadbackStarted = project(event(
    "syson_element_children",
    "started",
    "same-operation-id",
  ));
  assertEquals(packageReadbackStarted.nodes.map((node) => node.ref.id), [
    `${RUN_ID}:package-readback`,
  ]);

  const packageReadback = project(event(
    "syson_element_children",
    "completed",
    "same-operation-id",
  ));
  assertEquals(packageReadback.nodes.map((node) => [node.ref.id, node.freshness]), [
    [`${RUN_ID}:package-readback`, "fresh"],
  ]);
  assertEquals(packageReadback.edges.map((edge) => edge.id), [
    `${RUN_ID}:root-readback-to-package-readback`,
  ]);
});

Deno.test("inspection-drone architecture live projector never exposes SysML inputs or provider results", () => {
  const sysml = "package InspectionDroneArchitecture { private-token: never-show; }";
  const providerResult = "raw-syson-response-should-never-reach-the-feed";
  const providerText = "raw-syson-text-should-never-reach-the-feed";
  const project = createInspectionDroneArchitectureLiveProjector(RUN_ID);

  const preflight = project(event(
    "syson_element_children",
    "completed",
    "root-preflight",
    { sysml_text: sysml, credential: "private-token" },
    { children: [{ id: providerResult, label: providerResult }] },
    providerText,
  ));
  const insert = project(event(
    "syson_element_insert_sysml",
    "failed",
    "architecture-insert",
    { sysml_text: sysml },
    { providerResult },
    providerResult,
    providerResult,
  ));
  const visible = JSON.stringify([preflight, insert]);

  for (
    const privateValue of [
      sysml,
      "private-token",
      providerResult,
      providerText,
    ]
  ) {
    assertEquals(visible.includes(privateValue), false);
  }
  assertEquals(insert.nodes[0]?.summary.includes("architecture insert"), true);
});

Deno.test("inspection-drone architecture live projector ignores an out-of-order tool or another run", () => {
  const project = createInspectionDroneArchitectureLiveProjector(RUN_ID);
  assertEquals(
    project(event("syson_element_insert_sysml", "started", "unexpected")),
    { nodes: [], edges: [] },
  );
  assertEquals(
    project(
      event(
        "syson_element_children",
        "started",
        "another-run",
        {},
        {},
        undefined,
        undefined,
        "run:other",
      ),
    ),
    { nodes: [], edges: [] },
  );
  assertEquals(
    project(event("syson_element_children", "started", "root-preflight"))
      .nodes.map((node) => node.ref.id),
    [`${RUN_ID}:root-preflight`],
  );
});

function event(
  toolName: string,
  phase: RecordingMcpToolEvent["phase"],
  operationId: string,
  arguments_: Record<string, unknown> = { private: "provider-id" },
  structuredContent: Record<string, unknown> = { id: "provider-id" },
  resultText = "private provider response",
  error?: string,
  runId = RUN_ID,
): RecordingMcpToolEvent {
  return {
    phase,
    subjectId: "drone-concept",
    runId,
    operationId,
    serverId: "syson",
    toolName,
    recordedAt: "2026-08-03T08:00:00.000Z",
    call: { name: toolName, arguments: arguments_ },
    ...(phase === "completed"
      ? {
        result: {
          text: resultText,
          structuredContent,
        },
      }
      : {}),
    ...(phase === "failed" && error ? { error } : {}),
  };
}
