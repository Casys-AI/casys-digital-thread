import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  DOCKER_COMMAND_CANDIDATES,
  DockerResolvingRunner,
  resolveDockerCommand,
} from "./docker.ts";
import type {
  CommandResult,
  CommandRunner,
} from "../../../src/adapters/shared/docker-observer.ts";

Deno.test("docker resolution prefers the first existing absolute candidate", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-docker-resolve-" });
  try {
    const first = `${root}/docker-a`;
    const second = `${root}/docker-b`;
    await Deno.writeTextFile(first, "#!/bin/sh\necho a\n");
    await Deno.writeTextFile(second, "#!/bin/sh\necho b\n");
    await Deno.chmod(first, 0o755);
    await Deno.chmod(second, 0o755);
    assertEquals(
      await resolveDockerCommand([`${root}/missing`, first, second, "docker"]),
      first,
    );
    assertEquals(
      await resolveDockerCommand([`${root}/missing`, "docker"]),
      "docker",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("docker resolution skips directories", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-docker-resolve-" });
  try {
    await Deno.mkdir(`${root}/docker`);
    assertEquals(
      await resolveDockerCommand([`${root}/docker`, "docker"]),
      "docker",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("docker resolution skips non-executable files", async () => {
  if (Deno.build.os === "windows") return;
  const root = await Deno.makeTempDir({ prefix: "casys-docker-resolve-" });
  try {
    const blocked = `${root}/docker-blocked`;
    const valid = `${root}/docker-valid`;
    await Deno.writeTextFile(blocked, "#!/bin/sh\necho blocked\n");
    await Deno.writeTextFile(valid, "#!/bin/sh\necho valid\n");
    await Deno.chmod(blocked, 0o644);
    await Deno.chmod(valid, 0o755);
    assertEquals(
      await resolveDockerCommand([blocked, valid, "docker"]),
      valid,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolving runner rewrites only bare docker", async () => {
  const seen: string[] = [];
  const inner: CommandRunner = {
    run(command: string): Promise<CommandResult> {
      seen.push(command);
      return Promise.resolve({ success: true, code: 0, stdout: "", stderr: "" });
    },
  };
  const runner = new DockerResolvingRunner(inner);
  await runner.run("docker", ["version"], "/tmp");
  await runner.run("open", ["x"], "/tmp");
  assertEquals(seen[1], "open");
  assert(
    seen[0].endsWith("/docker") || seen[0].endsWith("\\docker.exe") ||
      seen[0] === "docker",
    `unexpected docker rewrite: ${seen[0]}`,
  );
});

Deno.test("docker candidates stay pinned for the desktop profile", () => {
  assertEquals(DOCKER_COMMAND_CANDIDATES, [
    "/opt/homebrew/bin/docker",
    "/usr/local/bin/docker",
    "/usr/bin/docker",
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    "docker",
  ]);
});
