import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  McpApp,
  MCPTool,
  ToolHandler,
  ToolHandlerContext,
} from "@casys/mcp-server";
import type { CockpitFocusStore } from "../application/ports/out/project/cockpit-focus-store.ts";
import type { CockpitFocusSnapshot } from "../domain/project/cockpit-focus.ts";
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

Deno.test("cockpit_focus_set uses the current store revision when expectedRevision is omitted", async () => {
  const app = new CapturingApp();
  const store = new MemoryFocusStore();
  store.value = seededFocus(22);
  registerCockpitFocusTools(app as unknown as McpApp, {
    focus: store,
    projects: { get: (id) => Promise.resolve(id === "drone" ? project() : undefined) },
  });
  const result = await app.handler("cockpit_focus_set")(
    omitExpectedRevision(args({ kind: "project", projectId: "drone" })),
    context(),
  ) as Record<string, unknown>;
  assertEquals((result.structuredContent as CockpitFocusSnapshot).revision, 23);
  assertEquals((result.structuredContent as CockpitFocusSnapshot).previous, {
    revision: 22,
  });
});

Deno.test("cockpit_focus_set schema does not require expectedRevision", () => {
  const app = new CapturingApp();
  registerCockpitFocusTools(app as unknown as McpApp, {
    focus: new MemoryFocusStore(),
    projects: { get: () => Promise.resolve(undefined) },
  });
  const schema = app.tool("cockpit_focus_set").inputSchema as {
    required?: readonly string[];
  };
  const required = schema.required ?? [];
  assertEquals(required.includes("expectedRevision"), false);
  assertEquals(required.includes("commandId"), true);
  assertEquals(required.includes("issuedAt"), true);
});

Deno.test("cockpit_focus_set still rejects an explicit stale expectedRevision", async () => {
  const app = new CapturingApp();
  const store = new MemoryFocusStore();
  store.value = seededFocus(22);
  registerCockpitFocusTools(app as unknown as McpApp, {
    focus: store,
    projects: { get: (id) => Promise.resolve(id === "drone" ? project() : undefined) },
  });
  await assertRejects(
    async () =>
      await app.handler("cockpit_focus_set")(
        args({ kind: "project", projectId: "drone" }),
        context(),
      ),
    Error,
    "stale focus",
  );
  assertEquals(store.value?.revision, 22);
});

class CapturingApp {
  #handlers = new Map<string, ToolHandler>();
  #tools = new Map<string, MCPTool>();
  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }
  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assert(handler, `Expected handler ${name}`);
    return handler;
  }
  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    assert(tool, `Expected tool ${name}`);
    return tool;
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

function omitExpectedRevision(
  value: ReturnType<typeof args>,
): Omit<ReturnType<typeof args>, "expectedRevision"> {
  const { expectedRevision: _expectedRevision, ...omitted } = value;
  return omitted;
}

function seededFocus(revision: number): CockpitFocusSnapshot {
  return {
    schemaVersion: "cockpit-focus/1.0",
    workspaceId: "primary",
    revision,
    commandId: "focus-seed",
    selectedAt: "2026-08-03T11:00:00.000Z",
    selectedBy: { kind: "agent", actorId: "mcp:seed@1" },
    target: { kind: "project", projectId: "other" },
    previous: { revision: revision - 1 },
  };
}

function context(): ToolHandlerContext {
  return { toolName: "test", clientInfo: { name: "paired-chat", version: "1" } };
}

function project() {
  return { project: { id: "drone" } } as never;
}
