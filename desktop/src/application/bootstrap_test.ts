import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.14";
import rawManifest from "../../component-manifest.json" with { type: "json" };
import { renderDesktopShell } from "../renderer/mod.ts";
import { bootstrapDesktopShell } from "./bootstrap.ts";

function bootstrap(
  overrides: Partial<Parameters<typeof bootstrapDesktopShell>[0]> = {},
) {
  return bootstrapDesktopShell({
    manifest: rawManifest,
    actualDenoVersion: "2.9.2",
    actualDesktopRuntimeVersion: "2.9.2",
    actualProductVersion: "0.1.0",
    platform: "macOS",
    env: (name) => name === "HOME" ? "/Users/ada" : undefined,
    ...overrides,
  });
}

Deno.test("bootstrap produces an honest degraded Lot 1 shell", () => {
  const model = bootstrap();
  assertEquals(model.status, "degraded");
  assertEquals(
    model.components.find((component) => component.id === "desktop-shell")?.state,
    "ready",
  );
  assertEquals(
    model.components.find((component) => component.id === "casys-control-plane")
      ?.state,
    "unavailable",
  );
  assertStringIncludes(model.summary, "unavailable");
});

Deno.test("bootstrap keeps runtime or application-support failure recovery-required", () => {
  assertEquals(
    bootstrap({ actualDenoVersion: "2.9.1" }).status,
    "recovery-required",
  );
  assertEquals(
    bootstrap({ env: () => undefined }).status,
    "recovery-required",
  );
});

Deno.test("the real bootstrap-to-renderer seam does not expose application-support paths", () => {
  const html = renderDesktopShell(bootstrap());
  for (
    const forbidden of [
      "/Users/ada",
      "Application Support",
      "/thread",
      "/cas",
      "/experience",
    ]
  ) {
    assertFalse(html.includes(forbidden), `rendered shell leaked ${forbidden}`);
  }
});
