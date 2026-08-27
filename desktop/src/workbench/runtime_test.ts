import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { WORKBENCH_MARKER_SCHEMA, WORKBENCH_VERSION } from "./contracts.ts";
import {
  clearOwnedWorkbenchRuntime,
  inspectWorkbenchRuntime,
  publishWorkbenchRuntime,
} from "./runtime.ts";
import { prepareWorkbenchRuntime, workbenchRuntimePaths } from "./workspace.ts";

const DIGEST =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TOKEN = "b".repeat(64);
const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";

Deno.test("Workbench runtime publishes a private exact capability and deletes only its owner", async () => {
  const cwd = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-workbench-runtime-" }),
  );
  const paths = workbenchRuntimePaths(cwd, "macos-application-support");
  await Deno.mkdir(`${cwd}/ai.casys.digital-thread`);
  await prepareWorkbenchRuntime(paths);
  await publishWorkbenchRuntime(paths, {
    schema: WORKBENCH_MARKER_SCHEMA,
    version: WORKBENCH_VERSION,
    launchId: LAUNCH_ID,
    pid: 4242,
    configDigest: DIGEST,
    startedAt: "2026-08-23T00:00:00.000Z",
  }, TOKEN);

  const inspected = await inspectWorkbenchRuntime(paths, DIGEST);
  assertEquals(inspected.configuration, "verified");
  assertEquals(inspected.marker?.launchId, LAUNCH_ID);
  assertEquals(inspected.accessToken, TOKEN);
  if (Deno.build.os !== "windows") {
    assertEquals((await Deno.stat(paths.markerPath)).mode! & 0o777, 0o600);
    assertEquals((await Deno.stat(paths.tokenPath)).mode! & 0o777, 0o600);
  }

  await assertRejects(
    () =>
      clearOwnedWorkbenchRuntime(
        paths,
        "22222222-2222-4222-8222-222222222222",
      ),
    Error,
    "another launch",
  );
  assertEquals((await inspectWorkbenchRuntime(paths, DIGEST)).accessToken, TOKEN);
  await clearOwnedWorkbenchRuntime(paths, LAUNCH_ID);
  const cleared = await inspectWorkbenchRuntime(paths, DIGEST);
  assertEquals(cleared.marker, null);
  assertEquals(cleared.accessToken, undefined);
});
