/**
 * Load the public WH01 two-file CAD source into one project's draft workspace.
 *
 * Talks only to the loopback Digital Thread MCP. It never imports application
 * use cases or writes state/local. Attachment, admission, export, and FEA
 * remain later public commands.
 *
 * Usage:
 *   deno task probe:wall-hook-wh01-source --project-id=<id>
 *   deno task probe:wall-hook-wh01-source --project-id=<id> --url=http://127.0.0.1:3020/mcp
 */

import { parseArgs, stableId } from "../lib/cli.ts";
import { callMcpTool, DEFAULT_MCP_URL, type McpCallIo } from "./mcp-call.ts";

export const DIMENSIONS_FILE_ID = "wh01-dimensions";
export const HOOK_FILE_ID = "wh01-hook";
export const MODULE_ID = "wh01";
export const MODULE_SLUG = "wh01";
export const MODULE_DISPLAY_NAME = "WH01 wall hook";
export const FILE_ROLE = "cad-script";
export const CAPTURE_PROFILE_ID = "build123d-closed-subset-v1";
export const DIMENSIONS_LOGICAL_NAME = "dimensions.py";
export const HOOK_LOGICAL_NAME = "hook.py";
export const DIMENSIONS_MUTATION_ID = "wh01-dimensions";
export const HOOK_MUTATION_ID = "wh01-hook";
export const MODULE_MUTATION_ID = "wh01-module";

const REPO_ROOT = new URL("../../", import.meta.url);
const DIMENSIONS_PATH = new URL(
  "examples/wall-hook-wh01/dimensions.py",
  REPO_ROOT,
);
const HOOK_PATH = new URL("examples/wall-hook-wh01/hook.py", REPO_ROOT);

export interface LoadWallHookWh01SourceRequest {
  readonly projectId: string;
  readonly url: string;
}

export interface WallHookWh01FileIdentities {
  readonly fileId: string;
  readonly fileRevision: number;
  readonly resourceRef: Record<string, unknown>;
  readonly virtualModule?: string;
}

export interface LoadWallHookWh01SourceResult {
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly moduleId: typeof MODULE_ID;
  readonly files: {
    readonly [DIMENSIONS_FILE_ID]: WallHookWh01FileIdentities;
    readonly [HOOK_FILE_ID]: WallHookWh01FileIdentities;
  };
  readonly next:
    "Attach wh01-hook to the exact WallHook PartDefinition, then call project_technical_source_capture.";
}

export interface LoadWallHookWh01SourceIo extends McpCallIo {
  readonly readTextFile?: (url: URL) => Promise<string>;
}

export function virtualModuleForFileId(fileId: string): string {
  const encodedId = [...new TextEncoder().encode(fileId)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `casys_workspace.f_${encodedId}`;
}

export function parseLoadWallHookWh01SourceCli(
  argv: string[],
): LoadWallHookWh01SourceRequest {
  const flags = parseArgs(argv);
  const projectId = flags["project-id"]?.trim();
  if (!projectId) {
    throw new TypeError("load-wall-hook-wh01-source requires --project-id.");
  }
  return {
    projectId: stableId(projectId, "project-id"),
    url: flags.url?.trim() || DEFAULT_MCP_URL,
  };
}

export async function loadWallHookWh01Source(
  request: LoadWallHookWh01SourceRequest,
  io: LoadWallHookWh01SourceIo = {},
): Promise<LoadWallHookWh01SourceResult> {
  const readTextFile = io.readTextFile ??
    ((url) => Deno.readTextFile(url));
  let snapshot = await callTool(request, io, {
    name: "project_source_workspace_snapshot",
    args: { projectId: request.projectId },
  });
  let workspaceRevision = requiredWorkspaceRevision(snapshot);
  const present = await listedFiles(request, io, workspaceRevision);
  const existingDimensions = present.find((entry) =>
    entry.fileId === DIMENSIONS_FILE_ID
  );
  const existingHook = present.find((entry) => entry.fileId === HOOK_FILE_ID);

  if (existingDimensions !== undefined && existingHook !== undefined) {
    return report(request.projectId, workspaceRevision, {
      dimensions: {
        fileId: DIMENSIONS_FILE_ID,
        fileRevision: existingDimensions.fileRevision,
        resourceRef: await readResourceRef(
          request,
          io,
          workspaceRevision,
          DIMENSIONS_FILE_ID,
          existingDimensions.fileRevision,
        ),
        virtualModule: virtualModuleForFileId(DIMENSIONS_FILE_ID),
      },
      hook: {
        fileId: HOOK_FILE_ID,
        fileRevision: existingHook.fileRevision,
        resourceRef: await readResourceRef(
          request,
          io,
          workspaceRevision,
          HOOK_FILE_ID,
          existingHook.fileRevision,
        ),
      },
    });
  }

  const dimensionsText = await readTextFile(DIMENSIONS_PATH);
  const hookText = await readTextFile(HOOK_PATH);
  const dimensionsRef = existingDimensions === undefined
    ? await captureSourceFile(request, io, {
      name: DIMENSIONS_LOGICAL_NAME,
      text: dimensionsText,
    })
    : await readResourceRef(
      request,
      io,
      workspaceRevision,
      DIMENSIONS_FILE_ID,
      existingDimensions.fileRevision,
    );
  const hookRef = existingHook === undefined
    ? await captureSourceFile(request, io, {
      name: HOOK_LOGICAL_NAME,
      text: hookText,
    })
    : await readResourceRef(
      request,
      io,
      workspaceRevision,
      HOOK_FILE_ID,
      existingHook.fileRevision,
    );

  if (!hasModule(snapshot)) {
    snapshot = await callTool(request, io, {
      name: "project_source_module_put",
      args: {
        projectId: request.projectId,
        mutationId: MODULE_MUTATION_ID,
        expectedWorkspaceRevision: workspaceRevision,
        moduleId: MODULE_ID,
        slug: MODULE_SLUG,
        displayName: MODULE_DISPLAY_NAME,
      },
    });
    workspaceRevision = requiredWorkspaceRevision(snapshot);
  }

  let dimensionsRevision = existingDimensions?.fileRevision;
  if (existingDimensions === undefined) {
    snapshot = await callTool(request, io, {
      name: "project_source_file_put",
      args: {
        projectId: request.projectId,
        mutationId: DIMENSIONS_MUTATION_ID,
        expectedWorkspaceRevision: workspaceRevision,
        fileId: DIMENSIONS_FILE_ID,
        moduleId: MODULE_ID,
        logicalName: DIMENSIONS_LOGICAL_NAME,
        role: FILE_ROLE,
        dependencies: [],
        captureRequest: { profileId: CAPTURE_PROFILE_ID },
        resourceRef: dimensionsRef,
      },
    });
    workspaceRevision = requiredWorkspaceRevision(snapshot);
    dimensionsRevision = await requireFileRevision(
      request,
      io,
      workspaceRevision,
      DIMENSIONS_FILE_ID,
    );
  }
  if (dimensionsRevision === undefined) {
    throw new TypeError("wh01-dimensions fileRevision is missing.");
  }

  let hookRevision = existingHook?.fileRevision;
  if (existingHook === undefined) {
    snapshot = await callTool(request, io, {
      name: "project_source_file_put",
      args: {
        projectId: request.projectId,
        mutationId: HOOK_MUTATION_ID,
        expectedWorkspaceRevision: workspaceRevision,
        fileId: HOOK_FILE_ID,
        moduleId: MODULE_ID,
        logicalName: HOOK_LOGICAL_NAME,
        role: FILE_ROLE,
        dependencies: [{
          fileId: DIMENSIONS_FILE_ID,
          fileRevision: dimensionsRevision,
        }],
        captureRequest: { profileId: CAPTURE_PROFILE_ID },
        resourceRef: hookRef,
      },
    });
    workspaceRevision = requiredWorkspaceRevision(snapshot);
    hookRevision = await requireFileRevision(
      request,
      io,
      workspaceRevision,
      HOOK_FILE_ID,
    );
  }
  if (hookRevision === undefined) {
    throw new TypeError("wh01-hook fileRevision is missing.");
  }

  return report(request.projectId, workspaceRevision, {
    dimensions: {
      fileId: DIMENSIONS_FILE_ID,
      fileRevision: dimensionsRevision,
      resourceRef: dimensionsRef,
      virtualModule: virtualModuleForFileId(DIMENSIONS_FILE_ID),
    },
    hook: {
      fileId: HOOK_FILE_ID,
      fileRevision: hookRevision,
      resourceRef: hookRef,
    },
  });
}

export async function runLoadWallHookWh01Source(
  argv: string[],
  io: LoadWallHookWh01SourceIo = {},
): Promise<number> {
  const writeOut = io.stdout ?? ((text) => console.log(text));
  const writeErr = io.stderr ?? ((text) => console.error(text));
  let request: LoadWallHookWh01SourceRequest;
  try {
    request = parseLoadWallHookWh01SourceCli(argv);
    const result = await loadWallHookWh01Source(request, io);
    writeOut(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    writeErr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function report(
  projectId: string,
  workspaceRevision: number,
  files: {
    readonly dimensions: WallHookWh01FileIdentities;
    readonly hook: WallHookWh01FileIdentities;
  },
): LoadWallHookWh01SourceResult {
  return {
    projectId,
    workspaceRevision,
    moduleId: MODULE_ID,
    files: {
      [DIMENSIONS_FILE_ID]: files.dimensions,
      [HOOK_FILE_ID]: files.hook,
    },
    next:
      "Attach wh01-hook to the exact WallHook PartDefinition, then call project_technical_source_capture.",
  };
}

async function captureSourceFile(
  request: LoadWallHookWh01SourceRequest,
  io: LoadWallHookWh01SourceIo,
  file: { name: string; text: string },
): Promise<Record<string, unknown>> {
  const payload = await callTool(request, io, {
    name: "project_resource_capture",
    args: {
      name: file.name,
      mimeType: "text/x-python",
      text: file.text,
    },
  });
  const reference = payload.reference;
  if (!isRecord(reference)) {
    throw new TypeError(
      `project_resource_capture returned no resource reference for ${file.name}.`,
    );
  }
  return reference;
}

async function listedFiles(
  request: LoadWallHookWh01SourceRequest,
  io: LoadWallHookWh01SourceIo,
  workspaceRevision: number,
): Promise<readonly { fileId: string; fileRevision: number }[]> {
  if (workspaceRevision === 0) return [];
  return await searchFiles(request, io, workspaceRevision);
}

async function requireFileRevision(
  request: LoadWallHookWh01SourceRequest,
  io: LoadWallHookWh01SourceIo,
  workspaceRevision: number,
  fileId: string,
): Promise<number> {
  const entries = await searchFiles(request, io, workspaceRevision);
  const match = entries.find((entry) => entry.fileId === fileId);
  if (match === undefined) {
    throw new TypeError(
      `project_source_search did not return ${fileId} at workspace revision ${workspaceRevision}.`,
    );
  }
  return match.fileRevision;
}

async function searchFiles(
  request: LoadWallHookWh01SourceRequest,
  io: LoadWallHookWh01SourceIo,
  workspaceRevision: number,
): Promise<readonly { fileId: string; fileRevision: number }[]> {
  const payload = await callTool(request, io, {
    name: "project_source_search",
    args: {
      projectId: request.projectId,
      workspaceRevision,
      moduleId: MODULE_ID,
    },
  });
  const entries = payload.entries;
  if (!Array.isArray(entries)) {
    throw new TypeError("project_source_search returned no entries array.");
  }
  return entries.map((entry) => {
    if (!isRecord(entry)) {
      throw new TypeError("project_source_search returned a non-object entry.");
    }
    if (typeof entry.fileId !== "string") {
      throw new TypeError("project_source_search entry is missing fileId.");
    }
    if (typeof entry.fileRevision !== "number") {
      throw new TypeError(
        "project_source_search entry is missing fileRevision.",
      );
    }
    return { fileId: entry.fileId, fileRevision: entry.fileRevision };
  });
}

async function readResourceRef(
  request: LoadWallHookWh01SourceRequest,
  io: LoadWallHookWh01SourceIo,
  workspaceRevision: number,
  fileId: string,
  fileRevision: number,
): Promise<Record<string, unknown>> {
  const payload = await callTool(request, io, {
    name: "project_source_file_read",
    args: {
      projectId: request.projectId,
      workspaceRevision,
      fileId,
      fileRevision,
    },
  });
  const record = payload.record;
  if (!isRecord(record) || !isRecord(record.resourceRef)) {
    throw new TypeError(
      `project_source_file_read returned no resourceRef for ${fileId}@${fileRevision}.`,
    );
  }
  return record.resourceRef;
}

function hasModule(snapshot: Record<string, unknown>): boolean {
  const roots = snapshot.rootModuleIds;
  return Array.isArray(roots) && roots.includes(MODULE_ID);
}

function requiredWorkspaceRevision(
  payload: Record<string, unknown>,
): number {
  const revision = payload.workspaceRevision;
  if (typeof revision !== "number") {
    throw new TypeError("MCP workspace result is missing workspaceRevision.");
  }
  return revision;
}

async function callTool(
  request: LoadWallHookWh01SourceRequest,
  io: LoadWallHookWh01SourceIo,
  call: { name: string; args: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const outcome = await callMcpTool({
    name: call.name,
    args: call.args,
    url: request.url,
  }, io);
  if (outcome.exitCode !== 0) {
    throw new TypeError(
      `${call.name} failed: ${JSON.stringify(outcome.payload)}`,
    );
  }
  if (!isRecord(outcome.payload)) {
    throw new TypeError(`${call.name} returned a non-object payload.`);
  }
  return outcome.payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
  const exitCode = await runLoadWallHookWh01Source(Deno.args);
  if (exitCode !== 0) {
    Deno.exit(exitCode);
  }
}
