import { assertEquals } from "jsr:@std/assert@1.0.14";
import { MACOS_RUNTIME_EXECUTABLE_NAME } from "../build/macos-launcher.ts";
import { resolveChatHostExecutable, resolvePackagedChatHost } from "./path.ts";

const FINAL_MACOS_EXECUTABLE =
  `/Applications/CasysDigitalThread.app/Contents/MacOS/${MACOS_RUNTIME_EXECUTABLE_NAME}`;

Deno.test("packaged Chat Host resolves the final macOS Deno.execPath runtime", () => {
  const result = resolvePackagedChatHost(
    FINAL_MACOS_EXECUTABLE,
    "darwin-arm64",
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(
      result.value.executable,
      "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-chat-host",
    );
    assertEquals(result.value.target, "darwin-arm64");
  }
});

Deno.test("unimplemented Linux and Windows packages fail closed before path fallback", () => {
  for (const target of ["linux-x64", "windows-x64"] as const) {
    const result = resolvePackagedChatHost("ambient-or-relative", target);
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.code, "chat-host-target.unsupported");
  }
});

Deno.test("package layout resolution has explicit macOS, Linux, and Windows seams", () => {
  assertEquals(
    resolveChatHostExecutable(
      FINAL_MACOS_EXECUTABLE,
      "darwin-arm64",
    ),
    "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-chat-host",
  );
  assertEquals(
    resolveChatHostExecutable(
      "/opt/casys-digital-thread/bin/casys-digital-thread",
      "linux-x64",
    ),
    "/opt/casys-digital-thread/libexec/casys-chat-host",
  );
  assertEquals(
    resolveChatHostExecutable(
      "C:\\Program Files\\Casys\\CasysDigitalThread\\CasysDigitalThread.exe",
      "windows-x64",
    ),
    "C:\\Program Files\\Casys\\CasysDigitalThread\\Helpers\\casys-chat-host.exe",
  );
});

Deno.test("package layout rejects lookalike product executables", () => {
  const lookalikes = [
    [
      "/Applications/CasysDigitalThread.app/Contents/MacOS/Casys Digital Thread",
      "darwin-arm64",
    ],
    [
      "/Applications/CasysDigitalThread.app/Contents/MacOS/laufey_webview",
      "darwin-arm64",
    ],
    [
      "/Applications/Casys.app/Contents/MacOS/casys-desktop-runtime",
      "darwin-arm64",
    ],
    ["/opt/other/bin/casys-digital-thread", "linux-x64"],
    [
      "C:\\Program Files\\Casys\\Other\\CasysDigitalThread.exe",
      "windows-x64",
    ],
  ] as const;
  for (const [executable, target] of lookalikes) {
    assertEquals(resolveChatHostExecutable(executable, target), undefined);
  }
});

Deno.test("implemented target rejects checkout and traversal paths", () => {
  for (
    const executable of [
      "/tmp/casys-desktop",
      "/Applications/App.app/Contents/MacOS/../casys",
    ]
  ) {
    const result = resolvePackagedChatHost(executable, "darwin-arm64");
    assertEquals(result.ok, false);
  }
});
