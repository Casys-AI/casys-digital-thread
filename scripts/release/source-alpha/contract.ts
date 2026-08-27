/** Shared contracts and deterministic primitives for the source-alpha renderer. */

export const SOURCE_ALPHA_GENERATOR_VERSION = "1.0.0";
export const REPOSITORY_ROOT = new URL("../../../", import.meta.url);
export const SCOPE_PATH = "release/sbom/source-alpha-scope.json";
export const TOOLS_LOCK_PATH = "release/sbom/tools.lock.json";
export const GENERATOR_PATH = "scripts/release/source-alpha-inventory.ts";
export const RELEASE_FILE_NAMES = [
  "source-release-manifest.json",
  "source.sbom.cdx.json",
  "source.tar.gz",
  "THIRD_PARTY_NOTICES.md",
] as const;

export type JsonRecord = Record<string, unknown>;

interface ScopeInput {
  readonly path: string;
  readonly role: string;
}

interface ScopeComponentInventory {
  readonly id: string;
  readonly inputPaths: readonly string[];
  readonly coverage: "included" | "provenance-only";
  readonly reason?: string;
}

interface ScopeExclusion {
  readonly id: string;
  readonly literal: string;
}

export interface SourceAlphaScope {
  readonly schemaVersion: "casys-source-alpha-sbom-scope/1.0";
  readonly scopeId: "source-alpha";
  readonly package: {
    readonly name: string;
    readonly type: "source-checkout";
  };
  readonly archive: {
    readonly format: "tar.gz";
    readonly content: string;
    readonly outputDirectory: string;
  };
  readonly inputs: readonly ScopeInput[];
  readonly componentInventories: readonly ScopeComponentInventory[];
  readonly exclusions: readonly ScopeExclusion[];
}

interface ToolLockEntry {
  readonly id: string;
  readonly version: string;
  readonly enforcement: string;
  readonly purpose: string;
}

export interface SourceAlphaToolsLock {
  readonly schemaVersion: "casys-source-alpha-sbom-tools-lock/1.0";
  readonly generator: {
    readonly id: "casys-source-alpha-inventory";
    readonly version: string;
    readonly sourcePath: string;
    readonly sourceModules: readonly string[];
  };
  readonly requiredTools: readonly ToolLockEntry[];
  readonly notExecutedTools: readonly {
    readonly id: string;
    readonly status: "not-executed";
    readonly reason: string;
  }[];
}

export interface SourceAlphaInputDigest {
  readonly path: string;
  readonly role: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface SourceAlphaReleaseContext {
  readonly tag: string;
  readonly commit: string;
  readonly tree: string;
  readonly commitTimestamp: string;
  readonly gitVersion: string;
  readonly scope: SourceAlphaScope;
  readonly scopeSha256: string;
  readonly toolsLock: SourceAlphaToolsLock;
  readonly toolsLockSha256: string;
  /** Canonical digest of every tracked source module declared in tools.lock.json. */
  readonly generatorSha256: string;
  readonly inputs: readonly SourceAlphaInputDigest[];
  readonly sourceArchive: Uint8Array;
  readonly sourceArchiveSha256: string;
}

export interface BuildSourceAlphaReleaseOptions {
  readonly tag: string;
  /** The CLI always leaves this false. Tests may exercise deterministic output from a dirty worktree. */
  readonly allowUncommittedForTest?: boolean;
  readonly outputRoot?: URL;
}

export interface Component {
  readonly type: "library";
  readonly "bom-ref": string;
  readonly name: string;
  readonly version: string;
  readonly purl: string;
  readonly hashes?: readonly { readonly alg: string; readonly content: string }[];
  readonly licenses: readonly { readonly license: { readonly name: string } }[];
  readonly externalReferences?: readonly {
    readonly type: "distribution";
    readonly url: string;
  }[];
  readonly properties: readonly { readonly name: string; readonly value: string }[];
}

export interface RenderedRelease {
  readonly context: SourceAlphaReleaseContext;
  readonly bom: JsonRecord;
  readonly bomText: string;
  readonly manifest: JsonRecord;
  readonly manifestText: string;
  readonly noticesText: string;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${context} must be a non-empty string.`);
  }
  return value;
}

function stringArray(value: unknown, context: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${context} must be an array of strings.`);
  }
  return value;
}

export function repositoryUrl(path: string, repositoryRoot = REPOSITORY_ROOT): URL {
  if (
    path.startsWith("/") || path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new TypeError(`Unsafe repository-relative path: ${path}`);
  }
  return new URL(path, repositoryRoot);
}

export function fileUrlPath(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  return Deno.build.os === "windows" ? path.slice(1).replaceAll("/", "\\") : path;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
}

export async function sha256Text(text: string): Promise<string> {
  return await sha256(new TextEncoder().encode(text));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export async function readJson(
  path: string,
  repositoryRoot = REPOSITORY_ROOT,
): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(repositoryUrl(path, repositoryRoot)));
}

export function parseSourceAlphaScope(value: unknown): SourceAlphaScope {
  if (!isRecord(value)) throw new TypeError(`${SCOPE_PATH} must be a JSON object.`);
  if (value.schemaVersion !== "casys-source-alpha-sbom-scope/1.0") {
    throw new TypeError(`${SCOPE_PATH} has an unsupported schemaVersion.`);
  }
  if (value.scopeId !== "source-alpha") {
    throw new TypeError(`${SCOPE_PATH} must name the source-alpha scope.`);
  }
  const packageValue = value.package;
  const archiveValue = value.archive;
  if (!isRecord(packageValue) || !isRecord(archiveValue)) {
    throw new TypeError(`${SCOPE_PATH} must declare package and archive objects.`);
  }
  if (packageValue.type !== "source-checkout" || archiveValue.format !== "tar.gz") {
    throw new TypeError(
      `${SCOPE_PATH} has an unsupported package or archive boundary.`,
    );
  }
  if (!Array.isArray(value.inputs) || !Array.isArray(value.componentInventories)) {
    throw new TypeError(`${SCOPE_PATH} must declare inputs and componentInventories.`);
  }
  if (!Array.isArray(value.exclusions) || value.exclusions.length === 0) {
    throw new TypeError(`${SCOPE_PATH} must retain literal exclusions.`);
  }

  const inputs = value.inputs.map((input, index) => {
    if (!isRecord(input)) throw new TypeError(`inputs[${index}] must be an object.`);
    const path = stringValue(input.path, `inputs[${index}].path`);
    repositoryUrl(path);
    return { path, role: stringValue(input.role, `inputs[${index}].role`) };
  });
  if (new Set(inputs.map((input) => input.path)).size !== inputs.length) {
    throw new TypeError(`${SCOPE_PATH} must not repeat an input path.`);
  }

  const componentInventories = value.componentInventories.map((inventory, index) => {
    if (!isRecord(inventory)) {
      throw new TypeError(`componentInventories[${index}] must be an object.`);
    }
    const coverage = stringValue(
      inventory.coverage,
      `componentInventories[${index}].coverage`,
    );
    if (coverage !== "included" && coverage !== "provenance-only") {
      throw new TypeError(
        `componentInventories[${index}].coverage must be included or provenance-only.`,
      );
    }
    const inputPaths = stringArray(
      inventory.inputPaths,
      `componentInventories[${index}].inputPaths`,
    );
    for (const path of inputPaths) {
      if (!inputs.some((input) => input.path === path)) {
        throw new TypeError(
          `componentInventories[${index}] references input outside the scope: ${path}`,
        );
      }
    }
    return {
      id: stringValue(inventory.id, `componentInventories[${index}].id`),
      inputPaths,
      coverage,
      ...(typeof inventory.reason === "string" ? { reason: inventory.reason } : {}),
    } as ScopeComponentInventory;
  });

  const exclusions = value.exclusions.map((exclusion, index) => {
    if (!isRecord(exclusion)) {
      throw new TypeError(`exclusions[${index}] must be an object.`);
    }
    return {
      id: stringValue(exclusion.id, `exclusions[${index}].id`),
      literal: stringValue(exclusion.literal, `exclusions[${index}].literal`),
    };
  });

  return {
    schemaVersion: "casys-source-alpha-sbom-scope/1.0",
    scopeId: "source-alpha",
    package: {
      name: stringValue(packageValue.name, "package.name"),
      type: "source-checkout",
    },
    archive: {
      format: "tar.gz",
      content: stringValue(archiveValue.content, "archive.content"),
      outputDirectory: stringValue(
        archiveValue.outputDirectory,
        "archive.outputDirectory",
      ),
    },
    inputs,
    componentInventories,
    exclusions,
  };
}

export function parseSourceAlphaToolsLock(value: unknown): SourceAlphaToolsLock {
  if (!isRecord(value)) {
    throw new TypeError(`${TOOLS_LOCK_PATH} must be a JSON object.`);
  }
  if (value.schemaVersion !== "casys-source-alpha-sbom-tools-lock/1.0") {
    throw new TypeError(`${TOOLS_LOCK_PATH} has an unsupported schemaVersion.`);
  }
  if (!isRecord(value.generator) || !Array.isArray(value.requiredTools)) {
    throw new TypeError(`${TOOLS_LOCK_PATH} must declare generator and requiredTools.`);
  }
  if (!Array.isArray(value.notExecutedTools)) {
    throw new TypeError(`${TOOLS_LOCK_PATH} must declare notExecutedTools.`);
  }
  const generator = value.generator;
  if (generator.id !== "casys-source-alpha-inventory") {
    throw new TypeError(`${TOOLS_LOCK_PATH} identifies the wrong generator.`);
  }
  const sourcePath = stringValue(generator.sourcePath, "generator.sourcePath");
  repositoryUrl(sourcePath);
  const sourceModules = stringArray(generator.sourceModules, "generator.sourceModules");
  if (sourceModules.length === 0 || !sourceModules.includes(sourcePath)) {
    throw new TypeError(
      `${TOOLS_LOCK_PATH} must include the facade sourcePath in sourceModules.`,
    );
  }
  for (const path of sourceModules) repositoryUrl(path);
  if (new Set(sourceModules).size !== sourceModules.length) {
    throw new TypeError(
      `${TOOLS_LOCK_PATH} must not repeat a generator source module.`,
    );
  }
  const requiredTools = value.requiredTools.map((tool, index) => {
    if (!isRecord(tool)) {
      throw new TypeError(`requiredTools[${index}] must be an object.`);
    }
    return {
      id: stringValue(tool.id, `requiredTools[${index}].id`),
      version: stringValue(tool.version, `requiredTools[${index}].version`),
      enforcement: stringValue(
        tool.enforcement,
        `requiredTools[${index}].enforcement`,
      ),
      purpose: stringValue(tool.purpose, `requiredTools[${index}].purpose`),
    };
  });
  const notExecutedTools = value.notExecutedTools.map((tool, index) => {
    if (!isRecord(tool)) {
      throw new TypeError(`notExecutedTools[${index}] must be an object.`);
    }
    if (tool.status !== "not-executed") {
      throw new TypeError(`notExecutedTools[${index}].status must be not-executed.`);
    }
    return {
      id: stringValue(tool.id, `notExecutedTools[${index}].id`),
      status: "not-executed" as const,
      reason: stringValue(tool.reason, `notExecutedTools[${index}].reason`),
    };
  });
  return {
    schemaVersion: "casys-source-alpha-sbom-tools-lock/1.0",
    generator: {
      id: "casys-source-alpha-inventory",
      version: stringValue(generator.version, "generator.version"),
      sourcePath,
      sourceModules,
    },
    requiredTools,
    notExecutedTools,
  };
}

export function assertRendererCoverage(scope: SourceAlphaScope): void {
  const included = scope.componentInventories
    .filter((inventory) => inventory.coverage === "included")
    .map((inventory) => `${inventory.id}:${inventory.inputPaths.join(",")}`)
    .sort();
  const expected = [
    "control-plane-deno:deno.json,deno.lock",
    "workbench-npm:src/ui/package.json,src/ui/package-lock.json",
  ];
  if (JSON.stringify(included) !== JSON.stringify(expected)) {
    throw new Error(
      "The source-alpha scope declares an included component inventory this renderer does not understand. Extend the renderer before widening the claim.",
    );
  }
}
