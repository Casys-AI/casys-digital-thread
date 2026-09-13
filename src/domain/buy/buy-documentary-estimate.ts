/**
 * Closed `buy-documentary-estimate/1.0` input.
 *
 * A documentary estimate is a dated monetary observation bound to one exact
 * configuration and STEP basis. Each line is explicitly per-configuration-unit;
 * the server multiplies by the configuration quantity exactly once. It is not
 * an ERP Item Price and not a Supplier Quotation.
 *
 * The authored payload never knows its own store-minted capture URI: the
 * capture locator lives on the immutable envelope, outside the canonical
 * preimage bytes. Every priced operand names an exact captured
 * AgentResourceReference as evidence; assumed operands add an explicit
 * immutable justification and stay provisional, never observed. Unknown
 * operands carry no decimal at all.
 */

import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import type { AgentResourceReference } from "../resource/agent-resource-capture.ts";
import { parseAgentResourceReference } from "../resource/agent-resource-reference.ts";
import { parseNonNegativeBuyDecimal } from "./buy-decimal.ts";
import { prefixedSha256 } from "./buy-source-capture.ts";

export const BUY_DOCUMENTARY_ESTIMATE_SCHEMA = "buy-documentary-estimate/1.0" as const;

export const BUY_ESTIMATE_TERM_NATURES = [
  "material",
  "machine-time",
  "labour",
  "other",
] as const;
export type BuyEstimateTermNature = typeof BUY_ESTIMATE_TERM_NATURES[number];

export const BUY_ESTIMATE_OPERANDS = ["sourced", "assumed", "unknown"] as const;
export type BuyEstimateOperandKind = typeof BUY_ESTIMATE_OPERANDS[number];

export const BUY_ESTIMATE_MAX_LINES = 512;
export const BUY_ESTIMATE_MAX_TERMS = 128;
export const BUY_ESTIMATE_MAX_ASSUMPTIONS = 128;
export const BUY_ESTIMATE_MAX_TEXT = 2000;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const CANONICAL_UTC =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export interface BuyEstimateSourceRef {
  readonly reference: AgentResourceReference;
  readonly anchor: string;
  readonly observedAt: string;
}

export interface BuyEstimateAssumedJustification {
  readonly statement: string;
  readonly source: BuyEstimateSourceRef;
}

export type BuyEstimateQuantityOperand =
  | {
    readonly operand: "sourced";
    readonly decimal: string;
    readonly uom: string;
    readonly source: BuyEstimateSourceRef;
  }
  | {
    readonly operand: "assumed";
    readonly decimal: string;
    readonly uom: string;
    readonly justification: BuyEstimateAssumedJustification;
  }
  | { readonly operand: "unknown" };

export type BuyEstimateRateOperand =
  | {
    readonly operand: "sourced";
    readonly decimal: string;
    readonly perUom: string;
    readonly currency: string;
    readonly source: BuyEstimateSourceRef;
  }
  | {
    readonly operand: "assumed";
    readonly decimal: string;
    readonly perUom: string;
    readonly currency: string;
    readonly justification: BuyEstimateAssumedJustification;
  }
  | { readonly operand: "unknown" };

export interface BuyEstimateTerm {
  readonly id: string;
  readonly nature: BuyEstimateTermNature;
  readonly consumption: BuyEstimateQuantityOperand;
  readonly rate: BuyEstimateRateOperand;
}

export interface BuyDocumentaryEstimateLine {
  readonly configurationLineId: string;
  readonly quantityBasis: "per-configuration-unit";
  readonly productUom: string;
  readonly terms: readonly BuyEstimateTerm[];
}

export interface BuyDocumentaryEstimateBasis {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}

export interface BuyDocumentaryEstimateGeometry {
  readonly parentArtifactId: string;
  readonly parentFingerprint: string;
  readonly stepArtifactId: string;
  readonly stepFingerprint: string;
  readonly stepUri: string;
}

export interface BuyDocumentaryEstimate {
  readonly schemaVersion: typeof BUY_DOCUMENTARY_ESTIMATE_SCHEMA;
  readonly estimateId: string;
  readonly projectId: string;
  readonly subjectId: string;
  readonly configurationDigest: string;
  readonly basis: BuyDocumentaryEstimateBasis;
  readonly geometry: BuyDocumentaryEstimateGeometry;
  readonly asOf: string;
  readonly sourceValidity: { readonly from?: string; readonly to?: string };
  readonly currency: string;
  readonly lines: readonly BuyDocumentaryEstimateLine[];
  readonly assumptions: readonly string[];
}

export interface BuyDocumentaryEstimateEnvelope {
  readonly schemaVersion: typeof BUY_DOCUMENTARY_ESTIMATE_SCHEMA;
  readonly estimate: BuyDocumentaryEstimate;
  readonly capture: AgentResourceReference;
  readonly canonicalText: string;
  readonly fingerprint: string;
  readonly byteCount: number;
}

export function validateBuyDocumentaryEstimate(
  value: unknown,
): BuyDocumentaryEstimate {
  const root = exactRecord(value, [
    "schemaVersion",
    "estimateId",
    "projectId",
    "subjectId",
    "configurationDigest",
    "basis",
    "geometry",
    "asOf",
    "sourceValidity",
    "currency",
    "lines",
    "assumptions",
  ], "$buyDocumentaryEstimate");
  literalValue(
    root.schemaVersion,
    BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
    "$buyDocumentaryEstimate.schemaVersion",
  );
  const currency = currencyCode(root.currency, "$buyDocumentaryEstimate.currency");
  const lines = nonEmptyArray(root.lines, "$buyDocumentaryEstimate.lines");
  boundedCount(lines, BUY_ESTIMATE_MAX_LINES, "$buyDocumentaryEstimate.lines");
  const parsedLines = lines.map((line, i) =>
    parseLine(line, `$buyDocumentaryEstimate.lines[${i}]`, currency)
  );
  rejectDuplicates(
    parsedLines.map((line) => line.configurationLineId),
    "$buyDocumentaryEstimate.lines.configurationLineId",
  );
  const assumptions = arrayOf(root.assumptions, "$buyDocumentaryEstimate.assumptions");
  boundedCount(
    assumptions,
    BUY_ESTIMATE_MAX_ASSUMPTIONS,
    "$buyDocumentaryEstimate.assumptions",
  );
  const estimate: BuyDocumentaryEstimate = {
    schemaVersion: BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
    estimateId: safeId(root.estimateId, "$buyDocumentaryEstimate.estimateId"),
    projectId: safeId(root.projectId, "$buyDocumentaryEstimate.projectId"),
    subjectId: safeId(root.subjectId, "$buyDocumentaryEstimate.subjectId"),
    configurationDigest: sha256(
      root.configurationDigest,
      "$buyDocumentaryEstimate.configurationDigest",
    ),
    basis: parseBasis(root.basis),
    geometry: parseGeometry(root.geometry),
    asOf: canonicalUtcTimestamp(root.asOf, "$buyDocumentaryEstimate.asOf"),
    sourceValidity: parseValidity(
      root.sourceValidity,
      "$buyDocumentaryEstimate.sourceValidity",
    ),
    currency,
    lines: parsedLines,
    assumptions: assumptions.map((item, i) =>
      boundedText(item, `$buyDocumentaryEstimate.assumptions[${i}]`)
    ),
  };
  return deepFreeze(estimate);
}

export function validateBuyDocumentaryEstimateEnvelope(
  value: unknown,
): BuyDocumentaryEstimateEnvelope {
  const root = exactRecord(value, [
    "schemaVersion",
    "estimate",
    "capture",
    "canonicalText",
    "fingerprint",
    "byteCount",
  ], "$buyDocumentaryEstimateEnvelope");
  literalValue(
    root.schemaVersion,
    BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
    "$buyDocumentaryEstimateEnvelope.schemaVersion",
  );
  const capture = parseAgentResourceReference(
    root.capture,
    "$buyDocumentaryEstimateEnvelope.capture",
  );
  const canonicalText = nonEmptyText(
    root.canonicalText,
    "$buyDocumentaryEstimateEnvelope.canonicalText",
  );
  let parsedCanonical: unknown;
  try {
    parsedCanonical = JSON.parse(canonicalText);
  } catch {
    throw new TypeError(
      "$buyDocumentaryEstimateEnvelope.canonicalText is not JSON.",
    );
  }
  const fromText = validateBuyDocumentaryEstimate(parsedCanonical);
  if (deterministicJson(fromText) !== canonicalText) {
    throw new TypeError(
      "$buyDocumentaryEstimateEnvelope.canonicalText is not the exact canonical bytes of the estimate payload.",
    );
  }
  const estimate = validateBuyDocumentaryEstimate(root.estimate);
  if (deterministicJson(estimate) !== canonicalText) {
    throw new TypeError(
      "$buyDocumentaryEstimateEnvelope.canonicalText does not match the estimate payload.",
    );
  }
  const fingerprint = prefixedSha256(
    root.fingerprint,
    "$buyDocumentaryEstimateEnvelope.fingerprint",
  );
  if (fingerprint !== `sha256:${capture.fingerprint.digest}`) {
    throw new TypeError(
      "$buyDocumentaryEstimateEnvelope.fingerprint does not match the capture locator digest.",
    );
  }
  if (typeof root.byteCount !== "number" || !Number.isSafeInteger(root.byteCount)) {
    throw new TypeError(
      "$buyDocumentaryEstimateEnvelope.byteCount must be a safe integer.",
    );
  }
  const observedBytes = new TextEncoder().encode(canonicalText).byteLength;
  if (root.byteCount !== observedBytes || root.byteCount !== capture.byteCount) {
    throw new TypeError(
      `$buyDocumentaryEstimateEnvelope.byteCount mismatch: declared ${root.byteCount}, observed ${observedBytes}.`,
    );
  }
  return deepFreeze({
    schemaVersion: BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
    estimate,
    capture,
    canonicalText,
    fingerprint,
    byteCount: root.byteCount,
  });
}

export function parseBuyEstimateQuantityOperand(
  value: unknown,
  path: string,
): BuyEstimateQuantityOperand {
  return parseQuantityOperand(value, path);
}

export function parseBuyEstimateRateOperand(
  value: unknown,
  path: string,
  estimateCurrency: string,
): BuyEstimateRateOperand {
  return parseRateOperand(value, path, estimateCurrency);
}

export function parseBuyEstimateValidity(
  value: unknown,
  path: string,
): { readonly from?: string; readonly to?: string } {
  return parseValidity(value, path);
}

/** Verify the envelope fingerprint against the canonical preimage bytes. */
export async function assertBuyDocumentaryEstimateFingerprint(
  envelope: BuyDocumentaryEstimateEnvelope,
  digest: (bytes: Uint8Array) => Promise<string>,
): Promise<void> {
  const observed = await digest(new TextEncoder().encode(envelope.canonicalText));
  const expected = envelope.fingerprint.slice("sha256:".length);
  if (observed !== expected) {
    throw new TypeError(
      "$buyDocumentaryEstimateEnvelope.fingerprint does not match SHA-256 of canonicalText.",
    );
  }
}

/** Canonical UTC millisecond timestamp; rejects rolled-over and noncanonical forms. */
export function canonicalUtcTimestamp(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!CANONICAL_UTC.test(text)) {
    throw new TypeError(
      `${path} must be a canonical UTC timestamp YYYY-MM-DDTHH:mm:ss.sssZ.`,
    );
  }
  if (new Date(text).toISOString() !== text) {
    throw new TypeError(`${path} is not a real calendar timestamp.`);
  }
  return text;
}

/** Real YYYY-MM-DD calendar date; rejects Feb 30, prose, and noncanonical forms. */
export function calendarDate(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!CALENDAR_DATE.test(text)) {
    throw new TypeError(`${path} must be a canonical YYYY-MM-DD date.`);
  }
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new TypeError(`${path} is not a real calendar date.`);
  }
  return text;
}

export function boundedText(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (text.length > BUY_ESTIMATE_MAX_TEXT) {
    throw new TypeError(
      `${path} must be at most ${BUY_ESTIMATE_MAX_TEXT} characters.`,
    );
  }
  return text;
}

function boundedCount(values: readonly unknown[], max: number, path: string): void {
  if (values.length > max) {
    throw new TypeError(`${path} must hold at most ${max} entries.`);
  }
}

function parseBasis(value: unknown): BuyDocumentaryEstimateBasis {
  const input = exactRecord(
    value,
    ["snapshotId", "revision", "subjectId"],
    "$buyDocumentaryEstimate.basis",
  );
  const snapshotId = safeId(
    input.snapshotId,
    "$buyDocumentaryEstimate.basis.snapshotId",
  );
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError("$buyDocumentaryEstimate.basis.snapshotId must not be latest.");
  }
  return {
    snapshotId,
    revision: positiveInteger(input.revision, "$buyDocumentaryEstimate.basis.revision"),
    subjectId: safeId(input.subjectId, "$buyDocumentaryEstimate.basis.subjectId"),
  };
}

function parseGeometry(value: unknown): BuyDocumentaryEstimateGeometry {
  const input = exactRecord(value, [
    "parentArtifactId",
    "parentFingerprint",
    "stepArtifactId",
    "stepFingerprint",
    "stepUri",
  ], "$buyDocumentaryEstimate.geometry");
  return {
    parentArtifactId: safeId(
      input.parentArtifactId,
      "$buyDocumentaryEstimate.geometry.parentArtifactId",
    ),
    parentFingerprint: sha256(
      input.parentFingerprint,
      "$buyDocumentaryEstimate.geometry.parentFingerprint",
    ),
    stepArtifactId: safeId(
      input.stepArtifactId,
      "$buyDocumentaryEstimate.geometry.stepArtifactId",
    ),
    stepFingerprint: sha256(
      input.stepFingerprint,
      "$buyDocumentaryEstimate.geometry.stepFingerprint",
    ),
    stepUri: nonEmptyText(input.stepUri, "$buyDocumentaryEstimate.geometry.stepUri"),
  };
}

function parseValidity(
  value: unknown,
  path: string,
): { readonly from?: string; readonly to?: string } {
  const input = closedRecord(value, ["from", "to"], [], path);
  const from = input.from === undefined || input.from === null
    ? undefined
    : calendarDate(input.from, `${path}.from`);
  const to = input.to === undefined || input.to === null
    ? undefined
    : calendarDate(input.to, `${path}.to`);
  if (from !== undefined && to !== undefined && from > to) {
    throw new TypeError(`${path} validity range is reversed.`);
  }
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}

function parseLine(
  value: unknown,
  path: string,
  estimateCurrency: string,
): BuyDocumentaryEstimateLine {
  const input = exactRecord(
    value,
    ["configurationLineId", "quantityBasis", "productUom", "terms"],
    path,
  );
  literalValue(input.quantityBasis, "per-configuration-unit", `${path}.quantityBasis`);
  const terms = nonEmptyArray(input.terms, `${path}.terms`);
  boundedCount(terms, BUY_ESTIMATE_MAX_TERMS, `${path}.terms`);
  const parsedTerms = terms.map((term, i) =>
    parseTerm(term, `${path}.terms[${i}]`, estimateCurrency)
  );
  rejectDuplicates(
    parsedTerms.map((term) => term.id),
    `${path}.terms.id`,
  );
  return {
    configurationLineId: safeId(
      input.configurationLineId,
      `${path}.configurationLineId`,
    ),
    quantityBasis: "per-configuration-unit",
    productUom: uomToken(input.productUom, `${path}.productUom`),
    terms: parsedTerms,
  };
}

function parseTerm(
  value: unknown,
  path: string,
  estimateCurrency: string,
): BuyEstimateTerm {
  const input = exactRecord(value, ["id", "nature", "consumption", "rate"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    nature: oneOf(input.nature, BUY_ESTIMATE_TERM_NATURES, `${path}.nature`),
    consumption: parseQuantityOperand(input.consumption, `${path}.consumption`),
    rate: parseRateOperand(input.rate, `${path}.rate`, estimateCurrency),
  };
}

function parseQuantityOperand(
  value: unknown,
  path: string,
): BuyEstimateQuantityOperand {
  const kind = operandKind(value, path);
  if (kind === "unknown") {
    exactRecord(value, ["operand"], path);
    return { operand: "unknown" };
  }
  if (kind === "sourced") {
    const input = exactRecord(value, ["operand", "decimal", "uom", "source"], path);
    return {
      operand: "sourced",
      decimal: parseNonNegativeBuyDecimal(input.decimal, `${path}.decimal`),
      uom: uomToken(input.uom, `${path}.uom`),
      source: parseSourceRef(input.source, `${path}.source`),
    };
  }
  const input = exactRecord(
    value,
    ["operand", "decimal", "uom", "justification"],
    path,
  );
  return {
    operand: "assumed",
    decimal: parseNonNegativeBuyDecimal(input.decimal, `${path}.decimal`),
    uom: uomToken(input.uom, `${path}.uom`),
    justification: parseJustification(input.justification, `${path}.justification`),
  };
}

function parseRateOperand(
  value: unknown,
  path: string,
  estimateCurrency: string,
): BuyEstimateRateOperand {
  const kind = operandKind(value, path);
  if (kind === "unknown") {
    exactRecord(value, ["operand"], path);
    return { operand: "unknown" };
  }
  if (kind === "sourced") {
    const input = exactRecord(
      value,
      ["operand", "decimal", "perUom", "currency", "source"],
      path,
    );
    const currency = currencyCode(input.currency, `${path}.currency`);
    if (currency !== estimateCurrency) {
      throw new TypeError(
        `${path}.currency must equal the estimate currency ${estimateCurrency}.`,
      );
    }
    return {
      operand: "sourced",
      decimal: parseNonNegativeBuyDecimal(input.decimal, `${path}.decimal`),
      perUom: uomToken(input.perUom, `${path}.perUom`),
      currency,
      source: parseSourceRef(input.source, `${path}.source`),
    };
  }
  const input = exactRecord(
    value,
    ["operand", "decimal", "perUom", "currency", "justification"],
    path,
  );
  const currency = currencyCode(input.currency, `${path}.currency`);
  if (currency !== estimateCurrency) {
    throw new TypeError(
      `${path}.currency must equal the estimate currency ${estimateCurrency}.`,
    );
  }
  return {
    operand: "assumed",
    decimal: parseNonNegativeBuyDecimal(input.decimal, `${path}.decimal`),
    perUom: uomToken(input.perUom, `${path}.perUom`),
    currency,
    justification: parseJustification(input.justification, `${path}.justification`),
  };
}

function operandKind(value: unknown, path: string): BuyEstimateOperandKind {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return oneOf(
    (value as Record<string, unknown>).operand,
    BUY_ESTIMATE_OPERANDS,
    `${path}.operand`,
  );
}

function parseSourceRef(value: unknown, path: string): BuyEstimateSourceRef {
  const input = exactRecord(value, ["reference", "anchor", "observedAt"], path);
  return {
    reference: parseAgentResourceReference(input.reference, `${path}.reference`),
    anchor: boundedText(input.anchor, `${path}.anchor`),
    observedAt: canonicalUtcTimestamp(input.observedAt, `${path}.observedAt`),
  };
}

function parseJustification(
  value: unknown,
  path: string,
): BuyEstimateAssumedJustification {
  const input = exactRecord(value, ["statement", "source"], path);
  return {
    statement: boundedText(input.statement, `${path}.statement`),
    source: parseSourceRef(input.source, `${path}.source`),
  };
}

function currencyCode(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!CURRENCY.test(text)) {
    throw new TypeError(`${path} must be an ISO-4217 alphabetic code.`);
  }
  return text;
}

function uomToken(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (text.toLowerCase() === "latest") {
    throw new TypeError(`${path} must not be a latest alias.`);
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
