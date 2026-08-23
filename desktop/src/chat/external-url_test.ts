import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { createExternalUrlOpener } from "./external-url.ts";

Deno.test("external URL capability opens exact HTTPS URL outside the webview", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const opener = createExternalUrlOpener("macOS", (command, args) => {
    calls.push({ command, args });
    return Promise.resolve({ success: true });
  });
  await opener?.open("https://example.com/confirm?request=one");
  assertEquals(calls, [{
    command: "/usr/bin/open",
    args: ["--", "https://example.com/confirm?request=one"],
  }]);
  await assertRejects(() => opener!.open("http://example.com"), TypeError);
  await assertRejects(() => opener!.open("https://user:secret@example.com"), TypeError);
});

Deno.test("external URL capability is absent for targets without packaged adapters", () => {
  assertEquals(createExternalUrlOpener("Linux"), undefined);
  assertEquals(createExternalUrlOpener("Windows"), undefined);
});
