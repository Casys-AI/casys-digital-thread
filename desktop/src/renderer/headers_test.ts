import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import { DESKTOP_SHELL_CSP, desktopShellResponseHeaders } from "./headers.ts";

Deno.test(
  "desktopShellResponseHeaders returns no-store, nosniff, no-referrer, and frame denial",
  () => {
    const headers = desktopShellResponseHeaders();
    assertEquals(headers["Content-Type"], "text/html; charset=utf-8");
    assertEquals(headers["Cache-Control"], "no-store");
    assertEquals(headers["X-Content-Type-Options"], "nosniff");
    assertEquals(headers["Referrer-Policy"], "no-referrer");
    assertEquals(headers["X-Frame-Options"], "DENY");
    assertEquals(headers["Content-Security-Policy"], DESKTOP_SHELL_CSP);
    assertEquals(desktopShellResponseHeaders(), headers);
  },
);

Deno.test("desktop shell CSP forbids scripts, frames, forms, and network", () => {
  assertEquals(DESKTOP_SHELL_CSP.includes("default-src 'none'"), true);
  assertEquals(DESKTOP_SHELL_CSP.includes("script-src 'none'"), true);
  assertEquals(DESKTOP_SHELL_CSP.includes("connect-src 'none'"), true);
  assertEquals(DESKTOP_SHELL_CSP.includes("img-src 'none'"), true);
  assertEquals(DESKTOP_SHELL_CSP.includes("font-src 'none'"), true);
  assertEquals(DESKTOP_SHELL_CSP.includes("form-action 'none'"), true);
  assertEquals(DESKTOP_SHELL_CSP.includes("frame-ancestors 'none'"), true);
  assertEquals(DESKTOP_SHELL_CSP.includes("style-src 'unsafe-inline'"), true);
  assertFalse(DESKTOP_SHELL_CSP.includes("unsafe-eval"));
  assertFalse(DESKTOP_SHELL_CSP.includes("*"));
});
