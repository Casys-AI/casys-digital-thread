import { assertEquals } from "jsr:@std/assert@1.0.14";
import { startPackagedChatHost } from "./startup.ts";

Deno.test("an unlaunchable Desktop bootstrap causes zero Chat Host spawn", async () => {
  let starts = 0;
  const client = await startPackagedChatHost({
    launchable: false,
    executablePath: "ambient-or-invalid",
    platform: "macOS",
    arch: "aarch64",
    env: () => undefined,
    childEnv: () => {
      throw new Error("must not read child environment");
    },
  }, {
    start() {
      starts += 1;
      throw new Error("must not spawn");
    },
  });

  assertEquals(client, undefined);
  assertEquals(starts, 0);
});
