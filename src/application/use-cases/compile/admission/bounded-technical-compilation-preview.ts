import type {
  ProjectTechnicalCompilationPreviewResult,
  ProjectTechnicalCompilationPreviewUseCase,
} from "../../../ports/in/compile/admission/project-technical-compilation-preview.ts";
import type {
  TechnicalCompilationPreviewEvidenceReference,
  TechnicalCompilationPreviewEvidenceStore,
} from "../../../ports/out/compile/admission/technical-compilation-preview-evidence-store.ts";
import {
  deterministicJson,
  sha256Hex,
} from "../../../../domain/kernel/deterministic-json.ts";

export const TECHNICAL_COMPILATION_PREVIEW_SUMMARY_SCHEMA =
  "technical-compilation-preview-summary/1.0" as const;
export const TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_BYTES = 8192;
export const TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES = 24576;
export const TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_ITEMS = 20;
export const TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_SAMPLES = 8;
const TECHNICAL_COMPILATION_PREVIEW_SOURCE_TEXT_CHUNK_MAX_BYTES = 1000;
const TECHNICAL_COMPILATION_PREVIEW_SUMMARY_EXCERPT_MAX_BYTES = 256;
const SUMMARY_ALLOWED_KEYS = new Set([
  "code",
  "profileRef",
  "subjectRef",
  "sourceId",
  "relation",
  "symbolName",
  "symbolKind",
  "reason",
  "candidateCount",
  "closureKind",
  "modelSymbolId",
  "attributeUsageId",
  "role",
  "requirementElementId",
  "recovery",
]);
export interface BoundedTechnicalCompilationPreviewResult {
  readonly schemaVersion: typeof TECHNICAL_COMPILATION_PREVIEW_SUMMARY_SCHEMA;
  readonly status: ProjectTechnicalCompilationPreviewResult["status"];
  readonly evidenceRef: TechnicalCompilationPreviewEvidenceReference;
  readonly evidenceBytes: number;
  readonly counts: {
    readonly sources: number;
    readonly projections: number;
    readonly diagnostics: number;
    readonly gaps: number;
    readonly diagnosticsByCode: Readonly<Record<string, number>>;
    readonly gapsByCode: Readonly<Record<string, number>>;
  };
  readonly samples: {
    readonly diagnostics: readonly BoundedTechnicalCompilationPreviewSample[];
    readonly gaps: readonly BoundedTechnicalCompilationPreviewSample[];
    readonly omittedDiagnostics: number;
    readonly omittedGaps: number;
  };
  readonly requiresFullEvidenceForMrtr: boolean;
}
export interface BoundedTechnicalCompilationPreviewExcerpt {
  readonly excerpt: string;
  readonly originalByteCount: number;
  readonly sha256: string;
  readonly truncatedBytes: number;
}
export type BoundedTechnicalCompilationPreviewSample =
  | null
  | boolean
  | number
  | BoundedTechnicalCompilationPreviewExcerpt
  | readonly BoundedTechnicalCompilationPreviewSample[]
  | { readonly [key: string]: BoundedTechnicalCompilationPreviewSample };
export class BoundedTechnicalCompilationPreview {
  constructor(
    private readonly preview: ProjectTechnicalCompilationPreviewUseCase,
    private readonly evidence: TechnicalCompilationPreviewEvidenceStore,
  ) {}
  async execute(command: unknown): Promise<BoundedTechnicalCompilationPreviewResult> {
    const result = await this.preview.execute(command);
    const evidenceRef = await this.evidence.save({
      schemaVersion: "technical-compilation-preview-evidence/1.0",
      projectId: result.document.basis.thread.projectId,
      result,
    });
    return await summary(result, evidenceRef);
  }
}
export async function summary(
  result: ProjectTechnicalCompilationPreviewResult,
  evidenceRef: TechnicalCompilationPreviewEvidenceReference,
): Promise<BoundedTechnicalCompilationPreviewResult> {
  const diagnostics = result.document.diagnostics, gaps = result.gaps;
  let diagnosticCount = Math.min(
    TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_SAMPLES,
    diagnostics.length,
  );
  let gapCount = Math.min(
    TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_SAMPLES,
    gaps.length,
  );
  while (true) {
    const out: BoundedTechnicalCompilationPreviewResult = {
      schemaVersion: TECHNICAL_COMPILATION_PREVIEW_SUMMARY_SCHEMA,
      status: result.status,
      evidenceRef,
      evidenceBytes: evidenceRef.byteCount,
      counts: {
        sources: result.document.inputManifest.sources.length,
        projections: result.document.projections.length,
        diagnostics: diagnostics.length,
        gaps: gaps.length,
        diagnosticsByCode: count(diagnostics),
        gapsByCode: count(gaps),
      },
      samples: {
        diagnostics: await Promise.all(
          diagnostics.slice(0, diagnosticCount).map(summaryItem),
        ),
        gaps: await Promise.all(gaps.slice(0, gapCount).map(summaryItem)),
        omittedDiagnostics: Math.max(0, diagnostics.length - diagnosticCount),
        omittedGaps: Math.max(0, gaps.length - gapCount),
      },
      requiresFullEvidenceForMrtr: result.status === "ready-for-review",
    };
    if (summaryBytes(out) <= TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_BYTES) {
      return out;
    }
    // Preserve the first occurrence of each class for deterministic triage.
    if (gapCount > 0) {
      gapCount--;
      continue;
    }
    if (diagnosticCount > 0) {
      diagnosticCount--;
      continue;
    }
    throw new TypeError("Preview summary metadata exceeds its fixed bound.");
  }
}
function summaryBytes(value: unknown): number {
  return new TextEncoder().encode(deterministicJson(value)).byteLength;
}
export class ReadTechnicalCompilationPreviewEvidence {
  constructor(private readonly evidence: TechnicalCompilationPreviewEvidenceStore) {}
  async execute(
    value: unknown,
  ): Promise<
    {
      readonly section: string;
      readonly items: readonly unknown[];
      readonly nextCursor: string | null;
    }
  > {
    const x = value as any;
    if (
      !x || typeof x !== "object" || typeof x.projectId !== "string" ||
      !x.evidenceRef || typeof x.section !== "string"
    ) {
      throw new TypeError(
        "Preview evidence detail requires only projectId, evidenceRef and section.",
      );
    }
    const e = await this.evidence.read(x.evidenceRef);
    if (!e || e.projectId !== x.projectId) {
      throw new TypeError("Preview evidence is unavailable or foreign.");
    }
    const data = await section(e.result, x.section);
    const offset = x.cursor === undefined
      ? 0
      : await this.#decode(x.cursor, x.evidenceRef, x.section, data.length);
    const page = this.#page(data, offset, x.section);
    const out = {
      section: x.section,
      items: page,
      nextCursor: offset + page.length < data.length
        ? await this.#encode(offset + page.length, x.evidenceRef, x.section)
        : null,
    };
    if (
      x.section !== "full-evidence" &&
      new TextEncoder().encode(deterministicJson(out)).byteLength >
        TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES
    ) throw new TypeError("Preview evidence page exceeds its fixed bound.");
    return out;
  }
  #page(data: readonly unknown[], offset: number, section: string): readonly unknown[] {
    const page: unknown[] = [];
    for (
      const item of data.slice(
        offset,
        offset + TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_ITEMS,
      )
    ) {
      const candidate = [...page, item];
      if (
        section !== "full-evidence" &&
        new TextEncoder().encode(
            deterministicJson({ section, items: candidate, nextCursor: "x" }),
          ).byteLength > TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES
      ) break;
      page.push(item);
    }
    if (page.length === 0 && offset < data.length && section !== "full-evidence") {
      throw new TypeError("Preview evidence item exceeds its fixed bound.");
    }
    return page;
  }
  async #encode(
    offset: number,
    reference: TechnicalCompilationPreviewEvidenceReference,
    section: string,
  ): Promise<string> {
    return await this.evidence.saveCursor({
      projectId: reference.projectId,
      fingerprint: reference.fingerprint.digest,
      section,
      offset,
    });
  }
  async #decode(
    cursor: string,
    reference: TechnicalCompilationPreviewEvidenceReference,
    section: string,
    length: number,
  ): Promise<number> {
    const record = await this.evidence.readCursor(cursor);
    if (
      !record || record.projectId !== reference.projectId ||
      record.fingerprint !== reference.fingerprint.digest ||
      record.section !== section || record.offset < 0 || record.offset > length
    ) throw new TypeError("Preview evidence cursor is invalid or foreign.");
    return record.offset;
  }
}
async function section(
  r: ProjectTechnicalCompilationPreviewResult,
  s: string,
): Promise<readonly unknown[]> {
  if (s === "diagnostics") return r.document.diagnostics;
  if (s === "gaps") {
    return await Promise.all(r.gaps.map(async (gap) => ({
      ...gap,
      recovery: await excerpt(gap.recovery),
    })));
  }
  if (s === "source-manifest") {
    return r.document.inputManifest.sources.map((source) => ({
      sourceId: source.analysis.source.id,
      role: source.analysis.source.role,
      language: source.analysis.source.language,
      sourceFingerprint: source.analysis.source.fingerprint.digest,
      analysisFingerprint: source.analysisFingerprint.digest,
      effectiveUnit: {
        kind: source.effectiveUnit.kind,
        closureKind: source.effectiveUnit.closureKind,
        unitId: source.effectiveUnit.unitId,
        closureFingerprint: source.effectiveUnit.closureFingerprint.digest,
      },
      counts: {
        symbols: source.analysis.symbols.length,
        dependencies: source.analysis.dependencies.length,
        unresolvedConstructs: source.analysis.unresolvedConstructs.length,
        bindings: r.document.inputManifest.bindings.filter((binding) =>
          binding.sourceId === source.analysis.source.id
        ).length,
      },
      bindingIds: r.document.inputManifest.bindings.filter((binding) =>
        binding.sourceId === source.analysis.source.id
      ).map((binding) =>
        binding.id
      ),
    }));
  }
  if (s === "source-text") {
    return r.document.inputManifest.sources.flatMap((x) =>
      chunks(x.analysis.source.id, x.sourceText)
    );
  }
  if (s === "projections") {
    return r.document.projections.map((projection) => ({
      target: projection.target,
      profile: { id: projection.profile.id, version: projection.profile.version },
      status: projection.status,
      profileFingerprint: projection.profileFingerprint.digest,
      counts: {
        sources: projection.sources.length,
        bindings: projection.sources.reduce(
          (total, source) => total + source.bindings.length,
          0,
        ),
        diagnostics: projection.diagnostics.length,
      },
    }));
  }
  if (s === "decision-parameters") {
    return r.status === "ready-for-review" ? r.decisionParameters : [];
  }
  if (s === "operation") return r.status === "ready-for-review" ? [r.operation] : [];
  if (s === "full-evidence") return [r];
  throw new TypeError("Unknown preview evidence section.");
}
function chunks(sourceId: string, text: string): readonly unknown[] {
  const out: unknown[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = offset;
    let byteCount = 0;
    while (end < text.length) {
      const codePoint = text.codePointAt(end);
      if (codePoint === undefined) break;
      const character = String.fromCodePoint(codePoint);
      const characterBytes = new TextEncoder().encode(character).byteLength;
      if (
        byteCount > 0 && byteCount + characterBytes >
          TECHNICAL_COMPILATION_PREVIEW_SOURCE_TEXT_CHUNK_MAX_BYTES
      ) break;
      byteCount += characterBytes;
      end += character.length;
    }
    out.push({ sourceId, offset, text: text.slice(offset, end) });
    offset = end;
  }
  return out;
}
function count(a: readonly any[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const x of a) {
    const k = typeof x?.code === "string" ? x.code : "unknown";
    r[k] = (r[k] ?? 0) + 1;
  }
  return r;
}
async function summaryItem(
  value: unknown,
): Promise<BoundedTechnicalCompilationPreviewSample> {
  if (typeof value === "string") return await excerpt(value);
  if (typeof value === "boolean" || typeof value === "number" || value === null) {
    return value;
  }
  if (Array.isArray(value)) return await Promise.all(value.map(summaryItem));
  if (typeof value !== "object") return null;
  const entries = await Promise.all(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => SUMMARY_ALLOWED_KEYS.has(key))
      .map(async ([key, nested]) => [key, await summaryItem(nested)] as const),
  );
  return Object.fromEntries(entries);
}
async function excerpt(
  value: string,
): Promise<BoundedTechnicalCompilationPreviewExcerpt> {
  const encoder = new TextEncoder();
  const original = encoder.encode(value);
  let end = 0;
  let byteCount = 0;
  while (end < value.length) {
    const codePoint = value.codePointAt(end);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const bytes = encoder.encode(character).byteLength;
    if (byteCount + bytes > TECHNICAL_COMPILATION_PREVIEW_SUMMARY_EXCERPT_MAX_BYTES) {
      break;
    }
    byteCount += bytes;
    end += character.length;
  }
  const visible = value.slice(0, end);
  return {
    excerpt: visible,
    originalByteCount: original.byteLength,
    sha256: await sha256Hex(original),
    truncatedBytes: original.byteLength - byteCount,
  };
}
