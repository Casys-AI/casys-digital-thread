import { assertEquals, assertThrows } from "@std/assert";
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

Deno.test("resolveDashboardFile selects the CM-01 digital thread", () => {
  assertEquals(resolveDashboardFile("cm01"), "coffee-machine-cm01.yaml");
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
