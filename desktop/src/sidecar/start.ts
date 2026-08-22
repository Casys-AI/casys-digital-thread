import {
  CONTROL_PLANE_ENDPOINT,
  type ControlPlaneLayoutProfile,
  type LaunchMarker,
  MARKER_SCHEMA,
  PRODUCT_VERSION,
  SERVER_VERSION,
} from "./contracts.ts";
import { createHandshake, serializeHandshake } from "./handshake.ts";
import { createLifecycleIdentity } from "./lifecycle-tool.ts";
import {
  type LifelineRuntime,
  type LifelineSignal,
  waitForLifeline,
} from "./lifeline.ts";
import { acquireWorkspaceLock, type WorkspaceLock } from "./lock.ts";
import {
  assertMarkerAbsent,
  compareAndDeleteMarker,
  workspaceMarkerPath,
  writeLaunchMarker,
} from "./marker.ts";
import { persistMrtrSigningKey } from "./mrtr-key.ts";
import { assertControlPlaneReady, type ReadinessFetch } from "./readiness.ts";
import {
  auditClosedWorkspaceTree,
  enterClosedWorkspace,
  materializeClosedWorkspace,
  type PackagedAssets,
  prepareClosedWorkspaceRoot,
} from "./workspace.ts";

export interface PreparedSidecarServer {
  readonly launchId: string;
  readonly configDigest: string;
  readonly mrtrSigningKey: string;
  readonly fleetText: string;
  readonly fixtureText: string;
  readonly identity: ReturnType<typeof createLifecycleIdentity>;
}

export interface StartedSidecarHttp {
  shutdown(): Promise<void>;
}

export interface SidecarServerFactory {
  (prepared: PreparedSidecarServer): Promise<StartedSidecarHttp>;
}

export interface StartControlPlaneInput {
  readonly launchId: string;
  readonly launchCwd: string;
  readonly layoutProfile: ControlPlaneLayoutProfile;
  readonly pid: number;
  readonly now: () => Date;
  readonly assets: PackagedAssets;
  readonly createServer: SidecarServerFactory;
  readonly lifeline: LifelineRuntime;
  readonly fetchImpl?: ReadinessFetch;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly chdir?: (workspaceRoot: string) => void;
}

export async function startControlPlane(
  input: StartControlPlaneInput,
): Promise<LifelineSignal> {
  const workspaceRoot = await prepareClosedWorkspaceRoot(
    input.launchCwd,
    input.layoutProfile,
  );
  const lock = await acquireWorkspaceLock(workspaceRoot);
  const chdir = input.chdir ?? enterClosedWorkspace;

  let http: StartedSidecarHttp | undefined;
  let markerWritten = false;
  try {
    await auditClosedWorkspaceTree(workspaceRoot);
    await assertMarkerAbsent(workspaceMarkerPath(workspaceRoot));
    const materialized = await materializeClosedWorkspace(
      input.launchCwd,
      input.layoutProfile,
      input.assets,
    );
    const mrtrSigningKey = await persistMrtrSigningKey(workspaceRoot);
    await auditClosedWorkspaceTree(workspaceRoot);
    const identity = createLifecycleIdentity(
      input.launchId,
      materialized.configDigest,
    );
    chdir(materialized.workspaceRoot);
    http = await input.createServer({
      launchId: input.launchId,
      configDigest: materialized.configDigest,
      mrtrSigningKey,
      fleetText: input.assets.fleetText,
      fixtureText: input.assets.fixtureText,
      identity,
    });
    await assertControlPlaneReady(identity, input.fetchImpl);
    const marker = createOwnedMarker(
      input.launchId,
      materialized.configDigest,
      input.pid,
      input.now(),
    );
    await writeLaunchMarker(workspaceMarkerPath(materialized.workspaceRoot), marker);
    markerWritten = true;
    input.stdout(serializeHandshake(createHandshake(
      input.launchId,
      materialized.configDigest,
    )));
    return await waitForLifeline(input.lifeline);
  } finally {
    await shutdownOwned(
      http,
      lock,
      workspaceRoot,
      input.launchId,
      markerWritten,
    );
  }
}

function createOwnedMarker(
  launchId: string,
  configDigest: string,
  pid: number,
  startedAt: Date,
): LaunchMarker {
  return {
    schema: MARKER_SCHEMA,
    productVersion: PRODUCT_VERSION,
    serverVersion: SERVER_VERSION,
    launchId,
    pid,
    endpoint: CONTROL_PLANE_ENDPOINT,
    configDigest,
    startedAt: startedAt.toISOString(),
  };
}

async function shutdownOwned(
  http: StartedSidecarHttp | undefined,
  lock: WorkspaceLock,
  workspaceRoot: string,
  launchId: string,
  markerWritten: boolean,
): Promise<void> {
  let failure: unknown;
  try {
    if (http !== undefined) {
      await http.shutdown();
    }
  } catch (error) {
    failure = error;
  }
  try {
    if (markerWritten) {
      await compareAndDeleteMarker(workspaceMarkerPath(workspaceRoot), launchId);
    }
  } catch (error) {
    failure ??= error;
  }
  try {
    await lock.release();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) {
    throw failure;
  }
}
