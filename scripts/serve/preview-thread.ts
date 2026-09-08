/**
 * Default development cockpit: Vite on :5173, read-only BFF on :5175.
 *
 * Humans open 5173. The BFF stays on the canonical 5175 loopback used by
 * preview:cockpit and start:agent. Vite proxies /api to that BFF. The BFF
 * child uses Deno `--watch` so imported projector/domain edits restart it.
 */
import { parseArgs } from "../lib/cli.ts";

export const PREVIEW_THREAD_UI_PORT = 5173;
export const PREVIEW_THREAD_BFF_PORT = 5175;

export interface PreviewThreadCommand {
  readonly name: "bff" | "ui" | "viewer-registrar";
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export function previewThreadPorts(): {
  readonly uiPort: number;
  readonly bffPort: number;
} {
  return {
    uiPort: PREVIEW_THREAD_UI_PORT,
    bffPort: PREVIEW_THREAD_BFF_PORT,
  };
}

/**
 * Default `--workspace-id=primary` is focus-only. An explicit `--project-id`
 * pins that project and must not also inject workspace follow. Passing both
 * explicit selectors is refused rather than silently serving another project.
 */
export function previewThreadWorkspaceSelectorArgs(
  passthrough: readonly string[] = [],
): readonly string[] {
  const explicitProjectId = lastFlagValue(passthrough, "project-id");
  const explicitWorkspaceId = lastFlagValue(passthrough, "workspace-id");
  if (explicitProjectId !== undefined && explicitWorkspaceId !== undefined) {
    throw new TypeError(
      "--project-id pins a project and cannot be combined with --workspace-id.",
    );
  }
  if (explicitProjectId !== undefined || explicitWorkspaceId !== undefined) {
    return [];
  }
  return ["--workspace-id=primary"];
}

export function buildPreviewThreadCommands(
  passthrough: readonly string[] = [],
): readonly PreviewThreadCommand[] {
  const extra = [...passthrough];
  return [
    {
      name: "bff",
      command: Deno.execPath(),
      args: [
        "run",
        "--watch",
        "--no-prompt",
        "--frozen",
        "--node-modules-dir=auto",
        "--allow-read=state,src/ui/dist/thread,config/projects,config/thread-subjects,config/mcp-fleet.json,config/microsandbox-local.json,examples/bracket,node_modules",
        "--allow-write=state/local",
        "--allow-net=127.0.0.1",
        "--allow-run=docker",
        "--allow-env=NAPI_RS_ENFORCE_VERSION_CHECK,NAPI_RS_NATIVE_LIBRARY_PATH,NAPI_RS_FORCE_WASI,NAPI_RS_WASI_FLAVOR,MSB_PATH,MSB_LIBKRUNFW_PATH,MSB_CONFIG_PATH,MSB_HOME,MSB_BACKEND,MSB_API_URL,MSB_API_KEY,MSB_PROFILE",
        "--allow-ffi=node_modules",
        "scripts/serve/serve-native-workbench.ts",
        ...previewThreadWorkspaceSelectorArgs(extra),
        "--no-seed",
        `--port=${PREVIEW_THREAD_BFF_PORT}`,
        "--viewer-app-registry=state/local/thread-viewer-apps/registry.json",
        "--viewer-app-object-dir=state/local/thread-viewer-apps/objects",
        ...extra,
      ],
    },
    {
      name: "ui",
      command: "npm",
      args: ["--prefix", "src/ui", "run", "dev:thread"],
      env: {
        CASYS_COCKPIT_BFF_PORT: String(PREVIEW_THREAD_BFF_PORT),
        CASYS_COCKPIT_UI_PORT: String(PREVIEW_THREAD_UI_PORT),
      },
    },
    {
      name: "viewer-registrar",
      command: Deno.execPath(),
      args: [
        "run",
        "--no-prompt",
        "--frozen",
        "--allow-read=state",
        "--allow-write=state/local/thread-viewer-apps",
        "scripts/runners/register-thread-viewer-apps.ts",
        "--watch",
        ...(lastFlagValue(extra, "project-id") !== undefined
          ? [`--project-id=${lastFlagValue(extra, "project-id")}`]
          : []),
      ],
    },
  ];
}

if (import.meta.main) {
  const cliArgs = parseArgs(Deno.args);
  const passthrough = Deno.args.filter((argument) =>
    argument !== "--" && !argument.startsWith("--help")
  );
  if (cliArgs.help === "true") {
    console.log(
      "Usage: deno task preview:thread [-- BFF args]\n" +
        `Vite ${PREVIEW_THREAD_UI_PORT} proxies /api to BFF ${PREVIEW_THREAD_BFF_PORT}.`,
    );
    Deno.exit(0);
  }

  const children: Deno.ChildProcess[] = [];
  const shutdown = () => {
    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
  };
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  for (const spec of buildPreviewThreadCommands(passthrough)) {
    const child = new Deno.Command(spec.command, {
      args: [...spec.args],
      env: spec.env ? { ...Deno.env.toObject(), ...spec.env } : undefined,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    children.push(child);
  }

  console.log(
    `Native Workbench (Vite): http://127.0.0.1:${PREVIEW_THREAD_UI_PORT}/`,
  );
  console.log(
    `Workbench BFF: http://127.0.0.1:${PREVIEW_THREAD_BFF_PORT}/`,
  );

  const statuses = await Promise.all(children.map((child) => child.status));
  shutdown();
  const failed = statuses.find((status) => !status.success);
  Deno.exit(failed?.code && failed.code > 0 ? failed.code : failed ? 1 : 0);
}

function lastFlagValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const prefix = `--${name}=`;
  const token = `--${name}`;
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith(prefix)) {
      value = argument.slice(prefix.length);
      continue;
    }
    if (argument === token) {
      const next = args[index + 1];
      value = next !== undefined && !next.startsWith("--") ? next : "";
    }
  }
  return value;
}
