import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import {
  resolvePackagedControlPlaneHelper,
  resolvePackagedWorkbenchHelper,
} from "./helper-path.ts";

Deno.test("resolvePackagedControlPlaneHelper derives only the nested macOS helper", () => {
  const result = resolvePackagedControlPlaneHelper(
    "/Applications/CasysDigitalThread.app/Contents/MacOS/Casys Digital Thread",
  );
  if (!result.ok) throw new Error(result.error.message);
  assertEquals(
    result.value,
    "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-control-plane",
  );
  assertFalse(result.value.endsWith("/deno"));
});

Deno.test("resolvePackagedWorkbenchHelper derives the sibling least-privilege helper", () => {
  const result = resolvePackagedWorkbenchHelper(
    "/Applications/CasysDigitalThread.app/Contents/MacOS/Casys Digital Thread",
  );
  if (!result.ok) throw new Error(result.error.message);
  assertEquals(
    result.value,
    "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-workbench",
  );
  assertFalse(result.value.endsWith("/deno"));
});

Deno.test("resolvePackagedControlPlaneHelper has no checkout or Deno CLI fallback", () => {
  for (
    const path of [
      "/opt/homebrew/bin/deno",
      "desktop/dist/CasysDigitalThread.app/Contents/MacOS/app",
      "/Applications/Casys.app/Contents/MacOS/../Helpers/casys-control-plane",
      "/Applications/Casys.app/Contents/MacOS/app/nested",
      "/Applications/Casys.app/Contents/MacOS/.",
    ]
  ) {
    const result = resolvePackagedControlPlaneHelper(path);
    assertEquals(result.ok, false);
  }
});
