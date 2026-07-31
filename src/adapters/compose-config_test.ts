import { assertEquals, assertStringIncludes } from "@std/assert";

type ComposeManifest = {
  name: string;
  transport: { type: string; url: string; protocol: string };
  tools: Array<{
    name: string;
    resourceUri?: string;
    inputSchema: { required?: string[] };
  }>;
};

const configRoot = new URL("../../config/compose/", import.meta.url);

async function loadManifest(name: string): Promise<ComposeManifest> {
  const source = await Deno.readTextFile(
    new URL(`manifests/${name}.json`, configRoot),
  );
  return JSON.parse(source) as ComposeManifest;
}

Deno.test("Compose manifests declare the stateless Modelica and build123d viewers", async () => {
  const [modelica, build123d] = await Promise.all([
    loadManifest("mcp-modelica"),
    loadManifest("mcp-build123d"),
  ]);

  assertEquals(modelica.transport, {
    type: "http",
    url: "http://127.0.0.1:3016",
    protocol: "stateless-2026-07-28",
  });
  assertEquals(build123d.transport, {
    type: "http",
    url: "http://127.0.0.1:3014",
    protocol: "stateless-2026-07-28",
  });
  assertEquals(modelica.tools.map((tool) => tool.name), [
    "modelica_kit_list",
    "modelica_simulate",
    "modelica_run_list",
    "modelica_run_get",
  ]);
  assertEquals(build123d.tools.map((tool) => tool.name), [
    "build123d_execute",
    "build123d_export",
  ]);
  assertEquals(
    modelica.tools.slice(1).map((tool) => tool.resourceUri),
    Array(3).fill("ui://mcp-modelica/results-viewer"),
  );
  assertEquals(
    build123d.tools.map((tool) => tool.resourceUri),
    Array(2).fill("ui://mcp-build123d/results-viewer"),
  );
});

Deno.test("engineering dashboard invokes one approved simulation and safe CAD result", async () => {
  const dashboard = await Deno.readTextFile(
    new URL("dashboards/engineering-results.yaml", configRoot),
  );
  const defaultConsole = await Deno.readTextFile(
    new URL("dashboards/console.yaml", configRoot),
  );

  assertStringIncludes(dashboard, "manifest: mcp-modelica");
  assertStringIncludes(dashboard, "tool: modelica_simulate");
  assertStringIncludes(dashboard, "model_id: coffee-machine-v1");
  assertStringIncludes(dashboard, "scenario_id: heat-up-nominal");
  assertStringIncludes(dashboard, "manifest: mcp-build123d");
  assertStringIncludes(dashboard, "tool: build123d_execute");
  assertStringIncludes(dashboard, "script: result = Box(10,20,5)");
  assertEquals(defaultConsole.includes("modelica_simulate"), false);
  assertEquals(defaultConsole.includes("build123d_execute"), false);
});
