import { assertEquals, assertThrows } from "@std/assert";
import { DASHBOARD_FILES, resolveDashboardFile } from "./serve-compose-dashboard.ts";

Deno.test("resolveDashboardFile defaults to the Console", () => {
  assertEquals(resolveDashboardFile(undefined), "console.yaml");
});

Deno.test("resolveDashboardFile selects the engineering evidence dashboard", () => {
  assertEquals(
    resolveDashboardFile("engineering"),
    "engineering-results.yaml",
  );
});

Deno.test("resolveDashboardFile rejects unknown dashboards", () => {
  assertThrows(
    () => resolveDashboardFile("unknown"),
    Error,
    `Choose one of: ${Object.keys(DASHBOARD_FILES).join(", ")}`,
  );
});
