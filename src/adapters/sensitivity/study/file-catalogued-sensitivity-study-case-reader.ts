import type { CataloguedSensitivityStudyCaseReader } from "../../../application/ports/out/sensitivity/study/catalogued-sensitivity-study-case-reader.ts";

const CATALOG_FILE = "catalog.json";
const CATALOG_SCHEMA_VERSION = "sensitivity-study-case-catalog/1.0";
const CATALOG_ROOT = "config/sensitivity-study-cases";
type CatalogEntry = { readonly id: string; readonly file: string };

/** Strict filesystem boundary for reviewed sensitivity-study templates. */
export class FileCataloguedSensitivityStudyCaseReader
  implements CataloguedSensitivityStudyCaseReader {
  readonly #root: string;
  constructor(root = CATALOG_ROOT) {
    this.#root = root.replace(/\/+$/, "");
  }
  async list(): Promise<readonly { readonly caseId: string }[]> {
    const root = await this.#canonicalRoot();
    return (await this.#manifest(root)).map(({ id }) => ({ caseId: id }));
  }
  async read(caseId: string): Promise<string | undefined> {
    const root = await this.#canonicalRoot();
    const entry = (await this.#manifest(root)).find((item) => item.id === caseId);
    if (!entry) return undefined;
    const path = `${root}/${entry.file}`;
    const raw = await readConfinedRegularFile(root, entry.file);
    if (raw === undefined) return undefined;
    assertCaseFileId(raw, caseId, path);
    return raw;
  }
  async #canonicalRoot(): Promise<string> {
    let canonical: string;
    try {
      canonical = (await Deno.realPath(this.#root)).replace(/\/+$/, "");
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(
          `Sensitivity-study catalog manifest is missing: ${this.#root}/${CATALOG_FILE}.`,
        );
      }
      throw error;
    }
    const info = await Deno.lstat(canonical);
    if (info.isSymlink || !info.isDirectory) {
      throw new Error(
        `Sensitivity-study catalog root is not a directory: ${this.#root}.`,
      );
    }
    return canonical;
  }
  async #manifest(root: string): Promise<readonly CatalogEntry[]> {
    const path = `${root}/${CATALOG_FILE}`;
    const raw = await readConfinedRegularFile(root, CATALOG_FILE);
    if (raw === undefined) {
      throw new Error(`Sensitivity-study catalog manifest is missing: ${path}.`);
    }
    const entries = parseManifest(raw, path);
    for (const entry of entries) await resolveConfinedRegularFile(root, entry.file);
    return entries;
  }
}

/**
 * Deno cannot openat(2)/O_NOFOLLOW a whole path without native FFI. The opened
 * handle plus path/file identity recross catches a replacement of the selected
 * path during read. A same-inode alias (hard link or bind mount) that appears
 * under the root after that recross is the residual kernel race.
 */
async function readConfinedRegularFile(
  root: string,
  relativeFile: string,
): Promise<string | undefined> {
  const selected = await resolveConfinedRegularFile(root, relativeFile);
  if (selected === undefined) return undefined;
  let file: Deno.FsFile;
  try {
    file = await Deno.open(selected, { read: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw catalogChanged(selected);
    throw error;
  }
  try {
    const info = await assertStableOpenedFile(root, selected, file);
    if (!Number.isSafeInteger(info.size) || info.size < 0) {
      throw catalogChanged(selected);
    }
    const bytes = new Uint8Array(info.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = await file.read(bytes.subarray(offset));
      if (count === null || count < 1) throw catalogChanged(selected);
      offset += count;
    }
    if (await file.read(new Uint8Array(1)) !== null) throw catalogChanged(selected);
    await assertStableOpenedFile(root, selected, file);
    return new TextDecoder("utf-8").decode(bytes);
  } finally {
    file.close();
  }
}

async function resolveConfinedRegularFile(
  root: string,
  relativeFile: string,
): Promise<string | undefined> {
  if (!isSafeRelativeJsonPath(relativeFile)) throw catalogEscaped(relativeFile);
  let current = root;
  const segments = relativeFile.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = `${current}/${segments[index]}`;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(candidate);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    let next: string;
    if (info.isSymlink) {
      let resolved: string;
      try {
        resolved = await Deno.realPath(candidate);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) throw catalogEscaped(candidate);
        throw error;
      }
      if (!isStrictDescendant(root, resolved)) throw catalogEscaped(candidate);
      next = resolved;
    } else {
      if (!isStrictDescendant(root, candidate)) throw catalogEscaped(candidate);
      next = candidate;
    }
    let nextInfo: Deno.FileInfo;
    try {
      nextInfo = await Deno.lstat(next);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) throw catalogChanged(next);
      throw error;
    }
    if (nextInfo.isSymlink) throw catalogEscaped(next);
    const last = index === segments.length - 1;
    if (last ? !nextInfo.isFile : !nextInfo.isDirectory) {
      throw catalogNotRegular(candidate);
    }
    current = next;
  }
  let canonical: string;
  try {
    canonical = await Deno.realPath(current);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw catalogChanged(current);
    throw error;
  }
  if (!isStrictDescendant(root, canonical)) throw catalogEscaped(current);
  return canonical;
}

async function assertStableOpenedFile(
  root: string,
  selected: string,
  file: Deno.FsFile,
): Promise<Deno.FileInfo> {
  if (!isStrictDescendant(root, selected)) throw catalogEscaped(selected);
  let rootNow: string;
  try {
    rootNow = await Deno.realPath(root);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw catalogChanged(root);
    throw error;
  }
  if (rootNow !== root) throw catalogEscaped(root);
  let current = root;
  for (const segment of selected.slice(root.length + 1).split("/")) {
    current = `${current}/${segment}`;
    let ancestor: Deno.FileInfo;
    try {
      ancestor = await Deno.lstat(current);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) throw catalogChanged(current);
      throw error;
    }
    if (ancestor.isSymlink) throw catalogEscaped(current);
  }
  let pathInfo: Deno.FileInfo;
  try {
    pathInfo = await Deno.lstat(selected);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw catalogChanged(selected);
    throw error;
  }
  if (pathInfo.isSymlink || !pathInfo.isFile) throw catalogNotRegular(selected);
  const openInfo = await file.stat();
  if (!openInfo.isFile) throw catalogNotRegular(selected);
  if (!sameFileIdentity(pathInfo, openInfo)) throw catalogChanged(selected);
  let now: string;
  try {
    now = await Deno.realPath(selected);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw catalogChanged(selected);
    throw error;
  }
  if (now !== selected || !isStrictDescendant(root, now)) {
    throw catalogEscaped(selected);
  }
  return openInfo;
}

function sameFileIdentity(left: Deno.FileInfo, right: Deno.FileInfo): boolean {
  if (
    left.dev === null || left.ino === null ||
    right.dev === null || right.ino === null
  ) return false;
  return left.dev === right.dev && left.ino === right.ino;
}

function isStrictDescendant(root: string, path: string): boolean {
  const prefix = root.replace(/\/+$/, "");
  const candidate = path.replace(/\/+$/, "");
  if (!candidate.startsWith(`${prefix}/`)) return false;
  const relative = candidate.slice(prefix.length + 1);
  return relative !== "" &&
    !relative.split("/").some((part) => part === "" || part === "." || part === "..");
}

function catalogEscaped(path: string): Error {
  return new Error(`Catalog path escaped the catalog root: ${path}.`);
}
function catalogNotRegular(path: string): Error {
  return new Error(`Catalog file is not a regular file: ${path}.`);
}
function catalogChanged(path: string): Error {
  return new Error(`Catalog file identity changed during read: ${path}.`);
}

function parseManifest(raw: string, path: string): readonly CatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Catalog manifest is not valid JSON: ${path}.`);
  }
  if (
    !isRecord(parsed) || !hasExactKeys(parsed, ["schemaVersion", "cases"]) ||
    parsed.schemaVersion !== CATALOG_SCHEMA_VERSION || !Array.isArray(parsed.cases)
  ) throw new Error(`Catalog manifest is invalid: ${path}.`);
  const ids = new Set<string>();
  const files = new Set<string>();
  return parsed.cases.map((entry, index) => {
    if (
      !isRecord(entry) || !hasExactKeys(entry, ["id", "file"]) ||
      typeof entry.id !== "string" ||
      typeof entry.file !== "string" || !isSafeId(entry.id) ||
      !isSafeRelativeJsonPath(entry.file)
    ) throw new Error(`Catalog manifest case ${index} is invalid: ${path}.`);
    if (ids.has(entry.id) || files.has(entry.file)) {
      throw new Error(`Catalog manifest contains a duplicate id or file: ${path}.`);
    }
    ids.add(entry.id);
    files.add(entry.file);
    return { id: entry.id, file: entry.file };
  });
}
function assertCaseFileId(raw: string, expectedId: string, path: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Catalogued case file is not valid JSON: ${path}.`);
  }
  if (!isRecord(parsed) || parsed.id !== expectedId) {
    throw new Error(
      `Catalogued case file id does not match manifest id "${expectedId}": ${path}.`,
    );
  }
}
function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}
function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}
function isSafeRelativeJsonPath(value: string): boolean {
  return value.endsWith(".json") && !value.startsWith("/") && !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
