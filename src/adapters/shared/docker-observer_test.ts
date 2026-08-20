import { assertEquals } from "@std/assert";
import type { DesiredServer } from "../../application/control-plane/read-model/fleet-manifest.ts";
import {
  type CommandResult,
  type CommandRunner,
  DockerComposeObserver,
  parseComposePs,
} from "./docker-observer.ts";

Deno.test("parseComposePs supports newline-delimited Compose JSON", () => {
  const parsed = parseComposePs(
    '{"Service":"mcp-a","Name":"stack-mcp-a-1","ID":"abc","State":"running","Health":"healthy","Image":"example/a:1"}\n' +
      '{"Service":"db","State":"running","Image":"postgres:15"}\n',
  );
  assertEquals(parsed[0], {
    service: "mcp-a",
    name: "stack-mcp-a-1",
    id: "abc",
    state: "running",
    health: "healthy",
    image: "example/a:1",
  });
});

Deno.test("DockerComposeObserver uses read-only commands and captures digest", async () => {
  const runner = new FakeRunner();
  const observer = new DockerComposeObserver({ runner, cwd: "/workspace" });
  const result = await observer.observe([serverFixture()]);
  assertEquals(result.get("a"), {
    runtimeAvailable: true,
    present: true,
    name: "stack-mcp-a-1",
    id: "abc",
    state: "running",
    health: "healthy",
    image: "example/a:1",
    imageId: "sha256:image",
    repoDigests: ["example/a@sha256:digest"],
  });
  assertEquals(runner.calls, [
    ["docker", "compose", "ps", "--all", "--format", "json"],
    ["docker", "image", "inspect", "example/a:1"],
  ]);
});

Deno.test("DockerComposeObserver reports unavailable runtime without throwing", async () => {
  const runner: CommandRunner = {
    run: () =>
      Promise.resolve({
        success: false,
        code: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
      }),
  };
  const result = await new DockerComposeObserver({ runner }).observe([
    serverFixture(),
  ]);
  assertEquals(result.get("a")?.runtimeAvailable, false);
  assertEquals(result.get("a")?.present, false);
});

class FakeRunner implements CommandRunner {
  calls: string[][] = [];

  run(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push([command, ...args]);
    if (args[0] === "compose") {
      return Promise.resolve({
        success: true,
        code: 0,
        stderr: "",
        stdout:
          '{"Service":"mcp-a","Name":"stack-mcp-a-1","ID":"abc","State":"running","Health":"healthy","Image":"example/a:1"}\n',
      });
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stderr: "",
      stdout: JSON.stringify([{
        Id: "sha256:image",
        RepoDigests: ["example/a@sha256:digest"],
      }]),
    });
  }
}

function serverFixture(): DesiredServer {
  return {
    id: "a",
    displayName: "A",
    role: "test",
    serviceName: "mcp-a",
    transport: "streamable-http",
    mcpUrl: "http://127.0.0.1:3999/mcp",
    healthUrl: "http://127.0.0.1:3999/health",
    image: "example/a:1",
    required: true,
    expectedTools: ["a_read"],
  };
}
