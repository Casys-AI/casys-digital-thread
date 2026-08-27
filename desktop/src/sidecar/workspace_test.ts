import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { SidecarFailure } from "./contracts.ts";
import { configDigestForAssets } from "./digest.ts";
import { auditClosedWorkspaceTree, materializeClosedWorkspace } from "./workspace.ts";

const FLEET = '{"version":1,"servers":[{"id":"syson"}]}\n';
const FIXTURE = '{"id":"bracket-demo"}\n';
const PROFILE = "macos-application-support" as const;

async function tempDir(prefix: string): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir({ prefix }));
}

Deno.test("materializeClosedWorkspace copies packaged assets and digest-checks them", async () => {
  const launchCwd = await tempDir("casys-ws-");
  const first = await materializeClosedWorkspace(launchCwd, PROFILE, {
    fleetText: FLEET,
    fixtureText: FIXTURE,
  });
  assertEquals(
    first.configDigest,
    await configDigestForAssets(FLEET, FIXTURE),
  );
  assertEquals(
    await Deno.readTextFile(`${first.workspaceRoot}/config/mcp-fleet.json`),
    FLEET,
  );
  const runtime = JSON.parse(
    await Deno.readTextFile(`${first.workspaceRoot}/config/desktop-runtime.json`),
  );
  assertEquals(runtime.yolo, false);
  assertEquals(runtime.localExecution, false);
  assertEquals(runtime.compose, "unavailable");
});

Deno.test("materializeClosedWorkspace does not replace a mismatched packaged asset", async () => {
  const launchCwd = await tempDir("casys-ws-mismatch-");
  const first = await materializeClosedWorkspace(launchCwd, PROFILE, {
    fleetText: FLEET,
    fixtureText: FIXTURE,
  });
  const path = `${first.workspaceRoot}/config/mcp-fleet.json`;
  await Deno.writeTextFile(path, '{"version":1,"servers":[]}\n');
  await assertRejects(
    () =>
      materializeClosedWorkspace(launchCwd, PROFILE, {
        fleetText: FLEET,
        fixtureText: FIXTURE,
      }),
    SidecarFailure,
    "were not replaced",
  );
  assertEquals(await Deno.readTextFile(path), '{"version":1,"servers":[]}\n');
});

Deno.test("materializeClosedWorkspace never overwrites a mismatched runtime receipt", async () => {
  const launchCwd = await tempDir("casys-ws-receipt-");
  const first = await materializeClosedWorkspace(launchCwd, PROFILE, {
    fleetText: FLEET,
    fixtureText: FIXTURE,
  });
  const path = `${first.workspaceRoot}/config/desktop-runtime.json`;
  await Deno.writeTextFile(path, '{"tampered":true}\n');
  await assertRejects(
    () =>
      materializeClosedWorkspace(launchCwd, PROFILE, {
        fleetText: FLEET,
        fixtureText: FIXTURE,
      }),
    SidecarFailure,
    "were not replaced",
  );
  assertEquals(await Deno.readTextFile(path), '{"tampered":true}\n');
});

Deno.test("auditClosedWorkspaceTree rejects a deep symlink without following it", async () => {
  const workspaceRoot = await tempDir("casys-ws-audit-");
  const outside = await tempDir("casys-ws-audit-outside-");
  await Deno.mkdir(`${workspaceRoot}/state/local`, { recursive: true });
  await Deno.writeTextFile(`${workspaceRoot}/state/regular.json`, "{}\n");
  await Deno.symlink(
    outside,
    `${workspaceRoot}/state/local/engineering-projects`,
  );

  await assertRejects(
    () => auditClosedWorkspaceTree(workspaceRoot),
    SidecarFailure,
    "contains a symlink",
  );
  assertEquals([...Deno.readDirSync(outside)].length, 0);
});

Deno.test("auditClosedWorkspaceTree rejects a regular file hard-linked outside", async () => {
  const workspaceRoot = await tempDir("casys-ws-audit-hardlink-");
  const outside = await tempDir("casys-ws-audit-hardlink-outside-");
  await Deno.mkdir(`${workspaceRoot}/state/local`, { recursive: true });
  const target = `${outside}/claim.json`;
  await Deno.writeTextFile(target, '{"outside":true}\n');
  await Deno.link(target, `${workspaceRoot}/state/local/claim.json`);

  await assertRejects(
    () => auditClosedWorkspaceTree(workspaceRoot),
    SidecarFailure,
    "hard link",
  );
  assertEquals(await Deno.readTextFile(target), '{"outside":true}\n');
});
