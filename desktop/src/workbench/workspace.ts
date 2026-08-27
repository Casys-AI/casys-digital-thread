import { parseDesktopRuntime } from "../sidecar/workspace.ts";
import {
  closedWorkspaceRoot,
  CONTROL_PLANE_RELATIVE_WORKSPACES,
  type ControlPlaneLayoutProfile,
  joinWorkspace,
} from "../sidecar/contracts.ts";
import {
  CONFIG_DIGEST_PATTERN,
  WORKBENCH_LOCK_RELATIVE_PATH,
  WORKBENCH_MARKER_RELATIVE_PATH,
  WORKBENCH_TOKEN_RELATIVE_PATH,
} from "./contracts.ts";

export interface WorkbenchRuntimePaths {
  readonly controlPlaneRoot: string;
  readonly runtimeRoot: string;
  readonly markerPath: string;
  readonly tokenPath: string;
  readonly lockPath: string;
}

export function workbenchRuntimePaths(
  launchCwd: string,
  layoutProfile: ControlPlaneLayoutProfile,
): WorkbenchRuntimePaths {
  const controlPlaneRoot = closedWorkspaceRoot(launchCwd, layoutProfile);
  const productRelativeRoot = parentRelativePath(
    CONTROL_PLANE_RELATIVE_WORKSPACES[layoutProfile],
  );
  const productRoot = joinWorkspace(launchCwd, productRelativeRoot);
  const runtimeRoot = joinWorkspace(productRoot, "workbench-runtime");
  return Object.freeze({
    controlPlaneRoot,
    runtimeRoot,
    markerPath: joinWorkspace(runtimeRoot, WORKBENCH_MARKER_RELATIVE_PATH),
    tokenPath: joinWorkspace(runtimeRoot, WORKBENCH_TOKEN_RELATIVE_PATH),
    lockPath: joinWorkspace(runtimeRoot, WORKBENCH_LOCK_RELATIVE_PATH),
  });
}

export async function readWorkbenchConfigurationDigest(
  paths: WorkbenchRuntimePaths,
): Promise<string | undefined> {
  await assertExactDirectory(paths.controlPlaneRoot);
  const runtimePath = joinWorkspace(
    paths.controlPlaneRoot,
    "config/desktop-runtime.json",
  );
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

function parentRelativePath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index <= 0 || path.slice(index + 1) !== "control-plane") {
    throw new TypeError("Workbench requires the registered control-plane workspace.");
  }
  return path.slice(0, index);
}

function normalize(path: string): string {
  const normalized = path.replace(/[\\/]+$/u, "").replace(/\\/gu, "/");
  return /^[A-Za-z]:\//u.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}
