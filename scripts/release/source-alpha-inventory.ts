/**
 * Deterministic, source-only release inventory for Casys Digital Thread.
 *
 * This module deliberately inventories only the source checkout boundary declared
 * in release/sbom/source-alpha-scope.json. It does not inspect, pull, or claim
 * coverage of OCI images, provider runtimes, microVMs, caches, Desktop bundles,
 * or live state.
 */

export const SOURCE_ALPHA_GENERATOR_VERSION = "1.0.0";

const REPOSITORY_ROOT = new URL("../../", import.meta.url);
const SCOPE_PATH = "release/sbom/source-alpha-scope.json";
const TOOLS_LOCK_PATH = "release/sbom/tools.lock.json";
const GENERATOR_PATH = "scripts/release/source-alpha-inventory.ts";
const DEFAULT_OUTPUT_ROOT = new URL("dist/release/", REPOSITORY_ROOT);
const RELEASE_FILE_NAMES = [
  "source-release-manifest.json",
  "source.sbom.cdx.json",
  "source.tar.gz",
  "THIRD_PARTY_NOTICES.md",
] as const;

type JsonRecord = Record<string, unknown>;

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

interface Component {
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

interface RenderedRelease {
  readonly context: SourceAlphaReleaseContext;
  readonly bom: JsonRecord;
  readonly bomText: string;
  readonly manifest: JsonRecord;
  readonly manifestText: string;
  readonly noticesText: string;
}

function isRecord(value: unknown): value is JsonRecord {
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

function repositoryUrl(path: string, repositoryRoot = REPOSITORY_ROOT): URL {
  if (
    path.startsWith("/") || path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new TypeError(`Unsafe repository-relative path: ${path}`);
  }
  return new URL(path, repositoryRoot);
}

function fileUrlPath(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  return Deno.build.os === "windows" ? path.slice(1).replaceAll("/", "\\") : path;
}

function outputDirectoryForTag(tag: string, outputRoot = DEFAULT_OUTPUT_ROOT): URL {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(tag)) {
    throw new TypeError(
      "--tag must contain only letters, numbers, '.', '_' or '-' and cannot start with punctuation.",
    );
  }
  return new URL(`${tag}/`, outputRoot);
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
}

async function sha256Text(text: string): Promise<string> {
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

async function readJson(
  path: string,
  repositoryRoot = REPOSITORY_ROOT,
): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(repositoryUrl(path, repositoryRoot)));
}

function parseScope(value: unknown): SourceAlphaScope {
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

function parseToolsLock(value: unknown): SourceAlphaToolsLock {
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
      sourcePath: stringValue(generator.sourcePath, "generator.sourcePath"),
    },
    requiredTools,
    notExecutedTools,
  };
}

function assertRendererCoverage(scope: SourceAlphaScope): void {
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

async function git(
  args: readonly string[],
  repositoryRoot = REPOSITORY_ROOT,
): Promise<Uint8Array> {
  const output = await new Deno.Command("git", {
    args: [...args],
    cwd: fileUrlPath(repositoryRoot),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
  return output.stdout;
}

async function gitText(
  args: readonly string[],
  repositoryRoot = REPOSITORY_ROOT,
): Promise<string> {
  return new TextDecoder().decode(await git(args, repositoryRoot)).trim();
}

async function assertCleanCheckout(repositoryRoot: URL): Promise<void> {
  const status = await gitText(
    ["status", "--porcelain", "--untracked-files=normal"],
    repositoryRoot,
  );
  if (status !== "") {
    throw new Error(
      "Source-alpha release generation requires a clean checkout. Commit or isolate the pending paths before building a public candidate.",
    );
  }
}

async function assertTrackedInputs(
  scope: SourceAlphaScope,
  toolsLock: SourceAlphaToolsLock,
  repositoryRoot: URL,
): Promise<void> {
  const tracked = new Set(
    (await gitText(["ls-tree", "-r", "--name-only", "HEAD"], repositoryRoot))
      .split("\n")
      .filter(Boolean),
  );
  for (
    const path of [
      ...scope.inputs.map((input) => input.path),
      SCOPE_PATH,
      TOOLS_LOCK_PATH,
      toolsLock.generator.sourcePath,
    ]
  ) {
    if (!tracked.has(path)) {
      throw new Error(
        `Source-alpha release input is not tracked at HEAD: ${path}. Generate only from a committed candidate.`,
      );
    }
  }
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const compressed = new Blob([copy.buffer]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

function parseNameAndVersion(identity: string): { name: string; version: string } {
  const marker = identity.lastIndexOf("@");
  if (marker <= 0 || marker === identity.length - 1) {
    return { name: identity, version: "NOASSERTION" };
  }
  return {
    name: identity.slice(0, marker),
    version: identity.slice(marker + 1).split("_")[0] || "NOASSERTION",
  };
}

function nameFromNpmLockPath(lockPath: string): string {
  const leaf = lockPath.split("node_modules/").at(-1) ?? lockPath;
  if (leaf.startsWith("@")) return leaf.split("/").slice(0, 2).join("/");
  return leaf.split("/")[0] || "NOASSERTION";
}

function purlFor(source: string, name: string, version: string): string {
  return `pkg:generic/${encodeURIComponent(source)}/${encodeURIComponent(name)}@$${
    encodeURIComponent(version)
  }`.replace("@$", "@");
}

function sriToHash(integrity: string | undefined):
  | { readonly alg: string; readonly content: string }
  | undefined {
  if (!integrity) return undefined;
  if (/^[0-9a-f]{64}$/u.test(integrity)) {
    return { alg: "SHA-256", content: integrity };
  }
  const match = integrity.match(/^sha(256|384|512)-([A-Za-z0-9+/]+={0,2})/u);
  if (!match) return undefined;
  const binary = atob(match[2]!);
  return {
    alg: `SHA-${match[1]}`,
    content: toHex(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
  };
}

function optionalString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function libraryComponent(args: {
  readonly source: string;
  readonly identity: string;
  readonly name: string;
  readonly version?: string;
  readonly integrity?: string;
  readonly license?: string;
  readonly resolved?: string;
}): Component {
  const version = args.version || "NOASSERTION";
  const integrity = args.integrity || "NOASSERTION";
  const hash = sriToHash(args.integrity);
  return {
    type: "library",
    "bom-ref": `urn:casys:source-alpha:${encodeURIComponent(args.source)}:${
      encodeURIComponent(args.identity)
    }`,
    name: args.name || "NOASSERTION",
    version,
    purl: purlFor(args.source, args.name || "NOASSERTION", version),
    ...(hash ? { hashes: [hash] } : {}),
    licenses: [{ license: { name: args.license || "NOASSERTION" } }],
    ...(args.resolved
      ? {
        externalReferences: [{ type: "distribution" as const, url: args.resolved }],
      }
      : {}),
    properties: [
      { name: "casys:inventory-source", value: args.source },
      { name: "casys:integrity", value: integrity },
    ],
  };
}

function denoLockComponents(lock: unknown): readonly Component[] {
  if (!isRecord(lock)) throw new TypeError("deno.lock must be an object.");
  const components: Component[] = [];
  for (const section of ["jsr", "npm"] as const) {
    const packages = lock[section];
    if (!isRecord(packages)) continue;
    for (const [identity, value] of Object.entries(packages)) {
      if (!isRecord(value)) continue;
      const { name, version } = parseNameAndVersion(identity);
      components.push(libraryComponent({
        source: `deno-lock:${section}`,
        identity,
        name,
        version,
        integrity: optionalString(value, "integrity"),
      }));
    }
  }
  return components;
}

function npmLockComponents(lock: unknown): readonly Component[] {
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    throw new TypeError("package-lock.json must contain a packages object.");
  }
  const components: Component[] = [];
  for (const [lockPath, value] of Object.entries(lock.packages)) {
    if (lockPath === "" || !isRecord(value)) continue;
    const name = optionalString(value, "name") || nameFromNpmLockPath(lockPath);
    components.push(libraryComponent({
      source: "npm-lock:src/ui/package-lock.json",
      identity: lockPath,
      name,
      version: optionalString(value, "version"),
      integrity: optionalString(value, "integrity"),
      license: optionalString(value, "license"),
      resolved: optionalString(value, "resolved"),
    }));
  }
  return components;
}

function repositoryLicenseName(text: string): string {
  return text.startsWith("MIT License") ? "MIT" : "NOASSERTION";
}

function deterministicBomUuid(seed: string): Promise<string> {
  return sha256Text(seed).then((digest) => {
    const raw = digest.slice(0, 32).split("");
    raw[12] = "5";
    raw[16] = ["8", "9", "a", "b"][Number.parseInt(raw[16]!, 16) % 4]!;
    return `urn:uuid:${raw.slice(0, 8).join("")}-${raw.slice(8, 12).join("")}-${
      raw.slice(12, 16).join("")
    }-${raw.slice(16, 20).join("")}-${raw.slice(20, 32).join("")}`;
  });
}

async function sourceInputDigests(
  scope: SourceAlphaScope,
  repositoryRoot: URL,
): Promise<readonly SourceAlphaInputDigest[]> {
  return await Promise.all(scope.inputs.map(async (input) => {
    const bytes = await Deno.readFile(repositoryUrl(input.path, repositoryRoot));
    return {
      path: input.path,
      role: input.role,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
    };
  })).then((inputs) =>
    inputs.sort((left, right) => left.path.localeCompare(right.path))
  );
}

async function resolveContext(
  tag: string,
  repositoryRoot: URL,
  allowUncommittedForTest: boolean,
): Promise<SourceAlphaReleaseContext> {
  const [scopeText, toolsLockText] = await Promise.all([
    Deno.readTextFile(repositoryUrl(SCOPE_PATH, repositoryRoot)),
    Deno.readTextFile(repositoryUrl(TOOLS_LOCK_PATH, repositoryRoot)),
  ]);
  const scope = parseScope(JSON.parse(scopeText));
  const toolsLock = parseToolsLock(JSON.parse(toolsLockText));
  if (toolsLock.generator.version !== SOURCE_ALPHA_GENERATOR_VERSION) {
    throw new Error(
      `Tool lock pins generator ${toolsLock.generator.version}; this renderer is ${SOURCE_ALPHA_GENERATOR_VERSION}.`,
    );
  }
  if (toolsLock.generator.sourcePath !== GENERATOR_PATH) {
    throw new Error(`${TOOLS_LOCK_PATH} must point to ${GENERATOR_PATH}.`);
  }
  assertRendererCoverage(scope);
  const denoTool = toolsLock.requiredTools.find((tool) => tool.id === "deno");
  if (
    !denoTool || denoTool.enforcement !== "exact" ||
    denoTool.version !== Deno.version.deno
  ) {
    throw new Error(
      `Source-alpha tooling requires Deno ${
        denoTool?.version ?? "(missing)"
      }; running ${Deno.version.deno}.`,
    );
  }
  const gitTool = toolsLock.requiredTools.find((tool) => tool.id === "git");
  if (!gitTool || gitTool.enforcement !== "record-only") {
    throw new Error(`${TOOLS_LOCK_PATH} must retain Git as a record-at-build tool.`);
  }
  if (
    !toolsLock.notExecutedTools.some((tool) =>
      tool.id === "syft" && tool.status === "not-executed"
    )
  ) {
    throw new Error(`${TOOLS_LOCK_PATH} must retain Syft as explicitly not executed.`);
  }
  if (!allowUncommittedForTest) {
    await assertCleanCheckout(repositoryRoot);
    await assertTrackedInputs(scope, toolsLock, repositoryRoot);
  }

  const [
    commit,
    tree,
    commitTimestamp,
    gitVersion,
    generatorBytes,
    inputs,
    archiveTar,
  ] = await Promise.all([
    gitText(["rev-parse", "HEAD"], repositoryRoot),
    gitText(["rev-parse", "HEAD^{tree}"], repositoryRoot),
    gitText(["show", "-s", "--format=%cI", "HEAD"], repositoryRoot),
    gitText(["--version"], repositoryRoot),
    Deno.readFile(repositoryUrl(GENERATOR_PATH, repositoryRoot)),
    sourceInputDigests(scope, repositoryRoot),
    git([
      "archive",
      "--format=tar",
      `--prefix=casys-digital-thread-${tag}/`,
      "HEAD",
    ], repositoryRoot),
  ]);
  const sourceArchive = await gzip(archiveTar);
  return {
    tag,
    commit,
    tree,
    commitTimestamp,
    gitVersion,
    scope,
    scopeSha256: await sha256Text(scopeText),
    toolsLock,
    toolsLockSha256: await sha256Text(toolsLockText),
    generatorSha256: await sha256(generatorBytes),
    inputs,
    sourceArchive,
    sourceArchiveSha256: await sha256(sourceArchive),
  };
}

async function renderRelease(
  tag: string,
  repositoryRoot: URL,
  allowUncommittedForTest: boolean,
): Promise<RenderedRelease> {
  const context = await resolveContext(tag, repositoryRoot, allowUncommittedForTest);
  const [denoLock, uiPackageLock, licenseText] = await Promise.all([
    readJson("deno.lock", repositoryRoot),
    readJson("src/ui/package-lock.json", repositoryRoot),
    Deno.readTextFile(repositoryUrl("LICENSE", repositoryRoot)),
  ]);
  const components = [
    ...denoLockComponents(denoLock),
    ...npmLockComponents(uiPackageLock),
  ].sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
  const bomUuid = await deterministicBomUuid([
    context.commit,
    context.tree,
    context.tag,
    context.scopeSha256,
    context.toolsLockSha256,
  ].join("\n"));
  const bom: JsonRecord = {
    "$schema": "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: bomUuid,
    version: 1,
    metadata: {
      timestamp: context.commitTimestamp,
      tools: {
        components: [
          {
            type: "application",
            name: "deno",
            version: Deno.version.deno,
          },
          {
            type: "application",
            name: "git",
            version: context.gitVersion.replace(/^git version\s+/u, ""),
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": `pkg:generic/${context.scope.package.name}@${
          encodeURIComponent(context.tag)
        }`,
        name: context.scope.package.name,
        version: context.tag,
        purl: `pkg:generic/${context.scope.package.name}@${
          encodeURIComponent(context.tag)
        }`,
        licenses: [{ license: { name: repositoryLicenseName(licenseText) } }],
        properties: [
          { name: "casys:release-boundary", value: "source-alpha" },
          { name: "casys:source-commit", value: context.commit },
          { name: "casys:source-tree", value: context.tree },
          { name: "casys:source-archive-sha256", value: context.sourceArchiveSha256 },
          { name: "casys:scope-sha256", value: context.scopeSha256 },
          { name: "casys:tools-lock-sha256", value: context.toolsLockSha256 },
        ],
      },
      properties: [
        { name: "casys:generator-version", value: SOURCE_ALPHA_GENERATOR_VERSION },
        { name: "casys:generator-sha256", value: context.generatorSha256 },
        {
          name: "casys:excluded-artifacts",
          value: context.scope.exclusions.map((exclusion) => exclusion.id).join(","),
        },
      ],
    },
    components,
  };
  const bomText = canonicalJson(bom);
  const manifest: JsonRecord = {
    schemaVersion: "casys-source-release-manifest/1.0",
    release: {
      tag: context.tag,
      boundary: "source-alpha",
      claim: "source inventory only",
    },
    source: {
      commit: context.commit,
      tree: context.tree,
      commitTimestamp: context.commitTimestamp,
      archive: {
        path: "source.tar.gz",
        mediaType: "application/gzip",
        bytes: context.sourceArchive.byteLength,
        sha256: context.sourceArchiveSha256,
      },
    },
    inputs: context.inputs,
    scope: {
      path: SCOPE_PATH,
      sha256: context.scopeSha256,
      componentInventories: context.scope.componentInventories,
      exclusions: context.scope.exclusions,
    },
    tooling: {
      lock: {
        path: TOOLS_LOCK_PATH,
        sha256: context.toolsLockSha256,
      },
      generator: {
        id: context.toolsLock.generator.id,
        version: SOURCE_ALPHA_GENERATOR_VERSION,
        path: GENERATOR_PATH,
        sha256: context.generatorSha256,
      },
      executed: [
        { id: "deno", version: Deno.version.deno },
        { id: "git", version: context.gitVersion },
      ],
      notExecuted: context.toolsLock.notExecutedTools,
    },
    artifacts: [
      {
        path: "source.sbom.cdx.json",
        mediaType: "application/vnd.cyclonedx+json",
        sha256: await sha256Text(bomText),
      },
    ],
  };
  const manifestText = canonicalJson(manifest);
  const noticesText = renderNotices(bom);
  return { context, bom, bomText, manifest, manifestText, noticesText };
}

function readBomComponents(bom: JsonRecord): Component[] {
  const components = bom.components;
  if (!Array.isArray(components)) {
    throw new TypeError("CycloneDX output must contain components.");
  }
  return components.filter(isRecord).map((component) =>
    component as unknown as Component
  );
}

export function renderNotices(bom: JsonRecord): string {
  const lines = [
    "# Third-party source inventory notices",
    "",
    "This deterministic inventory is derived only from the included source lockfiles.",
    "It is not a substitute for notices required by an OCI image, Desktop bundle,",
    "downloaded runtime, package cache, provider, worker, or other distributed artifact.",
    "`NOASSERTION` means the source lock did not provide a value; it is not a guessed licence.",
    "",
    "| Component | Version | Source lock | Declared licence | Integrity |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (
    const component of readBomComponents(bom).sort((left, right) =>
      left["bom-ref"].localeCompare(right["bom-ref"])
    )
  ) {
    const properties = new Map(
      component.properties.map((property) => [property.name, property.value]),
    );
    const license = component.licenses[0]?.license.name ?? "NOASSERTION";
    lines.push(
      `| ${escapeCell(component.name)} | ${escapeCell(component.version)} | ${
        escapeCell(properties.get("casys:inventory-source") ?? "NOASSERTION")
      } | ${escapeCell(license)} | ${
        escapeCell(properties.get("casys:integrity") ?? "NOASSERTION")
      } |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|");
}

async function writeChecksums(outputDirectory: URL): Promise<string> {
  const checksums = await Promise.all(RELEASE_FILE_NAMES.map(async (fileName) => {
    const bytes = await Deno.readFile(new URL(fileName, outputDirectory));
    return { fileName, sha256: await sha256(bytes) };
  }));
  const text = checksums
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
    .map(({ fileName, sha256 }) => `${sha256}  ${fileName}`)
    .join("\n") + "\n";
  await Deno.writeTextFile(new URL("SHA256SUMS", outputDirectory), text);
  return text;
}

export async function buildSourceAlphaRelease(
  options: BuildSourceAlphaReleaseOptions,
): Promise<{
  readonly outputDirectory: URL;
  readonly context: SourceAlphaReleaseContext;
}> {
  const outputDirectory = outputDirectoryForTag(options.tag, options.outputRoot);
  const rendered = await renderRelease(
    options.tag,
    REPOSITORY_ROOT,
    options.allowUncommittedForTest === true,
  );
  await Deno.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    Deno.writeFile(
      new URL("source.tar.gz", outputDirectory),
      rendered.context.sourceArchive,
    ),
    Deno.writeTextFile(
      new URL("source.sbom.cdx.json", outputDirectory),
      rendered.bomText,
    ),
    Deno.writeTextFile(
      new URL("source-release-manifest.json", outputDirectory),
      rendered.manifestText,
    ),
    Deno.writeTextFile(
      new URL("THIRD_PARTY_NOTICES.md", outputDirectory),
      rendered.noticesText,
    ),
  ]);
  await writeChecksums(outputDirectory);
  return { outputDirectory, context: rendered.context };
}

export async function renderThirdPartyNotices(options: {
  readonly tag: string;
  readonly outputRoot?: URL;
}): Promise<{ readonly outputDirectory: URL; readonly noticesSha256: string }> {
  const outputDirectory = outputDirectoryForTag(options.tag, options.outputRoot);
  const bom = JSON.parse(
    await Deno.readTextFile(new URL("source.sbom.cdx.json", outputDirectory)),
  );
  if (!isRecord(bom) || bom.bomFormat !== "CycloneDX" || bom.specVersion !== "1.6") {
    throw new TypeError(
      "source.sbom.cdx.json must be a CycloneDX 1.6 document before notices can be rendered.",
    );
  }
  const notices = renderNotices(bom);
  await Deno.writeTextFile(new URL("THIRD_PARTY_NOTICES.md", outputDirectory), notices);
  await writeChecksums(outputDirectory);
  return { outputDirectory, noticesSha256: await sha256Text(notices) };
}

export async function verifySourceAlphaRelease(options: {
  readonly tag: string;
  readonly outputRoot?: URL;
  readonly allowUncommittedForTest?: boolean;
}): Promise<
  { readonly outputDirectory: URL; readonly checkedFiles: readonly string[] }
> {
  const outputDirectory = outputDirectoryForTag(options.tag, options.outputRoot);
  const expected = await renderRelease(
    options.tag,
    REPOSITORY_ROOT,
    options.allowUncommittedForTest === true,
  );
  const expectedFiles: Readonly<
    Record<(typeof RELEASE_FILE_NAMES)[number], Uint8Array>
  > = {
    "source-release-manifest.json": new TextEncoder().encode(expected.manifestText),
    "source.sbom.cdx.json": new TextEncoder().encode(expected.bomText),
    "source.tar.gz": expected.context.sourceArchive,
    "THIRD_PARTY_NOTICES.md": new TextEncoder().encode(expected.noticesText),
  };
  for (const fileName of RELEASE_FILE_NAMES) {
    const actual = await Deno.readFile(new URL(fileName, outputDirectory));
    const required = expectedFiles[fileName];
    if (
      actual.byteLength !== required.byteLength || toHex(actual) !== toHex(required)
    ) {
      throw new Error(
        `${fileName} does not match a fresh deterministic source-alpha rendering for ${options.tag}.`,
      );
    }
  }
  const expectedChecksums =
    (await Promise.all(RELEASE_FILE_NAMES.map(async (fileName) => {
      return { fileName, sha256: await sha256(expectedFiles[fileName]) };
    })))
      .sort((left, right) => left.fileName.localeCompare(right.fileName))
      .map(({ fileName, sha256 }) => `${sha256}  ${fileName}`)
      .join("\n") + "\n";
  const actualChecksums = await Deno.readTextFile(
    new URL("SHA256SUMS", outputDirectory),
  );
  if (actualChecksums !== expectedChecksums) {
    throw new Error(
      "SHA256SUMS does not match the deterministic source-alpha artifacts.",
    );
  }
  return { outputDirectory, checkedFiles: [...RELEASE_FILE_NAMES, "SHA256SUMS"] };
}

export function sourceAlphaTagFromArgs(args: readonly string[]): string {
  let tag: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (argument === "--tag") {
      tag = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--tag=")) {
      tag = argument.slice("--tag=".length);
      continue;
    }
    throw new TypeError(`Unknown argument: ${argument}. Expected --tag <tag>.`);
  }
  if (!tag) throw new TypeError("Missing --tag <tag>.");
  outputDirectoryForTag(tag);
  return tag;
}
