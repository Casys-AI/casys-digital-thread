/**
 * Closed `buy-production-estimate-bundle/1.0` computation/provenance annex.
 *
 * The annex records per-configuration-unit line and term facts computed from
 * one `buy-documentary-estimate/1.0` input. It is not a totals/coverage
 * authority: final totals pass only through the shared `aggregateBuyCoveredTotals`
 * at V2 composition. Lines stay `costClass: "estimate"` with
 * `external-documentary` citations; they never attest an ERP price.
 *
 * Term amount = consumption decimal x rate decimal using the buy-decimal
 * engine. Unit cost = exact sum of term amounts when every term is priced.
 * An unknown term leaves no complete unit cost; priced term facts are kept
 * and the line is excluded from the final covered subtotal at composition.
 */

import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson, sha256Hex } from "../kernel/deterministic-json.ts";
import {
  type BuyConfiguration,
  validateBuyConfiguration,
} from "./buy-configuration.ts";
import type { BuyPricingContext } from "./buy-cost-bundle.ts";
import { addBuyDecimals, multiplyBuyDecimals, parseBuyDecimal } from "./buy-decimal.ts";
import {
  assertBuyDocumentaryEstimateFingerprint,
  BUY_ESTIMATE_TERM_NATURES,
  type BuyDocumentaryEstimateEnvelope,
  type BuyDocumentaryEstimateLine,
  type BuyEstimateQuantityOperand,
  type BuyEstimateRateOperand,
  type BuyEstimateTermNature,
  canonicalUtcTimestamp,
  parseBuyEstimateQuantityOperand,
  parseBuyEstimateRateOperand,
  parseBuyEstimateValidity,
  validateBuyDocumentaryEstimateEnvelope,
} from "./buy-documentary-estimate.ts";
import { prefixedSha256 } from "./buy-source-capture.ts";

export const BUY_PRODUCTION_ESTIMATE_BUNDLE_SCHEMA =
  "buy-production-estimate-bundle/1.0" as const;

export const BUY_ESTIMATE_GAP_CODES = [
  "estimate-basis-mismatch",
  "estimate-expired",
  "estimate-as-of-ambiguous",
  "uom-unresolved",
  "currency-unresolved",
  "unpriced-component",
] as const;
export type BuyEstimateGapCode = typeof BUY_ESTIMATE_GAP_CODES[number];

const SHA256_HEX = /^[0-9a-f]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;

export interface BuyEstimateGap {
  readonly code: BuyEstimateGapCode;
  readonly message: string;
  readonly lineId?: string;
}

export interface BuyAnnexTerm {
  readonly id: string;
  readonly nature: BuyEstimateTermNature;
  readonly consumption: BuyEstimateQuantityOperand;
  readonly rate: BuyEstimateRateOperand;
  readonly termAmount?: string;
  readonly provisional: boolean;
  readonly gaps: readonly BuyEstimateGap[];
}

export interface BuyAnnexLine {
  readonly configurationLineId: string;
  readonly quantityBasis: "per-configuration-unit";
  readonly productUom: string;
  readonly configurationQuantity: string;
  readonly configurationUom: string;
  readonly unitCost?: string;
  readonly provisional: boolean;
  readonly terms: readonly BuyAnnexTerm[];
  readonly gaps: readonly BuyEstimateGap[];
}

export interface BuyProductionEstimateBundle {
  readonly schemaVersion: typeof BUY_PRODUCTION_ESTIMATE_BUNDLE_SCHEMA;
  readonly estimateSource: {
    readonly inputFingerprint: string;
    readonly inputCaptureUri: string;
    readonly inputAsOf: string;
  };
  readonly estimateRef: {
    readonly configurationDigest: string;
    readonly stepFingerprint: string;
  };
  readonly currency: string;
  readonly sourceValidity: { readonly from?: string; readonly to?: string };
  readonly assumptions: readonly string[];
  readonly lines: readonly BuyAnnexLine[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "estimateSource",
  "estimateRef",
  "currency",
  "sourceValidity",
  "assumptions",
  "lines",
] as const;

export function validateBuyProductionEstimateBundle(
  value: unknown,
): BuyProductionEstimateBundle {
  const root = exactRecord(value, ROOT_KEYS, "$buyProductionEstimateBundle");
  literalValue(
    root.schemaVersion,
    BUY_PRODUCTION_ESTIMATE_BUNDLE_SCHEMA,
    "$buyProductionEstimateBundle.schemaVersion",
  );
  const estimateSource = exactRecord(
    root.estimateSource,
    ["inputFingerprint", "inputCaptureUri", "inputAsOf"],
    "$buyProductionEstimateBundle.estimateSource",
  );
  const estimateRef = exactRecord(
    root.estimateRef,
    ["configurationDigest", "stepFingerprint"],
    "$buyProductionEstimateBundle.estimateRef",
  );
  const currency = currencyCode(root.currency, "$buyProductionEstimateBundle.currency");
  const lines = arrayOf(root.lines, "$buyProductionEstimateBundle.lines").map(
    (line, i) =>
      parseAnnexLine(line, `$buyProductionEstimateBundle.lines[${i}]`, currency),
  );
  rejectDuplicates(
    lines.map((line) => line.configurationLineId),
    "$buyProductionEstimateBundle.lines.configurationLineId",
  );
  return deepFreeze({
    schemaVersion: BUY_PRODUCTION_ESTIMATE_BUNDLE_SCHEMA,
    estimateSource: {
      inputFingerprint: prefixedSha256(
        estimateSource.inputFingerprint,
        "$buyProductionEstimateBundle.estimateSource.inputFingerprint",
      ),
      inputCaptureUri: nonEmptyText(
        estimateSource.inputCaptureUri,
        "$buyProductionEstimateBundle.estimateSource.inputCaptureUri",
      ),
      inputAsOf: canonicalUtcTimestamp(
        estimateSource.inputAsOf,
        "$buyProductionEstimateBundle.estimateSource.inputAsOf",
      ),
    },
    estimateRef: {
      configurationDigest: sha256DigestValue(
        estimateRef.configurationDigest,
        "$buyProductionEstimateBundle.estimateRef.configurationDigest",
      ),
      stepFingerprint: sha256DigestValue(
        estimateRef.stepFingerprint,
        "$buyProductionEstimateBundle.estimateRef.stepFingerprint",
      ),
    },
    currency,
    sourceValidity: parseBuyEstimateValidity(
      root.sourceValidity,
      "$buyProductionEstimateBundle.sourceValidity",
    ),
    assumptions: arrayOf(root.assumptions, "$buyProductionEstimateBundle.assumptions")
      .map((item, i) =>
        nonEmptyText(item, `$buyProductionEstimateBundle.assumptions[${i}]`)
      ),
    lines,
  });
}

/**
 * Compute per-unit annex facts from one validated documentary estimate. The
 * supplied configuration digest is recomputed from the validated
 * configuration and never trusted blindly: an equal-but-invented caller or
 * source digest is refused.
 */
export async function computeBuyProductionEstimateCandidate(input: {
  readonly configuration: BuyConfiguration;
  readonly configurationDigest: string;
  readonly estimate: BuyDocumentaryEstimateEnvelope;
  readonly pricingContext: BuyPricingContext;
}): Promise<BuyProductionEstimateBundle> {
  const configuration = validateBuyConfiguration(input.configuration);
  const verifiedDigest = await sha256Hex(
    new TextEncoder().encode(deterministicJson(configuration)),
  );
  if (verifiedDigest !== input.configurationDigest) {
    throw new TypeError(
      "$buyProductionEstimate.configurationDigest is not the SHA-256 of the validated configuration.",
    );
  }
  const envelope = validateBuyDocumentaryEstimateEnvelope(input.estimate);
  await assertBuyDocumentaryEstimateFingerprint(envelope, sha256Hex);
  const estimate = envelope.estimate;
  const lines = estimate.lines.map((line) =>
    priceAnnexLine({
      configuration,
      verifiedDigest,
      line,
      estimate,
      pricingContext: input.pricingContext,
    })
  );
  return deepFreeze({
    schemaVersion: BUY_PRODUCTION_ESTIMATE_BUNDLE_SCHEMA,
    estimateSource: {
      inputFingerprint: envelope.fingerprint,
      inputCaptureUri: envelope.capture.uri,
      inputAsOf: estimate.asOf,
    },
    estimateRef: {
      configurationDigest: verifiedDigest,
      stepFingerprint: configuration.geometry.stepFingerprint,
    },
    currency: estimate.currency,
    sourceValidity: { ...estimate.sourceValidity },
    assumptions: [...estimate.assumptions],
    lines,
  });
}

/**
 * Recross a retained annex against the annex recomputed from the retained
 * estimate and calculation context: canonical input fingerprint, exact
 * configuration/STEP basis, retained currency, validity, assumptions,
 * operands, and every derived term/line value. Operand evidence references
 * are closed AgentResourceReferences; their genuine store reopen happens at
 * preview, not in this domain check.
 */
export async function assertBuyProductionEstimateLineage(
  bundle: BuyProductionEstimateBundle,
  estimate: BuyDocumentaryEstimateEnvelope,
  retained: {
    readonly configuration: BuyConfiguration;
    readonly configurationDigest: string;
    readonly pricingContext: BuyPricingContext;
  },
): Promise<void> {
  const validated = validateBuyProductionEstimateBundle(bundle);
  const expected = await computeBuyProductionEstimateCandidate({
    configuration: retained.configuration,
    configurationDigest: retained.configurationDigest,
    estimate,
    pricingContext: retained.pricingContext,
  });
  if (deterministicJson(validated) !== deterministicJson(expected)) {
    throw new TypeError(
      "Buy annex does not match the annex recomputed from the retained estimate and context.",
    );
  }
}

function priceAnnexLine(input: {
  readonly configuration: BuyConfiguration;
  readonly verifiedDigest: string;
  readonly line: BuyDocumentaryEstimateLine;
  readonly estimate: BuyDocumentaryEstimateEnvelope["estimate"];
  readonly pricingContext: BuyPricingContext;
}): BuyAnnexLine {
  const configurationLine = input.configuration.lines.find((line) =>
    line.id === input.line.configurationLineId
  );
  if (!configurationLine) {
    throw new TypeError(
      `$buyProductionEstimate names unknown configuration line ${input.line.configurationLineId}.`,
    );
  }
  const base = {
    configurationLineId: configurationLine.id,
    quantityBasis: "per-configuration-unit" as const,
    productUom: input.line.productUom,
    configurationQuantity: configurationLine.quantity,
    configurationUom: configurationLine.uom,
  };
  const unpricedTerms = input.line.terms.map((term) => ({
    id: term.id,
    nature: term.nature,
    consumption: term.consumption,
    rate: term.rate,
    provisional: term.consumption.operand === "assumed" ||
      term.rate.operand === "assumed",
    gaps: [] as BuyEstimateGap[],
  }));
  if (!estimateBasisMatches(input)) {
    return {
      ...base,
      provisional: unpricedTerms.some((term) => term.provisional),
      terms: unpricedTerms,
      gaps: [{
        code: "estimate-basis-mismatch",
        message:
          "Estimate basis (configuration identity, digest, basis, or CAD/STEP geometry) does not match the exact calculation basis.",
        lineId: configurationLine.id,
      }],
    };
  }
  const gaps: BuyEstimateGap[] = [];
  let asOfMismatch = false;
  if (input.estimate.asOf !== input.pricingContext.asOf) {
    asOfMismatch = true;
    gaps.push({
      code: "estimate-as-of-ambiguous",
      message:
        `Estimate asOf ${input.estimate.asOf} does not match pricing asOf ${input.pricingContext.asOf}.`,
      lineId: configurationLine.id,
    });
  }
  const pricingDate = input.pricingContext.asOf.slice(0, 10);
  const validity = input.estimate.sourceValidity;
  if (validity.to && pricingDate > validity.to) {
    gaps.push({
      code: "estimate-expired",
      message:
        `Estimate validity ended ${validity.to}; pricing asOf ${input.pricingContext.asOf} is after that date. The old validity is kept; it is not current.`,
      lineId: configurationLine.id,
    });
  }
  if (validity.from && pricingDate < validity.from) {
    gaps.push({
      code: "estimate-as-of-ambiguous",
      message:
        `Estimate validity starts ${validity.from}; pricing asOf ${input.pricingContext.asOf} is before that date.`,
      lineId: configurationLine.id,
    });
  }
  if (input.estimate.currency !== input.pricingContext.currency) {
    gaps.push({
      code: "currency-unresolved",
      message:
        `Estimate currency ${input.estimate.currency} does not match pricing currency ${input.pricingContext.currency}; no FX conversion is invented.`,
      lineId: configurationLine.id,
    });
  }
  if (input.line.productUom !== configurationLine.uom) {
    gaps.push({
      code: "uom-unresolved",
      message:
        `Estimate product UOM ${input.line.productUom} does not match configuration UOM ${configurationLine.uom}; no conversion is invented.`,
      lineId: configurationLine.id,
    });
  }
  const blocked = asOfMismatch ||
    gaps.some((gap) =>
      gap.code === "estimate-expired" || gap.code === "currency-unresolved" ||
      gap.code === "uom-unresolved"
    );
  if (blocked) {
    return {
      ...base,
      provisional: unpricedTerms.some((term) => term.provisional),
      terms: unpricedTerms,
      gaps,
    };
  }
  const terms = input.line.terms.map((term) => priceTerm(term, configurationLine.id));
  const unpricedIds = terms
    .filter((term) => term.termAmount === undefined)
    .map((term) => term.id);
  if (unpricedIds.length > 0) {
    gaps.push({
      code: "unpriced-component",
      message:
        `Estimate terms without a complete priced amount are excluded, not free: ${
          unpricedIds.join(", ")
        }.`,
      lineId: configurationLine.id,
    });
    return {
      ...base,
      provisional: terms.some((term) => term.provisional),
      terms,
      gaps,
    };
  }
  return {
    ...base,
    unitCost: terms.reduce(
      (sum, term) => addBuyDecimals(sum, term.termAmount!),
      "0",
    ),
    provisional: terms.some((term) => term.provisional),
    terms,
    gaps,
  };
}

function estimateBasisMatches(input: {
  readonly configuration: BuyConfiguration;
  readonly verifiedDigest: string;
  readonly estimate: BuyDocumentaryEstimateEnvelope["estimate"];
}): boolean {
  const estimate = input.estimate;
  const configuration = input.configuration;
  return estimate.configurationDigest === input.verifiedDigest &&
    estimate.projectId === configuration.projectId &&
    estimate.subjectId === configuration.subjectId &&
    estimate.basis.snapshotId === configuration.basis.snapshotId &&
    estimate.basis.revision === configuration.basis.revision &&
    estimate.basis.subjectId === configuration.basis.subjectId &&
    estimate.geometry.parentArtifactId === configuration.geometry.parentArtifactId &&
    estimate.geometry.parentFingerprint === configuration.geometry.parentFingerprint &&
    estimate.geometry.stepArtifactId === configuration.geometry.stepArtifactId &&
    estimate.geometry.stepFingerprint === configuration.geometry.stepFingerprint &&
    estimate.geometry.stepUri === configuration.geometry.stepUri;
}

function priceTerm(
  term: BuyDocumentaryEstimateLine["terms"][number],
  lineId: string,
): BuyAnnexTerm {
  const provisional = term.consumption.operand === "assumed" ||
    term.rate.operand === "assumed";
  const base = {
    id: term.id,
    nature: term.nature,
    consumption: term.consumption,
    rate: term.rate,
    provisional,
  };
  if (term.consumption.operand === "unknown" || term.rate.operand === "unknown") {
    const missing =
      term.consumption.operand === "unknown" && term.rate.operand === "unknown"
        ? "consumption and rate"
        : term.consumption.operand === "unknown"
        ? "consumption"
        : "rate";
    return {
      ...base,
      gaps: [{
        code: "unpriced-component",
        message:
          `Term ${term.id} ${missing} is unknown and is not free; every priced operand names a retained source.`,
        lineId,
      }],
    };
  }
  const consumptionUom = term.consumption.uom;
  const rateUom = term.rate.perUom;
  if (consumptionUom !== rateUom) {
    return {
      ...base,
      gaps: [{
        code: "uom-unresolved",
        message:
          `Term ${term.id} consumption UOM ${consumptionUom} does not match rate UOM ${rateUom}; no sourced conversion is present.`,
        lineId,
      }],
    };
  }
  return {
    ...base,
    termAmount: multiplyBuyDecimals(term.consumption.decimal, term.rate.decimal),
    gaps: [],
  };
}

function parseAnnexLine(
  value: unknown,
  path: string,
  currency: string,
): BuyAnnexLine {
  const input = closedRecord(value, [
    "configurationLineId",
    "quantityBasis",
    "productUom",
    "configurationQuantity",
    "configurationUom",
    "unitCost",
    "provisional",
    "terms",
    "gaps",
  ], [
    "configurationLineId",
    "quantityBasis",
    "productUom",
    "configurationQuantity",
    "configurationUom",
    "provisional",
    "terms",
    "gaps",
  ], path);
  literalValue(input.quantityBasis, "per-configuration-unit", `${path}.quantityBasis`);
  if (typeof input.provisional !== "boolean") {
    throw new TypeError(`${path}.provisional must be a boolean.`);
  }
  const terms = arrayOf(input.terms, `${path}.terms`).map((term, i) =>
    parseAnnexTerm(term, `${path}.terms[${i}]`, currency)
  );
  if (terms.length === 0) {
    throw new TypeError(`${path}.terms must hold at least one term.`);
  }
  const unitCost = input.unitCost === undefined || input.unitCost === null
    ? undefined
    : parseBuyDecimal(input.unitCost, `${path}.unitCost`);
  if (terms.some((term) => term.termAmount === undefined)) {
    if (unitCost !== undefined) {
      throw new TypeError(
        `${path}.unitCost must be absent when a term has no complete unit cost.`,
      );
    }
  } else if (
    unitCost !==
      terms.reduce((sum, term) => addBuyDecimals(sum, term.termAmount!), "0")
  ) {
    throw new TypeError(
      `${path}.unitCost must equal the exact sum of priced term amounts.`,
    );
  }
  return {
    configurationLineId: safeId(
      input.configurationLineId,
      `${path}.configurationLineId`,
    ),
    quantityBasis: "per-configuration-unit",
    productUom: nonEmptyText(input.productUom, `${path}.productUom`),
    configurationQuantity: parseBuyDecimal(
      input.configurationQuantity,
      `${path}.configurationQuantity`,
    ),
    configurationUom: nonEmptyText(input.configurationUom, `${path}.configurationUom`),
    ...(unitCost === undefined ? {} : { unitCost }),
    provisional: input.provisional,
    terms,
    gaps: arrayOf(input.gaps, `${path}.gaps`).map((gap, i) =>
      parseGap(gap, `${path}.gaps[${i}]`)
    ),
  };
}

function parseAnnexTerm(
  value: unknown,
  path: string,
  currency: string,
): BuyAnnexTerm {
  const input = closedRecord(
    value,
    ["id", "nature", "consumption", "rate", "termAmount", "provisional", "gaps"],
    ["id", "nature", "consumption", "rate", "provisional", "gaps"],
    path,
  );
  if (typeof input.provisional !== "boolean") {
    throw new TypeError(`${path}.provisional must be a boolean.`);
  }
  return {
    id: safeId(input.id, `${path}.id`),
    nature: oneOf(input.nature, BUY_ESTIMATE_TERM_NATURES, `${path}.nature`),
    consumption: parseBuyEstimateQuantityOperand(
      input.consumption,
      `${path}.consumption`,
    ),
    rate: parseBuyEstimateRateOperand(input.rate, `${path}.rate`, currency),
    ...(input.termAmount === undefined || input.termAmount === null ? {} : {
      termAmount: parseBuyDecimal(input.termAmount, `${path}.termAmount`),
    }),
    provisional: input.provisional,
    gaps: arrayOf(input.gaps, `${path}.gaps`).map((gap, i) =>
      parseGap(gap, `${path}.gaps[${i}]`)
    ),
  };
}

function parseGap(value: unknown, path: string): BuyEstimateGap {
  const input = closedRecord(
    value,
    ["code", "message", "lineId"],
    ["code", "message"],
    path,
  );
  return {
    code: oneOf(input.code, BUY_ESTIMATE_GAP_CODES, `${path}.code`),
    message: nonEmptyText(input.message, `${path}.message`),
    ...(input.lineId === undefined || input.lineId === null
      ? {}
      : { lineId: safeId(input.lineId, `${path}.lineId`) }),
  };
}

function currencyCode(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!CURRENCY.test(text)) {
    throw new TypeError(`${path} must be an ISO-4217 alphabetic code.`);
  }
  return text;
}

function sha256DigestValue(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!SHA256_HEX.test(text)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex SHA-256 digest.`);
  }
  return text;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}
