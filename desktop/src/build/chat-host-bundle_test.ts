import { createHash } from "node:crypto";
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import pins from "../../chat-runtime/pins.json" with { type: "json" };
import { resolveTargetArtifacts } from "../chat-host/target.ts";
import { MACOS_MINIMUM_SYSTEM_VERSION } from "./macos-bundle-contract.ts";

Deno.test("native Chat Host launcher rejects arbitrary Node scripts and flags", async () => {
  for (
    const args of [
      [] as string[],
      ["--eval=process.exit(0)"],
      ["--data-root=relative"],
      ["--data-root=/tmp/chat", "--eval=process.exit(0)"],
    ]
  ) {
    const output = await new Deno.Command("dist/helpers/casys-chat-host", {
      args,
      env: {},
      clearEnv: true,
      stdin: "null",
      stdout: "null",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 64);
    assertStringIncludes(
      new TextDecoder().decode(output.stderr),
      "accepts exactly one absolute --data-root argument",
    );
  }
});

Deno.test("native Chat Host launcher parses a valid multi-segment data root", async () => {
  const child = new Deno.Command("dist/helpers/casys-chat-host", {
    args: ["--data-root=/tmp/casys/chat"],
    env: {},
    clearEnv: true,
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const stderr = new Response(child.stderr).text();
  const exited = await Promise.race([
    child.status.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
  ]);
  if (!exited) child.kill("SIGKILL");
  const status = await child.status;
  assertEquals(exited, true, "launcher hung while parsing an absolute path");
  assertEquals(status.code, 70);
  assertStringIncludes(await stderr, "must run from its signed app bundle");
});

Deno.test("Chat Host manifest pins official Node, fork acpx runtime, lifeline, and adapter", async () => {
  const target = resolveTargetArtifacts("darwin-arm64");
  const manifest = JSON.parse(
    await Deno.readTextFile("dist/chat-host-runtime/bundle-manifest.json"),
  );
  assertEquals(manifest.schemaVersion, "casys-chat-host-bundle/1.0");
  assertEquals(manifest.target, "darwin-arm64");
  assertEquals(manifest.targetStatus, "implemented-tested");
  assertEquals(manifest.nodeVersion, pins.nodeVersion);
  assertEquals(manifest.acpxCommit, pins.acpx.commit);
  assertEquals(manifest.adapterVersion, pins.adapter.version);
  for (
    const entry of Object.values(manifest.files) as { path: string; sha256: string }[]
  ) {
    const path = entry.path.startsWith("../../Helpers/")
      ? `dist/helpers/${entry.path.slice("../../Helpers/".length)}`
      : `dist/chat-host-runtime/${entry.path}`;
    assertEquals(await sha256(path), entry.sha256, path);
  }
  assertEquals(manifest.files.node.sha256, target.nodeBinarySha256);
  assertEquals(manifest.files.acpxRuntime.sha256, pins.acpx.runtimeSha256);
  assertEquals(manifest.files.acpxLifeline.sha256, target.acpxLifelineSha256);
  assertEquals(manifest.files.adapter.sha256, pins.adapter.entrySha256);
  assertEquals(manifest.files.codexExecutable.sha256, target.codexBinarySha256);
});

Deno.test("official Node and launcher honor the declared macOS envelope", async () => {
  for (const path of ["dist/chat-host-runtime/node", "dist/helpers/casys-chat-host"]) {
    const linked = await command("/usr/bin/otool", ["-L", path]);
    const dependencies = linked.split("\n").slice(1).map((line) => line.trim())
      .filter(Boolean);
    assert(dependencies.length > 0);
    assertEquals(
      dependencies.some((line) =>
        line.startsWith("@rpath/") || line.includes("/opt/homebrew/") ||
        (!line.startsWith("/System/Library/") && !line.startsWith("/usr/lib/"))
      ),
      false,
    );
    const loadCommands = await command("/usr/bin/otool", ["-l", path]);
    const minos = loadCommands.match(
      /cmd LC_BUILD_VERSION[\s\S]*?\n\s*minos\s+([0-9.]+)/,
    )?.[1];
    assert(minos !== undefined);
    assert(compareVersions(minos, MACOS_MINIMUM_SYSTEM_VERSION) <= 0);
  }
});

async function command(program: string, args: readonly string[]): Promise<string> {
  const output = await new Deno.Command(program, {
    args: [...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout);
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await Deno.readFile(path)).digest("hex");
}

function compareVersions(left: string, right: string): number {
  const lhs = left.split(".").map(Number);
  const rhs = right.split(".").map(Number);
  for (let index = 0; index < Math.max(lhs.length, rhs.length); index++) {
    const difference = (lhs[index] ?? 0) - (rhs[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
