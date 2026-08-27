/**
 * Provider-free lowering of one exact Build123d workspace closure.
 *
 * This is deliberately not a Python module loader.  `ProjectSourceWorkspace`
 * has already resolved and sealed the exact closure; this contract proves the
 * one narrow shape which can be represented by the existing one-script CAD
 * execution boundary:
 *
 * - one Build123d root;
 * - zero or more direct dependency leaves containing only finite scalar
 *   bindings and arithmetic over earlier bindings;
 * - one module-level, explicit `from casys_workspace.<sealed-module> import
 *   name` statement for each direct leaf; and
 * - a deterministic concatenation which removes those workspace imports.
 *
 * No file is staged in a provider, no `sys.path` is changed, no capture,
 * admission, canonical export, or isolated execution is wired here.  In
 * particular, adding this pure lowerer does not make
 * `source.dependency-lowering-unavailable` disappear from compilation.
 */

import { parser } from "@lezer/python";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type ProjectSourceClosure,
  type ProjectSourceClosureFile,
  validateProjectSourceClosure,
} from "../../project-source-workspace/closure.ts";
import {
  GeometryScriptValidationError,
  validateGeometryScript,
} from "./geometry-script-validation.ts";
import { isQualifiedUnsignedDecimalLiteral } from "../../sensitivity/study/sensitivity-source-substitution.ts";

export const BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA =
  "build123d-workspace-closure-lowering/1.0" as const;
export const BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND =
  "build123d-workspace-closure-lowering" as const;
export const BUILD123D_WORKSPACE_IMPORT_PREFIX = "casys_workspace" as const;

const PYTHON_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PYTHON_KEYWORDS = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

export type Build123dWorkspaceClosureLoweringErrorCode =
  | "invalid_input"
  | "invalid_closure"
  | "exact_source_missing"
  | "exact_source_unexpected"
  | "source_fingerprint_mismatch"
  | "closure_not_direct"
  | "invalid_virtual_module"
  | "ambiguous_virtual_module"
  | "python_syntax"
  | "workspace_import_not_module_level"
  | "workspace_import_not_prelude"
  | "unsupported_workspace_import_syntax"
  | "duplicate_workspace_import"
  | "workspace_import_unsealed_dependency"
  | "dependency_import_missing"
  | "unknown_imported_name"
  | "duplicate_imported_name"
  | "data_module_import_forbidden"
  | "data_module_not_static"
  | "data_module_duplicate_binding"
  | "data_module_result_forbidden"
  | "data_module_undefined_reference"
  | "data_module_non_finite"
  | "name_collision"
  | "root_binding_collision"
  | "root_unimported_dependency_binding"
  | "lowered_script_rejected";

export class Build123dWorkspaceClosureLoweringError extends Error {
  constructor(
    readonly code: Build123dWorkspaceClosureLoweringErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "Build123dWorkspaceClosureLoweringError";
  }
}

/**
 * Exact reopened bytes for one file already named by the sealed closure.
 *
 * V1 deliberately has no caller-supplied path or logical-name resolver. The
 * virtual Python module is derived only from the sealed file id. Revision,
 * logical name, caller path, and latest are never part of that import
 * identity. Exact fileId@revision and the resource digest stay pinned on the
 * sealed closure and the lowering manifest.
 */
export interface Build123dWorkspaceClosureLoweringSource {
  readonly fileId: string;
  readonly fileRevision: number;
  readonly sourceText: string;
}

/** Exact closure plus the separately reopened texts needed by this pure pass. */
export interface Build123dWorkspaceClosureLoweringInput {
  readonly closure: ProjectSourceClosure;
  readonly root: Build123dWorkspaceClosureLoweringSource;
  readonly dependencies: readonly Build123dWorkspaceClosureLoweringSource[];
}

export interface Build123dWorkspaceClosureLoweringOffsetRange {
  /** UTF-16 code-unit offsets in the named exact source or lowered script. */
  readonly start: number;
  readonly end: number;
}

export interface Build123dWorkspaceClosureLoweringFileIdentity {
  readonly fileId: string;
  readonly fileRevision: number;
  readonly sourceFingerprint: ContentFingerprint;
}

export interface Build123dWorkspaceClosureLoweringSourceMapSegment {
  readonly output: Build123dWorkspaceClosureLoweringOffsetRange;
  readonly source: Build123dWorkspaceClosureLoweringFileIdentity & {
    /** Offsets in the exact source text, before any lowering. */
    readonly span: Build123dWorkspaceClosureLoweringOffsetRange;
  };
}

export interface Build123dWorkspaceClosureLoweringImport {
  readonly module: string;
  readonly dependency: Build123dWorkspaceClosureLoweringFileIdentity;
  readonly names: readonly string[];
  /** Exact physical source material removed for this workspace import. */
  readonly source: Build123dWorkspaceClosureLoweringFileIdentity & {
    /** The parsed import statement, excluding a trailing comment or line break. */
    readonly statement: Build123dWorkspaceClosureLoweringOffsetRange;
    /** The full removed physical line, including a trailing comment and CRLF/LF. */
    readonly removal: Build123dWorkspaceClosureLoweringOffsetRange;
  };
}

export interface Build123dWorkspaceClosureLoweringManifest {
  readonly schemaVersion: typeof BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA;
  readonly kind: typeof BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND;
  readonly closure: {
    readonly fingerprint: ContentFingerprint;
    readonly root: {
      readonly fileId: string;
      readonly fileRevision: number;
    };
  };
  /** Dependencies are canonical virtual-module order; root is always last. */
  readonly sources: readonly ({
    readonly role: "dependency" | "root";
    readonly virtualModule: string;
  } & Build123dWorkspaceClosureLoweringFileIdentity)[];
  readonly imports: readonly Build123dWorkspaceClosureLoweringImport[];
  /** Only copied source bytes appear here; generated separator newlines do not. */
  readonly sourceMap: readonly Build123dWorkspaceClosureLoweringSourceMapSegment[];
  readonly script: {
    /** UTF-8 byte length for the content-addressed lowered script. */
    readonly byteCount: number;
    /** UTF-16 code-unit length used by source-map output offsets. */
    readonly utf16Length: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly fingerprint: ContentFingerprint;
}

type Build123dWorkspaceClosureLoweringManifestBody = Omit<
  Build123dWorkspaceClosureLoweringManifest,
  "fingerprint"
>;

const BUILD123D_WORKSPACE_CLOSURE_LOWERING_MANIFEST_BODY_KEYS = [
  "schemaVersion",
  "kind",
  "closure",
  "sources",
  "imports",
  "sourceMap",
  "script",
] as const;
const BUILD123D_WORKSPACE_CLOSURE_LOWERING_MANIFEST_KEYS = [
  ...BUILD123D_WORKSPACE_CLOSURE_LOWERING_MANIFEST_BODY_KEYS,
  "fingerprint",
] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Parse the unsigned manifest body into its one canonical v1 representation.
 *
 * This validates only the lowering receipt itself.  It does not reopen the
 * project-source closure, source texts, or script bytes; those exact bytes are
 * deliberately outside this compact manifest and remain a separate boundary.
 */
export function canonicalizeBuild123dWorkspaceClosureLoweringManifestBody(
  value: unknown,
  path = "$build123dWorkspaceClosureLoweringManifest",
): Build123dWorkspaceClosureLoweringManifestBody {
  const root = exactRecord(
    value,
    BUILD123D_WORKSPACE_CLOSURE_LOWERING_MANIFEST_BODY_KEYS,
    path,
  );
  return deepFreeze(parseBuild123dWorkspaceClosureLoweringManifestBody(root, path));
}

/**
 * Recompute the SHA-256 over an unsigned manifest body with the exact v1 root
 * shape. Callers that seal a manifest must canonicalize it first; the
 * persistence validator remains responsible for rejecting malformed nested
 * facts even when they carry a correctly recomputed outer digest.
 */
export async function fingerprintBuild123dWorkspaceClosureLoweringManifestBody(
  value: unknown,
  path = "$build123dWorkspaceClosureLoweringManifest",
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(
    exactRecord(value, BUILD123D_WORKSPACE_CLOSURE_LOWERING_MANIFEST_BODY_KEYS, path),
  );
}

/**
 * Validate one persisted lowering manifest, including the SHA-256 fingerprint
 * of its exact canonical unsigned body.
 */
export async function validateBuild123dWorkspaceClosureLoweringManifest(
  value: unknown,
  path = "$build123dWorkspaceClosureLoweringManifest",
): Promise<Build123dWorkspaceClosureLoweringManifest> {
  const root = exactRecord(
    value,
    BUILD123D_WORKSPACE_CLOSURE_LOWERING_MANIFEST_KEYS,
    path,
  );
  const body = parseBuild123dWorkspaceClosureLoweringManifestBody(root, path);
  const fingerprint = parseManifestFingerprint(
    root.fingerprint,
    `${path}.fingerprint`,
  );
  const observed = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, observed)) {
    throw new TypeError(
      `${path}.fingerprint must equal the SHA-256 of the canonical manifest body.`,
    );
  }
  return deepFreeze({ ...body, fingerprint: observed });
}

/**
 * Compare every validated lowering-manifest fact.  The outer fingerprint is
 * included but never used as a shortcut for its nested provenance.
 */
export function build123dWorkspaceClosureLoweringManifestsEqual(
  left: Build123dWorkspaceClosureLoweringManifest,
  right: Build123dWorkspaceClosureLoweringManifest,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.kind === right.kind &&
    fingerprintsEqual(left.closure.fingerprint, right.closure.fingerprint) &&
    fileRevisionsEqual(left.closure.root, right.closure.root) &&
    left.sources.length === right.sources.length &&
    left.sources.every((source, index) =>
      manifestSourcesEqual(source, right.sources[index]!)
    ) &&
    left.imports.length === right.imports.length &&
    left.imports.every((entry, index) =>
      manifestImportsEqual(entry, right.imports[index]!)
    ) &&
    left.sourceMap.length === right.sourceMap.length &&
    left.sourceMap.every((segment, index) =>
      manifestSourceMapSegmentsEqual(segment, right.sourceMap[index]!)
    ) &&
    left.script.byteCount === right.script.byteCount &&
    left.script.utf16Length === right.script.utf16Length &&
    fingerprintsEqual(left.script.fingerprint, right.script.fingerprint) &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

/** Assert equality of every nested lowering-manifest fact. */
export function assertBuild123dWorkspaceClosureLoweringManifestsEqual(
  expected: Build123dWorkspaceClosureLoweringManifest,
  observed: Build123dWorkspaceClosureLoweringManifest,
  path: string,
): void {
  if (!build123dWorkspaceClosureLoweringManifestsEqual(expected, observed)) {
    throw new TypeError(
      `${path} does not match the complete Build123d workspace-closure lowering manifest.`,
    );
  }
}

export interface Build123dWorkspaceClosureLoweringResult {
  readonly schemaVersion: typeof BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA;
  readonly kind: typeof BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND;
  /** One deterministic Python script with no casys_workspace import left. */
  readonly script: string;
  readonly scriptFingerprint: ContentFingerprint;
  readonly manifest: Build123dWorkspaceClosureLoweringManifest;
}

interface ParsedNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly isError: boolean;
  readonly children: readonly ParsedNode[];
}

interface ResolvedSource extends Build123dWorkspaceClosureLoweringSource {
  readonly closureFile: ProjectSourceClosureFile;
  readonly sourceFingerprint: ContentFingerprint;
  readonly virtualModule: string;
}

interface DataBinding {
  readonly name: string;
  readonly value: number;
  readonly references: readonly string[];
  readonly span: Build123dWorkspaceClosureLoweringOffsetRange;
}

interface DataModule {
  readonly source: ResolvedSource;
  readonly bindings: ReadonlyMap<string, DataBinding>;
}

interface LoweredDataModule extends DataModule {
  /** Only the explicitly imported bindings and their static prerequisites. */
  readonly emittedBindings: readonly DataBinding[];
}

interface WorkspaceImportCandidate {
  readonly module: string;
  readonly names: readonly string[];
  readonly span: Build123dWorkspaceClosureLoweringOffsetRange;
  readonly removal: Build123dWorkspaceClosureLoweringOffsetRange;
}

interface LoweringPlan {
  readonly closure: ProjectSourceClosure;
  readonly root: ResolvedSource;
  readonly dependencies: readonly LoweredDataModule[];
  readonly imports: readonly (WorkspaceImportCandidate & {
    readonly dependency: DataModule;
  })[];
  readonly rootFragments: readonly Build123dWorkspaceClosureLoweringOffsetRange[];
}

/**
 * Validate and lower the narrow v1 workspace-import form to one exact script.
 *
 * The function is intentionally async only because every input text, script,
 * and manifest identity is SHA-256-derived.  It performs no I/O and invokes no
 * provider/runtime.
 */
export async function lowerBuild123dWorkspaceClosure(
  input: Build123dWorkspaceClosureLoweringInput,
): Promise<Build123dWorkspaceClosureLoweringResult> {
  const plan = await validateAndPlan(input);
  const builder = new LoweredScriptBuilder();

  for (const dependency of plan.dependencies) {
    for (const binding of dependency.emittedBindings) {
      builder.appendSource(dependency.source, binding.span);
      builder.appendGenerated("\n");
    }
    // A generated blank line is the only syntactic material inserted by v1.
    builder.appendGenerated("\n");
  }
  for (const fragment of plan.rootFragments) {
    builder.appendSource(plan.root, fragment);
  }

  const script = builder.text;
  try {
    // The lowered result must still satisfy the existing D4 reachability
    // boundary.  This is not admission or provider qualification.
    validateGeometryScript(script);
  } catch (cause) {
    const detail = cause instanceof GeometryScriptValidationError
      ? `${cause.code}: ${cause.message}`
      : cause instanceof Error
      ? cause.message
      : "unknown validator failure";
    fail(
      "lowered_script_rejected",
      `The lowered Build123d script does not pass D4: ${detail}`,
    );
  }

  const scriptFingerprint = await fingerprintUtf8(script);
  const sources = [
    ...plan.dependencies.map((dependency) => ({
      role: "dependency" as const,
      virtualModule: dependency.source.virtualModule,
      ...sourceIdentity(dependency.source),
    })),
    {
      role: "root" as const,
      virtualModule: plan.root.virtualModule,
      ...sourceIdentity(plan.root),
    },
  ];
  const imports = plan.imports.map((item) => ({
    module: item.module,
    dependency: sourceIdentity(item.dependency.source),
    names: [...item.names],
    source: {
      ...sourceIdentity(plan.root),
      statement: item.span,
      removal: item.removal,
    },
  }));
  const manifestFacts = canonicalizeBuild123dWorkspaceClosureLoweringManifestBody({
    schemaVersion: BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
    kind: BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND,
    closure: {
      fingerprint: plan.closure.fingerprint,
      root: {
        fileId: plan.closure.root.fileId,
        fileRevision: plan.closure.root.fileRevision,
      },
    },
    sources,
    imports,
    sourceMap: builder.sourceMap,
    script: {
      byteCount: new TextEncoder().encode(script).byteLength,
      utf16Length: script.length,
      fingerprint: scriptFingerprint,
    },
  });
  const manifest = deepFreeze({
    ...manifestFacts,
    fingerprint: await fingerprintBuild123dWorkspaceClosureLoweringManifestBody(
      manifestFacts,
    ),
  }) as Build123dWorkspaceClosureLoweringManifest;
  return deepFreeze({
    schemaVersion: BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
    kind: BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND,
    script,
    scriptFingerprint,
    manifest,
  });
}

function parseBuild123dWorkspaceClosureLoweringManifestBody(
  root: Record<string, unknown>,
  path: string,
): Build123dWorkspaceClosureLoweringManifestBody {
  literalValue(
    root.schemaVersion,
    BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.kind, BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND, `${path}.kind`);
  const closure = parseManifestClosure(root.closure, `${path}.closure`);
  const sources = nonEmptyArray(root.sources, `${path}.sources`).map(
    (source, index) => parseManifestSource(source, `${path}.sources[${index}]`),
  );
  assertCanonicalManifestSources(sources, closure, `${path}.sources`);
  const script = parseManifestScript(root.script, `${path}.script`);
  const imports = arrayOf(root.imports, `${path}.imports`).map((entry, index) =>
    parseManifestImport(entry, `${path}.imports[${index}]`)
  );
  assertCanonicalManifestImports(
    imports,
    sources,
    `${path}.imports`,
  );
  const sourceMap = nonEmptyArray(root.sourceMap, `${path}.sourceMap`).map(
    (segment, index) =>
      parseManifestSourceMapSegment(segment, `${path}.sourceMap[${index}]`),
  );
  assertCanonicalManifestSourceMap(
    sourceMap,
    sources,
    script.utf16Length,
    `${path}.sourceMap`,
  );
  return {
    schemaVersion: BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
    kind: BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND,
    closure,
    sources,
    imports,
    sourceMap,
    script,
  };
}

function parseManifestClosure(
  value: unknown,
  path: string,
): Build123dWorkspaceClosureLoweringManifest["closure"] {
  const root = exactRecord(value, ["fingerprint", "root"], path);
  return {
    fingerprint: parseManifestFingerprint(root.fingerprint, `${path}.fingerprint`),
    root: parseManifestFileRevision(root.root, `${path}.root`),
  };
}

function parseManifestSource(
  value: unknown,
  path: string,
): Build123dWorkspaceClosureLoweringManifest["sources"][number] {
  const root = exactRecord(
    value,
    ["role", "virtualModule", "fileId", "fileRevision", "sourceFingerprint"],
    path,
  );
  if (root.role !== "dependency" && root.role !== "root") {
    throw new TypeError(`${path}.role must be dependency or root.`);
  }
  const identity = parseManifestFileIdentityRecord(root, path);
  const virtualModule = nonEmptyText(root.virtualModule, `${path}.virtualModule`);
  const expectedModule = virtualModuleFor(identity);
  if (virtualModule !== expectedModule) {
    throw new TypeError(
      `${path}.virtualModule must be the stable fileId-only module ${expectedModule}.`,
    );
  }
  return {
    role: root.role,
    virtualModule,
    ...identity,
  };
}

function parseManifestImport(
  value: unknown,
  path: string,
): Build123dWorkspaceClosureLoweringImport {
  const root = exactRecord(value, ["module", "dependency", "names", "source"], path);
  const names = nonEmptyArray(root.names, `${path}.names`).map((name, index) => {
    const parsed = nonEmptyText(name, `${path}.names[${index}]`);
    if (!isPythonIdentifier(parsed)) {
      throw new TypeError(`${path}.names[${index}] must be one Python identifier.`);
    }
    return parsed;
  });
  if (new Set(names).size !== names.length) {
    throw new TypeError(`${path}.names must not contain duplicates.`);
  }
  const source = exactRecord(
    root.source,
    ["fileId", "fileRevision", "sourceFingerprint", "statement", "removal"],
    `${path}.source`,
  );
  return {
    module: nonEmptyText(root.module, `${path}.module`),
    dependency: parseManifestFileIdentity(
      root.dependency,
      `${path}.dependency`,
    ),
    names,
    source: {
      ...parseManifestFileIdentityRecord(source, `${path}.source`),
      statement: parseManifestOffsetRange(
        source.statement,
        `${path}.source.statement`,
        true,
      ),
      removal: parseManifestOffsetRange(
        source.removal,
        `${path}.source.removal`,
        true,
      ),
    },
  };
}

function parseManifestSourceMapSegment(
  value: unknown,
  path: string,
): Build123dWorkspaceClosureLoweringSourceMapSegment {
  const root = exactRecord(value, ["output", "source"], path);
  const source = exactRecord(
    root.source,
    ["fileId", "fileRevision", "sourceFingerprint", "span"],
    `${path}.source`,
  );
  return {
    output: parseManifestOffsetRange(root.output, `${path}.output`, true),
    source: {
      ...parseManifestFileIdentityRecord(source, `${path}.source`),
      span: parseManifestOffsetRange(source.span, `${path}.source.span`, true),
    },
  };
}

function parseManifestScript(
  value: unknown,
  path: string,
): Build123dWorkspaceClosureLoweringManifest["script"] {
  const root = exactRecord(
    value,
    ["byteCount", "utf16Length", "fingerprint"],
    path,
  );
  return {
    byteCount: nonNegativeSafeInteger(root.byteCount, `${path}.byteCount`),
    utf16Length: nonNegativeSafeInteger(
      root.utf16Length,
      `${path}.utf16Length`,
    ),
    fingerprint: parseManifestFingerprint(root.fingerprint, `${path}.fingerprint`),
  };
}

function parseManifestFileRevision(
  value: unknown,
  path: string,
): Build123dWorkspaceClosureLoweringManifest["closure"]["root"] {
  const root = exactRecord(value, ["fileId", "fileRevision"], path);
  return {
    fileId: parseManifestFileId(root.fileId, `${path}.fileId`),
    fileRevision: positiveInteger(root.fileRevision, `${path}.fileRevision`),
  };
}

function parseManifestFileIdentity(
  value: unknown,
  path: string,
): Build123dWorkspaceClosureLoweringFileIdentity {
  const root = exactRecord(
    value,
    ["fileId", "fileRevision", "sourceFingerprint"],
    path,
  );
  return parseManifestFileIdentityRecord(root, path);
}

function parseManifestFileIdentityRecord(
  root: Record<string, unknown>,
  path: string,
): Build123dWorkspaceClosureLoweringFileIdentity {
  return {
    fileId: parseManifestFileId(root.fileId, `${path}.fileId`),
    fileRevision: positiveInteger(root.fileRevision, `${path}.fileRevision`),
    sourceFingerprint: parseManifestFingerprint(
      root.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
  };
}

function parseManifestFileId(value: unknown, path: string): string {
  const fileId = safeId(value, path);
  if (fileId.toLowerCase() === "latest") {
    throw new TypeError(`${path} must not use a latest alias.`);
  }
  return fileId;
}

function parseManifestFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(root.digest, `${path}.digest`);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest };
}

function parseManifestOffsetRange(
  value: unknown,
  path: string,
  requireContent: boolean,
): Build123dWorkspaceClosureLoweringOffsetRange {
  const root = exactRecord(value, ["start", "end"], path);
  const start = nonNegativeSafeInteger(root.start, `${path}.start`);
  const end = nonNegativeSafeInteger(root.end, `${path}.end`);
  if (end < start || (requireContent && end === start)) {
    throw new TypeError(`${path} must be an ordered non-empty UTF-16 offset range.`);
  }
  return { start, end };
}

function assertCanonicalManifestSources(
  sources: readonly Build123dWorkspaceClosureLoweringManifest["sources"][number][],
  closure: Build123dWorkspaceClosureLoweringManifest["closure"],
  path: string,
): void {
  const root = sources.at(-1)!;
  if (
    root.role !== "root" ||
    sources.slice(0, -1).some((source) => source.role !== "dependency")
  ) {
    throw new TypeError(
      `${path} must list canonical dependencies followed by one root.`,
    );
  }
  if (!fileRevisionsEqual(root, closure.root)) {
    throw new TypeError(
      `${path} root must match $build123dWorkspaceClosureLoweringManifest.closure.root.`,
    );
  }
  const identities = new Set<string>();
  const fileIds = new Set<string>();
  const modules = new Set<string>();
  for (const source of sources) {
    const identity = manifestIdentityKey(source);
    if (
      identities.has(identity) || fileIds.has(source.fileId) ||
      modules.has(source.virtualModule)
    ) {
      throw new TypeError(
        `${path} must have unique file identities and virtual modules.`,
      );
    }
    identities.add(identity);
    fileIds.add(source.fileId);
    modules.add(source.virtualModule);
  }
  for (let index = 1; index < sources.length - 1; index++) {
    if (
      compareText(sources[index - 1]!.virtualModule, sources[index]!.virtualModule) >= 0
    ) {
      throw new TypeError(
        `${path} dependencies must be sorted by stable virtual module.`,
      );
    }
  }
}

function assertCanonicalManifestImports(
  imports: readonly Build123dWorkspaceClosureLoweringImport[],
  sources: readonly Build123dWorkspaceClosureLoweringManifest["sources"][number][],
  path: string,
): void {
  const root = sources.at(-1)!;
  const dependencies = sources.slice(0, -1);
  if (imports.length !== dependencies.length) {
    throw new TypeError(`${path} must cover every dependency exactly once.`);
  }
  const modules = new Set<string>();
  const importedNames = new Set<string>();
  for (const [index, entry] of imports.entries()) {
    const dependency = dependencies[index]!;
    if (
      entry.module !== dependency.virtualModule ||
      !fileIdentitiesEqual(entry.dependency, dependency)
    ) {
      throw new TypeError(
        `${path}[${index}] must match the exact dependency at its canonical module order.`,
      );
    }
    if (!fileIdentitiesEqual(entry.source, root)) {
      throw new TypeError(
        `${path}[${index}].source must be the exact listed root source.`,
      );
    }
    if (modules.has(entry.module)) {
      throw new TypeError(`${path} must not import one dependency more than once.`);
    }
    modules.add(entry.module);
    for (const name of entry.names) {
      if (importedNames.has(name)) {
        throw new TypeError(`${path} must not repeat an imported name.`);
      }
      importedNames.add(name);
    }
    if (
      entry.source.statement.start !== entry.source.removal.start ||
      entry.source.statement.end > entry.source.removal.end
    ) {
      throw new TypeError(
        `${path}[${index}] must retain its exact root import statement and removal span.`,
      );
    }
  }
  const removals = [...imports].sort((left, right) =>
    left.source.removal.start - right.source.removal.start
  );
  for (let index = 1; index < removals.length; index++) {
    if (
      removals[index]!.source.removal.start < removals[index - 1]!.source.removal.end
    ) {
      throw new TypeError(`${path} must have non-overlapping root import removals.`);
    }
  }
}

function assertCanonicalManifestSourceMap(
  sourceMap: readonly Build123dWorkspaceClosureLoweringSourceMapSegment[],
  sources: readonly Build123dWorkspaceClosureLoweringManifest["sources"][number][],
  scriptUtf16Length: number,
  path: string,
): void {
  const sourceIndexes = new Map(
    sources.map((source, index) => [manifestIdentityKey(source), index]),
  );
  const mapped = new Set<number>();
  let previousOutputEnd = 0;
  let previousSourceIndex = -1;
  let previousSourceEnd = 0;
  for (const [index, segment] of sourceMap.entries()) {
    const sourceIndex = sourceIndexes.get(manifestIdentityKey(segment.source));
    if (sourceIndex === undefined) {
      throw new TypeError(
        `${path}[${index}].source must name one exact listed source.`,
      );
    }
    if (
      segment.output.start < previousOutputEnd ||
      segment.output.end > scriptUtf16Length ||
      segment.output.end - segment.output.start !==
        segment.source.span.end - segment.source.span.start ||
      sourceIndex < previousSourceIndex ||
      (sourceIndex === previousSourceIndex &&
        segment.source.span.start < previousSourceEnd)
    ) {
      throw new TypeError(`${path} must be in canonical output and source order.`);
    }
    previousOutputEnd = segment.output.end;
    previousSourceIndex = sourceIndex;
    previousSourceEnd = segment.source.span.end;
    mapped.add(sourceIndex);
  }
  if (mapped.size !== sources.length) {
    throw new TypeError(`${path} must retain copied spans from every listed source.`);
  }
}

function manifestSourcesEqual(
  left: Build123dWorkspaceClosureLoweringManifest["sources"][number],
  right: Build123dWorkspaceClosureLoweringManifest["sources"][number],
): boolean {
  return left.role === right.role && left.virtualModule === right.virtualModule &&
    fileIdentitiesEqual(left, right);
}

function manifestImportsEqual(
  left: Build123dWorkspaceClosureLoweringImport,
  right: Build123dWorkspaceClosureLoweringImport,
): boolean {
  return left.module === right.module &&
    fileIdentitiesEqual(left.dependency, right.dependency) &&
    textArraysEqual(left.names, right.names) &&
    fileIdentitiesEqual(left.source, right.source) &&
    offsetRangesEqual(left.source.statement, right.source.statement) &&
    offsetRangesEqual(left.source.removal, right.source.removal);
}

function manifestSourceMapSegmentsEqual(
  left: Build123dWorkspaceClosureLoweringSourceMapSegment,
  right: Build123dWorkspaceClosureLoweringSourceMapSegment,
): boolean {
  return offsetRangesEqual(left.output, right.output) &&
    fileIdentitiesEqual(left.source, right.source) &&
    offsetRangesEqual(left.source.span, right.source.span);
}

function fileRevisionsEqual(
  left: { readonly fileId: string; readonly fileRevision: number },
  right: { readonly fileId: string; readonly fileRevision: number },
): boolean {
  return left.fileId === right.fileId && left.fileRevision === right.fileRevision;
}

function fileIdentitiesEqual(
  left: Build123dWorkspaceClosureLoweringFileIdentity,
  right: Build123dWorkspaceClosureLoweringFileIdentity,
): boolean {
  return fileRevisionsEqual(left, right) &&
    fingerprintsEqual(left.sourceFingerprint, right.sourceFingerprint);
}

function offsetRangesEqual(
  left: Build123dWorkspaceClosureLoweringOffsetRange,
  right: Build123dWorkspaceClosureLoweringOffsetRange,
): boolean {
  return left.start === right.start && left.end === right.end;
}

function textArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function manifestIdentityKey(
  value: Build123dWorkspaceClosureLoweringFileIdentity,
): string {
  return `${
    fileKey(value)
  }:${value.sourceFingerprint.algorithm}:${value.sourceFingerprint.digest}`;
}

async function validateAndPlan(
  value: Build123dWorkspaceClosureLoweringInput,
): Promise<LoweringPlan> {
  const input = parseInput(value);
  let closure: ProjectSourceClosure;
  try {
    closure = await validateProjectSourceClosure(input.closure);
  } catch (cause) {
    fail(
      "invalid_closure",
      `The supplied workspace closure is not an exact sealed closure: ${
        messageOf(cause)
      }`,
    );
  }

  const resolved = await resolveExactSources(closure, input);
  assertDirectLeafClosure(closure, resolved.root, resolved.dependencies);
  assertUnambiguousVirtualModules([resolved.root, ...resolved.dependencies]);

  const dataModules = resolved.dependencies
    .map((source) => parseDataModule(source))
    .sort((left, right) =>
      compareText(
        left.source.virtualModule,
        right.source.virtualModule,
      )
    );
  assertUniqueDataBindingNames(dataModules);

  const rootTree = parsePython(
    planSourceLabel(resolved.root),
    resolved.root.sourceText,
  );
  const workspaceImports = collectWorkspaceImports(rootTree, resolved.root);
  assertWorkspaceImportPrelude(rootTree, workspaceImports, resolved.root);
  const dependencyByModule = new Map(
    dataModules.map((dependency) => [dependency.source.virtualModule, dependency]),
  );
  const importedNames = new Set<string>();
  const imports: (WorkspaceImportCandidate & { readonly dependency: DataModule })[] =
    [];
  for (const candidate of workspaceImports) {
    const dependency = dependencyByModule.get(candidate.module);
    if (dependency === undefined) {
      fail(
        "workspace_import_unsealed_dependency",
        `Workspace import ${candidate.module} does not name one exact direct closure dependency.`,
      );
    }
    for (const name of candidate.names) {
      if (!dependency.bindings.has(name)) {
        fail(
          "unknown_imported_name",
          `Workspace import ${candidate.module} names ${name}, which is not a static binding in ${
            sourceLabel(dependency.source)
          }.`,
        );
      }
      if (importedNames.has(name)) {
        fail(
          "duplicate_imported_name",
          `Workspace import name ${name} is declared more than once.`,
        );
      }
      importedNames.add(name);
    }
    imports.push({ ...candidate, dependency });
  }

  const importedModules = new Set(imports.map((item) => item.module));
  for (const dependency of dataModules) {
    if (!importedModules.has(dependency.source.virtualModule)) {
      fail(
        "dependency_import_missing",
        `Exact direct dependency ${
          sourceLabel(dependency.source)
        } has no matching casys_workspace import in the root.`,
      );
    }
  }

  const dependencyBindingNames = new Set(
    dataModules.flatMap((module) => [...module.bindings.keys()]),
  );
  assertRootBindingIsolation(
    rootTree,
    resolved.root.sourceText,
    workspaceImports,
    dependencyBindingNames,
    importedNames,
    resolved.root,
  );
  const importedNamesByModule = new Map<string, readonly string[]>(
    imports.map((item) => [item.module, item.names]),
  );
  const loweredDependencies = dataModules.map((module) => ({
    ...module,
    emittedBindings: selectedBindingClosure(
      module,
      importedNamesByModule.get(module.source.virtualModule) ?? [],
    ),
  }));

  const rootFragments = sourceFragmentsAfterRemovals(
    resolved.root.sourceText.length,
    imports.map((item) => item.removal),
  );
  return {
    closure,
    root: resolved.root,
    dependencies: loweredDependencies,
    imports: [...imports].sort((left, right) => compareText(left.module, right.module)),
    rootFragments,
  };
}

function parseInput(value: unknown): Build123dWorkspaceClosureLoweringInput {
  try {
    const root = exactRecord(
      value,
      ["closure", "root", "dependencies"],
      "$build123dWorkspaceClosureLowering",
    );
    if (!Array.isArray(root.dependencies)) {
      throw new TypeError(
        "$build123dWorkspaceClosureLowering.dependencies must be an array.",
      );
    }
    return {
      closure: root.closure as ProjectSourceClosure,
      root: parseSource(root.root, "$build123dWorkspaceClosureLowering.root"),
      dependencies: root.dependencies.map((item, index) =>
        parseSource(
          item,
          `$build123dWorkspaceClosureLowering.dependencies[${index}]`,
        )
      ),
    };
  } catch (cause) {
    fail("invalid_input", messageOf(cause));
  }
}

function parseSource(
  value: unknown,
  path: string,
): Build123dWorkspaceClosureLoweringSource {
  const root = exactRecord(
    value,
    ["fileId", "fileRevision", "sourceText"],
    path,
  );
  if (typeof root.fileId !== "string" || root.fileId.length === 0) {
    throw new TypeError(`${path}.fileId must be non-empty text.`);
  }
  if (!Number.isSafeInteger(root.fileRevision) || Number(root.fileRevision) < 1) {
    throw new TypeError(`${path}.fileRevision must be a positive integer.`);
  }
  if (typeof root.sourceText !== "string" || root.sourceText.length === 0) {
    throw new TypeError(`${path}.sourceText must be non-empty text.`);
  }
  if (root.sourceText.includes("\0")) {
    throw new TypeError(`${path}.sourceText must not contain NUL.`);
  }
  return {
    fileId: root.fileId,
    fileRevision: Number(root.fileRevision),
    sourceText: root.sourceText,
  };
}

async function resolveExactSources(
  closure: ProjectSourceClosure,
  input: Build123dWorkspaceClosureLoweringInput,
): Promise<{
  readonly root: ResolvedSource;
  readonly dependencies: readonly ResolvedSource[];
}> {
  const closureByKey = new Map(
    closure.files.map((file) => [fileKey(file), file]),
  );
  const inputSources = [input.root, ...input.dependencies];
  const inputByKey = new Map<string, Build123dWorkspaceClosureLoweringSource>();
  for (const source of inputSources) {
    const key = fileKey(source);
    if (inputByKey.has(key)) {
      fail(
        "exact_source_unexpected",
        `Exact source ${key} is supplied more than once.`,
      );
    }
    inputByKey.set(key, source);
  }
  const rootKey = fileKey(closure.root);
  if (fileKey(input.root) !== rootKey) {
    fail(
      "exact_source_unexpected",
      `The supplied root ${
        fileKey(input.root)
      } does not equal sealed closure root ${rootKey}.`,
    );
  }
  for (const file of closure.files) {
    if (!inputByKey.has(fileKey(file))) {
      fail(
        "exact_source_missing",
        `Exact closure source ${fileKey(file)} was not reopened for lowering.`,
      );
    }
  }
  for (const [key] of inputByKey) {
    if (!closureByKey.has(key)) {
      fail(
        "exact_source_unexpected",
        `Supplied source ${key} is outside the exact sealed closure.`,
      );
    }
  }

  const resolve = async (
    source: Build123dWorkspaceClosureLoweringSource,
  ): Promise<ResolvedSource> => {
    const closureFile = closureByKey.get(fileKey(source));
    if (closureFile === undefined) {
      fail(
        "exact_source_unexpected",
        `Supplied source ${fileKey(source)} is outside the closure.`,
      );
    }
    const sourceFingerprint = await fingerprintUtf8(source.sourceText);
    if (
      !fingerprintsEqual(sourceFingerprint, closureFile.resourceRef.fingerprint) ||
      new TextEncoder().encode(source.sourceText).byteLength !==
        closureFile.resourceRef.byteCount
    ) {
      fail(
        "source_fingerprint_mismatch",
        `Reopened bytes for ${
          sourceLabel(source)
        } do not match its exact closure resource fingerprint.`,
      );
    }
    return {
      ...source,
      closureFile,
      sourceFingerprint,
      virtualModule: virtualModuleFor(closureFile),
    };
  };

  const root = await resolve(input.root);
  const dependencies = await Promise.all(input.dependencies.map(resolve));
  return { root, dependencies };
}

function assertDirectLeafClosure(
  closure: ProjectSourceClosure,
  root: ResolvedSource,
  dependencies: readonly ResolvedSource[],
): void {
  const rootFile = root.closureFile;
  const expectedDependencyKeys = new Set(rootFile.dependencies.map(fileKey));
  if (closure.files.length !== rootFile.dependencies.length + 1) {
    fail(
      "closure_not_direct",
      "Build123d workspace lowering v1 accepts only a root plus direct dependency leaves.",
    );
  }
  if (dependencies.length !== expectedDependencyKeys.size) {
    fail(
      "exact_source_missing",
      "Lowering must receive exactly one source text for every direct closure dependency.",
    );
  }
  for (const file of closure.files) {
    if (fileKey(file) === fileKey(root)) continue;
    if (file.dependencies.length !== 0 || !expectedDependencyKeys.has(fileKey(file))) {
      fail(
        "closure_not_direct",
        `Closure file ${fileKey(file)} is not one direct dependency leaf of the root.`,
      );
    }
  }
  for (const dependency of dependencies) {
    if (!expectedDependencyKeys.has(fileKey(dependency))) {
      fail(
        "closure_not_direct",
        `Supplied dependency ${
          sourceLabel(dependency)
        } is not a direct root dependency.`,
      );
    }
  }
}

function assertUnambiguousVirtualModules(
  sources: readonly ResolvedSource[],
): void {
  const ownerByFileId = new Map<string, ResolvedSource>();
  const ownerByModule = new Map<string, ResolvedSource>();
  for (const source of sources) {
    const existingFile = ownerByFileId.get(source.fileId);
    if (existingFile !== undefined) {
      fail(
        "ambiguous_virtual_module",
        `Virtual module ${source.virtualModule} is ambiguous because ${
          sourceLabel(existingFile)
        } and ${sourceLabel(source)} share the same fileId.`,
      );
    }
    ownerByFileId.set(source.fileId, source);
    const existing = ownerByModule.get(source.virtualModule);
    if (existing !== undefined) {
      fail(
        "ambiguous_virtual_module",
        `Virtual module ${source.virtualModule} resolves both ${
          sourceLabel(existing)
        } and ${sourceLabel(source)}.`,
      );
    }
    ownerByModule.set(source.virtualModule, source);
  }
}

function virtualModuleFor(file: Pick<ProjectSourceClosureFile, "fileId">): string {
  return [
    BUILD123D_WORKSPACE_IMPORT_PREFIX,
    sealedClosureModuleSegment(file.fileId),
  ].join(".");
}

/** A valid Python segment bijectively derived from the sealed file id only. */
function sealedClosureModuleSegment(fileId: string): string {
  const encodedId = [...new TextEncoder().encode(fileId)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const segment = `f_${encodedId}`;
  if (encodedId.length === 0 || !isPythonIdentifier(segment)) {
    fail(
      "invalid_virtual_module",
      `Sealed file id ${
        JSON.stringify(fileId)
      } does not resolve to one supported Python module name.`,
    );
  }
  return segment;
}

function isPythonIdentifier(value: string): boolean {
  return PYTHON_IDENTIFIER.test(value) && !PYTHON_KEYWORDS.has(value) &&
    !/^__.*__$/.test(value);
}

function parseDataModule(source: ResolvedSource): DataModule {
  const root = parsePython(planSourceLabel(source), source.sourceText);
  const bindings = new Map<string, DataBinding>();
  for (const statement of root.children) {
    // Lezer retains comments as direct top-level children. V1 treats them as
    // non-semantic annotation only: they are accepted but not copied into the
    // lowered script or source map.
    if (statement.name === "Comment") continue;
    if (statement.name === "ImportStatement") {
      fail(
        "data_module_import_forbidden",
        `Data dependency ${sourceLabel(source)} must not import another module.`,
      );
    }
    if (statement.name !== "AssignStatement") {
      fail(
        "data_module_not_static",
        `Data dependency ${
          sourceLabel(source)
        } contains ${statement.name}; v1 accepts only simple module-level scalar assignments.`,
      );
    }
    const assignment = simpleAssignment(statement, source.sourceText);
    if (assignment === undefined) {
      fail(
        "data_module_not_static",
        `Data dependency ${sourceLabel(source)} must assign one simple name with '='.`,
      );
    }
    if (assignment.name === "result") {
      fail(
        "data_module_result_forbidden",
        `Data dependency ${sourceLabel(source)} must not bind result.`,
      );
    }
    if (!isPythonIdentifier(assignment.name)) {
      fail(
        "data_module_not_static",
        `Data dependency ${
          sourceLabel(source)
        } has unsupported binding ${assignment.name}.`,
      );
    }
    if (bindings.has(assignment.name)) {
      fail(
        "data_module_duplicate_binding",
        `Data dependency ${
          sourceLabel(source)
        } binds ${assignment.name} more than once.`,
      );
    }
    const value = evaluateStaticExpression(
      assignment.rhs,
      source.sourceText,
      bindings,
      source,
    );
    bindings.set(assignment.name, {
      name: assignment.name,
      value,
      references: staticReferences(assignment.rhs, source.sourceText),
      span: { start: statement.from, end: statement.to },
    });
  }
  if (bindings.size === 0) {
    fail(
      "data_module_not_static",
      `Data dependency ${
        sourceLabel(source)
      } must contain at least one static binding.`,
    );
  }
  return { source, bindings };
}

function assertUniqueDataBindingNames(dataModules: readonly DataModule[]): void {
  const ownerByName = new Map<string, DataModule>();
  for (const module of dataModules) {
    for (const binding of module.bindings.values()) {
      const existing = ownerByName.get(binding.name);
      if (existing !== undefined) {
        fail(
          "name_collision",
          `Static binding ${binding.name} occurs in both ${
            sourceLabel(existing.source)
          } and ${sourceLabel(module.source)}.`,
        );
      }
      ownerByName.set(binding.name, module);
    }
  }
}

/**
 * Preserve Python module semantics without exposing the dependency module as a
 * runtime global namespace: emit only imported names and the earlier static
 * bindings required to evaluate them.  The source-order sort keeps values
 * available before each dependent expression and makes the script canonical.
 */
function selectedBindingClosure(
  module: DataModule,
  importedNames: readonly string[],
): readonly DataBinding[] {
  const selected = new Map<string, DataBinding>();
  const visit = (name: string): void => {
    const binding = module.bindings.get(name);
    if (binding === undefined) {
      // This is defensive: imports were checked against the same map above.
      fail(
        "unknown_imported_name",
        `Workspace import names ${name}, which is not a static binding in ${
          sourceLabel(module.source)
        }.`,
      );
    }
    if (selected.has(name)) return;
    selected.set(name, binding);
    for (const reference of binding.references) visit(reference);
  };
  for (const name of importedNames) visit(name);
  return [...selected.values()].sort((left, right) =>
    left.span.start - right.span.start
  );
}

function staticReferences(node: ParsedNode, sourceText: string): readonly string[] {
  const names: string[] = [];
  const visit = (current: ParsedNode): void => {
    if (current.name === "VariableName") {
      names.push(nodeText(sourceText, current));
      return;
    }
    for (const child of current.children) visit(child);
  };
  visit(node);
  return [...new Set(names)];
}

function evaluateStaticExpression(
  node: ParsedNode,
  sourceText: string,
  bindings: ReadonlyMap<string, DataBinding>,
  source: ResolvedSource,
): number {
  const text = sourceText.slice(node.from, node.to);
  if (node.name === "Number") {
    if (!isQualifiedUnsignedDecimalLiteral(text)) {
      fail(
        "data_module_non_finite",
        `Numeric expression ${JSON.stringify(text)} in ${
          sourceLabel(source)
        } is not a finite decimal literal.`,
      );
    }
    return finiteStaticValue(Number(text.replaceAll("_", "")), source, text);
  }
  if (node.name === "VariableName") {
    const binding = bindings.get(text);
    if (binding === undefined) {
      fail(
        "data_module_undefined_reference",
        `Static binding in ${
          sourceLabel(source)
        } references ${text} before it is declared.`,
      );
    }
    return binding.value;
  }
  if (node.name === "ParenthesizedExpression") {
    const inner = node.children.find((child) =>
      nodeText(sourceText, child) !== "(" && nodeText(sourceText, child) !== ")"
    );
    if (inner === undefined) {
      fail(
        "data_module_not_static",
        `Empty parentheses are not static data in ${sourceLabel(source)}.`,
      );
    }
    return evaluateStaticExpression(inner, sourceText, bindings, source);
  }
  if (node.name === "UnaryExpression") {
    const [operator, operand] = node.children;
    const operatorText = nodeText(sourceText, operator);
    if (
      operand === undefined || !["+", "-"].includes(operatorText)
    ) {
      fail(
        "data_module_not_static",
        `Unsupported unary expression in ${sourceLabel(source)}.`,
      );
    }
    const value = evaluateStaticExpression(operand, sourceText, bindings, source);
    return finiteStaticValue(
      operatorText === "-" ? -value : value,
      source,
      text,
    );
  }
  if (node.name === "BinaryExpression") {
    const [leftNode, operator, rightNode] = node.children;
    const operatorText = nodeText(sourceText, operator);
    if (
      leftNode === undefined || rightNode === undefined ||
      !["+", "-", "*", "/", "//", "%", "**"].includes(operatorText)
    ) {
      fail(
        "data_module_not_static",
        `Unsupported arithmetic expression in ${sourceLabel(source)}.`,
      );
    }
    const left = evaluateStaticExpression(leftNode, sourceText, bindings, source);
    const right = evaluateStaticExpression(rightNode, sourceText, bindings, source);
    if (["/", "//", "%"].includes(operatorText) && right === 0) {
      fail(
        "data_module_non_finite",
        `Static arithmetic ${JSON.stringify(text)} in ${
          sourceLabel(source)
        } divides by zero.`,
      );
    }
    let value: number;
    switch (operatorText) {
      case "+":
        value = left + right;
        break;
      case "-":
        value = left - right;
        break;
      case "*":
        value = left * right;
        break;
      case "/":
        value = left / right;
        break;
      case "//":
        value = Math.floor(left / right);
        break;
      case "%":
        // Python remainder has the divisor's sign, unlike JavaScript `%`.
        value = left - Math.floor(left / right) * right;
        break;
      case "**":
        value = left ** right;
        break;
      default:
        fail(
          "data_module_not_static",
          `Unsupported arithmetic expression in ${sourceLabel(source)}.`,
        );
    }
    return finiteStaticValue(value, source, text);
  }
  fail(
    "data_module_not_static",
    `Expression ${JSON.stringify(text)} in ${
      sourceLabel(source)
    } is not a finite static scalar expression.`,
  );
}

function finiteStaticValue(
  value: number,
  source: ResolvedSource,
  expression: string,
): number {
  if (!Number.isFinite(value)) {
    fail(
      "data_module_non_finite",
      `Static arithmetic ${JSON.stringify(expression)} in ${
        sourceLabel(source)
      } is not finite.`,
    );
  }
  return value;
}

function collectWorkspaceImports(
  root: ParsedNode,
  source: ResolvedSource,
): readonly WorkspaceImportCandidate[] {
  const topLevel = new Set(root.children);
  const found: WorkspaceImportCandidate[] = [];
  for (
    const node of collectNodes(
      root,
      (candidate) => candidate.name === "ImportStatement",
    )
  ) {
    const parsed = parseNamedFromImport(node, source.sourceText);
    const text = nodeText(source.sourceText, node);
    const looksLikeWorkspaceImport =
      /^from\s+(?:\.+)?casys_workspace(?:\.|\s|$)/.test(text) ||
      /^import\s+casys_workspace(?:\.|\s|,|$)/.test(text);
    if (parsed === undefined) {
      if (looksLikeWorkspaceImport) {
        fail(
          "unsupported_workspace_import_syntax",
          `Workspace import in ${
            sourceLabel(source)
          } must use one explicit named from-import.`,
        );
      }
      continue;
    }
    if (parsed.moduleSegments[0] !== BUILD123D_WORKSPACE_IMPORT_PREFIX) {
      continue;
    }
    if (!topLevel.has(node)) {
      fail(
        "workspace_import_not_module_level",
        `Workspace import ${parsed.moduleSegments.join(".")} in ${
          sourceLabel(source)
        } must be at module level.`,
      );
    }
    if (
      parsed.moduleSegments.length < 2 || parsed.names.length === 0 ||
      !isPhysicalLineImport(node, source.sourceText)
    ) {
      fail(
        "unsupported_workspace_import_syntax",
        `Workspace import ${parsed.moduleSegments.join(".")} in ${
          sourceLabel(source)
        } must be one physical line: from casys_workspace.<module> import name[, name].`,
      );
    }
    const module = parsed.moduleSegments.join(".");
    if (found.some((candidate) => candidate.module === module)) {
      fail(
        "duplicate_workspace_import",
        `Workspace module ${module} is imported more than once in ${
          sourceLabel(source)
        }.`,
      );
    }
    if (new Set(parsed.names).size !== parsed.names.length) {
      fail(
        "duplicate_imported_name",
        `Workspace import ${module} repeats one imported name.`,
      );
    }
    const lineStart = lineStartAt(source.sourceText, node.from);
    const lineEnd = lineEndIncludingBreakAt(source.sourceText, node.to);
    found.push({
      module,
      names: parsed.names,
      span: { start: node.from, end: node.to },
      removal: { start: lineStart, end: lineEnd },
    });
  }
  return found;
}

/**
 * V1 lowers data bindings before the root. To preserve Python's temporal name
 * lookup, every removable workspace import must therefore be in the root's
 * leading import prelude: comments may precede it, but no other root statement
 * may. This refuses a read-before-import rather than making it executable by
 * concatenation.
 */
function assertWorkspaceImportPrelude(
  root: ParsedNode,
  workspaceImports: readonly WorkspaceImportCandidate[],
  source: ResolvedSource,
): void {
  const workspaceSpans = workspaceImports.map((item) => item.span);
  const isWorkspaceImport = (node: ParsedNode): boolean =>
    workspaceSpans.some((span) => node.from === span.start && node.to === span.end);
  let sawNonWorkspaceStatement = false;
  for (const statement of root.children) {
    if (statement.name === "Comment") continue;
    if (isWorkspaceImport(statement)) {
      if (sawNonWorkspaceStatement) {
        fail(
          "workspace_import_not_prelude",
          `Workspace imports in ${
            sourceLabel(source)
          } must form one leading module-level prelude before any other root statement.`,
        );
      }
      continue;
    }
    sawNonWorkspaceStatement = true;
  }
}

/**
 * Concatenation must not turn a dependency's private data binding into a root
 * global.  The selected dependency closure below prevents that at runtime;
 * this guard also rejects the misleading root source before D4 can merely
 * leave it unresolved.  A root binding with the same name would overwrite a
 * copied dependency binding, so it is refused independently.
 */
function assertRootBindingIsolation(
  root: ParsedNode,
  sourceText: string,
  workspaceImports: readonly WorkspaceImportCandidate[],
  dependencyBindingNames: ReadonlySet<string>,
  importedNames: ReadonlySet<string>,
  source: ResolvedSource,
): void {
  const workspaceImportSpans = workspaceImports.map((item) => item.span);
  const isWorkspaceImportNode = (node: ParsedNode): boolean =>
    workspaceImportSpans.some((span) => node.from >= span.start && node.to <= span.end);

  for (
    const binding of rootModuleLevelBindingsStrict(
      root,
      sourceText,
      workspaceImportSpans,
    )
  ) {
    if (dependencyBindingNames.has(binding)) {
      fail(
        "root_binding_collision",
        `Root ${
          sourceLabel(source)
        } binds ${binding}, which collides with a dependency data binding.`,
      );
    }
  }
  for (const variable of collectNodes(root, (node) => node.name === "VariableName")) {
    if (isWorkspaceImportNode(variable)) continue;
    const name = nodeText(sourceText, variable);
    if (dependencyBindingNames.has(name) && !importedNames.has(name)) {
      fail(
        "root_unimported_dependency_binding",
        `Root ${
          sourceLabel(source)
        } references dependency binding ${name} without importing it from casys_workspace.`,
      );
    }
  }
}

/**
 * Follow assignments through root control-flow bodies. Function and class
 * bodies introduce their own scopes, while their definition names still bind
 * the root. Those names are the VariableName after the `def` or `class` token,
 * not a fixed child index, so `async def` stays a module binder. `global`
 * inside a nested scope still names the module; `nonlocal` cannot, but is
 * refused when nesting is ambiguous. Match CapturePattern and the VariableName
 * after `as` in AsPattern bind only at module scope; a ClassPattern class name
 * does not. TypeDefinition binds the VariableName after `type` at module
 * scope only. NamedExpression walrus binds its left target in the containing
 * scope, including a module-level expression or comprehension. A `:=` that is
 * a direct ArgList child binds the VariableName immediately before it; Lezer
 * does not wrap `Box(width := 5)` in NamedExpression. This list is the closed
 * V1 binder grammar, not a general Python symbol table.
 * DeleteStatement is the Lezer `del` node.
 */
function rootModuleLevelBindingsStrict(
  root: ParsedNode,
  sourceText: string,
  ignoredImportSpans: readonly Build123dWorkspaceClosureLoweringOffsetRange[],
): readonly string[] {
  const bindings = new Set<string>();
  const ignored = (node: ParsedNode): boolean =>
    ignoredImportSpans.some((span) => node.from >= span.start && node.to <= span.end);
  const addTarget = (node: ParsedNode | undefined): void => {
    if (node === undefined) return;
    if (node.name === "VariableName") {
      bindings.add(nodeText(sourceText, node));
      return;
    }
    for (const child of node.children) addTarget(child);
  };
  const addImportBindings = (statement: ParsedNode): void => {
    const importIndex = statement.children.findIndex((child) =>
      nodeText(sourceText, child) === "import"
    );
    if (importIndex < 0) return;
    for (
      let index = importIndex + 1;
      index < statement.children.length;
      index++
    ) {
      const current = statement.children[index]!;
      if (current.name !== "VariableName") continue;
      const previous = statement.children[index - 1];
      const next = statement.children[index + 1];
      if (
        nodeText(sourceText, previous) === "as" ||
        nodeText(sourceText, next) !== "as"
      ) {
        addTarget(current);
      }
    }
  };
  const nameAfterKeyword = (
    node: ParsedNode,
    keyword: string,
  ): ParsedNode | undefined => {
    const keywordIndex = node.children.findIndex((child) =>
      nodeText(sourceText, child) === keyword
    );
    if (keywordIndex < 0) return undefined;
    const name = node.children[keywordIndex + 1];
    return name?.name === "VariableName" ? name : undefined;
  };
  const addDirectWalrusTargets = (node: ParsedNode): void => {
    for (let index = 1; index < node.children.length; index++) {
      if (nodeText(sourceText, node.children[index]) !== ":=") continue;
      const name = node.children[index - 1];
      if (name?.name === "VariableName") addTarget(name);
    }
  };
  const addScopeNames = (statement: ParsedNode): void => {
    for (const child of statement.children) {
      if (child.name === "VariableName") addTarget(child);
    }
  };
  const visitNestedScope = (
    node: ParsedNode,
    functionNesting: number,
  ): void => {
    if (ignored(node)) return;
    if (node.name === "FunctionDefinition") {
      for (const child of node.children) {
        visitNestedScope(child, functionNesting + 1);
      }
      return;
    }
    if (node.name === "ClassDefinition") {
      for (const child of node.children) {
        visitNestedScope(child, functionNesting);
      }
      return;
    }
    if (node.name === "ScopeStatement") {
      const kind = nodeText(sourceText, node.children[0]);
      if (kind !== "nonlocal" || functionNesting < 2) addScopeNames(node);
      return;
    }
    for (const child of node.children) visitNestedScope(child, functionNesting);
  };
  const visit = (node: ParsedNode): void => {
    if (ignored(node)) return;
    if (node.name === "FunctionDefinition") {
      addTarget(nameAfterKeyword(node, "def"));
      for (const child of node.children) visitNestedScope(child, 1);
      return;
    }
    if (node.name === "ClassDefinition") {
      addTarget(nameAfterKeyword(node, "class"));
      for (const child of node.children) visitNestedScope(child, 0);
      return;
    }
    if (node.name === "AssignStatement" || node.name === "UpdateStatement") {
      addTarget(node.children[0]);
    } else if (node.name === "ForStatement") {
      const inIndex = node.children.findIndex((child) =>
        nodeText(sourceText, child) === "in"
      );
      for (let index = 1; index < inIndex; index++) {
        addTarget(node.children[index]);
      }
    } else if (node.name === "WithStatement" || node.name === "TryStatement") {
      for (let index = 0; index < node.children.length - 1; index++) {
        if (nodeText(sourceText, node.children[index]) === "as") {
          addTarget(node.children[index + 1]);
        }
      }
    } else if (node.name === "DeleteStatement") {
      for (const child of node.children.slice(1)) addTarget(child);
    } else if (node.name === "ImportStatement") {
      addImportBindings(node);
    } else if (node.name === "ScopeStatement") {
      addScopeNames(node);
    } else if (node.name === "CapturePattern") {
      addTarget(node);
    } else if (node.name === "AsPattern") {
      addTarget(nameAfterKeyword(node, "as"));
    } else if (node.name === "TypeDefinition") {
      addTarget(nameAfterKeyword(node, "type"));
    } else if (node.name === "NamedExpression" || node.name === "ArgList") {
      addDirectWalrusTargets(node);
    }
    for (const child of node.children) visit(child);
  };
  for (const statement of root.children) visit(statement);
  return [...bindings];
}

function parseNamedFromImport(
  node: ParsedNode,
  sourceText: string,
):
  | { readonly moduleSegments: readonly string[]; readonly names: readonly string[] }
  | undefined {
  const children = node.children;
  if (nodeText(sourceText, children[0]) !== "from") return undefined;
  let index = 1;
  const moduleSegments: string[] = [];
  let expectName = true;
  while (
    index < children.length && nodeText(sourceText, children[index]) !== "import"
  ) {
    const child = children[index]!;
    const text = nodeText(sourceText, child);
    if (expectName) {
      if (child.name !== "VariableName") return undefined;
      moduleSegments.push(text);
    } else if (text !== ".") {
      return undefined;
    }
    expectName = !expectName;
    index += 1;
  }
  if (
    moduleSegments.length === 0 || expectName ||
    nodeText(sourceText, children[index]) !== "import"
  ) return undefined;
  index += 1;
  const names: string[] = [];
  let expectImportedName = true;
  while (index < children.length) {
    const child = children[index]!;
    const text = nodeText(sourceText, child);
    if (expectImportedName) {
      if (child.name !== "VariableName") return undefined;
      names.push(text);
    } else if (text !== ",") {
      return undefined;
    }
    expectImportedName = !expectImportedName;
    index += 1;
  }
  return expectImportedName || names.length === 0
    ? undefined
    : { moduleSegments, names };
}

function isPhysicalLineImport(node: ParsedNode, sourceText: string): boolean {
  if (lineStartAt(sourceText, node.from) !== node.from) return false;
  const statementText = nodeText(sourceText, node);
  if (statementText.includes("\n") || statementText.includes("\r")) return false;
  const lineEnd = lineEndAt(sourceText, node.to);
  const suffix = sourceText.slice(node.to, lineEnd);
  return /^[ \t]*(?:#.*)?$/.test(suffix);
}

function sourceFragmentsAfterRemovals(
  sourceLength: number,
  removals: readonly Build123dWorkspaceClosureLoweringOffsetRange[],
): readonly Build123dWorkspaceClosureLoweringOffsetRange[] {
  const sorted = [...removals].sort((left, right) => left.start - right.start);
  const fragments: Build123dWorkspaceClosureLoweringOffsetRange[] = [];
  let cursor = 0;
  for (const removal of sorted) {
    if (
      removal.start < cursor || removal.end < removal.start ||
      removal.end > sourceLength
    ) {
      fail(
        "unsupported_workspace_import_syntax",
        "Workspace import removals overlap or escape the root source.",
      );
    }
    if (cursor < removal.start) fragments.push({ start: cursor, end: removal.start });
    cursor = removal.end;
  }
  if (cursor < sourceLength) fragments.push({ start: cursor, end: sourceLength });
  return fragments;
}

function parsePython(label: string, sourceText: string): ParsedNode {
  const root = materialize(parser.parse(sourceText));
  const error = collectNodes(root, (node) => node.isError)[0];
  if (error !== undefined) {
    fail(
      "python_syntax",
      `${label} has an unrecognized Python construct at UTF-16 offset ${error.from}.`,
    );
  }
  return root;
}

function materialize(tree: ReturnType<typeof parser.parse>): ParsedNode {
  const cursor = tree.cursor();
  const visit = (): ParsedNode => {
    const children: ParsedNode[] = [];
    if (cursor.firstChild()) {
      do children.push(visit()); while (cursor.nextSibling());
      cursor.parent();
    }
    return {
      name: cursor.name,
      from: cursor.from,
      to: cursor.to,
      isError: cursor.type.isError,
      children,
    };
  };
  return visit();
}

function collectNodes(
  root: ParsedNode,
  predicate: (node: ParsedNode) => boolean,
): ParsedNode[] {
  const found: ParsedNode[] = [];
  const visit = (node: ParsedNode): void => {
    if (predicate(node)) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function simpleAssignment(
  node: ParsedNode,
  sourceText: string,
): { readonly name: string; readonly rhs: ParsedNode } | undefined {
  const [nameNode, operator, rhs] = node.children;
  if (
    nameNode?.name !== "VariableName" || nodeText(sourceText, operator) !== "=" ||
    rhs === undefined || node.children.length !== 3
  ) return undefined;
  return { name: nodeText(sourceText, nameNode), rhs };
}

function nodeText(sourceText: string, node: ParsedNode | undefined): string {
  return node === undefined ? "" : sourceText.slice(node.from, node.to);
}

function lineStartAt(sourceText: string, offset: number): number {
  const lineBreak = Math.max(
    sourceText.lastIndexOf("\n", offset - 1),
    sourceText.lastIndexOf("\r", offset - 1),
  );
  return lineBreak + 1;
}

function lineEndAt(sourceText: string, offset: number): number {
  const lf = sourceText.indexOf("\n", offset);
  const cr = sourceText.indexOf("\r", offset);
  if (lf === -1) return cr === -1 ? sourceText.length : cr;
  if (cr === -1) return lf;
  return Math.min(lf, cr);
}

function lineEndIncludingBreakAt(sourceText: string, offset: number): number {
  const lineEnd = lineEndAt(sourceText, offset);
  if (lineEnd === sourceText.length) return lineEnd;
  if (sourceText[lineEnd] === "\r" && sourceText[lineEnd + 1] === "\n") {
    return lineEnd + 2;
  }
  return lineEnd + 1;
}

class LoweredScriptBuilder {
  #text = "";
  #sourceMap: Build123dWorkspaceClosureLoweringSourceMapSegment[] = [];

  get text(): string {
    return this.#text;
  }

  get sourceMap(): readonly Build123dWorkspaceClosureLoweringSourceMapSegment[] {
    return this.#sourceMap;
  }

  appendSource(
    source: ResolvedSource,
    span: Build123dWorkspaceClosureLoweringOffsetRange,
  ): void {
    if (span.start === span.end) return;
    const copied = source.sourceText.slice(span.start, span.end);
    const start = this.#text.length;
    this.#text += copied;
    this.#sourceMap.push({
      output: { start, end: this.#text.length },
      source: {
        ...sourceIdentity(source),
        span: { ...span },
      },
    });
  }

  appendGenerated(text: string): void {
    this.#text += text;
  }
}

function sourceIdentity(
  source: ResolvedSource,
): Build123dWorkspaceClosureLoweringFileIdentity {
  return {
    fileId: source.fileId,
    fileRevision: source.fileRevision,
    sourceFingerprint: source.sourceFingerprint,
  };
}

function fileKey(
  file: { readonly fileId: string; readonly fileRevision: number },
): string {
  return `${file.fileId}@${file.fileRevision}`;
}

function sourceLabel(
  source: Pick<Build123dWorkspaceClosureLoweringSource, "fileId" | "fileRevision">,
): string {
  return `${source.fileId}@${source.fileRevision}`;
}

function planSourceLabel(source: ResolvedSource): string {
  return `Exact source ${sourceLabel(source)}`;
}

async function fingerprintUtf8(text: string): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await sha256Hex(new TextEncoder().encode(text)),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function fail(
  code: Build123dWorkspaceClosureLoweringErrorCode,
  message: string,
): never {
  throw new Build123dWorkspaceClosureLoweringError(code, message);
}
