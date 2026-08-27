import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  closedWorkspaceRoot,
  CONTROL_PLANE_ENDPOINT,
  INSPECT_SCHEMA,
  MARKER_SCHEMA,
  PRODUCT_VERSION,
  SERVER_VERSION,
} from "./contracts.ts";
import { configDigestForAssets } from "./digest.ts";
import { inspectControlPlane, serializeControlPlaneInspect } from "./inspect.ts";
import { serializeLaunchMarker } from "./marker.ts";
import { materializeClosedWorkspace } from "./workspace.ts";

const PROFILE = "macos-application-support" as const;
const ASSETS = {
  fleetText: '{"version":1}\n',
  fixtureText: '{"id":"bracket-demo"}\n',
};

async function tempDir(prefix: string): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir({ prefix }));
}

Deno.test("inspect always emits its exact schema before first run without modifying disk", async () => {
  const launchCwd = await tempDir("casys-inspect-empty-");
  const workspaceRoot = closedWorkspaceRoot(launchCwd, PROFILE);
  const lines: string[] = [];
  const document = await inspectControlPlane({
    launchCwd,
    layoutProfile: PROFILE,
    assets: ASSETS,
    stdout: (line) => lines.push(line),
  });
  assertEquals(document, {
    schema: INSPECT_SCHEMA,
    productVersion: PRODUCT_VERSION,
    serverVersion: SERVER_VERSION,
    expectedConfigDigest: await configDigestForAssets(
      ASSETS.fleetText,
      ASSETS.fixtureText,
    ),
    configuration: "missing",
    marker: null,
    lock: "free",
  });
  assertEquals(lines.join(""), serializeControlPlaneInspect(document));
  await assertRejects(() => Deno.stat(workspaceRoot), Deno.errors.NotFound);
});

Deno.test("inspect reads verified configuration and an exact marker", async () => {
  const launchCwd = await tempDir("casys-inspect-ready-");
  const materialized = await materializeClosedWorkspace(
    launchCwd,
    PROFILE,
    ASSETS,
  );
  const marker = {
    schema: MARKER_SCHEMA,
    productVersion: PRODUCT_VERSION,
    serverVersion: SERVER_VERSION,
    launchId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    pid: 9,
    endpoint: CONTROL_PLANE_ENDPOINT,
    configDigest: materialized.configDigest,
    startedAt: "2026-08-22T06:00:00.000Z",
  } as const;
  await Deno.writeTextFile(
    `${materialized.workspaceRoot}/runtime/owner.json`,
    serializeLaunchMarker(marker),
  );

  const lines: string[] = [];
  const document = await inspectControlPlane({
    launchCwd,
    layoutProfile: PROFILE,
    assets: ASSETS,
    stdout: (line) => lines.push(line),
  });
  assertEquals(document.configuration, "verified");
  assertEquals(document.marker, marker);
  assertEquals(document.lock, "free");
  assertEquals(
    Object.keys(JSON.parse(lines.join(""))).sort(),
    [
      "configuration",
      "expectedConfigDigest",
      "lock",
      "marker",
      "productVersion",
      "schema",
      "serverVersion",
    ],
  );
});

Deno.test("inspect reports receipt mismatch without replacing it", async () => {
  const launchCwd = await tempDir("casys-inspect-mismatch-");
  const materialized = await materializeClosedWorkspace(
    launchCwd,
    PROFILE,
    ASSETS,
  );
  const receipt = `${materialized.workspaceRoot}/config/desktop-runtime.json`;
  const original = await Deno.readTextFile(receipt);
  const altered = original.replace(PRODUCT_VERSION, "9.9.9");
  await Deno.writeTextFile(receipt, altered);

  const document = await inspectControlPlane({
    launchCwd,
    layoutProfile: PROFILE,
    assets: ASSETS,
    stdout: () => {},
  });
  assertEquals(document.configuration, "mismatch");
  assertEquals(await Deno.readTextFile(receipt), altered);
});

Deno.test("inspect rejects a workspace that escapes through a symlink", async () => {
  const launchCwd = await tempDir("casys-inspect-link-");
  const escape = await tempDir("casys-inspect-escape-");
  await Deno.mkdir(`${escape}/ai.casys.digital-thread/control-plane`, {
    recursive: true,
  });
  await Deno.symlink(
    `${escape}/ai.casys.digital-thread`,
    `${launchCwd}/ai.casys.digital-thread`,
  );
  const document = await inspectControlPlane({
    launchCwd,
    layoutProfile: PROFILE,
    assets: ASSETS,
    stdout: () => {},
  });
  assertEquals(document.configuration, "error");
  assertEquals(document.marker, null);
  assertEquals(document.lock, "unavailable");
  assertEquals(
    [...Deno.readDirSync(`${escape}/ai.casys.digital-thread/control-plane`)]
      .length,
    0,
  );
});

Deno.test("inspect rejects a dangling product symlink without creating its target", async () => {
  const launchCwd = await tempDir("casys-inspect-dangling-");
  const escape = await tempDir("casys-inspect-dangling-target-");
  const target = `${escape}/ai.casys.digital-thread`;
  await Deno.symlink(target, `${launchCwd}/ai.casys.digital-thread`);

  const document = await inspectControlPlane({
    launchCwd,
    layoutProfile: PROFILE,
    assets: ASSETS,
    stdout: () => {},
  });

  assertEquals(document.configuration, "error");
  assertEquals(document.marker, null);
  assertEquals(document.lock, "unavailable");
  await assertRejects(() => Deno.lstat(target), Deno.errors.NotFound);
});
