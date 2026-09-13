import type {
  ProjectBuyCostEstimatePreviewResult,
  ProjectBuyCostEstimatePreviewUseCase,
} from "../../ports/in/buy/project-buy-cost-estimate-preview.ts";
import type {
  BuyCostEstimatePreviewEvidenceReference,
  BuyCostEstimatePreviewEvidenceStore,
} from "../../ports/out/buy/buy-cost-estimate-preview-evidence-store.ts";
import {
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_SCHEMA,
} from "../../ports/out/buy/buy-cost-estimate-preview-evidence-store.ts";
import type { BuyCostBundleV2Gap } from "../../../domain/buy/buy-cost-bundle-v2.ts";
import {
  arrayOf,
  closedRecord,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { parseAgentResourceReference } from "../../../domain/resource/agent-resource-reference.ts";

export const BUY_COST_ESTIMATE_PREVIEW_SUMMARY_SCHEMA =
  "buy-cost-estimate-preview-summary/1.0" as const;
export const BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_BYTES = 8192;
export const BUY_COST_ESTIMATE_PREVIEW_DETAIL_MAX_BYTES = 24576;
export const BUY_COST_ESTIMATE_PREVIEW_DETAIL_MAX_ITEMS = 20;
export const BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_SAMPLES = 8;
export const BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MESSAGE_MAX_CHARS = 200;

export const BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS = [
  "pricing",
  "lines",
  "annex-terms",
  "source-evidence",
  "assumptions",
  "full-evidence",
] as const;
export type BuyCostEstimatePreviewDetailSection =
  typeof BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS[number];

export interface BoundedBuyCostEstimatePreviewGapSample {
  readonly code: string;
  readonly message: string;
  readonly lineId?: string;
}

export interface BoundedBuyCostEstimatePreviewResult {
  readonly schemaVersion: typeof BUY_COST_ESTIMATE_PREVIEW_SUMMARY_SCHEMA;
  readonly nature: "documentary";
  readonly provisional: boolean;
  readonly status: "preview";
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
  readonly evidenceRef: BuyCostEstimatePreviewEvidenceReference;
  readonly evidenceBytes: number;
  readonly configurationDigest: string;
  readonly candidateDigest: string;
  readonly baseBundleDigest: string;
  readonly pricing: { readonly currency: string; readonly asOf: string };
  readonly coverage: {
    readonly status: string;
    readonly coveredCount: number;
    readonly excludedCount: number;
    readonly unknownDimensions: readonly string[];
  };
  readonly totals: readonly {
    readonly kind: string;
    readonly currency: string;
    readonly amount: string;
  }[];
  readonly counts: {
    readonly estimates: number;
    readonly evidence: number;
    readonly lines: number;
    readonly terms: number;
    readonly gaps: number;
    readonly provisionalLines: number;
    readonly gapsByCode: Readonly<Record<string, number>>;
  };
  readonly samples: {
    readonly gaps: readonly BoundedBuyCostEstimatePreviewGapSample[];
    readonly omittedGaps: number;
  };
}

export type BoundedBuyCostEstimatePreviewOutcome =
  | BoundedBuyCostEstimatePreviewResult
  | { readonly status: "unresolved" | "unavailable"; readonly reason: string };

type PreviewResult = Extract<
  ProjectBuyCostEstimatePreviewResult,
  { readonly status: "preview" }
>;

export class BoundedBuyCostEstimatePreview {
  constructor(
    private readonly preview: ProjectBuyCostEstimatePreviewUseCase,
    private readonly evidence: BuyCostEstimatePreviewEvidenceStore,
  ) {}

  async execute(command: unknown): Promise<BoundedBuyCostEstimatePreviewOutcome> {
    const result = await this.preview.execute(command);
    if (result.status !== "preview") return result;
    const evidenceRef = await this.evidence.save({
      schemaVersion: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_SCHEMA,
      projectId: result.projectId,
      basis: result.basis,
      candidate: result.candidate,
      configurationDigest: result.configurationDigest,
      baseBundleDigest: result.bundle.baseBundle.digest,
      inputRefs: inputRefsFromCommand(command),
      result,
    });
    return summary(result, evidenceRef);
  }
}

export function summary(
  result: PreviewResult,
  evidenceRef: BuyCostEstimatePreviewEvidenceReference,
): BoundedBuyCostEstimatePreviewResult {
  const gaps = collectGaps(result);
  let sampleCount = Math.min(
    BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_SAMPLES,
    gaps.length,
  );
  while (true) {
    const out: BoundedBuyCostEstimatePreviewResult = {
      schemaVersion: BUY_COST_ESTIMATE_PREVIEW_SUMMARY_SCHEMA,
      nature: result.nature,
      provisional: result.provisional,
      status: "preview",
      basis: {
        snapshotId: result.basis.snapshotId,
        revision: result.basis.revision,
        subjectId: result.basis.subjectId,
      },
      evidenceRef,
      evidenceBytes: evidenceRef.byteCount,
      configurationDigest: result.configurationDigest,
      candidateDigest: result.candidate.digest,
      baseBundleDigest: result.bundle.baseBundle.digest,
      pricing: { ...result.pricing },
      coverage: {
        status: result.bundle.coverage.status,
        coveredCount: result.bundle.coverage.coveredLineIds.length,
        excludedCount: result.bundle.coverage.excludedLineIds.length,
        unknownDimensions: [...result.bundle.coverage.unknownDimensions],
      },
      totals: result.bundle.totals.map((total) => ({
        kind: total.kind,
        currency: total.currency,
        amount: total.amount,
      })),
      counts: {
        estimates: result.estimates.length,
        evidence: result.evidence.length,
        lines: result.bundle.lines.length,
        terms: result.annexes.reduce(
          (count, annex) =>
            count +
            annex.lines.reduce((inner, line) => inner + line.terms.length, 0),
          0,
        ),
        gaps: gaps.length,
        provisionalLines: result.bundle.lines.filter((line) => line.provisional)
          .length,
        gapsByCode: countByCode(gaps),
      },
      samples: {
        gaps: gaps.slice(0, sampleCount).map((gap) => ({
          code: gap.code,
          message: gap.message.length >
              BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MESSAGE_MAX_CHARS
            ? gap.message.slice(
              0,
              BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MESSAGE_MAX_CHARS,
            )
            : gap.message,
          ...(gap.lineId === undefined ? {} : { lineId: gap.lineId }),
        })),
        omittedGaps: Math.max(0, gaps.length - sampleCount),
      },
    };
    if (summaryBytes(out) <= BUY_COST_ESTIMATE_PREVIEW_SUMMARY_MAX_BYTES) {
      return out;
    }
    if (sampleCount > 0) {
      sampleCount--;
      continue;
    }
    throw new TypeError("Preview summary metadata exceeds its fixed bound.");
  }
}

export class ReadBuyCostEstimatePreviewEvidence {
  constructor(private readonly evidence: BuyCostEstimatePreviewEvidenceStore) {}

  async execute(
    value: unknown,
  ): Promise<{
    readonly section: string;
    readonly items: readonly unknown[];
    readonly nextCursor: string | null;
  }> {
    const query = previewEvidenceDetailQuery(value);
    const stored = await this.evidence.read(query.evidenceRef);
    if (!stored || stored.projectId !== query.projectId) {
      throw new TypeError("Preview evidence is unavailable or foreign.");
    }
    const data = section(stored.result, query.section);
    const offset = query.cursor === undefined ? 0 : await this.#decode(
      query.cursor,
      query.evidenceRef,
      query.section,
      data.length,
    );
    const page = this.#page(data, offset, query.section);
    const out = {
      section: query.section,
      items: page,
      nextCursor: offset + page.length < data.length
        ? await this.#encode(offset + page.length, query.evidenceRef, query.section)
        : null,
    };
    if (
      query.section !== "full-evidence" &&
      new TextEncoder().encode(deterministicJson(out)).byteLength >
        BUY_COST_ESTIMATE_PREVIEW_DETAIL_MAX_BYTES
    ) throw new TypeError("Preview evidence page exceeds its fixed bound.");
    return out;
  }

  #page(
    data: readonly unknown[],
    offset: number,
    section: string,
  ): readonly unknown[] {
    const page: unknown[] = [];
    for (
      const item of data.slice(
        offset,
        offset + BUY_COST_ESTIMATE_PREVIEW_DETAIL_MAX_ITEMS,
      )
    ) {
      const candidate = [...page, item];
      if (
        section !== "full-evidence" &&
        new TextEncoder().encode(
            deterministicJson({ section, items: candidate, nextCursor: "x" }),
          ).byteLength > BUY_COST_ESTIMATE_PREVIEW_DETAIL_MAX_BYTES
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
    reference: BuyCostEstimatePreviewEvidenceReference,
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
    reference: BuyCostEstimatePreviewEvidenceReference,
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

function section(
  result: PreviewResult,
  name: BuyCostEstimatePreviewDetailSection,
): readonly unknown[] {
  switch (name) {
    case "pricing":
      return [{
        currency: result.bundle.pricingContext.currency,
        asOf: result.bundle.pricingContext.asOf,
        rounding: result.bundle.pricingContext.rounding,
        requiredDimensions: [...result.bundle.pricingContext.requiredDimensions],
        coverage: result.bundle.coverage,
        totals: [...result.bundle.totals],
      }];
    case "lines":
      return [...result.bundle.lines];
    case "annex-terms":
      return result.annexes.flatMap((annex) =>
        annex.lines.flatMap((line) =>
          line.terms.map((term) => {
            const annexFingerprint = result.bundle.lines.find((bundleLine) =>
              bundleLine.configurationLineId === line.configurationLineId
            )?.annexRef?.annexFingerprint;
            return {
              configurationLineId: line.configurationLineId,
              ...(annexFingerprint === undefined ? {} : { annexFingerprint }),
              inputCaptureUri: annex.estimateSource.inputCaptureUri,
              term,
            };
          })
        )
      );
    case "source-evidence":
      return [...result.evidence];
    case "assumptions":
      return result.annexes.flatMap((annex) =>
        annex.assumptions.map((assumption) => {
          const estimateId = result.estimates.find((entry) =>
            entry.captureUri === annex.estimateSource.inputCaptureUri
          )?.estimateId;
          return {
            captureUri: annex.estimateSource.inputCaptureUri,
            ...(estimateId === undefined ? {} : { estimateId }),
            assumption,
          };
        })
      );
    case "full-evidence":
      return [result];
  }
}

function collectGaps(
  result: PreviewResult,
): readonly BuyCostBundleV2Gap[] {
  return [
    ...result.bundle.gaps,
    ...result.bundle.lines.flatMap((line) => line.gaps),
  ];
}

function countByCode(
  gaps: readonly BuyCostBundleV2Gap[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const gap of gaps) {
    counts[gap.code] = (counts[gap.code] ?? 0) + 1;
  }
  return counts;
}

function summaryBytes(value: unknown): number {
  return new TextEncoder().encode(deterministicJson(value)).byteLength;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

function inputRefsFromCommand(command: unknown) {
  const root = exactRecord(command, [
    "projectId",
    "basis",
    "candidateArtifactId",
    "candidateFingerprint",
    "estimateRefs",
  ], "$buyCostEstimatePreview");
  return arrayOf(root.estimateRefs, "$buyCostEstimatePreview.estimateRefs").map(
    (ref, i) =>
      parseAgentResourceReference(
        ref,
        `$buyCostEstimatePreview.estimateRefs[${i}]`,
      ),
  );
}

function previewEvidenceDetailQuery(value: unknown): {
  readonly projectId: string;
  readonly evidenceRef: BuyCostEstimatePreviewEvidenceReference;
  readonly section: BuyCostEstimatePreviewDetailSection;
  readonly cursor?: string;
} {
  const root = closedRecord(value, [
    "projectId",
    "evidenceRef",
    "section",
    "cursor",
  ], [
    "projectId",
    "evidenceRef",
    "section",
  ], "$buyCostEstimatePreviewDetail");
  const ref = exactRecord(
    root.evidenceRef,
    ["schemaVersion", "projectId", "fingerprint", "byteCount"],
    "$buyCostEstimatePreviewDetail.evidenceRef",
  );
  literalValue(
    ref.schemaVersion,
    BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
    "$buyCostEstimatePreviewDetail.evidenceRef.schemaVersion",
  );
  const fingerprint = exactRecord(
    ref.fingerprint,
    ["algorithm", "digest"],
    "$buyCostEstimatePreviewDetail.evidenceRef.fingerprint",
  );
  literalValue(
    fingerprint.algorithm,
    "sha256",
    "$buyCostEstimatePreviewDetail.evidenceRef.fingerprint.algorithm",
  );
  const digest = nonEmptyText(
    fingerprint.digest,
    "$buyCostEstimatePreviewDetail.evidenceRef.fingerprint.digest",
  );
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(
      "$buyCostEstimatePreviewDetail.evidenceRef.fingerprint.digest must be lowercase sha256 hex.",
    );
  }
  if (
    typeof root.section !== "string" ||
    !(BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS as readonly string[]).includes(
      root.section,
    )
  ) {
    throw new TypeError(
      `$buyCostEstimatePreviewDetail.section must be one of ${
        BUY_COST_ESTIMATE_PREVIEW_DETAIL_SECTIONS.join(", ")
      }.`,
    );
  }
  if (
    root.cursor !== undefined &&
    (typeof root.cursor !== "string" || !SHA256_HEX.test(root.cursor))
  ) {
    throw new TypeError(
      "$buyCostEstimatePreviewDetail.cursor is invalid or foreign.",
    );
  }
  if (
    typeof ref.byteCount !== "number" || !Number.isSafeInteger(ref.byteCount) ||
    ref.byteCount < 1
  ) {
    throw new TypeError(
      "$buyCostEstimatePreviewDetail.evidenceRef.byteCount must be a positive integer.",
    );
  }
  return {
    projectId: safeId(root.projectId, "$buyCostEstimatePreviewDetail.projectId"),
    evidenceRef: {
      schemaVersion: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
      projectId: safeId(
        ref.projectId,
        "$buyCostEstimatePreviewDetail.evidenceRef.projectId",
      ),
      fingerprint: { algorithm: "sha256", digest },
      byteCount: ref.byteCount,
    },
    section: root.section as BuyCostEstimatePreviewDetailSection,
    ...(root.cursor === undefined ? {} : { cursor: root.cursor as string }),
  };
}
