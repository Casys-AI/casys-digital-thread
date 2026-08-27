import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import { constructHelperCommand } from "./command.ts";
import type { PackagedHelperCommand } from "./contracts.ts";
import { spawnPackagedHelper, wrapOwnedSidecarHandle } from "./spawn.ts";

const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";

function validStart(): PackagedHelperCommand {
  const command = constructHelperCommand({
    helperPath:
      "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-control-plane",
    cwd: "/Users/ada/Library/Application Support",
    platform: "macOS",
    layoutProfile: "macos-application-support",
    relativeWorkspace: "ai.casys.digital-thread/control-plane",
    mode: "start",
    launchId: LAUNCH_ID,
  });
  if (!command.ok) throw new Error(command.error.message);
  return command.value;
}

Deno.test("wrapOwnedSidecarHandle exposes no pid and stops through its child handle", () => {
  const signals: Deno.Signal[] = [];
  const { writable } = new TransformStream<Uint8Array>();
  const child = wrapOwnedSidecarHandle({
    stdin: writable,
    stdout: null,
    status: Promise.resolve({ success: true, code: 0, signal: null }),
    kill(signo) {
      if (signo !== undefined) signals.push(signo);
    },
  });
  assertFalse("pid" in child);
  assertFalse("stderr" in child);
  child.closeStdin();
  child.kill("SIGKILL");
  assertEquals(signals, ["SIGKILL"]);
});

Deno.test("spawnPackagedHelper accepts only exact start args with empty env and null stderr", () => {
  let spawned = 0;
  const command = validStart();
  const result = spawnPackagedHelper(command, "macOS", (observed) => {
    spawned += 1;
    assertEquals(observed.args, [
      "start",
      "--layout-profile=macos-application-support",
      `--launch-id=${LAUNCH_ID}`,
    ]);
    assertEquals(observed.env, {});
    assertEquals(observed.stderr, "null");
    return {
      stdin: null,
      stdout: null,
      status: Promise.resolve({ success: true, code: 0, signal: null }),
      kill() {},
    };
  });
  assertEquals(result.ok, true);
  assertEquals(spawned, 1);
});

Deno.test("spawnPackagedHelper rejects a general Deno CLI before spawning", () => {
  let spawned = 0;
  const result = spawnPackagedHelper(
    {
      ...validStart(),
      program: "/usr/bin/deno",
    },
    "macOS",
    () => {
      spawned += 1;
      throw new Error("must not spawn");
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "command.deno-cli-rejected");
  assertEquals(spawned, 0);
});

Deno.test("spawnPackagedHelper rejects injected env, stderr pipes, and inspect mode", () => {
  const injected = {
    ...validStart(),
    env: { CASYS_CONTROL_PLANE_CONFIG_DIGEST: "secret" },
  } as unknown as PackagedHelperCommand;
  const env = spawnPackagedHelper(injected, "macOS");
  assertEquals(env.ok, false);
  if (!env.ok) assertEquals(env.error.code, "command.env-invalid");

  const piped = {
    ...validStart(),
    stderr: "piped",
  } as unknown as PackagedHelperCommand;
  const stderr = spawnPackagedHelper(piped, "macOS");
  assertEquals(stderr.ok, false);
  if (!stderr.ok) assertEquals(stderr.error.code, "command.stdio-invalid");

  const inspect = constructHelperCommand({
    helperPath:
      "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-control-plane",
    cwd: "/Users/ada/Library/Application Support",
    platform: "macOS",
    layoutProfile: "macos-application-support",
    relativeWorkspace: "ai.casys.digital-thread/control-plane",
    mode: "inspect",
  });
  if (!inspect.ok) throw new Error(inspect.error.message);
  const result = spawnPackagedHelper(inspect.value, "macOS");
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "command.mode-invalid");
});
