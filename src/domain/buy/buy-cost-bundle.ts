/**
 * Closed `buy-cost-bundle/1.0` and server-owned candidate computation.
 *
 * Totals never treat missing tax, transport, discount, fees, MOQ or FX as
 * zero. Unpriced lines are gaps, not free. Covered subtotal and total
 * complete are distinct states.
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
import {
  addBuyDecimals,
  type BuyDecimalRounding,
  isPositiveBuyDecimal,
  multiplyBuyDecimals,
  parseBuyDecimal,
  roundBuyDecimal,
  validateBuyDecimalRounding,
} from "./buy-decimal.ts";
import type { BuyConfiguration } from "./buy-configuration.ts";
import {
  BUY_CLOSED_DOCTYPES,
  type BuyClosedDoctype,
  type BuySourceCaptureEnvelope,
  type BuySourceInstance,
  findBuySourceChildRow,
  findBuySourceDocument,
  frappeDatetime,
  parseBuySourceInstance,
  prefixedSha256,
} from "./buy-source-capture.ts";

export const BUY_COST_BUNDLE_SCHEMA = "buy-cost-bundle/1.0" as const;

export const BUY_COST_CLASSES = [
  "catalogue",
  "quotation",
  "historical-invoice",
  "estimate",
] as const;
export type BuyCostClass = typeof BUY_COST_CLASSES[number];

export const BUY_COST_DIMENSIONS = [
  "unit-price",
  "quantity",
  "uom",
  "currency",
  "tax",
  "transport",
  "discount",
  "fees",
  "moq",
  "fx",
] as const;
export type BuyCostDimension = typeof BUY_COST_DIMENSIONS[number];

export const BUY_COVERAGE_STATUSES = [
  "complete",
  "partial",
  "unresolved",
] as const;
export type BuyCoverageStatus = typeof BUY_COVERAGE_STATUSES[number];

export const BUY_BUNDLE_GAP_CODES = [
  "source-instance-mismatch",
  "document-mismatch",
  "modified-mismatch",
  "row-mismatch",
  "fingerprint-mismatch",
  "price-expired",
  "price-as-of-ambiguous",
  "uom-unresolved",
  "fx-unresolved",
  "dimension-unknown",
  "unpriced-component",
  "currency-unresolved",
  "caller-attestation-refused",
] as const;
export type BuyBundleGapCode = typeof BUY_BUNDLE_GAP_CODES[number];

const SHA256_HEX = /^[0-9a-f]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;

export interface BuyCostGap {
  readonly code: BuyBundleGapCode;
  readonly message: string;
  readonly lineId?: string;
}

export interface BuySourceCaptureRef {
  readonly fingerprint: string;
  readonly sourceInstance: BuySourceInstance;
  readonly capturedAt: string;
}

export interface BuyPricingContext {
  readonly currency: string;
  readonly asOf: string;
  readonly requiredDimensions: readonly BuyCostDimension[];
  readonly rounding: BuyDecimalRounding;
}

export type BuyCostCitation =
  | {
    readonly kind: "erp-attested";
    readonly sourceInstance: BuySourceInstance;
    readonly captureFingerprint: string;
    readonly document: { readonly doctype: BuyClosedDoctype; readonly name: string };
    readonly modified: string;
    readonly rowName?: string;
    readonly documentFingerprint: string;
  }
  | {
    readonly kind: "external-documentary";
    readonly resourceUri: string;
    readonly fingerprint: string;
    readonly capturedAt: string;
  };

export interface BuyCostLine {
  readonly configurationLineId: string;
  readonly costClass: BuyCostClass;
  readonly citation?: BuyCostCitation;
  readonly quantity: string;
  readonly uom: string;
  readonly unitPrice?: string;
  readonly currency?: string;
  readonly amount?: string;
  readonly capturedAt?: string;
  readonly sourceValidity?: { readonly from?: string; readonly to?: string };
  readonly asOf: string;
  readonly dimensions: Readonly<Record<BuyCostDimension, "established" | "unknown">>;
  readonly gaps: readonly BuyCostGap[];
}

export interface BuyCostTotal {
  readonly kind: "covered-subtotal" | "total-complete";
  readonly currency: string;
  readonly amount: string;
  readonly includedLineIds: readonly string[];
  readonly excludedLineIds: readonly string[];
  readonly includedDimensions: readonly BuyCostDimension[];
  readonly unknownDimensions: readonly BuyCostDimension[];
}

export interface BuyCostCoverage {
  readonly status: BuyCoverageStatus;
  readonly coveredLineIds: readonly string[];
  readonly excludedLineIds: readonly string[];
  readonly quantityBasis: "configuration-occurrences";
  readonly currency: string;
  readonly requiredDimensions: readonly BuyCostDimension[];
  readonly unknownDimensions: readonly BuyCostDimension[];
}

export interface BuyCostBundle {
  readonly schemaVersion: typeof BUY_COST_BUNDLE_SCHEMA;
  readonly configurationRef: { readonly digest: string };
  readonly sourceCaptures: readonly BuySourceCaptureRef[];
  readonly pricingContext: BuyPricingContext;
  readonly lines: readonly BuyCostLine[];
  readonly totals: readonly BuyCostTotal[];
  readonly coverage: BuyCostCoverage;
  readonly gaps: readonly BuyCostGap[];
}

export interface BuyCostSelection {
  readonly configurationLineId: string;
  readonly costClass: BuyCostClass;
  readonly citation?: BuyCostCitation;
}

const ROOT_KEYS = [
  "schemaVersion",
  "configurationRef",
  "sourceCaptures",
  "pricingContext",
  "lines",
  "totals",
  "coverage",
  "gaps",
] as const;

export function validateBuyCostBundle(value: unknown): BuyCostBundle {
  const root = exactRecord(value, ROOT_KEYS, "$buyCostBundle");
  literalValue(
    root.schemaVersion,
    BUY_COST_BUNDLE_SCHEMA,
    "$buyCostBundle.schemaVersion",
  );
  const configurationRef = exactRecord(
    root.configurationRef,
    ["digest"],
    "$buyCostBundle.configurationRef",
  );
  const pricingContext = parsePricingContext(
    root.pricingContext,
    "$buyCostBundle.pricingContext",
  );
  const lines = arrayOf(root.lines, "$buyCostBundle.lines").map((line, i) =>
    parseLine(line, `$buyCostBundle.lines[${i}]`)
  );
  rejectDuplicates(
    lines.map((line) => line.configurationLineId),
    "$buyCostBundle.lines.configurationLineId",
  );
  return deepFreeze({
    schemaVersion: BUY_COST_BUNDLE_SCHEMA,
    configurationRef: {
      digest: sha256(
        configurationRef.digest,
        "$buyCostBundle.configurationRef.digest",
      ),
    },
    sourceCaptures: arrayOf(
      root.sourceCaptures,
      "$buyCostBundle.sourceCaptures",
    ).map((capture, i) =>
      parseCaptureRef(capture, `$buyCostBundle.sourceCaptures[${i}]`)
    ),
    pricingContext,
    lines,
    totals: arrayOf(root.totals, "$buyCostBundle.totals").map((total, i) =>
      parseTotal(total, `$buyCostBundle.totals[${i}]`)
    ),
    coverage: parseCoverage(root.coverage),
    gaps: arrayOf(root.gaps, "$buyCostBundle.gaps").map((gap, i) =>
      parseGap(gap, `$buyCostBundle.gaps[${i}]`)
    ),
  });
}

/**
 * Build a candidate bundle from a reviewed configuration, captured sources,
 * and exact line selections. Missing dimensions stay unknown; they are never
 * filled with zero.
 */
export function computeBuyCostCandidate(input: {
  readonly configuration: BuyConfiguration;
  readonly configurationDigest: string;
  readonly captures: readonly BuySourceCaptureEnvelope[];
  readonly authorizedSiteId: string;
  readonly pricingContext: BuyPricingContext;
  readonly selections: readonly BuyCostSelection[];
}): BuyCostBundle {
  const captureRefs: BuySourceCaptureRef[] = input.captures.map((envelope) => ({
    fingerprint: envelope.fingerprint,
    sourceInstance: envelope.capture.sourceInstance,
    capturedAt: envelope.capture.capturedAt,
  }));
  const bundleGaps: BuyCostGap[] = [];
  for (const envelope of input.captures) {
    if (envelope.capture.sourceInstance.siteId !== input.authorizedSiteId) {
      bundleGaps.push({
        code: "source-instance-mismatch",
        message:
          "Capture sourceInstance does not match the authorized ERP site binding.",
      });
    }
    if (envelope.capture.consistency.consistent !== true) {
      bundleGaps.push({
        code: "document-mismatch",
        message:
          "Capture consistency is not a usable repeated-read; it is not an authoritative cost.",
      });
    }
  }
  const lines = input.configuration.lines.map((configurationLine) =>
    priceLine({
      configurationLine,
      selection: input.selections.find((item) =>
        item.configurationLineId === configurationLine.id
      ),
      captures: input.captures,
      authorizedSiteId: input.authorizedSiteId,
      pricingContext: input.pricingContext,
    })
  );
  const priced = lines.filter((line) => line.amount !== undefined);
  const coveredLineIds = priced.map((line) => line.configurationLineId);
  const excludedLineIds = lines
    .filter((line) => !coveredLineIds.includes(line.configurationLineId))
    .map((line) => line.configurationLineId);
  const unknownDimensions = uniqueDimensions(
    lines.flatMap((line) =>
      BUY_COST_DIMENSIONS.filter((dimension) =>
        input.pricingContext.requiredDimensions.includes(dimension) &&
        line.dimensions[dimension] === "unknown"
      )
    ),
  );
  const requiredUnknown = unknownDimensions.length > 0 ||
    excludedLineIds.length > 0 ||
    bundleGaps.length > 0;
  let amount = "0";
  if (priced.length > 0) {
    amount = priced.reduce((sum, line) => addBuyDecimals(sum, line.amount!), "0");
    amount = roundBuyDecimal(amount, input.pricingContext.rounding);
  }
  const coveredSubtotal: BuyCostTotal = {
    kind: "covered-subtotal",
    currency: input.pricingContext.currency,
    amount: priced.length === 0
      ? roundBuyDecimal("0", input.pricingContext.rounding)
      : amount,
    includedLineIds: coveredLineIds,
    excludedLineIds,
    includedDimensions: input.pricingContext.requiredDimensions.filter(
      (dimension) => !unknownDimensions.includes(dimension),
    ),
    unknownDimensions,
  };
  const totals: BuyCostTotal[] = [coveredSubtotal];
  const coverageStatus: BuyCoverageStatus = requiredUnknown
    ? (priced.length === 0 ? "unresolved" : "partial")
    : "complete";
  if (
    coverageStatus === "complete" && priced.length === input.configuration.lines.length
  ) {
    totals.push({
      ...coveredSubtotal,
      kind: "total-complete",
    });
  }
  return deepFreeze({
    schemaVersion: BUY_COST_BUNDLE_SCHEMA,
    configurationRef: { digest: input.configurationDigest },
    sourceCaptures: captureRefs,
    pricingContext: input.pricingContext,
    lines,
    totals,
    coverage: {
      status: coverageStatus,
      coveredLineIds,
      excludedLineIds,
      quantityBasis: "configuration-occurrences",
      currency: input.pricingContext.currency,
      requiredDimensions: [...input.pricingContext.requiredDimensions],
      unknownDimensions,
    },
    gaps: bundleGaps,
  });
}

function priceLine(input: {
  readonly configurationLine: BuyConfiguration["lines"][number];
  readonly selection: BuyCostSelection | undefined;
  readonly captures: readonly BuySourceCaptureEnvelope[];
  readonly authorizedSiteId: string;
  readonly pricingContext: BuyPricingContext;
}): BuyCostLine {
  const asOf = input.pricingContext.asOf;
  const dimensions = emptyDimensions();
  dimensions.quantity = "established";
  dimensions.uom = "established";
  const gaps: BuyCostGap[] = [];
  if (!input.selection || !input.selection.citation) {
    markUnknown(dimensions, input.pricingContext.requiredDimensions);
    gaps.push({
      code: "unpriced-component",
      message:
        `Configuration line ${input.configurationLine.id} has no priced citation and is not free.`,
      lineId: input.configurationLine.id,
    });
    return lineResult(input, dimensions, gaps, asOf);
  }
  const citation = input.selection.citation;
  if (citation.kind === "external-documentary") {
    markUnknown(
      dimensions,
      input.pricingContext.requiredDimensions.filter(
        (dimension) => dimension !== "quantity" && dimension !== "uom",
      ),
    );
    gaps.push({
      code: "dimension-unknown",
      message:
        `External documentary source for ${input.configurationLine.id} cannot attest an ERP price.`,
      lineId: input.configurationLine.id,
    });
    return lineResult(input, dimensions, gaps, asOf, citation);
  }
  if (citation.sourceInstance.siteId !== input.authorizedSiteId) {
    gaps.push({
      code: "source-instance-mismatch",
      message:
        "Citation sourceInstance does not match the authorized ERP site binding.",
      lineId: input.configurationLine.id,
    });
    markUnknown(dimensions, input.pricingContext.requiredDimensions);
    return lineResult(input, dimensions, gaps, asOf, citation);
  }
  const envelope = input.captures.find((item) =>
    item.fingerprint === citation.captureFingerprint
  );
  if (!envelope) {
    gaps.push({
      code: "fingerprint-mismatch",
      message:
        "Citation capture fingerprint is not among the reopened source captures.",
      lineId: input.configurationLine.id,
    });
    markUnknown(dimensions, input.pricingContext.requiredDimensions);
    return lineResult(input, dimensions, gaps, asOf, citation);
  }
  if (
    envelope.capture.sourceInstance.siteId !== citation.sourceInstance.siteId
  ) {
    gaps.push({
      code: "source-instance-mismatch",
      message: "Citation sourceInstance does not match the capture sourceInstance.",
      lineId: input.configurationLine.id,
    });
    markUnknown(dimensions, input.pricingContext.requiredDimensions);
    return lineResult(input, dimensions, gaps, asOf, citation);
  }
  const document = findBuySourceDocument(envelope.capture, citation.document);
  if (!document) {
    gaps.push({
      code: "document-mismatch",
      message: `Capture has no ${citation.document.doctype} ${citation.document.name}.`,
      lineId: input.configurationLine.id,
    });
    markUnknown(dimensions, input.pricingContext.requiredDimensions);
    return lineResult(input, dimensions, gaps, asOf, citation);
  }
  if (document.modified !== citation.modified) {
    gaps.push({
      code: "modified-mismatch",
      message: "Citation modified does not match the captured document.",
      lineId: input.configurationLine.id,
    });
    markUnknown(dimensions, input.pricingContext.requiredDimensions);
    return lineResult(input, dimensions, gaps, asOf, citation);
  }
  if (document.fingerprint !== citation.documentFingerprint) {
    gaps.push({
      code: "fingerprint-mismatch",
      message: "Citation document fingerprint does not match the captured document.",
      lineId: input.configurationLine.id,
    });
    markUnknown(dimensions, input.pricingContext.requiredDimensions);
    return lineResult(input, dimensions, gaps, asOf, citation);
  }
  const row = citation.rowName
    ? findBuySourceChildRow(document, citation.rowName)
    : undefined;
  if (citation.rowName && !row) {
    gaps.push({
      code: "row-mismatch",
      message: `Capture document has no child row ${citation.rowName}.`,
      lineId: input.configurationLine.id,
    });
    markUnknown(dimensions, input.pricingContext.requiredDimensions);
    return lineResult(input, dimensions, gaps, asOf, citation);
  }
  const rate = projectedDecimal(row?.fields.rate) ??
    projectedDecimal(document.fields.price_list_rate) ??
    projectedDecimal(document.fields.rate);
  const currency = projectedString(document.fields.currency);
  const uom = projectedString(row?.fields.uom) ??
    projectedString(document.fields.uom);
  const validFrom = projectedString(document.fields.valid_from);
  const validUpto = projectedString(document.fields.valid_upto) ??
    projectedString(document.fields.valid_till);
  const sourceValidity = {
    ...(validFrom ? { from: validFrom } : {}),
    ...(validUpto ? { to: validUpto } : {}),
  };
  if (rate) dimensions["unit-price"] = "established";
  if (currency) dimensions.currency = "established";
  if (uom) {
    if (uom !== input.configurationLine.uom) {
      dimensions.uom = "unknown";
      gaps.push({
        code: "uom-unresolved",
        message:
          `Price UOM ${uom} does not match configuration UOM ${input.configurationLine.uom}; no sourced conversion is present.`,
        lineId: input.configurationLine.id,
      });
    }
  } else {
    dimensions.uom = "unknown";
    gaps.push({
      code: "uom-unresolved",
      message: "Price UOM is absent.",
      lineId: input.configurationLine.id,
    });
  }
  let fxRate: string | undefined;
  if (currency && currency !== input.pricingContext.currency) {
    const fx = input.captures.flatMap((item) => item.capture.documents).find(
      (item) =>
        item.doctype === "Currency Exchange" &&
        item.fields.from_currency === currency &&
        item.fields.to_currency === input.pricingContext.currency &&
        item.fields.exchange_rate !== undefined,
    );
    fxRate = projectedPositiveDecimal(fx?.fields.exchange_rate);
    if (!fxRate) {
      dimensions.fx = "unknown";
      dimensions.currency = "unknown";
      gaps.push({
        code: "fx-unresolved",
        message: `No sourced FX from ${currency} to ${input.pricingContext.currency}.`,
        lineId: input.configurationLine.id,
      });
    } else {
      dimensions.fx = "established";
    }
  }
  const asOfDate = asOf.slice(0, 10);
  if (sourceValidity.to && asOfDate > sourceValidity.to) {
    gaps.push({
      code: "price-expired",
      message:
        `Price validity ended ${sourceValidity.to}; asOf ${asOf} is after that date. The old validity is kept; it is not current.`,
      lineId: input.configurationLine.id,
    });
  }
  if (sourceValidity.from && asOfDate < sourceValidity.from) {
    gaps.push({
      code: "price-as-of-ambiguous",
      message:
        `Price validity starts ${sourceValidity.from}; asOf ${asOf} is before that date.`,
      lineId: input.configurationLine.id,
    });
  }
  for (const dimension of input.pricingContext.requiredDimensions) {
    if (
      dimension === "tax" || dimension === "transport" || dimension === "discount" ||
      dimension === "fees" || dimension === "moq"
    ) {
      dimensions[dimension] = "unknown";
      gaps.push({
        code: "dimension-unknown",
        message:
          `Required cost dimension ${dimension} is not present on the captured document and is not defaulted to zero.`,
        lineId: input.configurationLine.id,
      });
    }
  }
  let unitPrice: string | undefined;
  let amount: string | undefined;
  let lineCurrency = currency;
  if (
    rate &&
    dimensions["unit-price"] === "established" &&
    dimensions.uom === "established" &&
    dimensions.currency === "established" &&
    !gaps.some((gap) =>
      gap.code === "price-expired" || gap.code === "fx-unresolved" ||
      gap.code === "uom-unresolved"
    )
  ) {
    const pricedRate = fxRate ? multiplyBuyDecimals(rate, fxRate) : rate;
    unitPrice = pricedRate;
    lineCurrency = fxRate ? input.pricingContext.currency : currency;
    amount = roundBuyDecimal(
      multiplyBuyDecimals(input.configurationLine.quantity, pricedRate),
      input.pricingContext.rounding,
    );
  } else if (!rate) {
    gaps.push({
      code: "unpriced-component",
      message: `Captured document for ${input.configurationLine.id} has no rate.`,
      lineId: input.configurationLine.id,
    });
  }
  return lineResult(
    input,
    dimensions,
    gaps,
    asOf,
    citation,
    unitPrice,
    lineCurrency,
    amount,
    envelope.capture.capturedAt,
    Object.keys(sourceValidity).length === 0 ? undefined : sourceValidity,
  );
}

function lineResult(
  input: {
    readonly configurationLine: BuyConfiguration["lines"][number];
    readonly selection: BuyCostSelection | undefined;
    readonly pricingContext: BuyPricingContext;
  },
  dimensions: Record<BuyCostDimension, "established" | "unknown">,
  gaps: readonly BuyCostGap[],
  asOf: string,
  citation?: BuyCostCitation,
  unitPrice?: string,
  currency?: string,
  amount?: string,
  capturedAt?: string,
  sourceValidity?: { readonly from?: string; readonly to?: string },
): BuyCostLine {
  return {
    configurationLineId: input.configurationLine.id,
    costClass: input.selection?.costClass ?? "estimate",
    ...(citation ? { citation } : {}),
    quantity: input.configurationLine.quantity,
    uom: input.configurationLine.uom,
    ...(unitPrice ? { unitPrice } : {}),
    ...(currency ? { currency } : {}),
    ...(amount ? { amount } : {}),
    ...(capturedAt ? { capturedAt } : {}),
    ...(sourceValidity ? { sourceValidity } : {}),
    asOf,
    dimensions,
    gaps,
  };
}

function emptyDimensions(): Record<BuyCostDimension, "established" | "unknown"> {
  return {
    "unit-price": "unknown",
    quantity: "unknown",
    uom: "unknown",
    currency: "unknown",
    tax: "unknown",
    transport: "unknown",
    discount: "unknown",
    fees: "unknown",
    moq: "unknown",
    fx: "unknown",
  };
}

function markUnknown(
  dimensions: Record<BuyCostDimension, "established" | "unknown">,
  required: readonly BuyCostDimension[],
): void {
  for (const dimension of required) {
    if (dimension !== "quantity") dimensions[dimension] = "unknown";
  }
}

function uniqueDimensions(
  values: readonly BuyCostDimension[],
): readonly BuyCostDimension[] {
  return BUY_COST_DIMENSIONS.filter((dimension) => values.includes(dimension));
}

function parsePricingContext(value: unknown, path: string): BuyPricingContext {
  const input = exactRecord(
    value,
    ["currency", "asOf", "requiredDimensions", "rounding"],
    path,
  );
  const currency = nonEmptyText(input.currency, `${path}.currency`);
  if (!CURRENCY.test(currency)) {
    throw new TypeError(`${path}.currency must be an ISO-4217 alphabetic code.`);
  }
  const requiredDimensions = arrayOf(
    input.requiredDimensions,
    `${path}.requiredDimensions`,
  ).map((dimension, i) =>
    oneOf(dimension, BUY_COST_DIMENSIONS, `${path}.requiredDimensions[${i}]`)
  );
  rejectDuplicates(requiredDimensions, `${path}.requiredDimensions`);
  if (
    !requiredDimensions.includes("unit-price") ||
    !requiredDimensions.includes("quantity") ||
    !requiredDimensions.includes("uom") ||
    !requiredDimensions.includes("currency")
  ) {
    throw new TypeError(
      `${path}.requiredDimensions must include unit-price, quantity, uom and currency.`,
    );
  }
  return {
    currency,
    asOf: isoDate(input.asOf, `${path}.asOf`),
    requiredDimensions,
    rounding: validateBuyDecimalRounding(input.rounding, `${path}.rounding`),
  };
}

function projectedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectedDecimal(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return parseBuyDecimal(value, "$rate");
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return parseBuyDecimal(JSON.stringify(value), "$rate");
  }
  return undefined;
}

function projectedPositiveDecimal(value: unknown): string | undefined {
  try {
    const parsed = projectedDecimal(value);
    if (parsed === undefined || !isPositiveBuyDecimal(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function parseCaptureRef(value: unknown, path: string): BuySourceCaptureRef {
  const input = exactRecord(
    value,
    ["fingerprint", "sourceInstance", "capturedAt"],
    path,
  );
  return {
    fingerprint: prefixedSha256(input.fingerprint, `${path}.fingerprint`),
    sourceInstance: parseBuySourceInstance(
      input.sourceInstance,
      `${path}.sourceInstance`,
    ),
    capturedAt: isoDate(input.capturedAt, `${path}.capturedAt`),
  };
}

function parseLine(value: unknown, path: string): BuyCostLine {
  const input = closedRecord(value, [
    "configurationLineId",
    "costClass",
    "citation",
    "quantity",
    "uom",
    "unitPrice",
    "currency",
    "amount",
    "capturedAt",
    "sourceValidity",
    "asOf",
    "dimensions",
    "gaps",
  ], [
    "configurationLineId",
    "costClass",
    "quantity",
    "uom",
    "asOf",
    "dimensions",
    "gaps",
  ], path);
  const costClass = oneOf(input.costClass, BUY_COST_CLASSES, `${path}.costClass`);
  const dimensions = parseDimensions(input.dimensions, `${path}.dimensions`);
  return {
    configurationLineId: safeId(
      input.configurationLineId,
      `${path}.configurationLineId`,
    ),
    costClass,
    ...(input.citation === undefined || input.citation === null
      ? {}
      : { citation: parseCitation(input.citation, `${path}.citation`) }),
    quantity: parseBuyDecimal(input.quantity, `${path}.quantity`),
    uom: nonEmptyText(input.uom, `${path}.uom`),
    ...(input.unitPrice === undefined || input.unitPrice === null
      ? {}
      : { unitPrice: parseBuyDecimal(input.unitPrice, `${path}.unitPrice`) }),
    ...(input.currency === undefined || input.currency === null
      ? {}
      : { currency: currencyCode(input.currency, `${path}.currency`) }),
    ...(input.amount === undefined || input.amount === null
      ? {}
      : { amount: parseBuyDecimal(input.amount, `${path}.amount`) }),
    ...(input.capturedAt === undefined || input.capturedAt === null
      ? {}
      : { capturedAt: isoDate(input.capturedAt, `${path}.capturedAt`) }),
    ...(input.sourceValidity === undefined || input.sourceValidity === null ? {} : {
      sourceValidity: parseValidity(input.sourceValidity, `${path}.sourceValidity`),
    }),
    asOf: isoDate(input.asOf, `${path}.asOf`),
    dimensions,
    gaps: arrayOf(input.gaps, `${path}.gaps`).map((gap, i) =>
      parseGap(gap, `${path}.gaps[${i}]`)
    ),
  };
}

function parseCitation(value: unknown, path: string): BuyCostCitation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  if (rec.kind === "external-documentary") {
    const input = exactRecord(
      value,
      ["kind", "resourceUri", "fingerprint", "capturedAt"],
      path,
    );
    return {
      kind: "external-documentary",
      resourceUri: nonEmptyText(input.resourceUri, `${path}.resourceUri`),
      fingerprint: prefixedSha256(input.fingerprint, `${path}.fingerprint`),
      capturedAt: isoDate(input.capturedAt, `${path}.capturedAt`),
    };
  }
  const input = closedRecord(value, [
    "kind",
    "sourceInstance",
    "captureFingerprint",
    "document",
    "modified",
    "rowName",
    "documentFingerprint",
  ], [
    "kind",
    "sourceInstance",
    "captureFingerprint",
    "document",
    "modified",
    "documentFingerprint",
  ], path);
  literalValue(input.kind, "erp-attested", `${path}.kind`);
  const document = exactRecord(input.document, ["doctype", "name"], `${path}.document`);
  return {
    kind: "erp-attested",
    sourceInstance: parseBuySourceInstance(
      input.sourceInstance,
      `${path}.sourceInstance`,
    ),
    captureFingerprint: prefixedSha256(
      input.captureFingerprint,
      `${path}.captureFingerprint`,
    ),
    document: {
      doctype: oneOf(document.doctype, BUY_CLOSED_DOCTYPES, `${path}.document.doctype`),
      name: nonEmptyText(document.name, `${path}.document.name`),
    },
    modified: frappeDatetime(input.modified, `${path}.modified`),
    ...(input.rowName === undefined || input.rowName === null
      ? {}
      : { rowName: nonEmptyText(input.rowName, `${path}.rowName`) }),
    documentFingerprint: prefixedSha256(
      input.documentFingerprint,
      `${path}.documentFingerprint`,
    ),
  };
}

function parseValidity(
  value: unknown,
  path: string,
): { readonly from?: string; readonly to?: string } {
  const input = closedRecord(value, ["from", "to"], [], path);
  return {
    ...(input.from === undefined || input.from === null
      ? {}
      : { from: isoDate(input.from, `${path}.from`) }),
    ...(input.to === undefined || input.to === null
      ? {}
      : { to: isoDate(input.to, `${path}.to`) }),
  };
}

function parseDimensions(
  value: unknown,
  path: string,
): Readonly<Record<BuyCostDimension, "established" | "unknown">> {
  const input = exactRecord(value, BUY_COST_DIMENSIONS, path);
  const result = emptyDimensions();
  for (const dimension of BUY_COST_DIMENSIONS) {
    result[dimension] = oneOf(
      input[dimension],
      ["established", "unknown"] as const,
      `${path}.${dimension}`,
    );
  }
  return result;
}

function parseTotal(value: unknown, path: string): BuyCostTotal {
  const input = exactRecord(value, [
    "kind",
    "currency",
    "amount",
    "includedLineIds",
    "excludedLineIds",
    "includedDimensions",
    "unknownDimensions",
  ], path);
  return {
    kind: oneOf(
      input.kind,
      ["covered-subtotal", "total-complete"] as const,
      `${path}.kind`,
    ),
    currency: currencyCode(input.currency, `${path}.currency`),
    amount: parseBuyDecimal(input.amount, `${path}.amount`),
    includedLineIds: arrayOf(input.includedLineIds, `${path}.includedLineIds`).map(
      (id, i) => safeId(id, `${path}.includedLineIds[${i}]`),
    ),
    excludedLineIds: arrayOf(input.excludedLineIds, `${path}.excludedLineIds`).map(
      (id, i) => safeId(id, `${path}.excludedLineIds[${i}]`),
    ),
    includedDimensions: arrayOf(
      input.includedDimensions,
      `${path}.includedDimensions`,
    ).map((dimension, i) =>
      oneOf(dimension, BUY_COST_DIMENSIONS, `${path}.includedDimensions[${i}]`)
    ),
    unknownDimensions: arrayOf(
      input.unknownDimensions,
      `${path}.unknownDimensions`,
    ).map((dimension, i) =>
      oneOf(dimension, BUY_COST_DIMENSIONS, `${path}.unknownDimensions[${i}]`)
    ),
  };
}

function parseCoverage(value: unknown): BuyCostCoverage {
  const input = exactRecord(value, [
    "status",
    "coveredLineIds",
    "excludedLineIds",
    "quantityBasis",
    "currency",
    "requiredDimensions",
    "unknownDimensions",
  ], "$buyCostBundle.coverage");
  literalValue(
    input.quantityBasis,
    "configuration-occurrences",
    "$buyCostBundle.coverage.quantityBasis",
  );
  return {
    status: oneOf(
      input.status,
      BUY_COVERAGE_STATUSES,
      "$buyCostBundle.coverage.status",
    ),
    coveredLineIds: arrayOf(
      input.coveredLineIds,
      "$buyCostBundle.coverage.coveredLineIds",
    ).map((id, i) => safeId(id, `$buyCostBundle.coverage.coveredLineIds[${i}]`)),
    excludedLineIds: arrayOf(
      input.excludedLineIds,
      "$buyCostBundle.coverage.excludedLineIds",
    ).map((id, i) => safeId(id, `$buyCostBundle.coverage.excludedLineIds[${i}]`)),
    quantityBasis: "configuration-occurrences",
    currency: currencyCode(input.currency, "$buyCostBundle.coverage.currency"),
    requiredDimensions: arrayOf(
      input.requiredDimensions,
      "$buyCostBundle.coverage.requiredDimensions",
    ).map((dimension, i) =>
      oneOf(
        dimension,
        BUY_COST_DIMENSIONS,
        `$buyCostBundle.coverage.requiredDimensions[${i}]`,
      )
    ),
    unknownDimensions: arrayOf(
      input.unknownDimensions,
      "$buyCostBundle.coverage.unknownDimensions",
    ).map((dimension, i) =>
      oneOf(
        dimension,
        BUY_COST_DIMENSIONS,
        `$buyCostBundle.coverage.unknownDimensions[${i}]`,
      )
    ),
  };
}

function parseGap(value: unknown, path: string): BuyCostGap {
  const input = closedRecord(
    value,
    ["code", "message", "lineId"],
    ["code", "message"],
    path,
  );
  return {
    code: oneOf(input.code, BUY_BUNDLE_GAP_CODES, `${path}.code`),
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

function isoDate(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (Number.isNaN(Date.parse(text))) {
    throw new TypeError(`${path} must be ISO-8601.`);
  }
  return text;
}

function sha256(value: unknown, path: string): string {
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
