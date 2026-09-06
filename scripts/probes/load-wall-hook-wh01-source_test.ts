import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { DEFAULT_MCP_URL } from "./mcp-call.ts";
import {
  DIMENSIONS_FILE_ID,
  HOOK_FILE_ID,
  loadWallHookWh01Source,
  parseLoadWallHookWh01SourceCli,
  runLoadWallHookWh01Source,
  virtualModuleForFileId,
} from "./load-wall-hook-wh01-source.ts";

const PROJECT_ID = "wall-hook-wh01-20260906";
const DIMENSIONS_REF = {
  uri: "casys://agent-resource-capture/sha256/dim",
  name: "dimensions.py",
};
const HOOK_REF = {
  uri: "casys://agent-resource-capture/sha256/hook",
  name: "hook.py",
};

Deno.test("virtualModuleForFileId encodes UTF-8 fileId bytes as casys_workspace.f_<hex>", () => {
  assertEquals(
    virtualModuleForFileId("wh01-dimensions"),
    "casys_workspace.f_776830312d64696d656e73696f6e73",
  );
  assertEquals(
    virtualModuleForFileId("dep-dimensions"),
    "casys_workspace.f_6465702d64696d656e73696f6e73",
  );
});

Deno.test("the checked-in WH01 root import matches fileId wh01-dimensions", async () => {
  const root = await Deno.readTextFile(
    new URL("../../examples/wall-hook-wh01/hook.py", import.meta.url),
  );
  assertEquals(
    root.includes(
      `from ${
        virtualModuleForFileId("wh01-dimensions")
      } import length, width, thickness`,
    ),
    true,
  );
  assertEquals(root.includes("result = Box(length, width, thickness)"), true);
});

Deno.test("load-wall-hook-wh01-source requires --project-id", () => {
  assertThrows(
    () => parseLoadWallHookWh01SourceCli([]),
    TypeError,
    "load-wall-hook-wh01-source requires --project-id.",
  );
});

Deno.test("load-wall-hook-wh01-source defaults --url to the loopback Console MCP", () => {
  assertEquals(
    parseLoadWallHookWh01SourceCli([`--project-id=${PROJECT_ID}`]).url,
    DEFAULT_MCP_URL,
  );
});

Deno.test("the empty-workspace path captures both files and chains returned revisions", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const io = fakeIo(calls, emptyWorkspaceHandlers());
  const result = await loadWallHookWh01Source({
    projectId: PROJECT_ID,
    url: DEFAULT_MCP_URL,
  }, io);

  assertEquals(result.projectId, PROJECT_ID);
  assertEquals(result.workspaceRevision, 3);
  assertEquals(result.moduleId, "wh01");
  assertEquals(result.files[DIMENSIONS_FILE_ID], {
    fileId: DIMENSIONS_FILE_ID,
    fileRevision: 1,
    resourceRef: DIMENSIONS_REF,
    virtualModule: "casys_workspace.f_776830312d64696d656e73696f6e73",
  });
  assertEquals(result.files[HOOK_FILE_ID].fileRevision, 1);
  assertEquals(result.files[HOOK_FILE_ID].resourceRef, HOOK_REF);
  assertEquals(
    calls.map((call) => call.name),
    [
      "project_source_workspace_snapshot",
      "project_resource_capture",
      "project_resource_capture",
      "project_source_module_put",
      "project_source_file_put",
      "project_source_search",
      "project_source_file_put",
      "project_source_search",
    ],
  );
  assertEquals(calls[4]?.args.expectedWorkspaceRevision, 1);
  assertEquals(calls[4]?.args.fileId, DIMENSIONS_FILE_ID);
  assertEquals(calls[4]?.args.resourceRef, DIMENSIONS_REF);
  assertEquals(calls[4]?.args.dependencies, []);
  assertEquals(calls[6]?.args.expectedWorkspaceRevision, 2);
  assertEquals(calls[6]?.args.fileId, HOOK_FILE_ID);
  assertEquals(calls[6]?.args.dependencies, [{
    fileId: DIMENSIONS_FILE_ID,
    fileRevision: 1,
  }]);
  assertEquals(calls[6]?.args.resourceRef, HOOK_REF);
});

Deno.test("an already-loaded workspace rereads identities and does not recapture", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const io = fakeIo(calls, {
    project_source_workspace_snapshot: () => ({
      workspaceRevision: 3,
      rootModuleIds: ["wh01"],
    }),
    project_source_search: () => ({
      entries: [
        { fileId: DIMENSIONS_FILE_ID, fileRevision: 1 },
        { fileId: HOOK_FILE_ID, fileRevision: 1 },
      ],
    }),
    project_source_file_read: (args) => ({
      record: {
        kind: "content",
        resourceRef: args.fileId === DIMENSIONS_FILE_ID ? DIMENSIONS_REF : HOOK_REF,
      },
    }),
  });
  const result = await loadWallHookWh01Source({
    projectId: PROJECT_ID,
    url: DEFAULT_MCP_URL,
  }, io);
  assertEquals(result.workspaceRevision, 3);
  assertEquals(result.files[DIMENSIONS_FILE_ID].resourceRef, DIMENSIONS_REF);
  assertEquals(result.files[HOOK_FILE_ID].resourceRef, HOOK_REF);
  assertEquals(
    calls.map((call) => call.name),
    [
      "project_source_workspace_snapshot",
      "project_source_search",
      "project_source_file_read",
      "project_source_file_read",
    ],
  );
});

Deno.test("a leaf-only workspace puts the root against the searched leaf revision", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const io = fakeIo(calls, {
    project_source_workspace_snapshot: () => ({
      workspaceRevision: 2,
      rootModuleIds: ["wh01"],
    }),
    project_source_search: (args) => {
      if (args.workspaceRevision === 2) {
        return {
          entries: [{ fileId: DIMENSIONS_FILE_ID, fileRevision: 4 }],
        };
      }
      return {
        entries: [
          { fileId: DIMENSIONS_FILE_ID, fileRevision: 4 },
          { fileId: HOOK_FILE_ID, fileRevision: 1 },
        ],
      };
    },
    project_source_file_read: () => ({
      record: { kind: "content", resourceRef: DIMENSIONS_REF },
    }),
    project_resource_capture: () => ({ reference: HOOK_REF }),
    project_source_file_put: () => ({ workspaceRevision: 3 }),
  });
  const result = await loadWallHookWh01Source({
    projectId: PROJECT_ID,
    url: DEFAULT_MCP_URL,
  }, io);
  assertEquals(result.files[DIMENSIONS_FILE_ID].fileRevision, 4);
  assertEquals(result.files[HOOK_FILE_ID].fileRevision, 1);
  const hookPut = calls.find((call) =>
    call.name === "project_source_file_put" && call.args.fileId === HOOK_FILE_ID
  );
  assertEquals(hookPut?.args.dependencies, [{
    fileId: DIMENSIONS_FILE_ID,
    fileRevision: 4,
  }]);
  assertEquals(hookPut?.args.expectedWorkspaceRevision, 2);
});

Deno.test("runLoadWallHookWh01Source prints JSON and exits 0", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const io = fakeIo(calls, emptyWorkspaceHandlers());
  const code = await runLoadWallHookWh01Source(
    [`--project-id=${PROJECT_ID}`],
    io,
  );
  assertEquals(code, 0);
  const printed = JSON.parse(io.written.stdout[0]!) as {
    workspaceRevision: number;
  };
  assertEquals(printed.workspaceRevision, 3);
});

Deno.test("runLoadWallHookWh01Source exits 1 when MCP returns an error", async () => {
  const io = fakeIo([], {
    project_source_workspace_snapshot: () => {
      throw new Error("unreachable");
    },
  }, { failSnapshot: true });
  const code = await runLoadWallHookWh01Source(
    [`--project-id=${PROJECT_ID}`],
    io,
  );
  assertEquals(code, 1);
  assertEquals(
    io.written.stderr[0]?.includes("project_source_workspace_snapshot failed"),
    true,
  );
});

Deno.test("loadWallHookWh01Source refuses a missing workspaceRevision", async () => {
  await assertRejects(
    () =>
      loadWallHookWh01Source(
        {
          projectId: PROJECT_ID,
          url: DEFAULT_MCP_URL,
        },
        fakeIo([], {
          project_source_workspace_snapshot: () => ({ projectId: PROJECT_ID }),
        }),
      ),
    TypeError,
    "MCP workspace result is missing workspaceRevision.",
  );
});

function emptyWorkspaceHandlers(): Record<
  string,
  (args: Record<string, unknown>) => unknown
> {
  return {
    project_source_workspace_snapshot: () => ({
      workspaceRevision: 0,
      rootModuleIds: [],
    }),
    project_resource_capture: (args) => ({
      reference: args.name === "dimensions.py" ? DIMENSIONS_REF : HOOK_REF,
    }),
    project_source_module_put: () => ({
      workspaceRevision: 1,
      rootModuleIds: ["wh01"],
    }),
    project_source_file_put: (args) => ({
      workspaceRevision: args.fileId === DIMENSIONS_FILE_ID ? 2 : 3,
    }),
    project_source_search: (args) => ({
      entries: args.workspaceRevision === 2
        ? [{ fileId: DIMENSIONS_FILE_ID, fileRevision: 1 }]
        : [
          { fileId: DIMENSIONS_FILE_ID, fileRevision: 1 },
          { fileId: HOOK_FILE_ID, fileRevision: 1 },
        ],
    }),
  };
}

function fakeIo(
  calls: { name: string; args: Record<string, unknown> }[],
  handlers: Record<string, (args: Record<string, unknown>) => unknown>,
  options: { failSnapshot?: boolean } = {},
): {
  fetch: typeof fetch;
  readTextFile: (url: URL) => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  written: { stdout: string[]; stderr: string[] };
} {
  const written = { stdout: [] as string[], stderr: [] as string[] };
  return {
    written,
    stdout: (text) => written.stdout.push(text),
    stderr: (text) => written.stderr.push(text),
    readTextFile: (url) => Promise.resolve(`# ${url.pathname}`),
    fetch: ((_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        params: { name: string; arguments: Record<string, unknown> };
      };
      const name = body.params.name;
      const args = body.params.arguments;
      calls.push({ name, args });
      if (options.failSnapshot && name === "project_source_workspace_snapshot") {
        return Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "unavailable" },
        }));
      }
      const handler = handlers[name];
      if (handler === undefined) {
        return Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: `unexpected tool ${name}` },
        }));
      }
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { structuredContent: handler(args) },
      }));
    }) as typeof fetch,
  };
}
