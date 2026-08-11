import { assertEquals } from "@std/assert";

Deno.test("provider smoke starts the five exact Compose services required by the live gate", async () => {
  const workflow = await Deno.readTextFile(
    new URL("../../.github/workflows/provider-smoke.yml", import.meta.url),
  );
  const match = workflow.match(/^\s*run:\s*docker compose up -d (.+)$/m);
  if (!match) throw new Error("provider-smoke Compose startup command is missing");
  assertEquals(match[1].trim().split(/\s+/), [
    "syson-db",
    "syson-app",
    "mcp-syson",
    "mcp-build123d",
    "mcp-calculix",
  ]);
});

Deno.test("both CI layers require the committed live FEA contract fixture", async () => {
  const providerSmoke = await Deno.readTextFile(
    new URL("../../.github/workflows/provider-smoke.yml", import.meta.url),
  );
  const quality = await Deno.readTextFile(
    new URL("../../.github/workflows/quality.yml", import.meta.url),
  );
  assertEquals(
    /^\s*run:\s*deno task verify:fea:contract\s*$/m.test(providerSmoke),
    true,
  );
  assertEquals(
    /^\s*run:\s*deno task verify:fea:contract\s*$/m.test(quality),
    true,
  );
  assertEquals(
    providerSmoke.includes("fixture is deliberately marked synthetic"),
    false,
  );
});

Deno.test("provider smoke documents a read-only SysON probe, never a SysON mutation", async () => {
  const workflow = await Deno.readTextFile(
    new URL("../../.github/workflows/provider-smoke.yml", import.meta.url),
  );
  assertEquals(workflow.includes("probes SysON read-only"), true);
  assertEquals(workflow.includes("creates and deletes ephemeral SysON"), false);
});
