import { fail, type HostResult, ok } from "./result.ts";
import type { ControlPlaneLayoutProfile } from "../control-plane/contracts.ts";

export type DesktopPlatform = "macOS" | "Windows" | "Linux";

export type LayoutEnvironmentName =
  | "HOME"
  | "XDG_DATA_HOME"
  | "APPDATA"
  | "LOCALAPPDATA";

export type EnvironmentReader = (
  name: LayoutEnvironmentName,
) => string | undefined;

export interface ApplicationSupportLayout {
  readonly root: string;
  /** Existing directory used as the helper cwd; never the persistence root. */
  readonly controlPlaneLaunchCwd: string;
  /** Closed persistence cwd used by the existing server's relative stores. */
  readonly controlPlaneWorkspace: string;
  /** Workspace path relative to controlPlaneLaunchCwd for baked permissions. */
  readonly controlPlaneRelativeWorkspace: string;
  readonly controlPlaneLayoutProfile: ControlPlaneLayoutProfile;
  readonly config: string;
  readonly thread: string;
  readonly cas: string;
  readonly experience: string;
  readonly journals: string;
  readonly logs: string;
  readonly cache: string;
  readonly runtime: string;
}

export interface ResolveApplicationSupportLayoutInput {
  readonly platform: DesktopPlatform;
  readonly productIdentifier: string;
  readonly env: EnvironmentReader;
}

interface ControlPlaneLayoutInput {
  readonly launchCwd: string;
  readonly relativeWorkspace: string;
  readonly profile: ApplicationSupportLayout["controlPlaneLayoutProfile"];
}

const PLATFORMS: readonly DesktopPlatform[] = ["macOS", "Windows", "Linux"];
const PRODUCT_IDENTIFIER = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const BASE_RECOVERY =
  "Provide the named platform application-support environment variables. Do not use the repository checkout, a relative path, or the home-directory root.";

export function resolveApplicationSupportLayout(
  input: ResolveApplicationSupportLayoutInput,
): HostResult<ApplicationSupportLayout> {
  if (!isPlatform(input.platform)) {
    return fail(
      "layout.platform-invalid",
      "platform must be macOS, Windows, or Linux",
      BASE_RECOVERY,
    );
  }
  if (!PRODUCT_IDENTIFIER.test(input.productIdentifier)) {
    return fail(
      "layout.product-invalid",
      "productIdentifier must be a reverse-DNS product id",
      BASE_RECOVERY,
    );
  }

  const layout = input.platform === "macOS"
    ? resolveMacos(input)
    : input.platform === "Linux"
    ? resolveLinux(input)
    : resolveWindows(input);
  if (!layout.ok) return layout;
  return ok(Object.freeze(layout.value));
}

function resolveMacos(
  input: ResolveApplicationSupportLayoutInput,
): HostResult<ApplicationSupportLayout> {
  const home = readBase(input.env, "HOME", "macOS");
  if (!home.ok) return home;
  const root = join(
    "macOS",
    home.value,
    "Library",
    "Application Support",
    input.productIdentifier,
  );
  const launchCwd = join(
    "macOS",
    home.value,
    "Library",
    "Application Support",
  );
  return children("macOS", root, root, {
    launchCwd,
    relativeWorkspace: joinRelative(
      "macOS",
      input.productIdentifier,
      "control-plane",
    ),
    profile: "macos-application-support",
  });
}

function resolveLinux(
  input: ResolveApplicationSupportLayoutInput,
): HostResult<ApplicationSupportLayout> {
  const xdg = readOptionalBase(input.env, "XDG_DATA_HOME");
  if (xdg !== undefined) {
    const base = inspectBase("XDG_DATA_HOME", xdg, "Linux");
    if (!base.ok) return base;
    const home = readOptionalBase(input.env, "HOME");
    if (home !== undefined && samePath("Linux", base.value, home)) {
      return fail(
        "layout.home-root-rejected",
        "XDG_DATA_HOME must not be the home-directory root",
        BASE_RECOVERY,
      );
    }
    const root = join("Linux", base.value, input.productIdentifier);
    return children("Linux", root, root, {
      launchCwd: base.value,
      relativeWorkspace: joinRelative(
        "Linux",
        input.productIdentifier,
        "control-plane",
      ),
      profile: "linux-xdg",
    });
  }

  const home = readBase(input.env, "HOME", "Linux");
  if (!home.ok) return home;
  const root = join("Linux", home.value, ".local", "share", input.productIdentifier);
  return children("Linux", root, root, {
    launchCwd: home.value,
    relativeWorkspace: joinRelative(
      "Linux",
      ".local",
      "share",
      input.productIdentifier,
      "control-plane",
    ),
    profile: "linux-home",
  });
}

function resolveWindows(
  input: ResolveApplicationSupportLayoutInput,
): HostResult<ApplicationSupportLayout> {
  const roaming = readWindowsSupportBase(input.env, "APPDATA");
  if (!roaming.ok) return roaming;
  const local = readWindowsSupportBase(input.env, "LOCALAPPDATA");
  if (!local.ok) return local;
  const root = join("Windows", local.value, input.productIdentifier);
  const configRoot = join("Windows", roaming.value, input.productIdentifier);
  return children("Windows", root, configRoot, {
    launchCwd: local.value,
    relativeWorkspace: joinRelative(
      "Windows",
      input.productIdentifier,
      "control-plane",
    ),
    profile: "windows-local-appdata",
  });
}

function children(
  platform: DesktopPlatform,
  root: string,
  configRoot: string,
  controlPlane: ControlPlaneLayoutInput,
): HostResult<ApplicationSupportLayout> {
  return ok({
    root,
    controlPlaneLaunchCwd: controlPlane.launchCwd,
    controlPlaneWorkspace: join(platform, root, "control-plane"),
    controlPlaneRelativeWorkspace: controlPlane.relativeWorkspace,
    controlPlaneLayoutProfile: controlPlane.profile,
    config: join(platform, configRoot, "config"),
    thread: join(platform, root, "thread"),
    cas: join(platform, root, "cas"),
    experience: join(platform, root, "experience"),
    journals: join(platform, root, "journals"),
    logs: join(platform, root, "logs"),
    cache: join(platform, root, "cache"),
    runtime: join(platform, root, "runtime"),
  });
}

function joinRelative(
  platform: DesktopPlatform,
  ...parts: readonly string[]
): string {
  const separator = platform === "Windows" ? "\\" : "/";
  return parts.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, "")).join(
    separator,
  );
}

function readWindowsSupportBase(
  env: EnvironmentReader,
  name: "APPDATA" | "LOCALAPPDATA",
): HostResult<string> {
  const base = readBase(env, name, "Windows");
  if (!base.ok) return base;
  if (!segments(base.value).some((segment) => segment.toLowerCase() === "appdata")) {
    return fail(
      "layout.home-root-rejected",
      `${name} must be a Windows application-support directory, not a home-directory root`,
      BASE_RECOVERY,
    );
  }
  const home = readOptionalBase(env, "HOME");
  if (home !== undefined && samePath("Windows", base.value, home)) {
    return fail(
      "layout.home-root-rejected",
      `${name} must not be the home-directory root`,
      BASE_RECOVERY,
    );
  }
  return base;
}

function readBase(
  env: EnvironmentReader,
  name: LayoutEnvironmentName,
  platform: DesktopPlatform,
): HostResult<string> {
  const optional = readOptionalBase(env, name);
  if (optional === undefined) {
    return fail(
      "layout.base-unresolved",
      `${name} is unset, so the ${platform} application-support base cannot be resolved`,
      BASE_RECOVERY,
    );
  }
  return inspectBase(name, optional, platform);
}

function readOptionalBase(
  env: EnvironmentReader,
  name: LayoutEnvironmentName,
): string | undefined {
  const raw = env(name);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function inspectBase(
  name: LayoutEnvironmentName,
  value: string,
  platform: DesktopPlatform,
): HostResult<string> {
  if (hasParentSegment(value)) {
    return fail(
      "layout.relative-path-rejected",
      `${name} must not contain a parent-directory segment`,
      BASE_RECOVERY,
    );
  }
  if (!isAbsolute(platform, value)) {
    return fail(
      "layout.relative-path-rejected",
      `${name} must be an absolute application-support base, not a relative path or checkout`,
      BASE_RECOVERY,
    );
  }
  if (isFilesystemRoot(platform, value)) {
    return fail(
      "layout.home-root-rejected",
      `${name} must not be a filesystem root`,
      BASE_RECOVERY,
    );
  }
  return ok(normalizeBase(platform, value));
}

function join(platform: DesktopPlatform, ...parts: readonly string[]): string {
  const separator = platform === "Windows" ? "\\" : "/";
  const [base, ...rest] = parts;
  const tail = rest.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ""));
  return [normalizeBase(platform, base), ...tail].join(separator);
}

function normalizeBase(platform: DesktopPlatform, path: string): string {
  if (platform === "Windows") return path.replace(/\//g, "\\").replace(/\\+$/g, "");
  return path.replace(/\/+$/g, "");
}

function isAbsolute(platform: DesktopPlatform, path: string): boolean {
  if (platform === "Windows") {
    return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
  }
  return path.startsWith("/");
}

function isFilesystemRoot(platform: DesktopPlatform, path: string): boolean {
  if (platform === "Windows") {
    return /^[A-Za-z]:[\\/]*$/.test(path);
  }
  return /^\/+$/u.test(path);
}

function hasParentSegment(path: string): boolean {
  return segments(path).includes("..");
}

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part.length > 0);
}

function samePath(platform: DesktopPlatform, left: string, right: string): boolean {
  const normalizedLeft = normalizeBase(platform, left);
  const normalizedRight = normalizeBase(platform, right);
  if (platform === "Windows") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function isPlatform(value: unknown): value is DesktopPlatform {
  return (PLATFORMS as readonly unknown[]).includes(value);
}
