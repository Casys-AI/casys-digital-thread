/**
 * Trusted lexical storage-root resolution and component-wise lstat walks.
 *
 * Relative configured roots capture `Deno.cwd()` as the trusted lexical
 * anchor and never inspect ancestors above it. The cwd node itself is not
 * `lstat`/`realPath`'d: `start`/`start:yolo` grants
 * `--allow-read=config,state,...` cannot inspect the worktree root.
 * Inspection starts at descendants. Absolute configured roots walk from `/`.
 * This is not a generic filesystem framework.
 */

export class AnchoredLexicalPathError extends Error {
  override readonly name = "AnchoredLexicalPathError";
}

export interface TrustedAnchoredStorageRoot {
  readonly trustedAnchor: string;
  readonly storageRoot: string;
}

export interface LexicalWalkMessages {
  readonly escaped: string;
  readonly appearedBehindMissingAncestor: string;
  readonly notRealDirectory: string;
  readonly componentChanged: string;
  readonly regularFile: string;
  readonly pathChangedWhileOpen: string;
}

const FORBIDDEN_SEGMENT = /^(?:\.|\.\.)$/;

export function resolveTrustedAnchoredStorageRoot(
  configured: string,
  options: { readonly currentWorkingDirectory?: string } = {},
): TrustedAnchoredStorageRoot {
  const root = validateConfiguredStorageRoot(configured);
  if (root.startsWith("/")) {
    return { trustedAnchor: "/", storageRoot: root };
  }
  const cwd = withoutTrailingSlash(
    options.currentWorkingDirectory ?? Deno.cwd(),
  );
  if (
    cwd.length === 0 || !cwd.startsWith("/") ||
    !isSafeLexicalPath(cwd, { allowRoot: true })
  ) {
    throw new TypeError("Storage current working directory is invalid.");
  }
  return {
    trustedAnchor: cwd,
    storageRoot: cwd === "/" ? `/${root}` : `${cwd}/${root}`,
  };
}

export function isEqualOrStrictLexicalDescendant(
  root: string,
  path: string,
): boolean {
  if (!isSafeLexicalPath(root, { allowRoot: true })) return false;
  if (!isSafeLexicalPath(path, { allowRoot: true })) return false;
  const normalizedRoot = withoutTrailingSlash(root);
  const normalizedPath = withoutTrailingSlash(path);
  if (normalizedPath === normalizedRoot) return true;
  if (normalizedRoot === "/") return normalizedPath.startsWith("/");
  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function requireEqualOrStrictLexicalDescendant(
  root: string,
  path: string,
  message: string,
): void {
  if (isEqualOrStrictLexicalDescendant(root, path)) return;
  throw new AnchoredLexicalPathError(message);
}

export function requireStrictLexicalDescendant(
  root: string,
  path: string,
  message: string,
): void {
  if (
    isEqualOrStrictLexicalDescendant(root, path) &&
    withoutTrailingSlash(path) !== withoutTrailingSlash(root)
  ) {
    return;
  }
  throw new AnchoredLexicalPathError(message);
}

export function requireContainedStoragePath(
  root: TrustedAnchoredStorageRoot,
  path: string,
  escaped: string,
): void {
  requireEqualOrStrictLexicalDescendant(root.trustedAnchor, path, escaped);
  if (withoutTrailingSlash(path) === withoutTrailingSlash(root.storageRoot)) {
    return;
  }
  requireStrictLexicalDescendant(root.storageRoot, path, escaped);
}

export function parentLexicalPath(path: string): string {
  const clean = withoutTrailingSlash(path);
  const slash = clean.lastIndexOf("/");
  return slash <= 0 ? "/" : clean.slice(0, slash);
}

export function lexicalComponentsFromAnchor(
  trustedAnchor: string,
  path: string,
  escaped: string,
): string[] {
  requireEqualOrStrictLexicalDescendant(trustedAnchor, path, escaped);
  const normalizedPath = withoutTrailingSlash(path);
  if (trustedAnchor === "/") {
    const parts = normalizedPath.split("/").filter((part) => part.length > 0);
    const components: string[] = [];
    let cursor = "";
    for (const part of parts) {
      cursor = `${cursor}/${part}`;
      components.push(cursor);
    }
    return components;
  }
  const components = [trustedAnchor];
  if (normalizedPath === trustedAnchor) return components;
  const rest = normalizedPath.slice(trustedAnchor.length + 1).split("/");
  let cursor = trustedAnchor;
  for (const part of rest) {
    cursor = `${cursor}/${part}`;
    components.push(cursor);
  }
  return components;
}

/**
 * lstat every existing lexical component from the trusted anchor down.
 * A symlink is refused below the anchor. The `/var` platform prefix alias is
 * allowed only when the walk itself starts at `/`.
 */
export async function assertExistingLexicalComponents(
  trustedAnchor: string,
  path: string,
  messages: LexicalWalkMessages,
): Promise<void> {
  const components = lexicalComponentsFromAnchor(
    trustedAnchor,
    path,
    messages.escaped,
  );
  let missing = false;
  const snapshots: PathComponentSnapshot[] = [];
  for (let index = 0; index < components.length; index += 1) {
    const cursor = components[index]!;
    const last = index === components.length - 1;
    if (isUninspectedRelativeTrustedAnchor(trustedAnchor, cursor)) continue;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(cursor);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      missing = true;
      continue;
    }
    if (missing) {
      throw new AnchoredLexicalPathError(messages.appearedBehindMissingAncestor);
    }
    if (info.isSymlink) {
      if (trustedAnchor === "/" && parentLexicalPath(cursor) === "/") continue;
      if (cursor === trustedAnchor) continue;
      if (last) continue;
      throw new AnchoredLexicalPathError(messages.notRealDirectory);
    }
    if (!info.isDirectory && (!last || !info.isFile)) {
      throw new AnchoredLexicalPathError(messages.notRealDirectory);
    }
    snapshots.push({ path: cursor, info });
  }
  for (const snapshot of snapshots) {
    const again = await Deno.lstat(snapshot.path);
    if (
      again.isSymlink ||
      (snapshot.info.isDirectory && !again.isDirectory) ||
      (snapshot.info.isFile && !again.isFile) ||
      (snapshot.info.dev !== null && snapshot.info.ino !== null &&
        again.dev !== null && again.ino !== null &&
        !sameInode(snapshot.info, again))
    ) {
      throw new AnchoredLexicalPathError(messages.componentChanged);
    }
  }
}

export async function collectMissingLexicalDirectories(
  trustedAnchor: string,
  path: string,
  messages: LexicalWalkMessages,
): Promise<string[]> {
  requireEqualOrStrictLexicalDescendant(trustedAnchor, path, messages.escaped);
  const missing: string[] = [];
  let cursor = withoutTrailingSlash(path);
  while (true) {
    if (isUninspectedRelativeTrustedAnchor(trustedAnchor, cursor)) {
      return missing;
    }
    try {
      await Deno.lstat(cursor);
      requireEqualOrStrictLexicalDescendant(
        trustedAnchor,
        cursor,
        messages.escaped,
      );
      return missing;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound) && !isNotFound(error)) {
        throw error;
      }
      if (cursor === withoutTrailingSlash(trustedAnchor)) throw error;
      missing.push(cursor);
      const parent = parentLexicalPath(cursor);
      if (
        parent === cursor ||
        !isEqualOrStrictLexicalDescendant(trustedAnchor, parent)
      ) {
        throw new AnchoredLexicalPathError(messages.escaped);
      }
      cursor = parent;
    }
  }
}

export async function assertAnchoredRealDirectory(
  root: TrustedAnchoredStorageRoot,
  path: string,
  messages: LexicalWalkMessages,
): Promise<Deno.FileInfo> {
  requireEqualOrStrictLexicalDescendant(root.trustedAnchor, path, messages.escaped);
  if (isUninspectedRelativeTrustedAnchor(root.trustedAnchor, path)) {
    throw new AnchoredLexicalPathError(messages.notRealDirectory);
  }
  await assertExistingLexicalComponents(root.trustedAnchor, path, messages);
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isDirectory) {
    throw new AnchoredLexicalPathError(messages.notRealDirectory);
  }
  const real = await Deno.realPath(path);
  const realInfo = await Deno.lstat(real);
  if (
    realInfo.isSymlink || !realInfo.isDirectory ||
    (info.dev !== null && info.ino !== null && realInfo.dev !== null &&
      realInfo.ino !== null && !sameInode(info, realInfo))
  ) {
    throw new AnchoredLexicalPathError(messages.notRealDirectory);
  }
  return info;
}

export async function assertAnchoredRealDirectoryIfPresent(
  root: TrustedAnchoredStorageRoot,
  path: string,
  messages: LexicalWalkMessages,
): Promise<void> {
  requireEqualOrStrictLexicalDescendant(root.trustedAnchor, path, messages.escaped);
  await assertExistingLexicalComponents(root.trustedAnchor, path, messages);
  try {
    await assertAnchoredRealDirectory(root, path, messages);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}

export async function ensureAnchoredDirectoryTree(
  root: TrustedAnchoredStorageRoot,
  path: string,
  messages: LexicalWalkMessages,
  createdDirectoryMode?: number,
): Promise<void> {
  requireEqualOrStrictLexicalDescendant(root.trustedAnchor, path, messages.escaped);
  await assertExistingLexicalComponents(root.trustedAnchor, path, messages);
  const missing = await collectMissingLexicalDirectories(
    root.trustedAnchor,
    path,
    messages,
  );
  for (const directory of missing.reverse()) {
    const parent = parentLexicalPath(directory);
    if (!isUninspectedRelativeTrustedAnchor(root.trustedAnchor, parent)) {
      await assertAnchoredRealDirectory(root, parent, messages);
    }
    try {
      await Deno.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const created = await assertAnchoredRealDirectory(root, directory, messages);
    assertUnixMode(created, createdDirectoryMode);
  }
  await assertAnchoredRealDirectory(root, path, messages);
}

export async function assertAnchoredRegularFile(
  root: TrustedAnchoredStorageRoot,
  path: string,
  messages: LexicalWalkMessages,
): Promise<Deno.FileInfo> {
  requireContainedStoragePath(root, path, messages.escaped);
  await assertExistingLexicalComponents(root.trustedAnchor, path, messages);
  await assertAnchoredRealDirectory(root, parentLexicalPath(path), messages);
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isFile) {
    throw new AnchoredLexicalPathError(messages.regularFile);
  }
  return info;
}

export async function assertAnchoredMissingOrRegularFile(
  root: TrustedAnchoredStorageRoot,
  path: string,
  messages: LexicalWalkMessages,
): Promise<void> {
  try {
    await assertAnchoredRegularFile(root, path, messages);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || isNotFound(error)) return;
    throw error;
  }
}

export async function assertAnchoredOpenRegularFile(
  root: TrustedAnchoredStorageRoot,
  path: string,
  file: Deno.FsFile,
  messages: LexicalWalkMessages,
  fileMode?: number,
): Promise<Deno.FileInfo> {
  const pathInfo = await assertAnchoredRegularFile(root, path, messages);
  const openInfo = await file.stat();
  if (
    !openInfo.isFile ||
    (pathInfo.dev !== null && pathInfo.ino !== null &&
      openInfo.dev !== null && openInfo.ino !== null &&
      !sameInode(pathInfo, openInfo))
  ) {
    throw new AnchoredLexicalPathError(messages.pathChangedWhileOpen);
  }
  assertUnixMode(openInfo, fileMode);
  return openInfo;
}

export async function openAnchoredRegularLockFile(
  root: TrustedAnchoredStorageRoot,
  path: string,
  messages: LexicalWalkMessages,
  fileMode?: number,
): Promise<Deno.FsFile> {
  requireContainedStoragePath(root, path, messages.escaped);
  await assertAnchoredMissingOrRegularFile(root, path, messages);
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, {
      createNew: true,
      read: true,
      write: true,
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists) && !isAlreadyExists(error)) {
      throw error;
    }
    await assertAnchoredRegularFile(root, path, messages);
    file = await Deno.open(path, { read: true, write: true });
  }
  try {
    await assertAnchoredOpenRegularFile(root, path, file, messages, fileMode);
    return file;
  } catch (error) {
    file.close();
    throw error;
  }
}

function assertUnixMode(info: Deno.FileInfo, expected: number | undefined): void {
  if (
    expected === undefined || Deno.build.os === "windows" || info.mode === null
  ) {
    return;
  }
  if ((info.mode & 0o777) !== expected) {
    throw new AnchoredLexicalPathError(
      `Storage path permissions must be ${expected.toString(8)}.`,
    );
  }
}

function sameInode(left: Deno.FileInfo, right: Deno.FileInfo): boolean {
  return left.dev !== null && left.ino !== null && right.dev !== null &&
    right.ino !== null && left.dev === right.dev && left.ino === right.ino;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

export function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error && /already exists/i.test(error.message));
}

function validateConfiguredStorageRoot(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes("//")
  ) {
    throw new TypeError("Storage root is invalid.");
  }
  const root = withoutTrailingSlash(value);
  if (root.length === 0 || root === "/" || root === "." || root === "..") {
    throw new TypeError("Storage root is invalid.");
  }
  const segments = root.split("/");
  if (segments[0] === "") segments.shift();
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || FORBIDDEN_SEGMENT.test(segment))
  ) {
    throw new TypeError("Storage root is invalid.");
  }
  return root;
}

function isSafeLexicalPath(
  path: string,
  options: { readonly allowRoot?: boolean } = {},
): boolean {
  if (
    path.length === 0 ||
    path !== path.trim() ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.includes("//")
  ) {
    return false;
  }
  if (path === "/") return options.allowRoot === true;
  const segments = withoutTrailingSlash(path).split("/");
  if (segments[0] === "") segments.shift();
  return segments.length > 0 &&
    segments.every((segment) => segment.length > 0 && !FORBIDDEN_SEGMENT.test(segment));
}

function withoutTrailingSlash(path: string): string {
  if (path === "/") return "/";
  return path.replace(/\/+$/, "");
}

/** Relative cwd anchors are lexical only; YOLO cannot inspect the worktree root. */
function isUninspectedRelativeTrustedAnchor(
  trustedAnchor: string,
  path: string,
): boolean {
  return trustedAnchor !== "/" &&
    withoutTrailingSlash(path) === withoutTrailingSlash(trustedAnchor);
}

type PathComponentSnapshot = {
  readonly path: string;
  readonly info: Deno.FileInfo;
};
