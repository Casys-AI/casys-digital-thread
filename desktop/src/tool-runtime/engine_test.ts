import { assertEquals } from "jsr:@std/assert@1.0.14";
import type { CommandRunner } from "../../../src/adapters/shared/docker-observer.ts";
import { detectToolRuntimeEngine } from "./engine.ts";

function runnerFor(
  handler: (command: string, args: string[]) => {
    success: boolean;
    code: number;
    stdout: string;
    stderr: string;
  },
): CommandRunner {
  return {
    run: (command, args) => Promise.resolve(handler(command, args)),
  };
}

const READY_VERSION = JSON.stringify({
  Client: { Version: "29.6.1" },
  Server: { Version: "29.7.2", Os: "linux", Arch: "aarch64" },
});

function readyRunner(): CommandRunner {
  return runnerFor((_command, args) => {
    if (args[0] === "compose") {
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify({ version: "v2.39.2" }),
        stderr: "",
      };
    }
    return { success: true, code: 0, stdout: READY_VERSION, stderr: "" };
  });
}

Deno.test("engine detection reports ready with recorded versions", async () => {
  const observed = await detectToolRuntimeEngine(readyRunner(), "/tmp");
  assertEquals(observed.status, "ready");
  assertEquals(observed.binaryPresent, true);
  assertEquals(observed.daemonReachable, true);
  assertEquals(observed.serverVersion, "29.7.2");
  assertEquals(observed.serverArch, "aarch64");
  assertEquals(observed.serverOs, "linux");
  assertEquals(observed.composeVersion, "v2.39.2");
  assertEquals(observed.reasons, []);
});

Deno.test("engine detection distinguishes a missing binary", async () => {
  const runner = runnerFor(() => ({
    success: false,
    code: -1,
    stdout: "",
    stderr: "Failed to spawn 'docker': No such file or directory (os error 2)",
  }));
  const observed = await detectToolRuntimeEngine(runner, "/tmp");
  assertEquals(observed.status, "absent");
  assertEquals(observed.binaryPresent, false);
  assertEquals(observed.daemonReachable, false);
});

Deno.test("engine detection distinguishes a stopped daemon", async () => {
  const runner = runnerFor(() => ({
    success: false,
    code: 1,
    stdout: JSON.stringify({ Client: { Version: "29.6.1" } }),
    stderr: "Cannot connect to the Docker daemon",
  }));
  const observed = await detectToolRuntimeEngine(runner, "/tmp");
  assertEquals(observed.status, "stopped");
  assertEquals(observed.binaryPresent, true);
  assertEquals(observed.daemonReachable, false);
});

Deno.test("engine detection refuses a non-linux server", async () => {
  const runner = runnerFor((_command, args) => {
    if (args[0] === "compose") {
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify({ version: "v2.39.2" }),
        stderr: "",
      };
    }
    return {
      success: true,
      code: 0,
      stdout: JSON.stringify({
        Client: { Version: "29.6.1" },
        Server: { Version: "29.7.2", Os: "windows", Arch: "amd64" },
      }),
      stderr: "",
    };
  });
  const observed = await detectToolRuntimeEngine(runner, "/tmp");
  assertEquals(observed.status, "incompatible");
  assertEquals(observed.reasons, ["os-not-linux"]);
  assertEquals(observed.daemonReachable, true);
});

Deno.test("engine detection refuses an unsupported architecture", async () => {
  const runner = runnerFor((_command, args) => {
    if (args[0] === "compose") {
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify({ version: "v2.39.2" }),
        stderr: "",
      };
    }
    return {
      success: true,
      code: 0,
      stdout: JSON.stringify({
        Client: { Version: "29.6.1" },
        Server: { Version: "29.7.2", Os: "linux", Arch: "riscv64" },
      }),
      stderr: "",
    };
  });
  const observed = await detectToolRuntimeEngine(runner, "/tmp");
  assertEquals(observed.status, "incompatible");
  assertEquals(observed.reasons, ["arch-unsupported"]);
});

Deno.test("engine detection refuses a missing compose plugin", async () => {
  const runner = runnerFor((_command, args) => {
    if (args[0] === "compose") {
      return {
        success: false,
        code: 1,
        stdout: "",
        stderr: "docker: 'compose' is not a docker command",
      };
    }
    return { success: true, code: 0, stdout: READY_VERSION, stderr: "" };
  });
  const observed = await detectToolRuntimeEngine(runner, "/tmp");
  assertEquals(observed.status, "incompatible");
  assertEquals(observed.reasons, ["compose-missing"]);
});

Deno.test("engine detection retries a transient probe timeout once", async () => {
  let composeCalls = 0;
  const runner = runnerFor((_command, args) => {
    if (args[0] === "compose") {
      composeCalls++;
      if (composeCalls === 1) {
        return { success: false, code: -1, stdout: "", stderr: "Command timed out" };
      }
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify({ version: "v2.39.2" }),
        stderr: "",
      };
    }
    return { success: true, code: 0, stdout: READY_VERSION, stderr: "" };
  });
  const observed = await detectToolRuntimeEngine(runner, "/tmp", {
    sleep: () => Promise.resolve(),
  });
  assertEquals(observed.status, "ready");
  assertEquals(composeCalls, 2);
});

Deno.test("engine detection never retries a missing binary", async () => {
  let calls = 0;
  const runner = runnerFor(() => {
    calls++;
    return {
      success: false,
      code: -1,
      stdout: "",
      stderr: "Failed to spawn 'docker': No such file or directory (os error 2)",
    };
  });
  const observed = await detectToolRuntimeEngine(runner, "/tmp", {
    sleep: () => Promise.resolve(),
  });
  assertEquals(observed.status, "absent");
  assertEquals(calls, 1);
});

Deno.test("engine detection fails closed on an unparsable probe", async () => {
  const runner = runnerFor(() => ({
    success: true,
    code: 0,
    stdout: "not-json{{",
    stderr: "",
  }));
  const observed = await detectToolRuntimeEngine(runner, "/tmp");
  assertEquals(observed.status, "incompatible");
  assertEquals(observed.reasons, ["probe-unparsable"]);
  assertEquals(observed.daemonReachable, false);
});
