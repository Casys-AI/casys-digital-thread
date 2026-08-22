import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { SidecarFailure } from "./contracts.ts";
import { acquireWorkspaceLock, inspectWorkspaceLock } from "./lock.ts";

async function tempDir(prefix: string): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir({ prefix }));
}

Deno.test("acquireWorkspaceLock holds one exclusive OS lock", async () => {
  const workspaceRoot = await tempDir("casys-lock-");
  const first = await acquireWorkspaceLock(workspaceRoot);
  await assertRejects(
    () => acquireWorkspaceLock(workspaceRoot),
    SidecarFailure,
    "already holds",
  );
  await first.release();
  const second = await acquireWorkspaceLock(workspaceRoot);
  assertEquals(second.path.endsWith("runtime/control-plane.lock"), true);
  await second.release();
});

Deno.test("inspectWorkspaceLock is read-only and distinguishes free from held", async () => {
  const workspaceRoot = await tempDir("casys-lock-inspect-");
  assertEquals(await inspectWorkspaceLock(workspaceRoot), "free");
  await assertRejects(
    () => Deno.stat(`${workspaceRoot}/runtime/control-plane.lock`),
    Deno.errors.NotFound,
  );
  const lock = await acquireWorkspaceLock(workspaceRoot);
  assertEquals(await inspectWorkspaceLock(workspaceRoot), "held");
  await lock.release();
  assertEquals(await inspectWorkspaceLock(workspaceRoot), "free");
});
