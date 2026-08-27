/**
 * Pure, non-authoritative cross-source admission compiler spike.
 *
 * It links exact source-analysis facts to an explicit SysML semantic draft.
 * It never executes source, selects a provider, or constructs an MCP call.
 */

import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
  type SourceAnalysisLanguage,
  type SourceAnalysisSourceRole,
  validateSourceAnalysisBundle,
} from "../../src/domain/compile/source/source-analysis.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../src/domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../src/domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";
import { briefSourceIdFor } from "../../src/domain/compile/brief/brief-source-analysis-reference.ts";
import type { EngineeringApprovedBriefBasis } from "../../src/domain/project/engineering-project.ts";
import type {
  ProjectBriefActor,
  ProjectBriefReview,
} from "../../src/domain/project/project-brief.ts";

export const ADMISSION_COMPILATION_SPIKE_SCHEMA =
  "admission-compilation-spike/0.1" as const;

export type ProjectionTarget = "build123d" | "modelica" | "calculix";
type ProjectionSourceRole = "cad-script" | "modelica-model" | "calculix-input";

export interface ServerOwnedLoweringProfile {
  readonly id: string;
  readonly version: string;
  readonly target: ProjectionTarget;
  readonly sourceRole: ProjectionSourceRole;
  readonly outputContract: string;
}

/**
 * Runtime-neutral execution port intentionally unused by this spike.
 *
 * A later adapter may implement it with a container, VM, WASI runtime, Deno
 * Sandbox, or another isolation mechanism without changing the compilation
 * contract. There is deliberately no command, shell, endpoint, provider, or
 * arbitrary arguments field here.
 */
export interface IsolatedRunner {
  run(request: IsolatedRunRequest): Promise<IsolatedRunResult>;
}

export interface IsolatedRunRequest {
  readonly compilationFingerprint: ContentFingerprint;
  readonly projection: ProjectionTarget;
  readonly lowering: { readonly id: string; readonly version: string };
  readonly sourceFingerprint: ContentFingerprint;
}

export interface IsolatedRunResult {
  readonly status: "completed" | "failed";
  readonly outputFingerprint?: ContentFingerprint;
  readonly diagnostic?: string;
}

export interface AdmissionCompilationSpike {
  readonly schemaVersion: typeof ADMISSION_COMPILATION_SPIKE_SCHEMA;
  readonly compilationId: string;
  readonly intentSource: {
    readonly kind: "brief-source-review-claim";
    readonly sourceId: string;
    readonly sourceFingerprint: ContentFingerprint;
    readonly approvedBriefBasis: EngineeringApprovedBriefBasis;
    readonly review: ProjectBriefReview & {
      readonly status: "approved";
      readonly decidedAt: string;
      readonly decidedBy: ProjectBriefActor & { readonly origin: "human" };
    };
    readonly bindingRefs: readonly string[];
  };
  readonly semanticAnchor: {
    readonly kind: "sysml-source-draft";
    readonly sourceId: string;
    readonly sourceFingerprint: ContentFingerprint;
  };
  readonly sourceRefs: readonly AdmissionSourceRef[];
  readonly bindings: readonly AdmissionBinding[];
  readonly status: "resolved" | "unresolved";
  readonly diagnostics: readonly AdmissionDiagnostic[];
  readonly projections: readonly AdmissionProjection[];
}

export interface AdmissionSourceRef {
  readonly sourceId: string;
  readonly role: SourceAnalysisSourceRole;
  readonly language: SourceAnalysisLanguage;
  readonly sourceFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
}

export interface AdmissionBinding {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceSymbolId: string;
  readonly targetSysmlSymbolId: string;
}

export interface AdmissionDiagnostic {
  readonly id: string;
  readonly severity: "warning" | "error";
  readonly code: "missing-explicit-binding" | "source-unresolved-construct";
  readonly sourceId: string;
  readonly symbolId?: string;
  readonly message: string;
  readonly blocking: boolean;
}

export interface AdmissionProjection {
  readonly target: ProjectionTarget;
  readonly sourceId: string;
  readonly sourceFingerprint: ContentFingerprint;
  readonly lowering: { readonly id: string; readonly version: string };
  readonly outputContract: string;
  readonly bindingRefs: readonly string[];
  readonly readiness: "resolved" | "unresolved";
}

interface ParsedRequest {
  readonly compilationId: string;
  readonly briefReviewClaim: {
    readonly approvedBriefBasis: EngineeringApprovedBriefBasis;
    readonly review: ProjectBriefReview & {
      readonly status: "approved";
      readonly decidedAt: string;
      readonly decidedBy: ProjectBriefActor & { readonly origin: "human" };
    };
  };
  readonly semanticAnchor: {
    readonly sourceId: string;
    readonly sourceFingerprint: ContentFingerprint;
  };
  readonly sources: readonly {
    readonly sourceText: string;
    readonly bundle: SourceAnalysisBundle;
  }[];
  readonly bindings: readonly AdmissionBinding[];
  readonly loweringProfileIds: Readonly<Record<ProjectionTarget, string>>;
}

const EXPECTED_SOURCES: ReadonlyArray<
  readonly [SourceAnalysisSourceRole, SourceAnalysisLanguage]
> = [
  ["brief", "plain-text"],
  ["sysml-model", "sysml-v2"],
  ["cad-script", "python"],
  ["modelica-model", "modelica"],
  ["calculix-input", "calculix-inp"],
];

const PROJECTION_SOURCE_ROLE: Readonly<Record<ProjectionTarget, ProjectionSourceRole>> =
  {
    build123d: "cad-script",
    modelica: "modelica-model",
    calculix: "calculix-input",
  };

const TARGETS: readonly ProjectionTarget[] = ["build123d", "modelica", "calculix"];
const SPIKE_OUTPUT_CONTRACT: Readonly<Record<ProjectionTarget, string>> = {
  build123d: "spike-only/build123d-projection/0.1",
  modelica: "spike-only/modelica-conformance-projection/0.1",
  calculix: "spike-only/calculix-deck-projection/0.1",
};

/**
 * Validate, link, and deterministically compile five exact native sources.
 *
 * `unresolved` is a valid fail-closed result for missing caller-supplied bindings.
 * Structural errors, rejected analysis policies, byte drift, and anchor drift
 * reject the request before a compilation document can exist.
 */
export async function compileAdmissionSpike(
  input: unknown,
  serverOwnedProfiles: readonly ServerOwnedLoweringProfile[],
): Promise<AdmissionCompilationSpike> {
  const request = await parseRequest(input);
  const profiles = parseClosedProfiles(serverOwnedProfiles);
  const bundleByRole = new Map(
    request.sources.map((source) => [source.bundle.source.role, source.bundle]),
  );
  const brief = bundleByRole.get("brief")!;
  const sysml = bundleByRole.get("sysml-model")!;

  const briefBasis = request.briefReviewClaim.approvedBriefBasis;
  const briefReview = request.briefReviewClaim.review;
  const briefNativeIdentity = parseBriefNativeIdentity(
    request.sources.find((source) => source.bundle.source.role === "brief")!
      .sourceText,
  );
  const expectedBriefSourceId = await briefSourceIdFor(
    briefNativeIdentity.briefId,
    briefNativeIdentity.briefSnapshotId,
    briefNativeIdentity.briefRevision,
  );
  if (brief.source.id !== expectedBriefSourceId) {
    throw new TypeError(
      "$request brief source id must be derived from the exact native brief identity.",
    );
  }
  if (
    briefBasis.briefId !== briefNativeIdentity.briefId ||
    briefBasis.briefSnapshotId !== briefNativeIdentity.briefSnapshotId ||
    briefBasis.briefRevision !== briefNativeIdentity.briefRevision ||
    briefReview.briefSnapshotId !== briefNativeIdentity.briefSnapshotId ||
    briefReview.briefRevision !== briefNativeIdentity.briefRevision
  ) {
    throw new TypeError(
      "$request.briefReviewClaim basis and review must identify the exact native brief revision.",
    );
  }
  if (
    !fingerprintsEqual(briefBasis.approvedBriefFingerprint, brief.source.fingerprint) ||
    !fingerprintsEqual(briefReview.inputFingerprint, brief.source.fingerprint)
  ) {
    throw new TypeError(
      "$request.briefReviewClaim fingerprints must match the exact analyzed brief bytes.",
    );
  }
  if (
    request.semanticAnchor.sourceId !== sysml.source.id ||
    !fingerprintsEqual(
      request.semanticAnchor.sourceFingerprint,
      sysml.source.fingerprint,
    )
  ) {
    throw new TypeError(
      "$request.semanticAnchor must name the exact analyzed SysML source and bytes.",
    );
  }

  const sysmlSymbolIds = new Set(sysml.symbols.map((symbol) => symbol.id));
  const sourceById = new Map(
    request.sources.map((source) => [source.bundle.source.id, source.bundle]),
  );
  const nonAnchorSources = request.sources.filter((source) =>
    source.bundle.source.role !== "sysml-model"
  );
  const symbolKey = (sourceId: string, symbolId: string) =>
    `${sourceId}\u0000${symbolId}`;
  const expectedSymbols = new Map<string, { sourceId: string; symbolId: string }>();
  for (const { bundle } of nonAnchorSources) {
    for (const symbol of bundle.symbols) {
      expectedSymbols.set(symbolKey(bundle.source.id, symbol.id), {
        sourceId: bundle.source.id,
        symbolId: symbol.id,
      });
    }
  }

  const bindingBySymbol = new Map<string, AdmissionBinding>();
  for (const binding of request.bindings) {
    const source = sourceById.get(binding.sourceId);
    if (!source || source.source.role === "sysml-model") {
      throw new TypeError(
        `$request.bindings.${binding.id}.sourceId must name a non-SysML compiled source.`,
      );
    }
    const key = symbolKey(binding.sourceId, binding.sourceSymbolId);
    if (!expectedSymbols.has(key)) {
      throw new TypeError(
        `$request.bindings.${binding.id}.sourceSymbolId must name a symbol in its exact source.`,
      );
    }
    if (!sysmlSymbolIds.has(binding.targetSysmlSymbolId)) {
      throw new TypeError(
        `$request.bindings.${binding.id}.targetSysmlSymbolId must name a symbol in the exact SysML anchor.`,
      );
    }
    if (bindingBySymbol.has(key)) {
      throw new TypeError(
        `$request.bindings must contain at most one explicit binding per source symbol.`,
      );
    }
    bindingBySymbol.set(key, binding);
  }

  const diagnostics: AdmissionDiagnostic[] = [];
  for (const expected of expectedSymbols.values()) {
    const key = symbolKey(expected.sourceId, expected.symbolId);
    if (bindingBySymbol.has(key)) continue;
    diagnostics.push({
      id: diagnosticId(
        "missing-explicit-binding",
        expected.sourceId,
        expected.symbolId,
      ),
      severity: "error",
      code: "missing-explicit-binding",
      sourceId: expected.sourceId,
      symbolId: expected.symbolId,
      message:
        "The source symbol has no reviewed explicit binding to the SysML anchor; name matching is never inferred.",
      blocking: true,
    });
  }
  for (const { bundle } of request.sources) {
    for (const construct of bundle.unresolvedConstructs) {
      diagnostics.push({
        id: diagnosticId(
          "source-unresolved-construct",
          bundle.source.id,
          construct.id,
        ),
        severity: "error",
        code: "source-unresolved-construct",
        sourceId: bundle.source.id,
        message: construct.message,
        blocking: true,
      });
    }
  }
  diagnostics.sort(compareDiagnostic);

  const sourceRefs = await Promise.all(request.sources.map(async ({ bundle }) => ({
    sourceId: bundle.source.id,
    role: bundle.source.role,
    language: bundle.source.language,
    sourceFingerprint: bundle.source.fingerprint,
    analysisFingerprint: await fingerprintSourceAnalysisBundle(bundle),
  })));
  sourceRefs.sort((left, right) => ascii(left.sourceId, right.sourceId));

  const bindings = [...request.bindings].sort(compareBinding);
  const projections = TARGETS.map((target): AdmissionProjection => {
    const source = bundleByRole.get(PROJECTION_SOURCE_ROLE[target])!;
    const profileId = request.loweringProfileIds[target];
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (
      !profile || profile.target !== target || profile.sourceRole !== source.source.role
    ) {
      throw new TypeError(
        `$request.loweringProfileIds.${target} must select a closed server-owned profile for ${target}.`,
      );
    }
    const bindingRefs = bindings
      .filter((binding) => binding.sourceId === source.source.id)
      .map((binding) => binding.id);
    const missing = source.symbols.some((symbol) =>
      !bindingBySymbol.has(symbolKey(source.source.id, symbol.id))
    );
    const sourceHasUnresolvedConstructs = source.unresolvedConstructs.length > 0;
    return {
      target,
      sourceId: source.source.id,
      sourceFingerprint: source.source.fingerprint,
      lowering: { id: profile.id, version: profile.version },
      outputContract: profile.outputContract,
      bindingRefs,
      readiness: missing || sourceHasUnresolvedConstructs ? "unresolved" : "resolved",
    };
  });

  return deepFreeze({
    schemaVersion: ADMISSION_COMPILATION_SPIKE_SCHEMA,
    compilationId: request.compilationId,
    intentSource: {
      kind: "brief-source-review-claim",
      sourceId: brief.source.id,
      sourceFingerprint: brief.source.fingerprint,
      approvedBriefBasis: briefBasis,
      review: briefReview,
      bindingRefs: bindings.filter((binding) => binding.sourceId === brief.source.id)
        .map((binding) => binding.id),
    },
    semanticAnchor: {
      kind: "sysml-source-draft",
      sourceId: sysml.source.id,
      sourceFingerprint: sysml.source.fingerprint,
    },
    sourceRefs,
    bindings,
    status: diagnostics.some((diagnostic) => diagnostic.blocking)
      ? "unresolved"
      : "resolved",
    diagnostics,
    projections,
  });
}

/** Canonical bytes for storage in a content-addressed draft area. */
export function canonicalAdmissionCompilationText(
  compilation: AdmissionCompilationSpike,
): string {
  return deterministicJson(compilation);
}

/** SHA-256 content address of the complete deterministic compilation document. */
export function fingerprintAdmissionCompilation(
  compilation: AdmissionCompilationSpike,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(compilation);
}

async function parseRequest(value: unknown): Promise<ParsedRequest> {
  const root = exactRecord(
    value,
    [
      "compilationId",
      "briefReviewClaim",
      "semanticAnchor",
      "sources",
      "bindings",
      "loweringProfileIds",
    ],
    "$request",
  );
  const briefReviewClaim = exactRecord(
    root.briefReviewClaim,
    ["approvedBriefBasis", "review"],
    "$request.briefReviewClaim",
  );
  const semanticAnchor = exactRecord(
    root.semanticAnchor,
    ["sourceId", "sourceFingerprint"],
    "$request.semanticAnchor",
  );
  const loweringProfileIds = exactRecord(
    root.loweringProfileIds,
    TARGETS,
    "$request.loweringProfileIds",
  );
  const sources = arrayOf(root.sources, "$request.sources").map((item, index) => {
    const record = exactRecord(
      item,
      ["sourceText", "bundle"],
      `$request.sources[${index}]`,
    );
    if (typeof record.sourceText !== "string") {
      throw new TypeError(`$request.sources[${index}].sourceText must be a string.`);
    }
    return {
      sourceText: record.sourceText,
      bundle: validateSourceAnalysisBundle(record.bundle),
    };
  });
  if (sources.length !== EXPECTED_SOURCES.length) {
    throw new TypeError("$request.sources must contain exactly five analyzed sources.");
  }
  const roleKey = (role: SourceAnalysisSourceRole) => role;
  rejectDuplicates(
    sources.map((source) => roleKey(source.bundle.source.role)),
    "$request.sources roles",
  );
  rejectDuplicates(
    sources.map((source) => source.bundle.source.id),
    "$request.sources source ids",
  );
  for (const [expectedRole, expectedLanguage] of EXPECTED_SOURCES) {
    const source = sources.find((candidate) =>
      candidate.bundle.source.role === expectedRole
    );
    if (!source || source.bundle.source.language !== expectedLanguage) {
      throw new TypeError(
        `$request.sources must contain ${expectedRole}/${expectedLanguage}.`,
      );
    }
  }
  for (const [index, source] of sources.entries()) {
    if (source.bundle.policy.status !== "passed") {
      throw new TypeError(
        `$request.sources[${index}].bundle.policy must have passed before compilation.`,
      );
    }
    const observed = await fingerprintUtf8(source.sourceText);
    if (!fingerprintsEqual(observed, source.bundle.source.fingerprint)) {
      throw new TypeError(
        `$request.sources[${index}] exact source bytes do not match the analyzed fingerprint.`,
      );
    }
  }

  const bindings = arrayOf(root.bindings, "$request.bindings").map(
    (item, index): AdmissionBinding => {
      const binding = exactRecord(
        item,
        ["id", "sourceId", "sourceSymbolId", "targetSysmlSymbolId"],
        `$request.bindings[${index}]`,
      );
      return {
        id: safeId(binding.id, `$request.bindings[${index}].id`),
        sourceId: safeId(binding.sourceId, `$request.bindings[${index}].sourceId`),
        sourceSymbolId: safeId(
          binding.sourceSymbolId,
          `$request.bindings[${index}].sourceSymbolId`,
        ),
        targetSysmlSymbolId: safeId(
          binding.targetSysmlSymbolId,
          `$request.bindings[${index}].targetSysmlSymbolId`,
        ),
      };
    },
  );
  rejectDuplicates(bindings.map((binding) => binding.id), "$request.bindings ids");

  return {
    compilationId: safeId(root.compilationId, "$request.compilationId"),
    briefReviewClaim: {
      approvedBriefBasis: parseApprovedBriefBasis(
        briefReviewClaim.approvedBriefBasis,
        "$request.briefReviewClaim.approvedBriefBasis",
      ),
      review: parseApprovedHumanReview(
        briefReviewClaim.review,
        "$request.briefReviewClaim.review",
      ),
    },
    semanticAnchor: {
      sourceId: safeId(semanticAnchor.sourceId, "$request.semanticAnchor.sourceId"),
      sourceFingerprint: parseFingerprint(
        semanticAnchor.sourceFingerprint,
        "$request.semanticAnchor.sourceFingerprint",
      ),
    },
    sources,
    bindings,
    loweringProfileIds: {
      build123d: safeId(
        loweringProfileIds.build123d,
        "$request.loweringProfileIds.build123d",
      ),
      modelica: safeId(
        loweringProfileIds.modelica,
        "$request.loweringProfileIds.modelica",
      ),
      calculix: safeId(
        loweringProfileIds.calculix,
        "$request.loweringProfileIds.calculix",
      ),
    },
  };
}

function parseClosedProfiles(
  values: readonly ServerOwnedLoweringProfile[],
): readonly ServerOwnedLoweringProfile[] {
  const profiles = arrayOf(values, "$serverOwnedProfiles").map((item, index) => {
    const profile = exactRecord(
      item,
      ["id", "version", "target", "sourceRole", "outputContract"],
      `$serverOwnedProfiles[${index}]`,
    );
    const target = projectionTarget(
      profile.target,
      `$serverOwnedProfiles[${index}].target`,
    );
    const expectedRole = PROJECTION_SOURCE_ROLE[target];
    literalValue(
      profile.sourceRole,
      expectedRole,
      `$serverOwnedProfiles[${index}].sourceRole`,
    );
    return {
      id: safeId(profile.id, `$serverOwnedProfiles[${index}].id`),
      version: nonEmptyText(profile.version, `$serverOwnedProfiles[${index}].version`),
      target,
      sourceRole: expectedRole,
      outputContract: (() => {
        const contract = nonEmptyText(
          profile.outputContract,
          `$serverOwnedProfiles[${index}].outputContract`,
        );
        literalValue(
          contract,
          SPIKE_OUTPUT_CONTRACT[target],
          `$serverOwnedProfiles[${index}].outputContract`,
        );
        return contract;
      })(),
    };
  });
  rejectDuplicates(profiles.map((profile) => profile.id), "$serverOwnedProfiles ids");
  rejectDuplicates(
    profiles.map((profile) => profile.target),
    "$serverOwnedProfiles targets",
  );
  if (profiles.length !== TARGETS.length) {
    throw new TypeError(
      "$serverOwnedProfiles must contain exactly one profile per target.",
    );
  }
  return profiles;
}

function projectionTarget(value: unknown, path: string): ProjectionTarget {
  if (value !== "build123d" && value !== "modelica" && value !== "calculix") {
    throw new TypeError(`${path} must be build123d, modelica, or calculix.`);
  }
  return value;
}

function parseApprovedBriefBasis(
  value: unknown,
  path: string,
): EngineeringApprovedBriefBasis {
  const basis = exactRecord(
    value,
    [
      "kind",
      "projectId",
      "projectSnapshotId",
      "projectRevision",
      "briefId",
      "briefSnapshotId",
      "briefRevision",
      "approvedBriefFingerprint",
    ],
    path,
  );
  literalValue(basis.kind, "approved-brief", `${path}.kind`);
  return {
    kind: "approved-brief",
    projectId: safeId(basis.projectId, `${path}.projectId`),
    projectSnapshotId: safeId(
      basis.projectSnapshotId,
      `${path}.projectSnapshotId`,
    ),
    projectRevision: positiveInteger(
      basis.projectRevision,
      `${path}.projectRevision`,
    ),
    briefId: safeId(basis.briefId, `${path}.briefId`),
    briefSnapshotId: safeId(basis.briefSnapshotId, `${path}.briefSnapshotId`),
    briefRevision: positiveInteger(basis.briefRevision, `${path}.briefRevision`),
    approvedBriefFingerprint: parseFingerprint(
      basis.approvedBriefFingerprint,
      `${path}.approvedBriefFingerprint`,
    ),
  };
}

function parseApprovedHumanReview(
  value: unknown,
  path: string,
): ProjectBriefReview & {
  readonly status: "approved";
  readonly decidedAt: string;
  readonly decidedBy: ProjectBriefActor & { readonly origin: "human" };
} {
  const review = exactOptionalRecord(
    value,
    [
      "briefSnapshotId",
      "briefRevision",
      "status",
      "inputFingerprint",
      "requestedAt",
      "decidedAt",
      "decidedBy",
    ],
    ["rationale"],
    path,
  );
  literalValue(review.status, "approved", `${path}.status`);
  const actor = exactRecord(review.decidedBy, ["id", "origin"], `${path}.decidedBy`);
  literalValue(actor.origin, "human", `${path}.decidedBy.origin`);
  return {
    briefSnapshotId: safeId(
      review.briefSnapshotId,
      `${path}.briefSnapshotId`,
    ),
    briefRevision: positiveInteger(
      review.briefRevision,
      `${path}.briefRevision`,
    ),
    status: "approved",
    inputFingerprint: parseFingerprint(
      review.inputFingerprint,
      `${path}.inputFingerprint`,
    ),
    requestedAt: canonicalUtcInstant(review.requestedAt, `${path}.requestedAt`),
    decidedAt: canonicalUtcInstant(review.decidedAt, `${path}.decidedAt`),
    decidedBy: {
      id: nonEmptyText(actor.id, `${path}.decidedBy.id`),
      origin: "human",
    },
    ...(Object.hasOwn(review, "rationale")
      ? { rationale: nonEmptyText(review.rationale, `${path}.rationale`) }
      : {}),
  };
}

function parseBriefNativeIdentity(sourceText: string): {
  readonly briefId: string;
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
} {
  let value: unknown;
  try {
    value = JSON.parse(sourceText);
  } catch {
    throw new TypeError("The exact brief source must be canonical JSON.");
  }
  const brief = value as Record<string, unknown>;
  return {
    briefId: safeId(brief.briefId, "$brief.briefId"),
    briefSnapshotId: safeId(brief.id, "$brief.id"),
    briefRevision: positiveInteger(brief.revision, "$brief.revision"),
  };
}

function exactOptionalRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return exactRecord(value, requiredKeys, path);
  }
  const actualKeys = Object.keys(value as Record<string, unknown>);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of actualKeys) {
    if (!allowed.has(key)) throw new TypeError(`${path} has unsupported field ${key}.`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} is required.`);
  }
  return exactRecord(value, actualKeys, path);
}

function canonicalUtcInstant(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new TypeError(`${path} must be a canonical UTC ISO-8601 instant.`);
  }
  return text;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.digest must be canonical lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

async function fingerprintUtf8(text: string): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

function diagnosticId(code: string, sourceId: string, itemId: string): string {
  const sanitized = `${code}:${sourceId}:${itemId}`.replace(/[^A-Za-z0-9._:-]/g, "-");
  return sanitized.length <= 256 ? sanitized : sanitized.slice(0, 256);
}

function compareBinding(left: AdmissionBinding, right: AdmissionBinding): number {
  return ascii(left.sourceId, right.sourceId) ||
    ascii(left.sourceSymbolId, right.sourceSymbolId) || ascii(left.id, right.id);
}

function compareDiagnostic(
  left: AdmissionDiagnostic,
  right: AdmissionDiagnostic,
): number {
  return ascii(left.sourceId, right.sourceId) ||
    ascii(left.symbolId ?? "", right.symbolId ?? "") || ascii(left.id, right.id);
}

function ascii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
