import {
  composeAndServeDashboard,
  loadManifests,
  loadTemplate,
} from "@casys/mcp-compose/runtime";

export const DASHBOARD_FILES: Readonly<Record<string, string>> = {
  console: "console.yaml",
  engineering: "engineering-results.yaml",
  cm01: "coffee-machine-cm01.yaml",
};

const DEFAULT_ARGS_FILES: Readonly<Record<string, string>> = {
  cm01: "state/local/coffee-machine-cm01.json",
};

export interface DashboardCliOptions {
  dashboardName: string;
  dashboardFile: string;
  argsFile?: string;
  args: Record<string, unknown>;
}

export function resolveDashboardFile(name: string | undefined): string {
  const dashboardName = name ?? "console";
  const dashboardFile = DASHBOARD_FILES[dashboardName];
  if (!dashboardFile) {
    throw new Error(
      `Unknown dashboard "${dashboardName}". Choose one of: ${
        Object.keys(DASHBOARD_FILES).join(", ")
      }`,
    );
  }
  return dashboardFile;
}

function parseArgAssignment(assignment: string): [string, unknown] {
  const separator = assignment.indexOf("=");
  if (separator <= 0) {
    throw new Error(`Invalid --arg "${assignment}". Expected key=value.`);
  }

  const key = assignment.slice(0, separator);
  const rawValue = assignment.slice(separator + 1);
  try {
    return [key, JSON.parse(rawValue)];
  } catch {
    return [key, rawValue];
  }
}

export function parseDashboardCliArgs(rawArgs: string[]): DashboardCliOptions {
  const dashboardName = rawArgs[0] ?? "console";
  const dashboardFile = resolveDashboardFile(dashboardName);
  const args: Record<string, unknown> = {};
  let argsFile: string | undefined;

  for (let index = 1; index < rawArgs.length; index++) {
    const option = rawArgs[index];
    if (option === "--args-file") {
      argsFile = rawArgs[++index];
      if (!argsFile) throw new Error("--args-file requires a JSON file path.");
      continue;
    }
    if (option.startsWith("--args-file=")) {
      argsFile = option.slice("--args-file=".length);
      if (!argsFile) throw new Error("--args-file requires a JSON file path.");
      continue;
    }

    let assignment: string | undefined;
    if (option === "--arg") {
      assignment = rawArgs[++index];
      if (!assignment) throw new Error("--arg requires key=value.");
    } else if (option.startsWith("--arg=")) {
      assignment = option.slice("--arg=".length);
    } else {
      throw new Error(`Unknown option "${option}".`);
    }

    const [key, value] = parseArgAssignment(assignment);
    args[key] = value;
  }

  return { dashboardName, dashboardFile, argsFile, args };
}

export function parseRuntimeArgsJson(
  json: string,
  path: string,
): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Compose args file "${path}" must contain one JSON object.`);
  }
  return value as Record<string, unknown>;
}

async function readArgsFile(
  path: string,
  optional: boolean,
): Promise<Record<string, unknown>> {
  try {
    return parseRuntimeArgsJson(await Deno.readTextFile(path), path);
  } catch (error) {
    if (optional && error instanceof Deno.errors.NotFound) return {};
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseDashboardCliArgs(Deno.args);
  const defaultArgsFile = DEFAULT_ARGS_FILES[options.dashboardName];
  const fileArgs = options.argsFile
    ? await readArgsFile(options.argsFile, false)
    : defaultArgsFile
    ? await readArgsFile(defaultArgsFile, true)
    : {};
  const runtimeArgs = { ...fileArgs, ...options.args };
  const configRoot = decodeURIComponent(
    new URL("../config/compose/", import.meta.url).pathname,
  );
  const manifests = await loadManifests(`${configRoot}manifests`);
  const template = await loadTemplate(
    `${configRoot}dashboards/${options.dashboardFile}`,
  );
  const dashboard = await composeAndServeDashboard(
    { manifests, template, args: runtimeArgs },
    { open: false },
  );

  console.log(`Compose dashboard: ${dashboard.url}`);
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
  await dashboard.shutdown();
}

if (import.meta.main) {
  await main();
}
