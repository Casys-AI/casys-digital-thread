import { assertEquals } from "jsr:@std/assert@1.0.14";
import { ChatHostClient } from "../chat-host/client.ts";

Deno.test("final app launches the closed Chat Host from a clean context", async () => {
  const root = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "casys-final-chat-host-",
  });
  const client = await ChatHostClient.start({
    paths: {
      executable:
        `${Deno.cwd()}/dist/CasysDigitalThread.app/Contents/Helpers/casys-chat-host`,
      target: "darwin-arm64",
    },
    dataRoot: `${root}/data`,
    launchCwd: root,
    env: { HOME: `${root}/home` },
    platform: "macOS",
  });
  try {
    const snapshot = await client.snapshot({
      protocol: "casys-desktop-chat/1.0",
    });
    assertEquals(snapshot.host, "ready");
    assertEquals(snapshot.conversations, []);
  } finally {
    assertEquals(await client.stop(), { status: "stopped" });
    await Deno.remove(root, { recursive: true });
  }
});
