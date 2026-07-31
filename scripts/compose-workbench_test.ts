import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  type ComposeWorkbenchDashboard,
  serveComposeWorkbench,
} from "./compose-workbench.ts";

const TEST_OPTS = { sanitizeOps: false, sanitizeResources: false };

Deno.test({
  name:
    "Compose Workbench selects dashboards in-page and swaps their live hosts atomically",
  ...TEST_OPTS,
  fn: async () => {
    const dashboards: ComposeWorkbenchDashboard[] = [
      {
        id: "cm01",
        title: "CoffeeMachine CM-01",
        description: "Four live engineering viewers.",
      },
      {
        id: "engineering",
        title: "Engineering evidence",
        description: "Parallel evidence surfaces.",
      },
    ];
    const starts: Array<{ id: string; frameAncestors: readonly string[] }> = [];
    const stopped: string[] = [];
    let nextPort = 61_000;
    const workbench = await serveComposeWorkbench({
      dashboards,
      port: 0,
      open: false,
      startDashboard(dashboard, frameAncestors) {
        starts.push({ id: dashboard.id, frameAncestors });
        const url = `http://127.0.0.1:${nextPort++}`;
        return Promise.resolve({
          url,
          shutdown() {
            stopped.push(dashboard.id);
            return Promise.resolve();
          },
        });
      },
    });

    try {
      const page = await fetch(workbench.url);
      assertEquals(page.status, 200);
      assertStringIncludes(await page.text(), "Compose Workbench");

      const initial = await fetch(`${workbench.url}/api/dashboards`);
      assertEquals(await initial.json(), {
        dashboards,
        activeDashboardId: null,
        dashboardUrl: null,
      });

      const cm01 = await fetch(
        `${workbench.url}/api/dashboards/cm01/activate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: workbench.url,
          },
          body: JSON.stringify({
            frameAncestors: [
              "http://127.0.0.1:60042",
              "https://untrusted.example.test",
            ],
          }),
        },
      );
      assertEquals(cm01.status, 200);
      assertEquals(await cm01.json(), {
        activeDashboardId: "cm01",
        dashboardUrl: "http://127.0.0.1:61000",
      });
      assertEquals(starts, [{
        id: "cm01",
        frameAncestors: [workbench.url, "http://127.0.0.1:60042"],
      }]);

      const engineering = await fetch(
        `${workbench.url}/api/dashboards/engineering/activate`,
        {
          method: "POST",
          headers: { Origin: workbench.url },
        },
      );
      assertEquals(engineering.status, 200);
      assertEquals(stopped, ["cm01"]);

      const unknown = await fetch(
        `${workbench.url}/api/dashboards/unknown/activate`,
        {
          method: "POST",
          headers: { Origin: workbench.url },
        },
      );
      assertEquals(unknown.status, 404);

      const crossOrigin = await fetch(
        `${workbench.url}/api/dashboards/cm01/activate`,
        {
          method: "POST",
          headers: { Origin: "http://example.test" },
        },
      );
      assertEquals(crossOrigin.status, 403);
    } finally {
      await workbench.shutdown();
    }

    assertEquals(stopped, ["cm01", "engineering"]);
  },
});
