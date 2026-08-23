import { parseDesktopRuntime } from "../sidecar/workspace.ts";
import {
  CONFIG_DIGEST_PATTERN,
  WORKBENCH_CONTROL_PLANE_RELATIVE_ROOT,
  WORKBENCH_LOCK_RELATIVE_PATH,
  WORKBENCH_MARKER_RELATIVE_PATH,
  WORKBENCH_RUNTIME_RELATIVE_ROOT,
  WORKBENCH_TOKEN_RELATIVE_PATH,
} from "./contracts.ts";

export interface WorkbenchRuntimePaths {
  readonly controlPlaneRoot: string;
  readonly runtimeRoot: string;
  readonly markerPath: string;
  readonly tokenPath: string;
  readonly lockPath: string;
}

export function workbenchRuntimePaths(launchCwd: string): WorkbenchRuntimePaths {
  assertLaunchCwd(launchCwd);
  const root = launchCwd.replace(/\/+$/, "");
  const runtimeRoot = `${root}/${WORKBENCH_RUNTIME_RELATIVE_ROOT}`;
  return Object.freeze({
    controlPlaneRoot: `${root}/${WORKBENCH_CONTROL_PLANE_RELATIVE_ROOT}`,
    runtimeRoot,
    markerPath: `${runtimeRoot}/${WORKBENCH_MARKER_RELATIVE_PATH}`,
    tokenPath: `${runtimeRoot}/${WORKBENCH_TOKEN_RELATIVE_PATH}`,
    lockPath: `${runtimeRoot}/${WORKBENCH_LOCK_RELATIVE_PATH}`,
  });
}

export async function readWorkbenchConfigurationDigest(
  paths: WorkbenchRuntimePaths,
): Promise<string | undefined> {
  await assertExactDirectory(paths.controlPlaneRoot);
  const runtimePath = `${paths.controlPlaneRoot}/config/desktop-runtime.json`;
  await assertExactFile(runtimePath);
  const { configDigest } = parseDesktopRuntime(
    await Deno.readTextFile(runtimePath),
  );
  if (!CONFIG_DIGEST_PATTERN.test(configDigest)) {
    throw new Error("Workbench configuration digest is invalid.");
  }
  return configDigest;
}

export async function prepareWorkbenchRuntime(
  paths: WorkbenchRuntimePaths,
): Promise<void> {
  try {
    await Deno.mkdir(paths.runtimeRoot);
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
  await assertExactDirectory(paths.runtimeRoot);
}

export async function assertExactDirectory(path: string): Promise<void> {
  const stat = await Deno.lstat(path);
  if (
    !stat.isDirectory || stat.isSymlink ||
    normalize(await Deno.realPath(path)) !== normalize(path)
  ) {
    throw new Error("Workbench directory is not an exact non-symlink path.");
  }
}

export async function assertExactFile(path: string): Promise<void> {
  const stat = await Deno.lstat(path);
  if (
    !stat.isFile || stat.isSymlink ||
    normalize(await Deno.realPath(path)) !== normalize(path) ||
    (stat.nlink !== null && stat.nlink !== 1)
  ) {
    throw new Error("Workbench file is not an exact regular path.");
  }
}

function assertLaunchCwd(launchCwd: string): void {
  if (
    launchCwd.trim() !== launchCwd || !launchCwd.startsWith("/") ||
    /^\/+$/u.test(launchCwd) || launchCwd.split("/").includes("..")
  ) {
    throw new TypeError(
      "Workbench launch cwd must be an absolute, non-root support directory.",
    );
  }
}

function normalize(path: string): string {
  return path.replace(/\/+$/, "");
}
