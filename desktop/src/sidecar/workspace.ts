import {
  CLOSED_WORKSPACE_DIR,
  closedWorkspaceRoot,
  CONFIG_DIGEST_PATTERN,
  CONTROL_PLANE_RELATIVE_WORKSPACES,
  type ControlPlaneLayoutProfile,
  DESKTOP_RUNTIME_RELATIVE_PATH,
  FIXTURE_RELATIVE_PATH,
  FLEET_RELATIVE_PATH,
  joinWorkspace,
  PRODUCT_VERSION,
  RUNTIME_SCHEMA,
  SERVER_VERSION,
  SidecarFailure,
} from "./contracts.ts";
import { configDigestForAssets, sha256HexText } from "./digest.ts";
import { exactRecord, parseJsonObject } from "./json.ts";

export interface PackagedAssets {
  readonly fleetText: string;
  readonly fixtureText: string;
}

export interface MaterializedWorkspace {
  readonly launchCwd: string;
  readonly workspaceRoot: string;
  readonly configDigest: string;
}

export type ClosedWorkspacePathState = "safe" | "missing" | "unsafe";

const REQUIRED_DIRECTORIES = [
  "config",
  "config/projects",
  "config/projects/baselines",
  "state",
  "state/fixtures",
  "state/fixtures/runs",
  "state/local",
  "runtime",
  "secrets",
] as const;

export async function materializeClosedWorkspace(
  launchCwd: string,
  layoutProfile: ControlPlaneLayoutProfile,
  assets: PackagedAssets,
): Promise<MaterializedWorkspace> {
  const workspaceRoot = await prepareClosedWorkspaceRoot(
    launchCwd,
    layoutProfile,
  );
  for (const directory of REQUIRED_DIRECTORIES) {
    await ensureClosedWorkspaceDirectory(workspaceRoot, directory);
  }

  const configDigest = await configDigestForAssets(
    assets.fleetText,
    assets.fixtureText,
  );
  await materializeExactFile(
    joinWorkspace(workspaceRoot, FLEET_RELATIVE_PATH),
    assets.fleetText,
    "fleet",
  );
  await materializeExactFile(
    joinWorkspace(workspaceRoot, FIXTURE_RELATIVE_PATH),
    assets.fixtureText,
    "fixture",
  );
  await materializeExactFile(
    joinWorkspace(workspaceRoot, DESKTOP_RUNTIME_RELATIVE_PATH),
    serializeDesktopRuntime(configDigest),
    "Desktop runtime receipt",
  );

  return { launchCwd, workspaceRoot, configDigest };
}

/**
 * Deno's lexical path allowlist follows symlinks. Verify the physical path
 * before any configuration, key, marker, or lock bytes are created.
 */
export async function inspectClosedWorkspacePath(
  launchCwd: string,
  layoutProfile: ControlPlaneLayoutProfile,
): Promise<ClosedWorkspacePathState> {
  return await inspectDirectoryChain(
    launchCwd,
    splitRelativePath(CONTROL_PLANE_RELATIVE_WORKSPACES[layoutProfile]),
  );
}

export async function prepareClosedWorkspaceRoot(
  launchCwd: string,
  layoutProfile: ControlPlaneLayoutProfile,
): Promise<string> {
  const expectedWorkspaceRoot = closedWorkspaceRoot(launchCwd, layoutProfile);
  let current = launchCwd;
  for (
    const segment of splitRelativePath(
      CONTROL_PLANE_RELATIVE_WORKSPACES[layoutProfile],
    )
  ) {
    current = joinWorkspace(current, segment);
    await ensureExactDirectory(current);
  }
  if (current !== expectedWorkspaceRoot) {
    throw new SidecarFailure(
      "workspace.root-invalid",
      "The prepared workspace does not match the closed layout profile.",
    );
  }
  return expectedWorkspaceRoot;
}

/**
 * Create and verify every missing segment beneath an already validated closed
 * workspace. Recursive mkdir is deliberately forbidden: it can follow a
 * symlinked ancestor before the completed path is inspected.
 */
export async function ensureClosedWorkspaceDirectory(
  workspaceRoot: string,
  relativeDirectory: string,
): Promise<string> {
  if (await inspectDirectoryPath(workspaceRoot) !== "safe") {
    throw unsafeWorkspacePath();
  }
  let current = workspaceRoot;
  for (const segment of splitRelativePath(relativeDirectory)) {
    current = joinWorkspace(current, segment);
    await ensureExactDirectory(current);
  }
  return current;
}

/** Read-only validation for a directory chain inside the closed workspace. */
export async function inspectClosedWorkspaceDirectory(
  workspaceRoot: string,
  relativeDirectory: string,
): Promise<ClosedWorkspacePathState> {
  const rootState = await inspectDirectoryPath(workspaceRoot);
  if (rootState !== "safe") return rootState;
  return await inspectDirectoryChain(
    workspaceRoot,
    splitRelativePath(relativeDirectory),
  );
}

/**
 * Validate every entry that already exists below the closed workspace without
 * following links. This is a launch-time boundary, not a substitute for
 * dirfd/openat-style protection against a same-user mutation after the audit.
 */
export async function auditClosedWorkspaceTree(
  workspaceRoot: string,
): Promise<void> {
  if (await inspectDirectoryPath(workspaceRoot) !== "safe") {
    throw unsafeWorkspaceTree();
  }

  const pending = [workspaceRoot];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    await assertExactTreeEntry(directory, "directory");
    try {
      for await (const entry of Deno.readDir(directory)) {
        if (entry.name.length === 0 || entry.name === "." || entry.name === "..") {
          throw unsafeWorkspaceTree();
        }
        const path = joinWorkspace(directory, entry.name);
        const stat = await Deno.lstat(path);
        if (stat.isSymlink) throw unsafeWorkspaceTree();
        if (stat.isDirectory) {
          await assertExactTreeEntry(path, "directory", stat);
          pending.push(path);
          continue;
        }
        if (stat.isFile) {
          await assertExactTreeEntry(path, "file", stat);
          if (stat.nlink !== null && stat.nlink !== 1) {
            throw unsafeWorkspaceTree();
          }
          continue;
        }
        throw unsafeWorkspaceTree();
      }
    } catch (error) {
      if (error instanceof SidecarFailure) throw error;
      throw unsafeWorkspaceTree();
    }
  }
}

export async function inspectMaterializedConfiguration(
  workspaceRoot: string,
  assets: PackagedAssets,
  expectedConfigDigest: string,
): Promise<"verified" | "missing" | "mismatch" | "error"> {
  const fleet = await readOptionalWorkspaceText(
    workspaceRoot,
    FLEET_RELATIVE_PATH,
  );
  const fixture = await readOptionalWorkspaceText(
    workspaceRoot,
    FIXTURE_RELATIVE_PATH,
  );
  const runtime = await readOptionalWorkspaceText(
    workspaceRoot,
    DESKTOP_RUNTIME_RELATIVE_PATH,
  );
  if (fleet === null || fixture === null || runtime === null) return "missing";
  if (fleet instanceof Error || fixture instanceof Error || runtime instanceof Error) {
    return "error";
  }

  const materializedDigest = await configDigestForAssets(fleet, fixture);
  if (materializedDigest !== expectedConfigDigest) return "mismatch";
  if (fleet !== assets.fleetText || fixture !== assets.fixtureText) return "mismatch";

  const expectedRuntime = serializeDesktopRuntime(expectedConfigDigest);
  if (runtime === expectedRuntime) return "verified";
  try {
    parseDesktopRuntime(runtime);
  } catch {
    return "error";
  }
  return "mismatch";
}

export function enterClosedWorkspace(workspaceRoot: string): void {
  if (
    !workspaceRoot.endsWith(`/${CLOSED_WORKSPACE_DIR}`) &&
    !workspaceRoot.endsWith(`\\${CLOSED_WORKSPACE_DIR}`)
  ) {
    throw new SidecarFailure(
      "workspace.root-invalid",
      "The helper only enters the closed control-plane workspace.",
    );
  }
  Deno.chdir(workspaceRoot);
}

async function materializeExactFile(
  path: string,
  expectedText: string,
  label: string,
): Promise<void> {
  const parent = parentPath(path);
  await assertExactRealPath(parent);
  let existing: string | undefined;
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink) {
      throw new SidecarFailure(
        "workspace.asset-unsafe",
        `Existing ${label} path is not a regular non-symlink file.`,
      );
    }
    await assertExactRealPath(path);
    existing = await Deno.readTextFile(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  if (existing === undefined) {
    await writeExactNewFile(path, expectedText, label);
    return;
  }

  const actual = await sha256HexText(existing);
  const expected = await sha256HexText(expectedText);
  if (actual !== expected) {
    throw new SidecarFailure(
      "workspace.asset-mismatch",
      `Existing ${label} bytes do not match the packaged digest and were not replaced.`,
    );
  }
}

function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index <= 0) {
    throw new SidecarFailure(
      "workspace.asset-path-invalid",
      "A materialized asset must be below the closed workspace.",
    );
  }
  return path.slice(0, index);
}

async function writeExactNewFile(
  path: string,
  text: string,
  label: string,
): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temporary, text, { createNew: true });
  try {
    await Deno.link(temporary, path);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new SidecarFailure(
        "workspace.asset-race",
        `The ${label} path appeared during materialization and was not overwritten.`,
      );
    }
    throw error;
  } finally {
    try {
      await Deno.remove(temporary);
    } catch {
      // The published target or primary failure remains authoritative.
    }
  }
}

async function assertExactRealPath(path: string): Promise<void> {
  const physical = await Deno.realPath(path);
  if (!samePhysicalPath(physical, path)) {
    throw new SidecarFailure(
      "workspace.path-unsafe",
      "The closed workspace resolves through a symlink.",
    );
  }
}

async function assertExactTreeEntry(
  path: string,
  kind: "directory" | "file",
  observed?: Deno.FileInfo,
): Promise<void> {
  try {
    const stat = observed ?? await Deno.lstat(path);
    if (
      stat.isSymlink ||
      (kind === "directory" ? !stat.isDirectory : !stat.isFile) ||
      !samePhysicalPath(await Deno.realPath(path), path)
    ) {
      throw unsafeWorkspaceTree();
    }
  } catch (error) {
    if (error instanceof SidecarFailure) throw error;
    throw unsafeWorkspaceTree();
  }
}

async function ensureExactDirectory(path: string): Promise<void> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    try {
      await Deno.mkdir(path);
    } catch (mkdirError) {
      if (!(mkdirError instanceof Deno.errors.AlreadyExists)) throw mkdirError;
    }
    stat = await Deno.lstat(path);
  }
  if (!stat.isDirectory || stat.isSymlink) {
    throw unsafeWorkspacePath();
  }
  await assertExactRealPath(path);
}

async function inspectDirectoryChain(
  base: string,
  segments: readonly string[],
): Promise<ClosedWorkspacePathState> {
  let current = base;
  for (const segment of segments) {
    current = joinWorkspace(current, segment);
    const state = await inspectDirectoryPath(current);
    if (state !== "safe") return state;
  }
  return "safe";
}

async function inspectDirectoryPath(
  path: string,
): Promise<ClosedWorkspacePathState> {
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isDirectory || stat.isSymlink) return "unsafe";
    return samePhysicalPath(await Deno.realPath(path), path) ? "safe" : "unsafe";
  } catch (error) {
    return error instanceof Deno.errors.NotFound ? "missing" : "unsafe";
  }
}

function splitRelativePath(path: string): readonly string[] {
  const segments = path.split(/[\\/]+/);
  if (
    segments.length === 0 ||
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new SidecarFailure(
      "workspace.relative-path-invalid",
      "The closed workspace profile must contain only named relative segments.",
    );
  }
  return segments;
}

function unsafeWorkspacePath(): SidecarFailure {
  return new SidecarFailure(
    "workspace.path-unsafe",
    "The closed workspace resolves through a symlink or an unreadable path.",
  );
}

function unsafeWorkspaceTree(): SidecarFailure {
  return new SidecarFailure(
    "workspace.tree-unsafe",
    "The closed workspace contains a symlink, hard link, special entry, unreadable entry, or path that changed during launch audit.",
  );
}

function samePhysicalPath(left: string, right: string): boolean {
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalize(left) === normalize(right);
}

export function serializeDesktopRuntime(
  configDigest: string,
): string {
  return `${
    JSON.stringify({
      schema: RUNTIME_SCHEMA,
      productVersion: PRODUCT_VERSION,
      serverVersion: SERVER_VERSION,
      configDigest,
      yolo: false,
      localExecution: false,
      compose: "unavailable",
    })
  }\n`;
}

export function parseDesktopRuntime(text: string): {
  readonly configDigest: string;
} {
  const record = exactRecord(
    parseJsonObject(text, "Desktop runtime receipt", "workspace.runtime-corrupt"),
    [
      "schema",
      "productVersion",
      "serverVersion",
      "configDigest",
      "yolo",
      "localExecution",
      "compose",
    ],
    "Desktop runtime receipt",
    "workspace.runtime-corrupt",
  );
  if (
    record.schema !== RUNTIME_SCHEMA ||
    typeof record.productVersion !== "string" ||
    typeof record.serverVersion !== "string" ||
    typeof record.configDigest !== "string" ||
    !CONFIG_DIGEST_PATTERN.test(record.configDigest) ||
    record.yolo !== false ||
    record.localExecution !== false ||
    record.compose !== "unavailable"
  ) {
    throw new SidecarFailure(
      "workspace.runtime-corrupt",
      "The Desktop runtime receipt is not the exact closed schema.",
    );
  }
  return { configDigest: record.configDigest };
}

async function readOptionalWorkspaceText(
  workspaceRoot: string,
  relativePath: string,
): Promise<string | null | Error> {
  if (await inspectDirectoryPath(workspaceRoot) !== "safe") {
    return new Error("unsafe materialized path");
  }
  const segments = splitRelativePath(relativePath);
  const filename = segments.at(-1)!;
  const parentSegments = segments.slice(0, -1);
  const parentState = await inspectDirectoryChain(workspaceRoot, parentSegments);
  if (parentState === "missing") return null;
  if (parentState === "unsafe") return new Error("unsafe materialized path");
  const parent = parentSegments.reduce(
    (path, segment) => joinWorkspace(path, segment),
    workspaceRoot,
  );
  const path = joinWorkspace(parent, filename);
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink) {
      return new Error("unsafe materialized path");
    }
    if (!samePhysicalPath(await Deno.realPath(path), path)) {
      return new Error("unsafe materialized path");
    }
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    return error instanceof Error ? error : new Error(String(error));
  }
}
