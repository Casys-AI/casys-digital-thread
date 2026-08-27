import {
  CONFIG_DIGEST_PATTERN,
  LAUNCH_ID_PATTERN,
  WORKBENCH_ACCESS_TOKEN_PATTERN,
  WORKBENCH_INSPECT_SCHEMA,
  WORKBENCH_MARKER_SCHEMA,
  WORKBENCH_VERSION,
  type WorkbenchInspectDocument,
  type WorkbenchMarker,
} from "./contracts.ts";
import { assertExactFile, type WorkbenchRuntimePaths } from "./workspace.ts";

export interface WorkbenchRuntimeLock {
  release(): Promise<void>;
}

export async function inspectWorkbenchRuntime(
  paths: WorkbenchRuntimePaths,
  configDigest: string | undefined,
): Promise<WorkbenchInspectDocument> {
  const lock = await inspectLock(paths.lockPath);
  let marker: WorkbenchMarker | null = null;
  let accessToken: string | undefined;
  try {
    marker = parseWorkbenchMarker(await Deno.readTextFile(paths.markerPath));
    await assertExactFile(paths.markerPath);
    accessToken = (await Deno.readTextFile(paths.tokenPath)).trim();
    await assertExactFile(paths.tokenPath);
    if (!WORKBENCH_ACCESS_TOKEN_PATTERN.test(accessToken)) {
      throw new Error("Workbench access token is invalid.");
    }
    if (await sha256Fingerprint(accessToken) !== marker.tokenDigest) {
      throw new Error("Workbench access token does not match its marker.");
    }
    if (configDigest !== undefined && marker.configDigest !== configDigest) {
      throw new Error("Workbench marker configuration digest is stale.");
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    if (await pathExists(paths.markerPath) || await pathExists(paths.tokenPath)) {
      throw new Error("Workbench lifecycle marker and token are incomplete.");
    }
  }

  return Object.freeze({
    schema: WORKBENCH_INSPECT_SCHEMA,
    version: WORKBENCH_VERSION,
    configuration: configDigest === undefined ? "unavailable" : "verified",
    ...(configDigest === undefined ? {} : { configDigest }),
    lock,
    marker,
    ...(accessToken === undefined ? {} : { accessToken }),
  });
}

export async function acquireWorkbenchRuntimeLock(
  path: string,
): Promise<WorkbenchRuntimeLock> {
  await rejectUnsafeExisting(path);
  const file = await Deno.open(path, {
    read: true,
    write: true,
    create: true,
    mode: 0o600,
  });
  const acquired = await file.tryLock(true);
  if (!acquired) {
    file.close();
    throw new Error("Another Workbench helper holds the lifecycle lock.");
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await file.unlock();
      } finally {
        file.close();
      }
    },
  };
}

export function createAccessToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function publishWorkbenchRuntime(
  paths: WorkbenchRuntimePaths,
  marker: Omit<WorkbenchMarker, "tokenDigest">,
  accessToken: string,
): Promise<WorkbenchMarker> {
  if (!WORKBENCH_ACCESS_TOKEN_PATTERN.test(accessToken)) {
    throw new Error("Workbench access token is invalid.");
  }
  if (await pathExists(paths.markerPath) || await pathExists(paths.tokenPath)) {
    throw new Error("Workbench lifecycle state already exists.");
  }
  const complete: WorkbenchMarker = Object.freeze({
    ...marker,
    tokenDigest: await sha256Fingerprint(accessToken),
  });
  await writeCreateNew(paths.tokenPath, `${accessToken}\n`);
  try {
    await writeCreateNew(paths.markerPath, `${JSON.stringify(complete)}\n`);
  } catch (error) {
    await Deno.remove(paths.tokenPath).catch(() => undefined);
    throw error;
  }
  return complete;
}

export async function clearOwnedWorkbenchRuntime(
  paths: WorkbenchRuntimePaths,
  launchId: string,
): Promise<void> {
  let marker: WorkbenchMarker;
  try {
    marker = parseWorkbenchMarker(await Deno.readTextFile(paths.markerPath));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (marker.launchId !== launchId) {
    throw new Error("Workbench lifecycle marker belongs to another launch.");
  }
  await Deno.remove(paths.markerPath);
  await Deno.remove(paths.tokenPath).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
}

export function parseWorkbenchMarker(value: string): WorkbenchMarker {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new TypeError("Workbench marker must be an object.");
  exactKeys(parsed, [
    "schema",
    "version",
    "launchId",
    "pid",
    "configDigest",
    "tokenDigest",
    "startedAt",
  ]);
  if (
    parsed.schema !== WORKBENCH_MARKER_SCHEMA ||
    parsed.version !== WORKBENCH_VERSION ||
    typeof parsed.launchId !== "string" ||
    !LAUNCH_ID_PATTERN.test(parsed.launchId) ||
    !Number.isSafeInteger(parsed.pid) || (parsed.pid as number) < 1 ||
    typeof parsed.configDigest !== "string" ||
    !CONFIG_DIGEST_PATTERN.test(parsed.configDigest) ||
    typeof parsed.tokenDigest !== "string" ||
    !CONFIG_DIGEST_PATTERN.test(parsed.tokenDigest) ||
    typeof parsed.startedAt !== "string" ||
    Number.isNaN(Date.parse(parsed.startedAt))
  ) {
    throw new TypeError("Workbench marker is not the exact supported contract.");
  }
  return structuredClone(parsed as unknown as WorkbenchMarker);
}

async function inspectLock(
  path: string,
): Promise<WorkbenchInspectDocument["lock"]> {
  let file: Deno.FsFile;
  try {
    await rejectUnsafeExisting(path);
    file = await Deno.open(path, { read: true, write: true });
  } catch (error) {
    return error instanceof Deno.errors.NotFound ? "free" : "unavailable";
  }
  try {
    const acquired = await file.tryLock(true);
    if (!acquired) return "held";
    await file.unlock();
    return "free";
  } catch {
    return "unavailable";
  } finally {
    file.close();
  }
}

async function rejectUnsafeExisting(path: string): Promise<void> {
  try {
    await assertExactFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

async function writeCreateNew(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  try {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    while (offset < bytes.length) {
      offset += await file.write(bytes.subarray(offset));
    }
    await file.sync();
  } finally {
    file.close();
  }
}

async function sha256Fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError("Workbench marker contains unsupported fields.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
