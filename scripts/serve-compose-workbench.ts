import {
  composeAndServeDashboard,
  loadManifests,
  loadTemplate,
} from "@casys/mcp-compose/runtime";
import {
  type ComposeWorkbenchDashboard,
  serveComposeWorkbench,
} from "./compose-workbench.ts";
import { parseRuntimeArgsJson } from "./serve-compose-dashboard.ts";

interface DashboardSource extends ComposeWorkbenchDashboard {
  file: string;
  argsFile?: string;
}

export const WORKBENCH_DASHBOARDS: readonly DashboardSource[] = [
  {
    id: "cm01",
    title: "CoffeeMachine CM-01",
    description: "SysON, CAD, BOM and Modelica evidence for the reference product.",
    file: "coffee-machine-cm01.yaml",
    argsFile: "state/local/coffee-machine-cm01.json",
  },
  {
    id: "engineering",
    title: "Engineering evidence",
    description: "Parallel calculation, geometry and traceability results.",
    file: "engineering-results.yaml",
  },
];

async function readOptionalArgsFile(
  path: string | undefined,
): Promise<Record<string, unknown>> {
  if (!path) return {};
  try {
    return parseRuntimeArgsJson(await Deno.readTextFile(path), path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {};
    throw error;
  }
}

async function main(): Promise<void> {
  const configRoot = decodeURIComponent(
    new URL("../config/compose/", import.meta.url).pathname,
  );
  const manifests = await loadManifests(`${configRoot}manifests`);
  const sources = new Map(
    WORKBENCH_DASHBOARDS.map((dashboard) => [dashboard.id, dashboard]),
  );
  const workbench = await serveComposeWorkbench({
    dashboards: WORKBENCH_DASHBOARDS.map(({ id, title, description }) => ({
      id,
      title,
      description,
    })),
    port: 60_060,
    open: false,
    async startDashboard(dashboard, frameAncestors) {
      const source = sources.get(dashboard.id);
      if (!source) throw new Error(`Unknown dashboard "${dashboard.id}".`);
      const template = await loadTemplate(
        `${configRoot}dashboards/${source.file}`,
      );
      const args = await readOptionalArgsFile(source.argsFile);
      const hostOptions = {
        open: false,
        frameAncestors,
      };
      return await composeAndServeDashboard(
        { manifests, template, args },
        hostOptions,
      );
    },
  });

  console.log(`Compose Workbench: ${workbench.url}`);
  console.log("Select a saved composition in the left rail.");
  console.log("Press Ctrl-C to stop it.");

  let resolveSignal: () => void = () => {};
  const signal = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  const onSignal = () => resolveSignal();
  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal);

  await signal;
  Deno.removeSignalListener("SIGINT", onSignal);
  Deno.removeSignalListener("SIGTERM", onSignal);
  await workbench.shutdown();
}

if (import.meta.main) await main();
