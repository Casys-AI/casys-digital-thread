import { assertEquals } from "jsr:@std/assert@1.0.14";

Deno.test("packaged fork acpx/runtime streams elicitation and reaps its process tree", async () => {
  const stateRoot = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "casys-packaged-acpx-test-",
  });
  try {
    const desktopRoot = Deno.cwd();
    const output = await new Deno.Command("dist/chat-host-runtime/node", {
      args: [
        `${desktopRoot}/src/build/fixtures/packaged-runtime-smoke.mjs`,
        `${desktopRoot}/dist/chat-host-runtime`,
        `${desktopRoot}/src/build/fixtures/acp-agent.mjs`,
        stateRoot,
      ],
      cwd: Deno.cwd(),
      env: {},
      clearEnv: true,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    assertEquals(output.success, true, stderr);
    assertEquals(JSON.parse(stdout), {
      ok: true,
      runtime: "acpx/runtime",
      result: "completed",
      text: "elicitation:accept",
      elicitation: {
        mode: "form",
        message: "Confirm packaged runtime smoke",
        requestIdType: "number",
        aborted: false,
      },
      noOrphan: true,
    });
  } finally {
    await Deno.remove(stateRoot, { recursive: true });
  }
});
