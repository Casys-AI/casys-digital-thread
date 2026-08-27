/**
 * Desktop Lot 2 Lane A — packaged control-plane helper host lifecycle.
 *
 * Integration seams (bootstrap / Lane B / renderer; do not wire from this
 * module):
 *
 * - Bootstrap constructs `ControlPlaneHost` with the absolute nested-signed helper
 *   path and the validated cwd/profile/relative-workspace tuple from layout.
 * - Lane B helper must implement `start` / `inspect`, the exact marker, lock,
 *   bounded stdout handshake, stdin EOF lifeline, `createConsoleServer`,
 *   GET /health, server/discover, and `desktop_control_plane_lifecycle`.
 * - Application code consumes `ControlPlaneHostResult.projection`. It must not
 *   receive pid, launch id, endpoint, path, command line, or secrets.
 * - Stop is exclusively `OwnedSidecarHandle.closeStdin` / `kill` for the child
 *   this host spawned. There is no stop-by-pid API.
 */

export {
  type ConfigurationMaterialization,
  CONSOLE_SNAPSHOT_TOOL_NAME,
  CONTROL_PLANE_COMPONENT_IDS,
  CONTROL_PLANE_HANDSHAKE_SCHEMA,
  CONTROL_PLANE_HEALTH_URL,
  CONTROL_PLANE_INSPECT_SCHEMA,
  CONTROL_PLANE_LAYOUTS,
  CONTROL_PLANE_LIFECYCLE_SCHEMA,
  CONTROL_PLANE_LOOPBACK_HOST,
  CONTROL_PLANE_MARKER_SCHEMA,
  CONTROL_PLANE_MCP_URL,
  CONTROL_PLANE_PORT,
  CONTROL_PLANE_PRODUCT_IDENTIFIER,
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_NAME,
  CONTROL_PLANE_SERVER_VERSION,
  type ControlPlaneHandshake,
  type ControlPlaneHealthDocument,
  type ControlPlaneHostResult,
  type ControlPlaneInspectDocument,
  type ControlPlaneLayoutProfile,
  type ControlPlaneLifecycleIdentity,
  type ControlPlaneMarker,
  type ControlPlaneOwnership,
  type ControlPlaneRendererObservation,
  DESKTOP_LIFECYCLE_TOOL_NAME,
  type DesktopPlatform,
  type ExpectedControlPlaneIdentity,
  type ExpectedLiveControlPlaneIdentity,
  HANDSHAKE_MAX_BYTES,
  HELPER_INSPECT_MODE,
  HELPER_START_MODE,
  type HelperMode,
  type InspectLockState,
  MCP_PROTOCOL_VERSION,
  type OwnedSidecarHandle,
  type OwnershipKind,
  type PackagedHelperCommand,
  type ProviderSnapshotObservation,
} from "./contracts.ts";
export { constructHelperCommand } from "./command.ts";
export { classifyControlPlaneAggregate, classifyOwnership } from "./classify.ts";
export { ControlPlaneHost } from "./host.ts";
export {
  buildRendererObservation,
  sanitizeObservation,
  sanitizeText,
  toDesktopControlPlaneProjection,
} from "./observations.ts";
export {
  parseHandshake,
  parseHandshakeText,
  parseHealthDocument,
  parseInspect,
  parseInspectText,
  parseLifecycleIdentity,
  parseMarker,
  readBoundedHandshakeText,
} from "./parse.ts";
export type { ControlPlaneHostOptions, ControlPlaneHostPorts } from "./ports.ts";
export {
  isListenerAbsent,
  parseProviderSnapshot,
  probeConsoleSnapshot,
  probeControlPlaneLifecycle,
} from "./probes.ts";
export {
  createDenoControlPlanePorts,
  type PackagedHelperSpawnImpl,
  revalidatePackagedHelperCommand,
  type SpawnableChild,
  spawnPackagedHelper,
  wrapOwnedSidecarHandle,
} from "./spawn.ts";
