import { fail, type HostResult, ok } from "../host/result.ts";

export const PACKAGED_CONTROL_PLANE_HELPER_NAME = "casys-control-plane";

const RECOVERY =
  "Reinstall the signed macOS application bundle. Do not fall back to a checkout helper or a general Deno CLI.";

/** Resolve only the nested helper from the running signed macOS app bundle. */
export function resolvePackagedControlPlaneHelper(
  executablePath: string,
): HostResult<string> {
  if (
    executablePath.trim() !== executablePath || !executablePath.startsWith("/") ||
    executablePath.split("/").includes("..")
  ) {
    return fail(
      "helper-path.invalid",
      "the Desktop executable path is not an exact absolute macOS bundle path",
      RECOVERY,
    );
  }

  const marker = ".app/Contents/MacOS/";
  const markerIndex = executablePath.lastIndexOf(marker);
  const executableName = executablePath.slice(markerIndex + marker.length);
  if (
    markerIndex < 1 || executableName.length === 0 ||
    executableName === "." || executableName.includes("/")
  ) {
    return fail(
      "helper-path.unavailable",
      "the packaged control-plane helper is unavailable outside a macOS app bundle",
      RECOVERY,
    );
  }

  const appRoot = executablePath.slice(0, markerIndex + ".app".length);
  return ok(`${appRoot}/Contents/Helpers/${PACKAGED_CONTROL_PLANE_HELPER_NAME}`);
}
