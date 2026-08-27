import {
  type InspectLockState,
  joinWorkspace,
  LOCK_RELATIVE_PATH,
  SidecarFailure,
} from "./contracts.ts";
import {
  ensureClosedWorkspaceDirectory,
  inspectClosedWorkspaceDirectory,
} from "./workspace.ts";

export interface WorkspaceLock {
  readonly path: string;
  release(): Promise<void>;
}

/** Probe an existing lock without creating a file or directory. */
export async function inspectWorkspaceLock(
  workspaceRoot: string,
): Promise<InspectLockState> {
  const runtimeState = await inspectClosedWorkspaceDirectory(
    workspaceRoot,
    "runtime",
  );
  if (runtimeState === "missing") return "free";
  if (runtimeState === "unsafe") return "unavailable";
  let file: Deno.FsFile;
  try {
    const path = lockPath(workspaceRoot);
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink) return "unavailable";
    file = await Deno.open(path, {
      read: true,
      write: true,
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "free";
    return "unavailable";
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

export function lockPath(workspaceRoot: string): string {
  return joinWorkspace(workspaceRoot, LOCK_RELATIVE_PATH);
}

export async function acquireWorkspaceLock(
  workspaceRoot: string,
): Promise<WorkspaceLock> {
  const path = lockPath(workspaceRoot);
  await ensureClosedWorkspaceDirectory(workspaceRoot, "runtime");
  await rejectNonRegularExistingLock(path);
  const file = await Deno.open(path, { read: true, write: true, create: true });
  let locked = false;
  try {
    locked = await file.tryLock(true);
  } catch (error) {
    file.close();
    throw new SidecarFailure(
      "lock.unavailable",
      `The control-plane lock could not be acquired: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!locked) {
    file.close();
    throw new SidecarFailure(
      "lock.held",
      "Another control-plane owner already holds the workspace lock.",
    );
  }

  let released = false;
  return {
    path,
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

async function rejectNonRegularExistingLock(path: string): Promise<void> {
  try {
    const stat = await Deno.lstat(path);
    if (stat.isFile && !stat.isSymlink) return;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new SidecarFailure(
    "lock.path-unsafe",
    "The control-plane lock path is not a regular non-symlink file.",
  );
}
