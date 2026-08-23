/** Exact Lot 2 sidecar identities. Lane A parses these documents, not aliases. */

export const PRODUCT_IDENTIFIER = "ai.casys.digital-thread";
export const PRODUCT_VERSION = "0.4.0";
export const SERVER_NAME = "casys-digital-thread-console";
export const SERVER_VERSION = "0.2.0";
export const CONTROL_PLANE_HELPER_NAME = "casys-control-plane";

export const MARKER_SCHEMA = "casys-desktop-control-plane-marker/1.0";
export const HANDSHAKE_SCHEMA = "casys-desktop-control-plane-handshake/1.0";
export const INSPECT_SCHEMA = "casys-desktop-control-plane-inspect/1.0";
export const LIFECYCLE_SCHEMA = "casys-desktop-control-plane-lifecycle/1.0";
export const RUNTIME_SCHEMA = "casys-desktop-control-plane-runtime/1.0";
export const ASSET_DIGEST_SCHEMA = "casys-desktop-control-plane-assets/1.0";

export const CLOSED_WORKSPACE_DIR = "control-plane";
export const FLEET_RELATIVE_PATH = "config/mcp-fleet.json";
export const FIXTURE_RELATIVE_PATH = "state/fixtures/runs/bracket-demo.json";
export const DESKTOP_RUNTIME_RELATIVE_PATH = "config/desktop-runtime.json";
export const MARKER_RELATIVE_PATH = "runtime/owner.json";
export const LOCK_RELATIVE_PATH = "runtime/control-plane.lock";
export const MRTR_KEY_RELATIVE_PATH = "secrets/mrtr-signing-key";

export const CONTROL_PLANE_HOSTNAME = "127.0.0.1";
export const CONTROL_PLANE_PORT = 3020;
export const CONTROL_PLANE_ENDPOINT = "http://127.0.0.1:3020/mcp";
export const CONTROL_PLANE_HEALTH_URL = "http://127.0.0.1:3020/health";

export const DESKTOP_LIFECYCLE_TOOL_NAME = "desktop_control_plane_lifecycle";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

export const LAUNCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const CONFIG_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const CONTROL_PLANE_LOOPBACK_PORTS = [
  3020,
  3009,
  3012,
  3014,
  3015,
  3018,
  3019,
  3022,
  3023,
  3024,
] as const;

export const EXACT_HEALTH = Object.freeze({
  status: "ok",
  server: SERVER_NAME,
  version: SERVER_VERSION,
});

export const EXACT_DISCOVER_SERVER_INFO = Object.freeze({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

export const COMPOSE_UNAVAILABLE_ERROR =
  "Compose metadata is unavailable; the Desktop control-plane helper has no Docker permission and does not search for a compose root.";

export interface LaunchMarker {
  readonly schema: typeof MARKER_SCHEMA;
  readonly productVersion: typeof PRODUCT_VERSION;
  readonly serverVersion: typeof SERVER_VERSION;
  readonly launchId: string;
  readonly pid: number;
  readonly endpoint: typeof CONTROL_PLANE_ENDPOINT;
  readonly configDigest: string;
  readonly startedAt: string;
}

export interface ReadinessHandshake {
  readonly schema: typeof HANDSHAKE_SCHEMA;
  readonly status: "ready";
  readonly productVersion: typeof PRODUCT_VERSION;
  readonly serverVersion: typeof SERVER_VERSION;
  readonly launchId: string;
  readonly configDigest: string;
}

export interface LifecycleIdentity {
  readonly schema: typeof LIFECYCLE_SCHEMA;
  readonly productVersion: typeof PRODUCT_VERSION;
  readonly serverVersion: typeof SERVER_VERSION;
  readonly launchId: string;
  readonly configDigest: string;
}

export type ControlPlaneLayoutProfile =
  | "macos-application-support"
  | "linux-xdg"
  | "linux-home"
  | "windows-local-appdata";

/** Must stay byte-for-byte aligned with host/layout.ts. */
export const CONTROL_PLANE_RELATIVE_WORKSPACES = Object.freeze(
  {
    "macos-application-support": "ai.casys.digital-thread/control-plane",
    "linux-xdg": "ai.casys.digital-thread/control-plane",
    "linux-home": ".local/share/ai.casys.digital-thread/control-plane",
    "windows-local-appdata": "ai.casys.digital-thread\\control-plane",
  } satisfies Record<ControlPlaneLayoutProfile, string>,
);

export type InspectConfigurationState =
  | "verified"
  | "missing"
  | "mismatch"
  | "error";

export type InspectLockState = "held" | "free" | "unavailable";

export interface ControlPlaneInspectDocument {
  readonly schema: typeof INSPECT_SCHEMA;
  readonly productVersion: typeof PRODUCT_VERSION;
  readonly serverVersion: typeof SERVER_VERSION;
  readonly expectedConfigDigest: string;
  readonly configuration: InspectConfigurationState;
  readonly marker: LaunchMarker | null;
  readonly lock: InspectLockState;
}

export class SidecarFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SidecarFailure";
    this.code = code;
  }
}

export function joinWorkspace(
  root: string,
  ...segments: readonly string[]
): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const edgeSeparators = /^[\\/]+|[\\/]+$/g;
  return [
    root.replace(/[\\/]+$/g, ""),
    ...segments.map((segment) => segment.replace(edgeSeparators, "")),
  ].join(separator);
}

export function isControlPlaneLayoutProfile(
  value: string,
): value is ControlPlaneLayoutProfile {
  return Object.hasOwn(CONTROL_PLANE_RELATIVE_WORKSPACES, value);
}

export function closedWorkspaceRoot(
  launchCwd: string,
  profile: ControlPlaneLayoutProfile,
): string {
  assertLaunchCwd(launchCwd, profile);
  return joinWorkspace(
    launchCwd,
    CONTROL_PLANE_RELATIVE_WORKSPACES[profile],
  );
}

function assertLaunchCwd(
  launchCwd: string,
  profile: ControlPlaneLayoutProfile,
): void {
  const windows = profile === "windows-local-appdata";
  const absolute = windows
    ? /^[A-Za-z]:[\\/]/.test(launchCwd) || launchCwd.startsWith("\\\\")
    : launchCwd.startsWith("/");
  if (
    launchCwd.trim() !== launchCwd || !absolute ||
    launchCwd.split(/[\\/]+/).includes("..") ||
    (!windows && /^\/+$/u.test(launchCwd)) ||
    (windows && /^[A-Za-z]:[\\/]*$/.test(launchCwd))
  ) {
    throw new SidecarFailure(
      "workspace.cwd-invalid",
      "The helper cwd must be an absolute, non-root platform support base without parent-directory segments.",
    );
  }
}
