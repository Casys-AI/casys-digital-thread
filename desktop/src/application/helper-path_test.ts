import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import type { DesktopPlatform } from "../host/mod.ts";
import {
  resolvePackagedControlPlaneHelper,
  resolvePackagedWorkbenchHelper,
} from "./helper-path.ts";

const VALID_LAYOUTS: readonly {
  platform: DesktopPlatform;
  executablePath: string;
  controlPlane: string;
  workbench: string;
}[] = [{
  platform: "macOS",
  executablePath:
    "/Applications/CasysDigitalThread.app/Contents/MacOS/Casys Digital Thread",
  controlPlane:
    "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-control-plane",
  workbench: "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-workbench",
}, {
  platform: "Linux",
  executablePath: "/opt/casys-digital-thread/bin/casys-digital-thread",
  controlPlane: "/opt/casys-digital-thread/libexec/casys-control-plane",
  workbench: "/opt/casys-digital-thread/libexec/casys-workbench",
}, {
  platform: "Windows",
  executablePath: "C:\\Program Files\\CasysDigitalThread\\CasysDigitalThread.exe",
  controlPlane:
    "C:\\Program Files\\CasysDigitalThread\\Helpers\\casys-control-plane.exe",
  workbench: "C:\\Program Files\\CasysDigitalThread\\Helpers\\casys-workbench.exe",
}];

Deno.test("packaged helper paths derive from three closed platform bundle layouts", () => {
  for (const layout of VALID_LAYOUTS) {
    const controlPlane = resolvePackagedControlPlaneHelper(layout);
    const workbench = resolvePackagedWorkbenchHelper(layout);
    if (!controlPlane.ok) throw new Error(controlPlane.error.message);
    if (!workbench.ok) throw new Error(workbench.error.message);
    assertEquals(controlPlane.value, layout.controlPlane);
    assertEquals(workbench.value, layout.workbench);
    assertFalse(/(?:^|[\\/])deno(?:\.exe)?$/iu.test(controlPlane.value));
    assertFalse(/(?:^|[\\/])deno(?:\.exe)?$/iu.test(workbench.value));
  }
});

Deno.test("helper resolution rejects traversal, roots, mixed separators, and ambiguity", () => {
  const invalid: readonly {
    platform: DesktopPlatform;
    executablePath: string;
  }[] = [
    { platform: "macOS", executablePath: "/" },
    {
      platform: "macOS",
      executablePath:
        "/Applications/Casys.app/Contents/MacOS/../Helpers/casys-control-plane",
    },
    {
      platform: "macOS",
      executablePath:
        "/Applications/Outer.app/Contents/MacOS/Inner.app/Contents/MacOS/app",
    },
    { platform: "Linux", executablePath: "/" },
    {
      platform: "Linux",
      executablePath: "/opt/casys-digital-thread/bin/../bin/casys-digital-thread",
    },
    {
      platform: "Linux",
      executablePath:
        "/opt/casys-digital-thread/bin/casys-digital-thread/casys-digital-thread/bin/casys-digital-thread",
    },
    { platform: "Windows", executablePath: "C:\\" },
    {
      platform: "Windows",
      executablePath:
        "C:\\Program Files\\CasysDigitalThread\\..\\CasysDigitalThread.exe",
    },
    {
      platform: "Windows",
      executablePath:
        "C:\\CasysDigitalThread\\CasysDigitalThread.exe\\CasysDigitalThread\\CasysDigitalThread.exe",
    },
    {
      platform: "Windows",
      executablePath: "C:/Program Files/CasysDigitalThread/CasysDigitalThread.exe",
    },
  ];
  for (const input of invalid) {
    assertEquals(
      resolvePackagedControlPlaneHelper(input).ok,
      false,
      input.executablePath,
    );
    assertEquals(resolvePackagedWorkbenchHelper(input).ok, false, input.executablePath);
  }
});

Deno.test("helper resolution rejects cross-platform and general-runtime lookalikes", () => {
  const invalid: readonly {
    platform: DesktopPlatform;
    executablePath: string;
  }[] = [
    { platform: "macOS", executablePath: "/opt/homebrew/bin/deno" },
    { platform: "Linux", executablePath: "/usr/bin/deno" },
    { platform: "Windows", executablePath: "C:\\Deno\\deno.exe" },
    { platform: "Linux", executablePath: VALID_LAYOUTS[0].executablePath },
    { platform: "Windows", executablePath: VALID_LAYOUTS[1].executablePath },
    { platform: "macOS", executablePath: VALID_LAYOUTS[2].executablePath },
    {
      platform: "macOS",
      executablePath:
        "desktop/dist/CasysDigitalThread.app/Contents/MacOS/Casys Digital Thread",
    },
  ];
  for (const input of invalid) {
    assertEquals(
      resolvePackagedControlPlaneHelper(input).ok,
      false,
      input.executablePath,
    );
  }
});
