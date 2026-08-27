import type { DesktopPlatform } from "../host/mod.ts";
import { fail, type HostResult, ok } from "../host/result.ts";

export const PACKAGED_CONTROL_PLANE_HELPER_NAME = "casys-control-plane";
export const PACKAGED_WORKBENCH_HELPER_NAME = "casys-workbench";

export interface PackagedHelperResolutionInput {
  /** Selected once from Deno.build.os by the Desktop entry point. */
  readonly platform: DesktopPlatform;
  /** Must be the direct Deno.execPath() value for the running package. */
  readonly executablePath: string;
}

const RECOVERY =
  "Reinstall the verified package for the selected platform. Do not fall back to a checkout helper or a general Deno CLI.";
const MACOS_EXECUTABLE_MARKER = ".app/Contents/MacOS/";
const LINUX_EXECUTABLE_SUFFIX = "/casys-digital-thread/bin/casys-digital-thread";
const WINDOWS_EXECUTABLE_SUFFIX = "\\CasysDigitalThread\\CasysDigitalThread.exe";

/** Resolve only the control-plane helper in the selected closed bundle layout. */
export function resolvePackagedControlPlaneHelper(
  input: PackagedHelperResolutionInput,
): HostResult<string> {
  return resolvePackagedHelper(input, PACKAGED_CONTROL_PLANE_HELPER_NAME);
}

/** Resolve only the read-only Workbench helper in the same selected bundle. */
export function resolvePackagedWorkbenchHelper(
  input: PackagedHelperResolutionInput,
): HostResult<string> {
  return resolvePackagedHelper(input, PACKAGED_WORKBENCH_HELPER_NAME);
}

function resolvePackagedHelper(
  input: PackagedHelperResolutionInput,
  helperName: string,
): HostResult<string> {
  const inspected = inspectExecutablePath(input);
  if (!inspected.ok) return inspected;
  const executablePath = inspected.value;
  switch (input.platform) {
    case "macOS":
      return resolveMacosHelper(executablePath, helperName);
    case "Linux":
      return resolveLinuxHelper(executablePath, helperName);
    case "Windows":
      return resolveWindowsHelper(executablePath, helperName);
  }
}

function inspectExecutablePath(
  input: PackagedHelperResolutionInput,
): HostResult<string> {
  if (!isDesktopPlatform(input.platform)) {
    return unavailable("the Desktop platform has no registered bundle layout");
  }
  const path = input.executablePath;
  if (
    path.length === 0 || path.trim() !== path || path.includes("\0") ||
    segments(path).some((segment) => segment === "." || segment === "..")
  ) {
    return invalid("the Desktop executable path is not exact and traversal-free");
  }
  if (input.platform === "Windows") {
    if (!/^[A-Za-z]:\\[^\\]/u.test(path) || path.includes("/")) {
      return invalid(
        "the Windows Desktop executable path must be a drive-absolute native path",
      );
    }
    if (/^[A-Za-z]:\\?$/u.test(path)) {
      return invalid("the Desktop executable path must not be a filesystem root");
    }
  } else if (!path.startsWith("/") || path.includes("\\") || /^\/+$/u.test(path)) {
    return invalid(
      `the ${input.platform} Desktop executable path must be an absolute native path outside the filesystem root`,
    );
  }
  return ok(path);
}

function resolveMacosHelper(
  executablePath: string,
  helperName: string,
): HostResult<string> {
  const markerIndex = uniqueIndex(executablePath, MACOS_EXECUTABLE_MARKER);
  if (markerIndex < 1) {
    return unavailable(
      "the macOS executable is not inside one exact .app/Contents/MacOS directory",
    );
  }
  const executableName = executablePath.slice(
    markerIndex + MACOS_EXECUTABLE_MARKER.length,
  );
  if (executableName.length === 0 || executableName.includes("/")) {
    return unavailable("the macOS bundle executable leaf is invalid or ambiguous");
  }
  const appRoot = executablePath.slice(0, markerIndex + ".app".length);
  return ok(`${appRoot}/Contents/Helpers/${helperName}`);
}

function resolveLinuxHelper(
  executablePath: string,
  helperName: string,
): HostResult<string> {
  const suffixIndex = uniqueIndex(executablePath, LINUX_EXECUTABLE_SUFFIX);
  if (
    suffixIndex < 1 ||
    suffixIndex + LINUX_EXECUTABLE_SUFFIX.length !== executablePath.length
  ) {
    return unavailable(
      "the Linux executable does not match the closed casys-digital-thread/bin bundle layout",
    );
  }
  const bundleRoot = executablePath.slice(
    0,
    suffixIndex + "/casys-digital-thread".length,
  );
  return ok(`${bundleRoot}/libexec/${helperName}`);
}

function resolveWindowsHelper(
  executablePath: string,
  helperName: string,
): HostResult<string> {
  const suffixIndex = uniqueIndex(
    executablePath.toLowerCase(),
    WINDOWS_EXECUTABLE_SUFFIX.toLowerCase(),
  );
  if (
    suffixIndex <= 2 ||
    suffixIndex + WINDOWS_EXECUTABLE_SUFFIX.length !== executablePath.length
  ) {
    return unavailable(
      "the Windows executable does not match the closed CasysDigitalThread bundle layout",
    );
  }
  const bundleRoot = executablePath.slice(
    0,
    suffixIndex + "\\CasysDigitalThread".length,
  );
  return ok(`${bundleRoot}\\Helpers\\${helperName}.exe`);
}

function uniqueIndex(value: string, marker: string): number {
  const first = value.indexOf(marker);
  if (first < 0 || first !== value.lastIndexOf(marker)) return -1;
  return first;
}

function segments(path: string): string[] {
  return path.split(/[\\/]+/u).filter((segment) => segment.length > 0);
}

function isDesktopPlatform(value: unknown): value is DesktopPlatform {
  return value === "macOS" || value === "Linux" || value === "Windows";
}

function invalid(message: string): HostResult<never> {
  return fail("helper-path.invalid", message, RECOVERY);
}

function unavailable(message: string): HostResult<never> {
  return fail("helper-path.unavailable", message, RECOVERY);
}
