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
    return (await this.#open()).entries.map(({ id }) => ({ caseId: id }));
  }
  async read(caseId: string): Promise<string | undefined> {
    const { root, entries } = await this.#open();
    const entry = entries.find((item) => item.id === caseId);
    if (!entry) return undefined;
    const path = `${root}/${entry.file}`;
    const raw = await readConfined(root, entry.file);
    if (raw === undefined) return undefined;
    assertCaseFileId(raw, caseId, path);
    return raw;
  }
  async #open(): Promise<{
    readonly root: string;
    readonly entries: readonly CatalogEntry[];
  }> {
    const root = await resolveCatalogRoot(this.#root);
    const path = `${root}/${CATALOG_FILE}`;
    const raw = await readConfined(root, CATALOG_FILE);
    if (raw === undefined) {
      throw new Error(`Sensitivity-study catalog manifest is missing: ${path}.`);
    }
    const entries = parseManifest(raw, path);
    for (const entry of entries) await resolveConfined(root, entry.file);
    return { root, entries };
  }
}

async function resolveCatalogRoot(root: string): Promise<string> {
  try {
    return (await Deno.realPath(root)).replace(/\/+$/, "");
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Sensitivity-study catalog manifest is missing: ${root}/${CATALOG_FILE}.`,
      );
    }
    throw error;
  }
}

async function readConfined(
  root: string,
  relativeFile: string,
): Promise<string | undefined> {
  const canonical = await resolveConfined(root, relativeFile);
  if (canonical === undefined) return undefined;
  try {
    return await Deno.readTextFile(canonical);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function resolveConfined(
  root: string,
  relativeFile: string,
): Promise<string | undefined> {
  const path = `${root}/${relativeFile}`;
  let canonical: string;
  try {
    canonical = await Deno.realPath(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  if (!isStrictDescendant(root, canonical)) {
    throw new Error(`Catalog path escaped the catalog root: ${path}.`);
  }
  return canonical;
}

function isStrictDescendant(root: string, path: string): boolean {
  return path.startsWith(`${root}/`) && path.length > root.length + 1;
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
