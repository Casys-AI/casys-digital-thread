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
  name?: string;
  sources: Array<{
    id?: string;
    manifest: string;
    calls: Array<{ tool: string; args: Record<string, unknown> }>;
  }>;
  orchestration?: {
    layout?: {
      areas?: string[][];
      columns?: number[];
      rows?: number[];
      gap?: string;
    };
  };
};

type FleetManifest = {
  servers: Array<{
    id: string;
    mcpUrl: string;
    required: boolean;
    expectedTools: string[];
  }>;
};

const configRoot = new URL("../../config/compose/", import.meta.url);

async function loadManifest(name: string): Promise<ComposeManifest> {
  const source = await Deno.readTextFile(
    new URL(`manifests/${name}.json`, configRoot),
  );
  return JSON.parse(source) as ComposeManifest;
}

function composeManifestName(fleetId: string): string {
  return `mcp-${fleetId}`;
}

function transportBaseUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp\/?$/, "").replace(/\/$/, "");
}

Deno.test("every required engineering MCP has a reviewed stateless Compose manifest", async () => {
  const fleet = JSON.parse(
    await Deno.readTextFile(new URL("../../config/mcp-fleet.json", import.meta.url)),
  ) as FleetManifest;

  for (const server of fleet.servers.filter((server) => server.required)) {
    const manifest = await loadManifest(composeManifestName(server.id));
    assertEquals(manifest.name, composeManifestName(server.id));
    assertEquals(manifest.transport, {
      type: "http",
      url: transportBaseUrl(server.mcpUrl),
      protocol: "stateless-2026-07-28",
    });
    assertEquals(manifest.tools.length > 0, true);
    const appOnlyHelpers = manifest.tools.filter((tool) =>
      !server.expectedTools.includes(tool.name)
    );
    assertEquals(
      appOnlyHelpers.every((tool) =>
        tool.appCallable === true && tool.resourceUri === undefined
      ),
      true,
    );
    assertEquals(
      manifest.tools.some((tool) => typeof tool.resourceUri === "string"),
      true,
    );
  }
});

Deno.test("Compose manifests declare the stateless engineering viewers and minimum grants", async () => {
  const [syson, modelica, build123d, calculix, erpnext, fleetSource] = await Promise
    .all([
      loadManifest("mcp-syson"),
      loadManifest("mcp-modelica"),
      loadManifest("mcp-build123d"),
      loadManifest("mcp-calculix"),
      loadManifest("mcp-erpnext"),
      Deno.readTextFile(new URL("../../config/mcp-fleet.json", import.meta.url)),
    ]);
  const fleet = JSON.parse(fleetSource) as FleetManifest;

  assertEquals(syson.transport, {
    type: "http",
    url: "http://127.0.0.1:3009",
    protocol: "stateless-2026-07-28",
  });
  assertEquals(syson.tools.map((tool) => tool.name), [
    "syson_constraint_validate",
    "syson_diagram_snapshot",
    "syson_query_eval",
    "syson_query_requirements_trace",
    "syson_search",
    "syson_value_read",
    "syson_value_set",
  ]);
  assertEquals(
    syson.tools.every((tool) =>
      tool.resourceUri?.startsWith("ui://mcp-syson/") === true
    ),
    true,
  );
  assertEquals(syson.tools.map((tool) => tool.appCallable), Array(7).fill(undefined));

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
  assertEquals(erpnext.transport, {
    type: "http",
    url: "http://127.0.0.1:3012",
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
    "build123d_export_read",
  ]);
  assertEquals(
    modelica.tools.slice(1).map((tool) => tool.resourceUri),
    Array(3).fill("ui://mcp-modelica/results-viewer"),
  );
  assertEquals(
    build123d.tools.map((tool) => tool.resourceUri),
    [
      "ui://mcp-build123d/results-viewer",
      "ui://mcp-build123d/results-viewer",
      undefined,
    ],
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
  assertEquals(
    build123d.tools.map((tool) => tool.inputSchema.additionalProperties),
    [false, false, false],
  );
  const build123dExportRead = build123d.tools.find((tool) =>
    tool.name === "build123d_export_read"
  );
  assertEquals(build123dExportRead?.appCallable, true);
  assertEquals(build123dExportRead?.resourceUri, undefined);
  assertEquals(build123dExportRead?.inputSchema.required, ["name"]);
  assertEquals(
    fleet.servers.find((server) => server.id === "build123d")?.expectedTools
      .includes("build123d_export_read"),
    false,
  );
  assertEquals(
    (build123dExportRead?.inputSchema as {
      properties?: { name?: Record<string, unknown> };
    }).properties?.name,
    {
      type: "string",
      minLength: 5,
      maxLength: 255,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*\\.glb$",
      description: "Safe GLB basename returned in build123d_export.files[].viewer.name",
    },
  );
  assertEquals(
    build123d.tools.filter((tool) => tool.name !== "build123d_export_read")
      .map((tool) => tool.appCallable),
    [undefined, undefined],
  );
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
  assertEquals(erpnext.tools.map((tool) => tool.name), [
    "erpnext_bom_list",
    "erpnext_bom_get",
  ]);
  assertEquals(
    erpnext.tools.find((tool) => tool.name === "erpnext_bom_list")?.resourceUri,
    "ui://mcp-erpnext/doclist-viewer",
  );
  assertEquals(erpnext.tools.map((tool) => tool.appCallable), [true, true]);
  assertEquals(
    erpnext.tools.map((tool) => tool.inputSchema.additionalProperties),
    [false, false],
  );
});

Deno.test("engineering dashboard parses approved simulation, CAD and read-only BOM sources", async () => {
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
  const erpnext = parsed.sources.find((source) => source.manifest === "mcp-erpnext");
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
  assertEquals(erpnext?.calls, [{
    tool: "erpnext_bom_list",
    args: { limit: 20, is_active: true },
  }]);
  assertStringIncludes(dashboard, "cannot pass a build123d STEP export into CalculiX");
  assertEquals(dashboard.includes("manifest: mcp-calculix"), false);
  assertEquals(defaultConsole.includes("modelica_simulate"), false);
  assertEquals(defaultConsole.includes("build123d_execute"), false);
});

Deno.test("CM-01 dashboard saves four live sources and a portable 2x2 layout", async () => {
  const source = await Deno.readTextFile(
    new URL("dashboards/coffee-machine-cm01.yaml", configRoot),
  );
  const parsed = parseYaml(source) as EngineeringDashboard;

  assertEquals(parsed.name, "CoffeeMachine CM-01 digital thread");
  assertEquals(
    parsed.sources.map(({ id, manifest, calls }) => ({
      id,
      manifest,
      tools: calls.map((call) => call.tool),
    })),
    [
      {
        id: "architecture",
        manifest: "mcp-syson",
        tools: ["syson_diagram_snapshot"],
      },
      { id: "cad", manifest: "mcp-build123d", tools: ["build123d_export"] },
      { id: "bom", manifest: "mcp-erpnext", tools: ["erpnext_bom_list"] },
      {
        id: "simulation",
        manifest: "mcp-modelica",
        tools: ["modelica_simulate"],
      },
    ],
  );
  assertEquals(parsed.orchestration?.layout, {
    areas: [["architecture", "cad"], ["bom", "simulation"]],
    columns: [1, 1.15],
    rows: [1, 1],
    gap: "normal",
  });

  const architectureArgs = parsed.sources[0].calls[0].args;
  assertEquals(architectureArgs, {
    editing_context_id: "{{syson_editing_context_id}}",
    diagram_id: "{{syson_diagram_id}}",
  });
  assertEquals(source.includes("erpnext_doc_create"), false);
  assertEquals(source.includes("manifest: mcp-calculix"), false);
});
