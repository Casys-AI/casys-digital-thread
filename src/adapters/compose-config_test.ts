import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

type ComposeManifest = {
  name: string;
  transport: { type: string; url: string; protocol: string };
  tools: Array<{
    name: string;
    description?: string;
    resourceUri?: string;
    appCallable?: boolean;
    inputSchema: {
      required?: string[];
      additionalProperties?: boolean;
    };
    outputSchema?: {
      additionalProperties?: boolean;
      required?: string[];
    };
  }>;
};

type EngineeringDashboard = {
  sources: Array<{
    manifest: string;
    calls: Array<{ tool: string; args: Record<string, unknown> }>;
  }>;
};

const configRoot = new URL("../../config/compose/", import.meta.url);

async function loadManifest(name: string): Promise<ComposeManifest> {
  const source = await Deno.readTextFile(
    new URL(`manifests/${name}.json`, configRoot),
  );
  return JSON.parse(source) as ComposeManifest;
}

Deno.test("Compose manifests declare the stateless engineering viewers and minimum grants", async () => {
  const [modelica, build123d, calculix] = await Promise.all([
    loadManifest("mcp-modelica"),
    loadManifest("mcp-build123d"),
    loadManifest("mcp-calculix"),
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
  assertEquals(calculix.transport, {
    type: "http",
    url: "http://127.0.0.1:3015",
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
  assertEquals(
    modelica.tools.find((tool) => tool.name === "modelica_run_get")
      ?.appCallable,
    true,
  );
  assertEquals(
    modelica.tools.filter((tool) => tool.name !== "modelica_run_get").map(
      (tool) => tool.appCallable,
    ),
    [undefined, undefined, undefined],
  );
  assertEquals(build123d.tools.map((tool) => tool.inputSchema.additionalProperties), [
    false,
    false,
  ]);
  assertStringIncludes(build123d.tools[0].description ?? "", "trusted-local");
  assertEquals((build123d.tools[0].description ?? "").includes("bounded"), false);
  assertEquals(calculix.tools.map((tool) => tool.name), ["calculix_solve_static"]);
  assertEquals(
    calculix.tools[0].resourceUri,
    "ui://mcp-calculix/results-viewer",
  );
  assertEquals(calculix.tools[0].appCallable, undefined);
  assertEquals(calculix.tools[0].outputSchema?.additionalProperties, false);
  assertEquals(calculix.tools[0].outputSchema?.required, [
    "schemaVersion",
    "kind",
    "mesh",
    "constraints",
    "metrics",
  ]);
});

Deno.test("engineering dashboard parses one approved simulation and executable CAD source", async () => {
  const dashboard = await Deno.readTextFile(
    new URL("dashboards/engineering-results.yaml", configRoot),
  );
  const defaultConsole = await Deno.readTextFile(
    new URL("dashboards/console.yaml", configRoot),
  );

  const parsed = parseYaml(dashboard) as EngineeringDashboard;
  const modelica = parsed.sources.find((source) => source.manifest === "mcp-modelica");
  const build123d = parsed.sources.find((source) =>
    source.manifest === "mcp-build123d"
  );
  assertEquals(modelica?.calls, [{
    tool: "modelica_simulate",
    args: { model_id: "coffee-machine-v1", scenario_id: "heat-up-nominal" },
  }]);
  assertEquals(build123d?.calls, [{
    tool: "build123d_execute",
    args: {
      script: "from build123d import Box\nresult = Box(10, 20, 5)\n",
    },
  }]);
  assertStringIncludes(dashboard, "cannot pass a build123d STEP export into CalculiX");
  assertEquals(dashboard.includes("manifest: mcp-calculix"), false);
  assertEquals(defaultConsole.includes("modelica_simulate"), false);
  assertEquals(defaultConsole.includes("build123d_execute"), false);
});
