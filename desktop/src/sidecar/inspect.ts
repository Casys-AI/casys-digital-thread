import {
  closedWorkspaceRoot,
  type ControlPlaneInspectDocument,
  type ControlPlaneLayoutProfile,
  INSPECT_SCHEMA,
  type InspectLockState,
  type LaunchMarker,
  PRODUCT_VERSION,
  SERVER_VERSION,
} from "./contracts.ts";
import { configDigestForAssets } from "./digest.ts";
import { inspectWorkspaceLock } from "./lock.ts";
import { parseLaunchMarker, workspaceMarkerPath } from "./marker.ts";
import {
  inspectClosedWorkspaceDirectory,
  inspectClosedWorkspacePath,
  inspectMaterializedConfiguration,
  type PackagedAssets,
} from "./workspace.ts";

export async function inspectControlPlane(input: {
  readonly launchCwd: string;
  readonly layoutProfile: ControlPlaneLayoutProfile;
  readonly assets: PackagedAssets;
  readonly stdout: (line: string) => void;
}): Promise<ControlPlaneInspectDocument> {
  const expectedConfigDigest = await configDigestForAssets(
    input.assets.fleetText,
    input.assets.fixtureText,
  );

  let document: ControlPlaneInspectDocument;
  try {
    const workspaceRoot = closedWorkspaceRoot(
      input.launchCwd,
      input.layoutProfile,
    );
    const pathState = await inspectClosedWorkspacePath(
      input.launchCwd,
      input.layoutProfile,
    );
    if (pathState !== "safe") {
      document = {
        schema: INSPECT_SCHEMA,
        productVersion: PRODUCT_VERSION,
        serverVersion: SERVER_VERSION,
        expectedConfigDigest,
        configuration: pathState === "missing" ? "missing" : "error",
        marker: null,
        lock: pathState === "missing" ? "free" : "unavailable",
      };
      input.stdout(serializeControlPlaneInspect(document));
      return document;
    }
    const runtimeState = await inspectClosedWorkspaceDirectory(
      workspaceRoot,
      "runtime",
    );
    const [configuration, markerObservation, observedLock] = await Promise.all([
      inspectMaterializedConfiguration(
        workspaceRoot,
        input.assets,
        expectedConfigDigest,
      ),
      runtimeState === "safe"
        ? readMarker(workspaceMarkerPath(workspaceRoot))
        : Promise.resolve({ marker: null, corrupt: runtimeState === "unsafe" }),
      runtimeState === "safe"
        ? inspectWorkspaceLock(workspaceRoot)
        : Promise.resolve<InspectLockState>(
          runtimeState === "missing" ? "free" : "unavailable",
        ),
    ]);
    document = {
      schema: INSPECT_SCHEMA,
      productVersion: PRODUCT_VERSION,
      serverVersion: SERVER_VERSION,
      expectedConfigDigest,
      configuration,
      marker: markerObservation.marker,
      lock: markerObservation.corrupt ? "unavailable" : observedLock,
    };
  } catch {
    document = {
      schema: INSPECT_SCHEMA,
      productVersion: PRODUCT_VERSION,
      serverVersion: SERVER_VERSION,
      expectedConfigDigest,
      configuration: "error",
      marker: null,
      lock: "unavailable",
    };
  }

  input.stdout(serializeControlPlaneInspect(document));
  return document;
}

export function serializeControlPlaneInspect(
  document: ControlPlaneInspectDocument,
): string {
  return `${
    JSON.stringify({
      schema: document.schema,
      productVersion: document.productVersion,
      serverVersion: document.serverVersion,
      expectedConfigDigest: document.expectedConfigDigest,
      configuration: document.configuration,
      marker: document.marker,
      lock: document.lock,
    })
  }\n`;
}

async function readMarker(
  path: string,
): Promise<{ readonly marker: LaunchMarker | null; readonly corrupt: boolean }> {
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink) {
      return { marker: null, corrupt: true };
    }
    return {
      marker: parseLaunchMarker(await Deno.readTextFile(path)),
      corrupt: false,
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { marker: null, corrupt: false };
    }
    return { marker: null, corrupt: true };
  }
}
