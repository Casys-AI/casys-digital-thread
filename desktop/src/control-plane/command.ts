import { fail, type HostResult, ok } from "../host/result.ts";
import {
  COMMAND_RECOVERY,
  CONTROL_PLANE_LAYOUTS,
  type ControlPlaneLayoutProfile,
  type DesktopPlatform,
  HELPER_INSPECT_MODE,
  HELPER_START_MODE,
  type HelperMode,
  LAUNCH_ID_PATTERN,
  type PackagedHelperCommand,
} from "./contracts.ts";

const DENO_BASENAME = /^(deno|deno\.exe)$/i;

export interface ConstructHelperCommandInput {
  readonly helperPath: string;
  /** Validated platform support base selected by the layout resolver. */
  readonly cwd: string;
  readonly platform: DesktopPlatform;
  readonly layoutProfile: ControlPlaneLayoutProfile;
  /** Must be the fixed workspace derived by the platform layout resolver. */
  readonly relativeWorkspace: string;
  readonly mode: HelperMode;
  readonly launchId?: string;
}

export function constructHelperCommand(
  input: ConstructHelperCommandInput,
): HostResult<PackagedHelperCommand> {
  if (input.mode !== HELPER_START_MODE && input.mode !== HELPER_INSPECT_MODE) {
    return fail(
      "command.mode-invalid",
      "helper mode must be start or inspect",
      COMMAND_RECOVERY,
    );
  }

  const program = inspectAbsolutePath(
    input.helperPath,
    input.platform,
    "helperPath",
  );
  if (!program.ok) return program;

  const basename = pathBasename(program.value, input.platform);
  if (DENO_BASENAME.test(basename)) {
    return fail(
      "command.deno-cli-rejected",
      "the host must not execute a general Deno CLI",
      COMMAND_RECOVERY,
    );
  }

  const cwd = inspectAbsolutePath(input.cwd, input.platform, "cwd");
  if (!cwd.ok) return cwd;

  const layout = inspectLayout(
    input.platform,
    input.layoutProfile,
    input.relativeWorkspace,
  );
  if (!layout.ok) return layout;

  if (input.mode === HELPER_START_MODE) {
    if (
      typeof input.launchId !== "string" ||
      !LAUNCH_ID_PATTERN.test(input.launchId)
    ) {
      return fail(
        "command.launch-id-invalid",
        "start requires a lowercase UUID v4 host-minted launch id",
        COMMAND_RECOVERY,
      );
    }
  } else if (input.launchId !== undefined) {
    return fail(
      "command.mode-invalid",
      "inspect must not carry a launch id",
      COMMAND_RECOVERY,
    );
  }

  const args = input.mode === HELPER_START_MODE
    ? [
      HELPER_START_MODE,
      `--layout-profile=${layout.value}`,
      `--launch-id=${input.launchId}`,
    ]
    : [HELPER_INSPECT_MODE, `--layout-profile=${layout.value}`];

  return ok(Object.freeze({
    program: program.value,
    args: Object.freeze(args),
    cwd: cwd.value,
    env: Object.freeze({}) as Readonly<Record<string, never>>,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
    clearEnv: true,
  }));
}

function inspectLayout(
  platform: DesktopPlatform,
  profile: ControlPlaneLayoutProfile,
  relativeWorkspace: string,
): HostResult<ControlPlaneLayoutProfile> {
  const expected = CONTROL_PLANE_LAYOUTS[profile];
  if (expected === undefined || expected.platform !== platform) {
    return fail(
      "command.layout-profile-invalid",
      "layout profile does not belong to the selected platform",
      COMMAND_RECOVERY,
    );
  }
  if (relativeWorkspace !== expected.relativeWorkspace) {
    return fail(
      "command.workspace-invalid",
      "relative workspace does not match the fixed layout profile",
      COMMAND_RECOVERY,
    );
  }
  if (
    relativeWorkspace.length === 0 ||
    isAbsolute(platform, relativeWorkspace) ||
    segments(relativeWorkspace).includes("..")
  ) {
    return fail(
      "command.workspace-invalid",
      "layout workspace must be the fixed relative product subtree",
      COMMAND_RECOVERY,
    );
  }
  return ok(profile);
}

function inspectAbsolutePath(
  value: string,
  platform: DesktopPlatform,
  field: "helperPath" | "cwd",
): HostResult<string> {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== value) {
    return fail(
      field === "cwd" ? "command.cwd-invalid" : "command.path-invalid",
      `${field} must be an absolute path without edge whitespace`,
      COMMAND_RECOVERY,
    );
  }
  if (segments(trimmed).includes("..")) {
    return fail(
      "command.relative-path-rejected",
      `${field} must not contain a parent-directory segment`,
      COMMAND_RECOVERY,
    );
  }
  if (!isAbsolute(platform, trimmed)) {
    return fail(
      "command.relative-path-rejected",
      `${field} must be absolute, not a repository checkout or relative path`,
      COMMAND_RECOVERY,
    );
  }
  if (isFilesystemRoot(platform, trimmed)) {
    return fail(
      field === "cwd" ? "command.cwd-invalid" : "command.path-invalid",
      `${field} must not be a filesystem root`,
      COMMAND_RECOVERY,
    );
  }
  return ok(normalize(platform, trimmed));
}

function normalize(platform: DesktopPlatform, path: string): string {
  if (platform === "Windows") {
    return path.replace(/\//g, "\\").replace(/\\+$/g, "");
  }
  return path.replace(/\/+$/g, "");
}

function isAbsolute(platform: DesktopPlatform, path: string): boolean {
  if (platform === "Windows") {
    return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
  }
  return path.startsWith("/");
}

function isFilesystemRoot(platform: DesktopPlatform, path: string): boolean {
  if (platform === "Windows") return /^[A-Za-z]:[\\/]*$/.test(path);
  return /^\/+$/u.test(path);
}

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part.length > 0);
}

function pathBasename(path: string, platform: DesktopPlatform): string {
  const parts = segments(normalize(platform, path));
  return parts[parts.length - 1] ?? "";
}
