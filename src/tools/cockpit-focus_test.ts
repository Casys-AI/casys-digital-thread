import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  McpApp,
  MCPTool,
  ToolHandler,
  ToolHandlerContext,
} from "@casys/mcp-server";
import type { CockpitFocusStore } from "../adapters/file-cockpit-focus-store.ts";
import type { CockpitFocusSnapshot } from "../domain/cockpit-focus.ts";
import { registerCockpitFocusTools } from "./cockpit-focus.ts";

Deno.test("cockpit focus tools verify the selected durable target before changing browser focus", async () => {
  const app = new CapturingApp();
  const store = new MemoryFocusStore();
  registerCockpitFocusTools(app as unknown as McpApp, {
    focus: store,
    projects: { get: (id) => Promise.resolve(id === "drone" ? project() : undefined) },
  });
  const set = app.handler("cockpit_focus_set");
  await assertRejects(
    async () => await set(args({ kind: "project", projectId: "missing" }), context()),
    TypeError,
    "was not found",
  );
  const result = await set(
    args({ kind: "project", projectId: "drone" }),
    context(),
  ) as Record<string, unknown>;
  assertStringIncludes(result.content as string, "did not create or change a project");
  assertEquals((result.structuredContent as CockpitFocusSnapshot).target, {
    kind: "project",
    projectId: "drone",
  });
  const read = await app.handler("cockpit_focus_snapshot")({
    workspaceId: "primary",
  }) as Record<string, unknown>;
  assertEquals(
    ((read.structuredContent as Record<string, unknown>).focus as CockpitFocusSnapshot)
      .revision,
    1,
  );
});

class CapturingApp {
  #handlers = new Map<string, ToolHandler>();
  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#handlers.set(tool.name, handler);
  }
  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assert(handler, `Expected handler ${name}`);
    return handler;
  }
}

class MemoryFocusStore implements CockpitFocusStore {
  value?: CockpitFocusSnapshot;
  get(): Promise<CockpitFocusSnapshot | undefined> {
    return Promise.resolve(this.value);
  }
  select(
    snapshot: CockpitFocusSnapshot,
    expectedRevision: number,
  ): Promise<CockpitFocusSnapshot> {
    if ((this.value?.revision ?? 0) !== expectedRevision) {
      return Promise.reject(new Error("stale focus"));
    }
    this.value = snapshot;
    return Promise.resolve(snapshot);
  }
}

function args(target: Record<string, unknown>) {
  return {
    commandId: "focus-1",
    workspaceId: "primary",
    expectedRevision: 0,
    issuedAt: "2026-08-03T12:00:00.000Z",
    target,
  };
}

function context(): ToolHandlerContext {
  return { toolName: "test", clientInfo: { name: "paired-chat", version: "1" } };
}

function project() {
  return { project: { id: "drone" } } as never;
}
