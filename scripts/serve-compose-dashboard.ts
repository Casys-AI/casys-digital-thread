import {
  composeAndServeDashboard,
  loadManifests,
  loadTemplate,
} from "@casys/mcp-compose/runtime";

export const DASHBOARD_FILES: Readonly<Record<string, string>> = {
  console: "console.yaml",
  engineering: "engineering-results.yaml",
};

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

async function main(): Promise<void> {
  const dashboardFile = resolveDashboardFile(Deno.args[0]);
  const configRoot = decodeURIComponent(
    new URL("../config/compose/", import.meta.url).pathname,
  );
  const manifests = await loadManifests(`${configRoot}manifests`);
  const template = await loadTemplate(
    `${configRoot}dashboards/${dashboardFile}`,
  );
  const dashboard = await composeAndServeDashboard(
    { manifests, template },
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
