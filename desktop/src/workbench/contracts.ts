import type { OwnedSidecarHandle } from "../control-plane/contracts.ts";
import type { DesktopWorkbenchProjection } from "../contracts/diagnostics.ts";

export const WORKBENCH_HELPER_NAME = "casys-workbench";
export const WORKBENCH_VERSION = "0.3.0";
export const WORKBENCH_HOSTNAME = "127.0.0.1";
export const WORKBENCH_PORT = 5176;
export const WORKBENCH_ORIGIN = `http://${WORKBENCH_HOSTNAME}:${WORKBENCH_PORT}`;
export const WORKBENCH_WORKSPACE_ID = "primary";

export const WORKBENCH_MARKER_SCHEMA = "casys-desktop-workbench-marker/1.0";
export const WORKBENCH_INSPECT_SCHEMA = "casys-desktop-workbench-inspect/1.0";
export const WORKBENCH_HANDSHAKE_SCHEMA = "casys-desktop-workbench-handshake/1.0";
export const WORKBENCH_HEALTH_SCHEMA = "casys-desktop-workbench-health/1.0";

export const WORKBENCH_RUNTIME_RELATIVE_ROOT =
  "ai.casys.digital-thread/workbench-runtime";
export const WORKBENCH_CONTROL_PLANE_RELATIVE_ROOT =
  "ai.casys.digital-thread/control-plane";
export const WORKBENCH_MARKER_RELATIVE_PATH = "owner.json";
export const WORKBENCH_TOKEN_RELATIVE_PATH = "access-token";
export const WORKBENCH_LOCK_RELATIVE_PATH = "workbench.lock";

export const WORKBENCH_ACCESS_HEADER = "x-casys-workbench-session";
export const WORKBENCH_ACCESS_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const CONFIG_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const LAUNCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface WorkbenchMarker {
  readonly schema: typeof WORKBENCH_MARKER_SCHEMA;
  readonly version: typeof WORKBENCH_VERSION;
  readonly launchId: string;
  readonly pid: number;
  readonly configDigest: string;
  readonly tokenDigest: string;
  readonly startedAt: string;
}

export interface WorkbenchInspectDocument {
  readonly schema: typeof WORKBENCH_INSPECT_SCHEMA;
  readonly version: typeof WORKBENCH_VERSION;
  readonly configuration: "verified" | "unavailable" | "error";
  readonly configDigest?: string;
  readonly lock: "held" | "free" | "unavailable";
  readonly marker: WorkbenchMarker | null;
  /** Host-only session capability; it is never copied into renderer DTOs. */
  readonly accessToken?: string;
}

export interface WorkbenchHandshake {
  readonly schema: typeof WORKBENCH_HANDSHAKE_SCHEMA;
  readonly status: "ready";
  readonly version: typeof WORKBENCH_VERSION;
  readonly launchId: string;
  readonly configDigest: string;
  /** Host-only session capability; it is never copied into renderer DTOs. */
  readonly accessToken: string;
}

export interface WorkbenchHealthDocument {
  readonly schema: typeof WORKBENCH_HEALTH_SCHEMA;
  readonly status: "ok";
  readonly version: typeof WORKBENCH_VERSION;
  readonly launchId: string;
  readonly configDigest: string;
  readonly workspaceId: typeof WORKBENCH_WORKSPACE_ID;
}

export interface WorkbenchSession {
  readonly origin: typeof WORKBENCH_ORIGIN;
  readonly accessToken: string;
}

export interface WorkbenchHostResult {
  readonly projection: DesktopWorkbenchProjection;
  /** Privileged host seam only. Never put this object in a renderer model. */
  readonly session?: WorkbenchSession;
}

export type WorkbenchOwnedHandle = OwnedSidecarHandle;

export type { DesktopWorkbenchProjection };
