import type {
  ComponentDiagnostic,
  DesktopControlPlaneProjection,
  ShellStatus,
} from "../contracts/diagnostics.ts";

/** Exact Desktop-owned loopback bind. Callers cannot choose a host or port. */
export const CONTROL_PLANE_LOOPBACK_HOST = "127.0.0.1";
export const CONTROL_PLANE_PORT = 3020;
export const CONTROL_PLANE_HEALTH_URL = "http://127.0.0.1:3020/health";
export const CONTROL_PLANE_MCP_URL = "http://127.0.0.1:3020/mcp";

export const CONTROL_PLANE_MARKER_SCHEMA = "casys-desktop-control-plane-marker/1.0";
export const CONTROL_PLANE_HANDSHAKE_SCHEMA =
  "casys-desktop-control-plane-handshake/1.0";
export const CONTROL_PLANE_INSPECT_SCHEMA = "casys-desktop-control-plane-inspect/1.0";
export const CONTROL_PLANE_LIFECYCLE_SCHEMA =
  "casys-desktop-control-plane-lifecycle/1.0";

export const CONTROL_PLANE_SERVER_NAME = "casys-digital-thread-console";
export const CONTROL_PLANE_SERVER_VERSION = "0.2.0";
export const CONTROL_PLANE_PRODUCT_IDENTIFIER = "ai.casys.digital-thread";
export const CONTROL_PLANE_PRODUCT_VERSION = "0.4.0";
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/** Read-only Desktop identity tool. Lane B must register this exact name. */
export const DESKTOP_LIFECYCLE_TOOL_NAME = "desktop_control_plane_lifecycle";
export const CONSOLE_SNAPSHOT_TOOL_NAME = "console_snapshot";

export const HELPER_START_MODE = "start";
export const HELPER_INSPECT_MODE = "inspect";
export type HelperMode = typeof HELPER_START_MODE | typeof HELPER_INSPECT_MODE;

export const HANDSHAKE_MAX_BYTES = 4096;
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const PROBE_TIMEOUT_MS = 2_000;

export const CONFIG_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const LAUNCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const EXACT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const STARTED_AT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export const VERSION_ALIASES = ["latest", "canary", "nightly"] as const;

export type DesktopPlatform = "macOS" | "Windows" | "Linux";

export type ControlPlaneLayoutProfile =
  | "macos-application-support"
  | "linux-xdg"
  | "linux-home"
  | "windows-local-appdata";

/**
 * Fixed storage beneath the already validated platform base used as helper cwd.
 * The relative path is checked by the host but is not caller-selected CLI input.
 */
export const CONTROL_PLANE_LAYOUTS = Object.freeze({
  "macos-application-support": Object.freeze({
    platform: "macOS" as const,
    relativeWorkspace: "ai.casys.digital-thread/control-plane",
  }),
  "linux-xdg": Object.freeze({
    platform: "Linux" as const,
    relativeWorkspace: "ai.casys.digital-thread/control-plane",
  }),
  "linux-home": Object.freeze({
    platform: "Linux" as const,
    relativeWorkspace: ".local/share/ai.casys.digital-thread/control-plane",
  }),
  "windows-local-appdata": Object.freeze({
    platform: "Windows" as const,
    relativeWorkspace: "ai.casys.digital-thread\\control-plane",
  }),
});

export type OwnershipKind =
  | "absent"
  | "owned"
  | "reconnected"
  | "foreign"
  | "ambiguous"
  | "stale"
  | "mismatch";

export type InspectLockState = "held" | "free" | "unavailable";

export type ConfigurationMaterializationState =
  | "verified"
  | "missing"
  | "mismatch"
  | "error";

export interface ExpectedControlPlaneIdentity {
  readonly productIdentifier: typeof CONTROL_PLANE_PRODUCT_IDENTIFIER;
  readonly productVersion: string;
  readonly serverName: typeof CONTROL_PLANE_SERVER_NAME;
  readonly serverVersion: string;
}

/** Digest is learned only from the signed helper's exact inspect document. */
export interface ExpectedLiveControlPlaneIdentity extends ExpectedControlPlaneIdentity {
  readonly configDigest: string;
}

export interface ControlPlaneMarker {
  readonly schema: typeof CONTROL_PLANE_MARKER_SCHEMA;
  readonly productVersion: string;
  readonly serverVersion: string;
  readonly launchId: string;
  readonly pid: number;
  readonly endpoint: typeof CONTROL_PLANE_MCP_URL;
  readonly configDigest: string;
  readonly startedAt: string;
}

export interface ControlPlaneHandshake {
  readonly schema: typeof CONTROL_PLANE_HANDSHAKE_SCHEMA;
  readonly status: "ready";
  readonly productVersion: string;
  readonly serverVersion: string;
  readonly launchId: string;
  readonly configDigest: string;
}

export interface ControlPlaneInspectDocument {
  readonly schema: typeof CONTROL_PLANE_INSPECT_SCHEMA;
  readonly productVersion: string;
  readonly serverVersion: string;
  readonly expectedConfigDigest: string;
  readonly configuration: ConfigurationMaterializationState;
  readonly marker: ControlPlaneMarker | null;
  readonly lock: InspectLockState;
}

export interface ControlPlaneLifecycleIdentity {
  readonly schema: typeof CONTROL_PLANE_LIFECYCLE_SCHEMA;
  readonly productVersion: string;
  readonly serverVersion: string;
  readonly launchId: string;
  readonly configDigest: string;
}

export interface ControlPlaneHealthDocument {
  readonly status: "ok";
  readonly server: typeof CONTROL_PLANE_SERVER_NAME;
  readonly version: string;
}

export interface ConfigurationMaterialization {
  readonly state: ConfigurationMaterializationState;
  readonly expectedDigest: string;
}

export interface PackagedHelperCommand {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, never>>;
  readonly stdin: "piped";
  readonly stdout: "piped";
  readonly stderr: "null";
  readonly clearEnv: true;
}

/**
 * Live child this host spawned. Stop uses `kill` / `closeStdin` on this
 * object. There is no pid field, so a persisted pid cannot be signaled.
 */
export interface OwnedSidecarHandle {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly status: Promise<Deno.CommandStatus>;
  closeStdin(): void;
  kill(signo: Deno.Signal): void;
}

export interface ControlPlaneOwnership {
  readonly kind: OwnershipKind;
  readonly reason: string;
  readonly recovery?: string;
  readonly recoveryCode?: DesktopControlPlaneProjection["recoveryCode"];
}

export type ProviderFleetStatus =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "unknown";

export interface ProviderSnapshotObservation {
  readonly fleetStatus: ProviderFleetStatus;
  readonly healthy: number;
  readonly total: number;
  readonly drift: number;
  readonly runCount: number;
  readonly demoRunCount: number;
}

/** Host result carrying both the legacy diagnostic view and the narrow renderer DTO. */
export interface ControlPlaneHostResult {
  readonly renderer: ControlPlaneRendererObservation;
  readonly projection: DesktopControlPlaneProjection;
}

export interface ControlPlaneRendererObservation {
  readonly status: ShellStatus;
  readonly configuration: ComponentDiagnostic;
  readonly controlPlane: ComponentDiagnostic;
  readonly providers: ComponentDiagnostic;
  readonly projectEvidence: ComponentDiagnostic;
}

export const CONTROL_PLANE_COMPONENT_IDS = Object.freeze({
  configuration: "packaged-configuration",
  controlPlane: "casys-control-plane",
  providers: "engineering-providers",
  projectEvidence: "project-evidence",
});

export const MARKER_RECOVERY =
  "Replace the sidecar marker with an exact casys-desktop-control-plane-marker/1.0 document, or remove a stale marker through a reviewed recovery path. Do not signal a persisted pid.";

export const HANDSHAKE_RECOVERY =
  "Restart Desktop so the packaged helper can write one bounded JSON handshake after MCP readiness. Do not treat stderr logs as handshake.";

export const INSPECT_RECOVERY =
  "Run the packaged helper in inspect mode only. Do not invoke a general Deno CLI or a stop-by-pid mode.";

export const COMMAND_RECOVERY =
  "Launch only the nested-signed packaged control-plane helper by its absolute path with a validated application-support cwd. Do not execute deno, grant --allow-run=deno, or use the repository checkout.";

export const OWNERSHIP_RECOVERY =
  "A foreign or ambiguous listener on the Desktop control-plane port must not be killed or adopted. Close the conflicting process from a reviewed recovery path, then reopen Desktop.";

export const PROBE_RECOVERY =
  "Require exact GET /health, exact server/discover, and the Desktop lifecycle tool identity before claiming ownership. Name, version, or port alone are insufficient.";
