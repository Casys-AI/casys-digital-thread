import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../src/application/ports/out/engineering-project-revision-store.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import { parseArgs } from "../lib/cli.ts";
import {
  buildPreviewThreadCommands,
  PREVIEW_THREAD_BFF_PORT,
  PREVIEW_THREAD_UI_PORT,
  previewThreadPorts,
  previewThreadWorkspaceSelectorArgs,
} from "./preview-thread.ts";
import {
  createNativeWorkbenchHandler,
  resolveNativeWorkbenchStartupTarget,
} from "./serve-native-workbench.ts";

Deno.test("preview:thread defaults Vite to 5173 and the BFF to 5175", () => {
  assertEquals(previewThreadPorts(), { uiPort: 5173, bffPort: 5175 });
  assertEquals(PREVIEW_THREAD_UI_PORT, 5173);
  assertEquals(PREVIEW_THREAD_BFF_PORT, 5175);
});

Deno.test("preview:thread launches the BFF on 5175 and Vite on 5173", () => {
  const commands = buildPreviewThreadCommands();
  assertEquals(commands.map((command) => command.name), [
    "bff",
    "ui",
    "viewer-registrar",
  ]);

  const [bff, ui] = commands;
  assertEquals(denoRunFlags(bff, BFF_SCRIPT).includes("--watch"), true);
  assertEquals(bff.args.includes(`--port=${PREVIEW_THREAD_BFF_PORT}`), true);
  assertEquals(bff.args.includes("--workspace-id=primary"), true);
  assertEquals(bff.args.includes("--no-prompt"), true);
  assertEquals(bff.args.includes("--frozen"), true);
  assertEquals(bff.args.includes("--node-modules-dir=auto"), true);
  assertEquals(
    bff.args.includes(
      "--allow-read=state,src/ui/dist/thread,config/projects,config/thread-subjects,config/mcp-fleet.json,config/microsandbox-local.json,examples/bracket,node_modules",
    ),
    true,
  );
  assertEquals(bff.args.includes("--allow-run=docker"), true);
  assertEquals(
    bff.args.includes(
      "--allow-env=NAPI_RS_ENFORCE_VERSION_CHECK,NAPI_RS_NATIVE_LIBRARY_PATH,NAPI_RS_FORCE_WASI,NAPI_RS_WASI_FLAVOR,MSB_PATH,MSB_LIBKRUNFW_PATH,MSB_CONFIG_PATH,MSB_HOME,MSB_BACKEND,MSB_API_URL,MSB_API_KEY,MSB_PROFILE",
    ),
    true,
  );
  assertEquals(bff.args.includes("--allow-ffi=node_modules"), true);
  assertEquals(
    bff.args.includes(
      "--viewer-app-registry=state/local/thread-viewer-apps/registry.json",
    ),
    true,
  );
  assertEquals(
    bff.args.includes(
      "--viewer-app-object-dir=state/local/thread-viewer-apps/objects",
    ),
    true,
  );
  assertEquals(
    bff.args.some((argument) => argument.startsWith("--project-id")),
    false,
  );

  assertEquals(ui.command, "npm");
  assertEquals(ui.args.includes("dev:thread"), true);
  assertEquals(ui.env, {
    CASYS_COCKPIT_BFF_PORT: "5175",
    CASYS_COCKPIT_UI_PORT: "5173",
  });
});

Deno.test("preview:thread watches imported BFF modules without changing UI or registrar semantics", () => {
  const commands = buildPreviewThreadCommands(["--project-id=sample-project"]);
  const bff = commands.find((command) => command.name === "bff")!;
  const ui = commands.find((command) => command.name === "ui")!;
  const registrar = commands.find((command) => command.name === "viewer-registrar")!;

  assertEquals(denoRunFlags(bff, BFF_SCRIPT).includes("--watch"), true);
  assertEquals(denoRunFlags(bff, BFF_SCRIPT).includes("--frozen"), true);
  assertEquals(scriptArgs(bff, BFF_SCRIPT).includes("--watch"), false);
  assertEquals(ui.command, "npm");
  assertEquals(ui.args.includes("dev:thread"), true);
  assertEquals(ui.args.includes("--watch"), false);
  assertEquals(denoRunFlags(registrar, REGISTRAR_SCRIPT).includes("--watch"), false);
  assertEquals(scriptArgs(registrar, REGISTRAR_SCRIPT).includes("--watch"), true);
});

Deno.test("preview:thread registers viewers outside the read-only BFF with display-only writes", () => {
  const registrar = buildPreviewThreadCommands(["--project-id=sample-project"])
    .find((command) => command.name === "viewer-registrar")!;
  assertEquals(registrar.args.includes("--watch"), true);
  assertEquals(registrar.args.includes("--project-id=sample-project"), true);
  assertEquals(
    registrar.args.includes("--allow-write=state/local/thread-viewer-apps"),
    true,
  );
  assertEquals(
    registrar.args.some((argument) =>
      argument.startsWith("--allow-net") || argument.startsWith("--allow-run")
    ),
    false,
  );
});

Deno.test("preview:thread without --project-id starts the BFF in focus-only mode", () => {
  assertEquals(previewThreadWorkspaceSelectorArgs(), [
    "--workspace-id=primary",
  ]);
  const startup = resolveNativeWorkbenchStartupTarget(
    parseArgs(bffWorkbenchCliArgs(buildPreviewThreadCommands())),
  );
  assertEquals(startup.workspaceId, "primary");
  assertEquals(startup.projectId, undefined);
});

Deno.test("preview:thread --project-id pins that project and does not follow workspace focus", async () => {
  const pinnedId = "modular-sensor-mount-msm01";
  const focusedId = "two-piece-tablet-stand-tps03";
  assertEquals(
    previewThreadWorkspaceSelectorArgs([`--project-id=${pinnedId}`]),
    [],
  );
  const commands = buildPreviewThreadCommands([`--project-id=${pinnedId}`]);
  const [bff] = commands;
  assertEquals(bff.args.includes(`--project-id=${pinnedId}`), true);
  assertEquals(bff.args.includes("--workspace-id=primary"), false);

  const startup = resolveNativeWorkbenchStartupTarget(
    parseArgs(bffWorkbenchCliArgs(commands)),
  );
  assertEquals(startup.projectId, pinnedId);
  assertEquals(startup.workspaceId, undefined);

  const pinned = planningProject(pinnedId);
  const focused = planningProject(focusedId);
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([pinned, focused]),
    projectId: startup.projectId,
    workspaceId: startup.workspaceId,
    html: "unused",
  });
  const response = await handler(
    new Request("http://127.0.0.1/api/thread/workbench"),
  );
  assertEquals(response.status, 200);
  const body = await response.json() as {
    project: { project: { id: string } };
  };
  assertEquals(body.project.project.id, pinnedId);
});

Deno.test("preview:thread --project-id reports a missing pin without substituting another project", async () => {
  const startup = resolveNativeWorkbenchStartupTarget(
    parseArgs(
      bffWorkbenchCliArgs(
        buildPreviewThreadCommands([
          "--project-id=modular-sensor-mount-msm01",
        ]),
      ),
    ),
  );
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([
      planningProject("two-piece-tablet-stand-tps03"),
    ]),
    projectId: startup.projectId,
    workspaceId: startup.workspaceId,
    html: "unused",
  });
  const response = await handler(
    new Request("http://127.0.0.1/api/thread/workbench"),
  );
  assertEquals(response.status, 404);
  assertEquals(await response.json(), {
    error: "engineering_project_not_found",
    projectId: "modular-sensor-mount-msm01",
  });
});

Deno.test("preview:thread preserves an explicit caller --workspace-id", () => {
  const startup = resolveNativeWorkbenchStartupTarget(
    parseArgs(
      bffWorkbenchCliArgs(
        buildPreviewThreadCommands(["--workspace-id=review"]),
      ),
    ),
  );
  assertEquals(startup.workspaceId, "review");
  assertEquals(startup.projectId, undefined);
});

Deno.test("preview:thread refuses an explicit project pin combined with --workspace-id", () => {
  assertThrows(
    () =>
      buildPreviewThreadCommands([
        "--project-id=modular-sensor-mount-msm01",
        "--workspace-id=primary",
      ]),
    TypeError,
    "--project-id pins a project and cannot be combined with --workspace-id.",
  );
});

Deno.test("native Vite config defaults match preview:thread ports", async () => {
  const source = await Deno.readTextFile(
    new URL("../../src/ui/vite.native.config.ts", import.meta.url),
  );
  assertStringIncludes(
    source,
    'environmentPort("CASYS_COCKPIT_BFF_PORT", 5175)',
  );
  assertStringIncludes(
    source,
    'environmentPort("CASYS_COCKPIT_UI_PORT", 5173)',
  );
  assertStringIncludes(source, "workbench-root-rewrite");
  assertStringIncludes(source, "development-mcp-app-script-nonce");
  assertStringIncludes(source, "casys-mcp-app-script-nonce");
});

Deno.test("preview:cockpit grants the anchored state root to the read-only BFF", async () => {
  const config = await Deno.readTextFile(
    new URL("../../deno.json", import.meta.url),
  );
  assertStringIncludes(config, '"preview:cockpit"');
  assertStringIncludes(
    config,
    "--allow-read=state,src/ui/dist/thread,config/projects,config/thread-subjects,config/mcp-fleet.json,config/microsandbox-local.json,examples/bracket,node_modules",
  );
  assertStringIncludes(config, "--allow-run=docker");
  assertStringIncludes(config, "--allow-ffi=node_modules");
});

const BFF_SCRIPT = "scripts/serve/serve-native-workbench.ts";
const REGISTRAR_SCRIPT = "scripts/runners/register-thread-viewer-apps.ts";

function denoRunFlags(
  command: { readonly args: readonly string[] },
  scriptPath: string,
): readonly string[] {
  const scriptIndex = command.args.indexOf(scriptPath);
  if (scriptIndex < 0) {
    throw new Error(`preview:thread script path is missing: ${scriptPath}`);
  }
  return command.args.slice(0, scriptIndex);
}

function scriptArgs(
  command: { readonly args: readonly string[] },
  scriptPath: string,
): readonly string[] {
  const scriptIndex = command.args.indexOf(scriptPath);
  if (scriptIndex < 0) {
    throw new Error(`preview:thread script path is missing: ${scriptPath}`);
  }
  return command.args.slice(scriptIndex + 1);
}

function bffWorkbenchCliArgs(
  commands: ReturnType<typeof buildPreviewThreadCommands>,
): string[] {
  const bff = commands.find((command) => command.name === "bff");
  if (!bff) throw new Error("preview:thread BFF command is missing.");
  return [...scriptArgs(bff, BFF_SCRIPT)];
}

function planningProject(projectId: string): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: `${projectId}:r1`,
    revision: 1,
    generatedAt: "2026-08-03T12:00:00.000Z",
    project: {
      id: projectId,
      name: projectId,
      subjectId: `project:${projectId}`,
      objective: { title: "Project", statement: "Project" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

class EmptyThreadStore implements ThreadSnapshotStore {
  get(_snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(undefined);
  }

  latest(_subjectId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(undefined);
  }

  save(_snapshot: ThreadSnapshot): Promise<void> {
    return Promise.resolve();
  }
}

class ProjectStore implements Pick<EngineeringProjectRevisionStore, "get"> {
  readonly #projects = new Map<string, EngineeringProjectSnapshot>();

  constructor(projects: readonly EngineeringProjectSnapshot[]) {
    for (const project of projects) {
      this.#projects.set(project.project.id, project);
    }
  }

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(this.#projects.get(projectId));
  }
}
