import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import type { DesktopShellViewModel } from "../contracts/diagnostics.ts";
import { createDesktopShellHandler } from "./shell-handler.ts";

const MODEL: DesktopShellViewModel = {
  productName: "Casys Digital Thread",
  productVersion: "0.3.0",
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
    version: "0.3.0",
  }],
};

Deno.test("shell handler serves only the static document through GET and HEAD", async () => {
  const handler = createDesktopShellHandler(MODEL);

  const get = await handler(new Request("http://127.0.0.1/"));
  assertEquals(get.status, 200);
  assertStringIncludes(await get.text(), "Casys Digital Thread");
  assertEquals(get.headers.get("cache-control"), "no-store");

  const index = await handler(new Request("http://127.0.0.1/index.html"));
  assertEquals(index.status, 200);

  const head = await handler(
    new Request("http://127.0.0.1/", { method: "HEAD" }),
  );
  assertEquals(head.status, 200);
  assertEquals(await head.text(), "");
});

Deno.test("shell handler rejects command-shaped methods and every privileged route", async () => {
  const handler = createDesktopShellHandler(MODEL);

  const post = await handler(
    new Request("http://127.0.0.1/", { method: "POST" }),
  );
  assertEquals(post.status, 405);
  assertEquals(post.headers.get("allow"), "GET, HEAD");
  assertEquals(
    post.headers.get("content-security-policy")?.includes("default-src 'none'"),
    true,
  );
  assertEquals(await post.text(), "Method not allowed.\n");

  for (const path of ["/api/control", "/mcp", "/health", "/lifecycle"]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const missing = await handler(
        new Request(`http://127.0.0.1${path}`, { method }),
      );
      assertEquals(missing.status, 404);
      assertEquals(await missing.text(), method === "HEAD" ? "" : "Not found.\n");
    }
  }
});

Deno.test("shell handler makes the ready Workbench root canonical and keeps an honest fallback", async () => {
  const session = {
    origin: "http://127.0.0.1:5176" as const,
    accessToken: "a".repeat(64),
  };
  const ready = createDesktopShellHandler(
    MODEL,
    session,
    () =>
      Promise.resolve(
        new Response("<html>Living Workbench</html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      ),
  );
  const root = await ready(new Request("http://127.0.0.1/"));
  assertStringIncludes(await root.text(), "Living Workbench");
  const diagnostic = await ready(new Request("http://127.0.0.1/index.html"));
  assertStringIncludes(await diagnostic.text(), "Casys Digital Thread");

  const unavailable = createDesktopShellHandler(MODEL);
  const projects = await unavailable(new Request("http://127.0.0.1/api/projects"));
  assertEquals(projects.status, 503);
  assertEquals(await projects.json(), {
    schemaVersion: "desktop-workbench-unavailable/1.0",
    state: "unavailable",
  });
  const rejectedEventsHead = await unavailable(
    new Request("http://127.0.0.1/api/thread/workbench/events", {
      method: "HEAD",
    }),
  );
  assertEquals(rejectedEventsHead.status, 405);
  assertEquals(rejectedEventsHead.headers.get("allow"), "GET");
});
