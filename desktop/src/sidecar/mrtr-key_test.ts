import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { SidecarFailure } from "./contracts.ts";
import { persistMrtrSigningKey } from "./mrtr-key.ts";

Deno.test("persistMrtrSigningKey creates a 0o600 key and reuses it", async () => {
  const workspaceRoot = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-mrtr-" }),
  );
  const first = await persistMrtrSigningKey(workspaceRoot);
  const second = await persistMrtrSigningKey(workspaceRoot);
  assertEquals(first, second);
  assertEquals(first.length, 64);
  const stat = await Deno.stat(`${workspaceRoot}/secrets/mrtr-signing-key`);
  assertEquals(stat.mode !== null && (stat.mode & 0o777) === 0o600, true);
});

Deno.test("persistMrtrSigningKey fails closed on a corrupt persisted key", async () => {
  const workspaceRoot = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-mrtr-bad-" }),
  );
  await Deno.mkdir(`${workspaceRoot}/secrets`, { recursive: true });
  await Deno.writeTextFile(`${workspaceRoot}/secrets/mrtr-signing-key`, "not-a-key\n");
  await Deno.chmod(`${workspaceRoot}/secrets/mrtr-signing-key`, 0o600);
  await assertRejects(
    () => persistMrtrSigningKey(workspaceRoot),
    SidecarFailure,
    "32-byte hex",
  );
});

Deno.test("persistMrtrSigningKey rejects an existing key with permissive mode", async () => {
  const workspaceRoot = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-mrtr-mode-" }),
  );
  await Deno.mkdir(`${workspaceRoot}/secrets`);
  const path = `${workspaceRoot}/secrets/mrtr-signing-key`;
  await Deno.writeTextFile(path, `${"ab".repeat(32)}\n`, { mode: 0o644 });
  await Deno.chmod(path, 0o644);

  await assertRejects(
    () => persistMrtrSigningKey(workspaceRoot),
    SidecarFailure,
    "exact mode 0o600",
  );
  assertEquals((await Deno.lstat(path)).mode! & 0o777, 0o644);
});

Deno.test("persistMrtrSigningKey rejects a symlinked key", async () => {
  const workspaceRoot = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-mrtr-link-" }),
  );
  const targetRoot = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-mrtr-link-target-" }),
  );
  await Deno.mkdir(`${workspaceRoot}/secrets`);
  const target = `${targetRoot}/key`;
  await Deno.writeTextFile(target, `${"ab".repeat(32)}\n`, { mode: 0o600 });
  await Deno.chmod(target, 0o600);
  await Deno.symlink(target, `${workspaceRoot}/secrets/mrtr-signing-key`);

  await assertRejects(
    () => persistMrtrSigningKey(workspaceRoot),
    SidecarFailure,
    "non-symlink",
  );
  assertEquals(await Deno.readTextFile(target), `${"ab".repeat(32)}\n`);
});
