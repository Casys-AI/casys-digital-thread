/**
 * Provider-owned recorded-result projection built from a sealed DT bundle.
 * Never substitutes a reserialized capture for inner canonicalText.
 */

import {
  BUY_SEAL_CAPTURE_URI_PREFIX,
  type BuySealCapture,
} from "./buy-seal-capture.ts";
import type { BuyCostLine } from "../../domain/buy/buy-cost-bundle.ts";
import {
  BUY_CAPTURE_URI_PREFIX,
  sha256Digest,
} from "../../domain/buy/buy-source-capture.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";

export const BUY_RECORDED_RESULT_SCHEMA =
  "io.casys.mcp-erpnext.buy-recorded-result/1.0" as const;
export const BUY_RECORDED_RESULT_V2_SCHEMA =
  "io.casys.mcp-erpnext.buy-recorded-result/2.0" as const;
export const BUY_RECORDED_RESULT_KIND = "buy.configuration-cost" as const;
export const BUY_RESULT_URI_PREFIX =
  "casys://mcp-erpnext/buy-recorded-result/sha256/" as const;
export const BUY_CONFIGURATION_URI_PREFIX =
  "casys://digital-thread/buy-configuration/sha256/" as const;
/** Published DT seal-capture URI. Not recorded-result bytes. */
export const BUY_BUNDLE_URI_PREFIX = BUY_SEAL_CAPTURE_URI_PREFIX;

export async function buildBuyRecordedResult(
  capture: BuySealCapture,
  applicability: "current" | "historical",
): Promise<{
  readonly result: Record<string, unknown>;
  readonly fingerprint: string;
  readonly uri: string;
}> {
  const capturedAt = capture.sourceCaptures[0]?.capture.capturedAt ??
    capture.sealedAt;
  const priced = capture.bundle.lines.filter((line) => line.amount !== undefined);
  const unpriced = capture.bundle.lines.filter((line) => line.amount === undefined);
  const excluded = capture.bundle.coverage.excludedLineIds;
  const gaps = recordedGaps(capture);
  const status = recordedCoverageStatus(capture, priced, excluded, gaps);
  const result = {
    schemaVersion: unpriced.length > 0
      ? BUY_RECORDED_RESULT_V2_SCHEMA
      : BUY_RECORDED_RESULT_SCHEMA,
    kind: BUY_RECORDED_RESULT_KIND,
    configurationRef: {
      uri: `${BUY_CONFIGURATION_URI_PREFIX}${capture.configurationDigest}`,
      fingerprint: `sha256:${capture.configurationDigest}`,
    },
    configuration: {
      projectId: capture.configuration.projectId,
      subjectId: capture.configuration.subjectId,
      configurationRevision: capture.configuration.configurationRevision,
    },
    sourceCaptures: capture.sourceCaptures.map((envelope) => {
      const digest = sha256Digest(envelope.fingerprint);
      return {
        sourceInstance: envelope.capture.sourceInstance,
        fingerprint: envelope.fingerprint,
        capturedAt: envelope.capture.capturedAt,
        uri: `${BUY_CAPTURE_URI_PREFIX}${digest}`,
      };
    }),
    pricingContext: {
      currency: capture.bundle.pricingContext.currency,
      observedAt: capturedAt,
    },
    lines: priced.map((line) => recordedLine(line, capturedAt)),
    ...(unpriced.length > 0
      ? {
        excludedLines: unpriced.map((line) => ({
          lineId: line.configurationLineId,
          qty: line.quantity,
          uom: line.uom,
          reason: line.gaps.map((gap) => gap.message).join(" ") ||
            "No sourced monetary amount is established for this configuration line.",
        })),
      }
      : {}),
    coverage: {
      status,
      coveredLineIds: priced.map((line) => line.configurationLineId),
      excludedLineIds: [...excluded],
      quantityBasis: "configuration-occurrences",
      currency: capture.bundle.pricingContext.currency,
    },
    totals: recordedTotals(capture, status),
    gaps,
    basis: {
      current: {
        configurationRevision: capture.configuration.configurationRevision,
        capturedAt,
      },
      ...(applicability === "historical"
        ? {
          old: {
            configurationRevision: capture.configuration.configurationRevision,
            capturedAt,
          },
        }
        : {}),
    },
  };
  const fingerprint = `sha256:${(await sha256Fingerprint(result)).digest}`;
  return {
    result,
    fingerprint,
    uri: `${BUY_RESULT_URI_PREFIX}${sha256Digest(fingerprint)}`,
  };
}

function recordedCoverageStatus(
  capture: BuySealCapture,
  priced: readonly BuyCostLine[],
  excluded: readonly string[],
  gaps: readonly { readonly code: string }[],
): "complete" | "partial" | "unresolved" {
  if (gaps.length > 0 && priced.length > 0) return "partial";
  if (priced.length === 0) return "unresolved";
  if (excluded.length > 0) return "partial";
  if (capture.bundle.coverage.unknownDimensions.length > 0) return "partial";
  return "complete";
}

function recordedTotals(
  capture: BuySealCapture,
  status: "complete" | "partial" | "unresolved",
): readonly Record<string, unknown>[] {
  const covered = capture.bundle.totals.find((item) =>
    item.kind === "covered-subtotal"
  );
  if (!covered) {
    throw new TypeError(
      "Recorded Buy evidence requires its retained covered subtotal.",
    );
  }
  const totals: Record<string, unknown>[] = [{
    kind: "covered-subtotal",
    currency: capture.bundle.pricingContext.currency,
    amount: covered.amount,
  }];
  if (status === "complete") {
    totals.push({
      kind: "complete-total",
      currency: capture.bundle.pricingContext.currency,
      amount: covered.amount,
    });
  }
  return totals;
}

function recordedGaps(capture: BuySealCapture): readonly {
  readonly code: string;
  readonly reason: string;
  readonly lineId?: string;
}[] {
  const gaps: Array<
    { code: string; reason: string; lineId?: string }
  > = capture.bundle.gaps.map((gap) => ({
    code: gap.code,
    reason: gap.message,
    ...(gap.lineId ? { lineId: gap.lineId } : {}),
  }));
  for (const line of capture.bundle.lines) {
    for (const gap of line.gaps) {
      if (gap.code === "dimension-unknown" && !gap.lineId) {
        gaps.push({ code: gap.code, reason: gap.message });
        continue;
      }
      if (gap.code === "dimension-unknown") {
        const already = gaps.some((item) =>
          item.code === gap.code && item.reason === gap.message && !item.lineId
        );
        if (!already) {
          gaps.push({ code: gap.code, reason: gap.message });
        }
        continue;
      }
      gaps.push({
        code: gap.code,
        reason: gap.message,
        ...(gap.lineId ? { lineId: gap.lineId } : {}),
      });
    }
  }
  return gaps;
}

function recordedLine(
  line: BuyCostLine,
  capturedAt: string,
): Record<string, unknown> {
  if (
    line.unitPrice === undefined || line.currency === undefined ||
    line.amount === undefined || !line.citation
  ) {
    throw new TypeError(
      `Priced Buy line ${line.configurationLineId} requires retained price, currency, amount and citation.`,
    );
  }
  const sourceCategory = line.costClass === "catalogue"
    ? "catalogue-price"
    : line.costClass === "quotation"
    ? "supplier-quotation"
    : line.costClass === "historical-invoice"
    ? "historical-invoice"
    : "documentary-estimate";
  return {
    lineId: line.configurationLineId,
    sourceCategory,
    qty: line.quantity,
    uom: line.uom,
    unitPrice: line.unitPrice,
    currency: line.currency,
    lineAmount: line.amount,
    priceDate: (line.sourceValidity?.from ?? capturedAt).slice(0, 10),
    observedAt: line.capturedAt ?? capturedAt,
    source: recordedSource(line),
  };
}

function recordedSource(line: BuyCostLine): Record<string, unknown> {
  const citation = line.citation;
  if (!citation) {
    throw new TypeError("A recorded priced Buy line requires its retained citation.");
  }
  if (citation.kind === "external-documentary") {
    return {
      kind: "external-documentary",
      uri: citation.resourceUri,
      fingerprint: citation.fingerprint,
    };
  }
  return {
    kind: "erpnext-document",
    sourceInstance: citation.sourceInstance,
    doctype: citation.document.doctype,
    name: citation.document.name,
    modified: citation.modified,
    ...(citation.rowName ? { row: citation.rowName } : {}),
    fingerprint: citation.documentFingerprint,
  };
}
