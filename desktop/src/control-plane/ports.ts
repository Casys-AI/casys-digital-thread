import type {
  ControlPlaneLayoutProfile,
  DesktopPlatform,
  ExpectedControlPlaneIdentity,
  OwnedSidecarHandle,
  PackagedHelperCommand,
} from "./contracts.ts";

export interface ControlPlaneHostPorts {
  readonly fetch: typeof fetch;
  /**
   * Spawn the already-validated packaged helper. Production uses
   * `spawnPackagedHelper`. Tests inject a fake child. This port must never
   * receive a general Deno CLI command.
   */
  readonly spawn: (command: PackagedHelperCommand) => OwnedSidecarHandle;
  /** Short-lived inspect process stdout. Must not start a second server. */
  readonly runInspect: (command: PackagedHelperCommand) => Promise<string>;
  readonly createLaunchId: () => string;
}

export interface ControlPlaneHostOptions {
  readonly helperPath: string;
  readonly cwd: string;
  readonly platform: DesktopPlatform;
  readonly layoutProfile: ControlPlaneLayoutProfile;
  readonly relativeWorkspace: string;
  readonly expected: ExpectedControlPlaneIdentity;
  readonly ports: ControlPlaneHostPorts;
  readonly handshakeTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly raceRecoveryTimeoutMs?: number;
}
