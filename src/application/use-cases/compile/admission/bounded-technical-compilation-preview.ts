import type {
  ProjectTechnicalCompilationPreviewResult,
  ProjectTechnicalCompilationPreviewUseCase,
} from "../../../ports/in/compile/admission/project-technical-compilation-preview.ts";
import type {
  TechnicalCompilationPreviewEvidenceReference,
  TechnicalCompilationPreviewEvidenceStore,
} from "../../../ports/out/compile/admission/technical-compilation-preview-evidence-store.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";

export const TECHNICAL_COMPILATION_PREVIEW_SUMMARY_SCHEMA =
  "technical-compilation-preview-summary/1.0" as const;
export const TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_BYTES = 8192;
export const TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES = 24576;
export const TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_ITEMS = 20;
const TECHNICAL_COMPILATION_PREVIEW_SOURCE_TEXT_CHUNK_MAX_BYTES = 1000;
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
    readonly diagnostics: readonly unknown[];
    readonly gaps: readonly unknown[];
    readonly omittedDiagnostics: number;
    readonly omittedGaps: number;
  };
  readonly requiresFullEvidenceForMrtr: boolean;
}
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
    return summary(result, evidenceRef);
  }
}
export function summary(
  result: ProjectTechnicalCompilationPreviewResult,
  evidenceRef: TechnicalCompilationPreviewEvidenceReference,
): BoundedTechnicalCompilationPreviewResult {
  const diagnostics = result.document.diagnostics, gaps = result.gaps;
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
      diagnostics: diagnostics.slice(0, 8).map(summaryItem),
      gaps: gaps.slice(0, 8).map(summaryItem),
      omittedDiagnostics: Math.max(0, diagnostics.length - 8),
      omittedGaps: Math.max(0, gaps.length - 8),
    },
    requiresFullEvidenceForMrtr: result.status === "ready-for-review",
  };
  if (
    new TextEncoder().encode(deterministicJson(out)).byteLength >
      TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_BYTES
  ) throw new TypeError("Preview summary exceeds its fixed bound.");
  return out;
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
    const data = section(e.result, x.section);
    const offset = x.cursor === undefined
      ? 0
      : decode(x.cursor, x.evidenceRef, x.section, data.length);
    const page = data.slice(
      offset,
      offset + TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_ITEMS,
    );
    const out = {
      section: x.section,
      items: page,
      nextCursor: offset + page.length < data.length
        ? encode(offset + page.length, x.evidenceRef, x.section)
        : null,
    };
    if (
      x.section !== "full-evidence" &&
      new TextEncoder().encode(deterministicJson(out)).byteLength >
        TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES
    ) throw new TypeError("Preview evidence page exceeds its fixed bound.");
    return out;
  }
}
function section(
  r: ProjectTechnicalCompilationPreviewResult,
  s: string,
): readonly unknown[] {
  if (s === "diagnostics") return r.document.diagnostics;
  if (s === "gaps") return r.gaps;
  if (s === "source-manifest") {
    return r.document.inputManifest.sources.map(({ sourceText, ...x }) => x);
  }
  if (s === "source-text") {
    return r.document.inputManifest.sources.flatMap((x) =>
      chunks(x.analysis.source.id, x.sourceText)
    );
  }
  if (s === "projections") return r.document.projections;
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
function summaryItem(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(summaryItem);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => SUMMARY_ALLOWED_KEYS.has(key))
      .map(([key, nested]) => [key, summaryItem(nested)]),
  );
}
function encode(
  offset: number,
  reference: TechnicalCompilationPreviewEvidenceReference,
  section: string,
) {
  return btoa(
    JSON.stringify({
      p: reference.projectId,
      f: reference.fingerprint.digest,
      s: section,
      o: offset,
    }),
  ).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decode(
  cursor: string,
  reference: TechnicalCompilationPreviewEvidenceReference,
  section: string,
  length: number,
) {
  try {
    const x = JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")));
    if (
      x.p !== reference.projectId || x.f !== reference.fingerprint.digest ||
      x.s !== section ||
      !Number.isSafeInteger(x.o) || x.o < 0 || x.o > length
    ) throw 0;
    return x.o;
  } catch {
    throw new TypeError("Preview evidence cursor is invalid or foreign.");
  }
}
