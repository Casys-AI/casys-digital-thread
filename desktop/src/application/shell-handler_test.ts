import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import type { DesktopShellViewModel } from "../contracts/diagnostics.ts";
import { createDesktopShellHandler } from "./shell-handler.ts";

const MODEL: DesktopShellViewModel = {
  productName: "Casys Digital Thread",
  productVersion: "0.1.0",
  status: "degraded",
  title: "Local control plane unavailable",
  summary: "The native shell is ready; local engineering services are not observed.",
  platform: "macOS",
  components: [{
    id: "desktop-shell",
    label: "Desktop shell",
    state: "ready",
    summary: "The shell manifest matches the installed runtime.",
    evidence: "Manifest and runtime observed at bootstrap.",
    version: "0.1.0",
  }],
};

Deno.test("shell handler serves only the static document through GET and HEAD", async () => {
  const handler = createDesktopShellHandler(MODEL);

  const get = handler(new Request("http://127.0.0.1/"));
  assertEquals(get.status, 200);
  assertStringIncludes(await get.text(), "Casys Digital Thread");
  assertEquals(get.headers.get("cache-control"), "no-store");

  const index = handler(new Request("http://127.0.0.1/index.html"));
  assertEquals(index.status, 200);

  const head = handler(new Request("http://127.0.0.1/", { method: "HEAD" }));
  assertEquals(head.status, 200);
  assertEquals(await head.text(), "");
});

Deno.test("shell handler rejects command-shaped methods and unknown routes", async () => {
  const handler = createDesktopShellHandler(MODEL);

  const post = handler(new Request("http://127.0.0.1/", { method: "POST" }));
  assertEquals(post.status, 405);
  assertEquals(post.headers.get("allow"), "GET, HEAD");
  assertEquals(
    post.headers.get("content-security-policy")?.includes("default-src 'none'"),
    true,
  );
  assertEquals(await post.text(), "Method not allowed.\n");

  const missing = handler(new Request("http://127.0.0.1/api/control"));
  assertEquals(missing.status, 404);
  assertEquals(await missing.text(), "Not found.\n");
});
