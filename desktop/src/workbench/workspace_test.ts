import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { workbenchRuntimePaths } from "./workspace.ts";

Deno.test("Workbench derives control-plane and lifecycle roots from each closed layout", () => {
  assertEquals(
    workbenchRuntimePaths(
      "/Users/ada/Library/Application Support",
      "macos-application-support",
    ),
    {
      controlPlaneRoot:
        "/Users/ada/Library/Application Support/ai.casys.digital-thread/control-plane",
      runtimeRoot:
        "/Users/ada/Library/Application Support/ai.casys.digital-thread/workbench-runtime",
      markerPath:
        "/Users/ada/Library/Application Support/ai.casys.digital-thread/workbench-runtime/owner.json",
      tokenPath:
        "/Users/ada/Library/Application Support/ai.casys.digital-thread/workbench-runtime/access-token",
      lockPath:
        "/Users/ada/Library/Application Support/ai.casys.digital-thread/workbench-runtime/workbench.lock",
    },
  );
  assertEquals(
    workbenchRuntimePaths("/home/ada", "linux-home"),
    {
      controlPlaneRoot: "/home/ada/.local/share/ai.casys.digital-thread/control-plane",
      runtimeRoot: "/home/ada/.local/share/ai.casys.digital-thread/workbench-runtime",
      markerPath:
        "/home/ada/.local/share/ai.casys.digital-thread/workbench-runtime/owner.json",
      tokenPath:
        "/home/ada/.local/share/ai.casys.digital-thread/workbench-runtime/access-token",
      lockPath:
        "/home/ada/.local/share/ai.casys.digital-thread/workbench-runtime/workbench.lock",
    },
  );
  assertEquals(
    workbenchRuntimePaths(
      "C:\\Users\\ada\\AppData\\Local",
      "windows-local-appdata",
    ),
    {
      controlPlaneRoot:
        "C:\\Users\\ada\\AppData\\Local\\ai.casys.digital-thread\\control-plane",
      runtimeRoot:
        "C:\\Users\\ada\\AppData\\Local\\ai.casys.digital-thread\\workbench-runtime",
      markerPath:
        "C:\\Users\\ada\\AppData\\Local\\ai.casys.digital-thread\\workbench-runtime\\owner.json",
      tokenPath:
        "C:\\Users\\ada\\AppData\\Local\\ai.casys.digital-thread\\workbench-runtime\\access-token",
      lockPath:
        "C:\\Users\\ada\\AppData\\Local\\ai.casys.digital-thread\\workbench-runtime\\workbench.lock",
    },
  );
});

Deno.test("Workbench rejects a launch root that does not belong to its layout", () => {
  assertThrows(
    () => workbenchRuntimePaths("C:\\Users\\ada", "linux-home"),
    Error,
  );
  assertThrows(
    () => workbenchRuntimePaths("/home/ada", "windows-local-appdata"),
    Error,
  );
  assertThrows(
    () => workbenchRuntimePaths("/", "linux-home"),
    Error,
  );
});
