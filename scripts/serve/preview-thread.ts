/**
 * Default development cockpit: Vite on :5173, read-only BFF on :5175.
 *
 * Humans open 5173. The BFF stays on the canonical 5175 loopback used by
 * preview:cockpit and start:agent. Vite proxies /api to that BFF.
 */
import { parseArgs } from "../lib/cli.ts";

export const PREVIEW_THREAD_UI_PORT = 5173;
export const PREVIEW_THREAD_BFF_PORT = 5175;

export interface PreviewThreadCommand {
  readonly name: "bff" | "ui";
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
        "--allow-read=state/local,src/ui/dist/thread,config/projects,config/thread-subjects,config/mcp-fleet.json",
        "--allow-write=state/local",
        "--allow-net=127.0.0.1",
        "scripts/serve/serve-native-workbench.ts",
        "--workspace-id=primary",
        "--no-seed",
        `--port=${PREVIEW_THREAD_BFF_PORT}`,
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
