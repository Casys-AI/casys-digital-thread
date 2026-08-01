import { assertEquals, assertThrows } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  DASHBOARD_FILES,
  parseDashboardCliArgs,
  parseRuntimeArgsJson,
  resolveDashboardFile,
} from "./serve-compose-dashboard.ts";

Deno.test("resolveDashboardFile defaults to the Console", () => {
  assertEquals(resolveDashboardFile(undefined), "console.yaml");
});

Deno.test("resolveDashboardFile selects the engineering evidence dashboard", () => {
  assertEquals(
    resolveDashboardFile("engineering"),
    "engineering-results.yaml",
  );
});

Deno.test("resolveDashboardFile selects the CalculiX bracket proof", () => {
  assertEquals(resolveDashboardFile("calculix"), "calculix-bracket.yaml");
});

Deno.test("resolveDashboardFile selects the CM-01 digital thread", () => {
  assertEquals(resolveDashboardFile("cm01"), "coffee-machine-cm01.yaml");
});

Deno.test("resolveDashboardFile selects manufacturing readiness", () => {
  assertEquals(
    resolveDashboardFile("manufacturing"),
    "manufacturing-readiness.yaml",
  );
});

Deno.test("resolveDashboardFile rejects unknown dashboards", () => {
  assertThrows(
    () => resolveDashboardFile("unknown"),
    Error,
    `Choose one of: ${Object.keys(DASHBOARD_FILES).join(", ")}`,
  );
});

Deno.test("parseDashboardCliArgs accepts a file and typed overrides", () => {
  assertEquals(
    parseDashboardCliArgs([
      "cm01",
      "--args-file=state/local/cm01.json",
      "--arg",
      "limit=5",
      "--arg=active=true",
      "--arg=label=CM-01",
    ]),
    {
      dashboardName: "cm01",
      dashboardFile: "coffee-machine-cm01.yaml",
      argsFile: "state/local/cm01.json",
      args: { limit: 5, active: true, label: "CM-01" },
    },
  );
});

Deno.test("parseDashboardCliArgs rejects malformed assignments", () => {
  assertThrows(
    () => parseDashboardCliArgs(["cm01", "--arg", "missing-separator"]),
    Error,
    "Expected key=value",
  );
});

Deno.test("parseRuntimeArgsJson requires one object", () => {
  assertEquals(parseRuntimeArgsJson('{"bom_item":"CASYS-CM01"}', "args.json"), {
    bom_item: "CASYS-CM01",
  });
  assertThrows(
    () => parseRuntimeArgsJson("[]", "args.json"),
    Error,
    "must contain one JSON object",
  );
});

Deno.test("product recipes compose five explicit MCP component palettes", async () => {
  const expectedManifests = [
    "mcp-build123d",
    "mcp-calculix",
    "mcp-erpnext-components",
    "mcp-modelica",
    "mcp-syson",
  ];

  for (
    const file of [
      "coffee-machine-cm01.yaml",
      "engineering-results.yaml",
      "manufacturing-readiness.yaml",
    ]
  ) {
    const text = await Deno.readTextFile(
      new URL(`../config/compose/dashboards/${file}`, import.meta.url),
    );
    const recipe = parseYaml(text) as {
      sources: Array<{
        manifest: string;
        surface?: { components?: Array<{ component: string }> };
      }>;
      orchestration?: {
        sync?: Array<{ event: string; action: string; to: string }>;
      };
    };

    assertEquals(
      recipe.sources.map((source) => source.manifest).sort(),
      expectedManifests,
      `${file} must contain each product MCP exactly once`,
    );
    assertEquals(
      recipe.sources.every((source) => (source.surface?.components?.length ?? 0) > 0),
      true,
      `${file} must select atomic components for every MCP`,
    );
    assertEquals(
      recipe.orchestration?.sync?.some((route) =>
        route.event === "syson.element.selected" &&
        route.action === "syson.element.selected" &&
        route.to === "mcp-erpnext-components:erpnext_bom_surface"
      ),
      true,
      `${file} must preserve SysON to ERPNext selection routing`,
    );
  }
});
