/**
 * Closed `buy-cost-bundle/2.0` composition of a preserved v1 bundle with
 * documentary estimate annexes.
 *
 * V2 reuses the single totals/coverage authority `aggregateBuyCoveredTotals`:
 * it adds no second sum engine. Catalogue lines keep their exact ERP
 * provenance; estimate lines are `costClass: "estimate"` with
 * `external-documentary` citations pointing at the exact annex bytes. A
 * simultaneous usable ERP price and usable estimate for one line is refused:
 * estimates never silently replace catalogue prices.
 *
 * Arithmetic coverage never removes documentary/provisional origin: estimate
 * lines carry `provisional` from their annex, and assumed operands stay
 * provisional even when the covered subtotal is arithmetically complete.
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
import {
  aggregateBuyCoveredTotals,
  BUY_BUNDLE_GAP_CODES,
  BUY_COST_BUNDLE_SCHEMA,
  BUY_COST_CLASSES,
  type BuyBundleGapCode,
  type BuyCostBundle,
  type BuyCostCitation,
  type BuyCostClass,
  type BuyCostCoverage,
  type BuyCostDimension,
  type BuyCostTotal,
  type BuyPricingContext,
  type BuySourceCaptureRef,
  createBuyCostDimensions,
  parseBuyCostCitation,
  parseBuyCostCoverage,
  parseBuyCostDimensions,
  parseBuyCostTotal,
  parseBuyPricingContext,
  parseBuySourceCaptureRef,
  validateBuyCostBundle,
} from "./buy-cost-bundle.ts";
import {
  multiplyBuyDecimals,
  parseBuyDecimal,
  roundBuyDecimal,
} from "./buy-decimal.ts";
import { canonicalUtcTimestamp } from "./buy-documentary-estimate.ts";
import {
  BUY_ESTIMATE_GAP_CODES,
  type BuyAnnexLine,
  type BuyEstimateGapCode,
  type BuyProductionEstimateBundle,
  validateBuyProductionEstimateBundle,
} from "./buy-production-estimate.ts";
import { prefixedSha256 } from "./buy-source-capture.ts";

export const BUY_COST_BUNDLE_V2_SCHEMA = "buy-cost-bundle/2.0" as const;

export type BuyCostBundleV2GapCode = BuyBundleGapCode | BuyEstimateGapCode;

const V2_GAP_CODES: readonly string[] = [
  ...new Set<string>([
    ...BUY_BUNDLE_GAP_CODES,
    ...BUY_ESTIMATE_GAP_CODES,
  ]),
];

const SHA256_HEX = /^[0-9a-f]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;

export interface BuyCostBundleV2Gap {
  readonly code: BuyCostBundleV2GapCode;
  readonly message: string;
  readonly lineId?: string;
}

export interface BuyCostBundleV2Line {
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
  readonly provisional: boolean;
  readonly annexRef?: {
    readonly annexFingerprint: string;
    readonly inputFingerprint: string;
  };
  readonly dimensions: Readonly<Record<BuyCostDimension, "established" | "unknown">>;
  readonly gaps: readonly BuyCostBundleV2Gap[];
}

export interface BuyV2EstimateProvenance {
  readonly annexFingerprint: string;
  readonly inputFingerprint: string;
  readonly inputCaptureUri: string;
  readonly inputAsOf: string;
  readonly configurationLineIds: readonly string[];
  readonly provisionalLineIds: readonly string[];
}

export interface BuyCostBundleV2 {
  readonly schemaVersion: typeof BUY_COST_BUNDLE_V2_SCHEMA;
  readonly configurationRef: { readonly digest: string };
  readonly baseBundle: {
    readonly schemaVersion: typeof BUY_COST_BUNDLE_SCHEMA;
    readonly digest: string;
  };
  readonly sourceCaptures: readonly BuySourceCaptureRef[];
  readonly estimateProvenance: readonly BuyV2EstimateProvenance[];
  readonly pricingContext: BuyPricingContext;
  readonly lines: readonly BuyCostBundleV2Line[];
  readonly totals: readonly BuyCostTotal[];
  readonly coverage: BuyCostCoverage;
  readonly gaps: readonly BuyCostBundleV2Gap[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "configurationRef",
  "baseBundle",
  "sourceCaptures",
  "estimateProvenance",
  "pricingContext",
  "lines",
  "totals",
  "coverage",
  "gaps",
] as const;

export function validateBuyCostBundleV2(value: unknown): BuyCostBundleV2 {
  const root = exactRecord(value, ROOT_KEYS, "$buyCostBundleV2");
  literalValue(
    root.schemaVersion,
    BUY_COST_BUNDLE_V2_SCHEMA,
    "$buyCostBundleV2.schemaVersion",
  );
  const configurationRef = exactRecord(
    root.configurationRef,
    ["digest"],
    "$buyCostBundleV2.configurationRef",
  );
  const baseBundle = exactRecord(
    root.baseBundle,
    ["schemaVersion", "digest"],
    "$buyCostBundleV2.baseBundle",
  );
  literalValue(
    baseBundle.schemaVersion,
    BUY_COST_BUNDLE_SCHEMA,
    "$buyCostBundleV2.baseBundle.schemaVersion",
  );
  const lines = arrayOf(root.lines, "$buyCostBundleV2.lines").map((line, i) =>
    parseV2Line(line, `$buyCostBundleV2.lines[${i}]`)
  );
  rejectDuplicates(
    lines.map((line) => line.configurationLineId),
    "$buyCostBundleV2.lines.configurationLineId",
  );
  const provenance = arrayOf(
    root.estimateProvenance,
    "$buyCostBundleV2.estimateProvenance",
  )
    .map((entry, i) =>
      parseProvenance(entry, `$buyCostBundleV2.estimateProvenance[${i}]`)
    );
  rejectDuplicates(
    provenance.map((entry) => entry.annexFingerprint),
    "$buyCostBundleV2.estimateProvenance.annexFingerprint",
  );
  return deepFreeze({
    schemaVersion: BUY_COST_BUNDLE_V2_SCHEMA,
    configurationRef: {
      digest: sha256DigestValue(
        configurationRef.digest,
        "$buyCostBundleV2.configurationRef.digest",
      ),
    },
    baseBundle: {
      schemaVersion: BUY_COST_BUNDLE_SCHEMA,
      digest: sha256DigestValue(
        baseBundle.digest,
        "$buyCostBundleV2.baseBundle.digest",
      ),
    },
    sourceCaptures: arrayOf(root.sourceCaptures, "$buyCostBundleV2.sourceCaptures")
      .map((capture, i) =>
        parseBuySourceCaptureRef(
          capture,
          `$buyCostBundleV2.sourceCaptures[${i}]`,
        )
      ),
    estimateProvenance: provenance,
    pricingContext: parseBuyPricingContext(
      root.pricingContext,
      "$buyCostBundleV2.pricingContext",
    ),
    lines,
    totals: arrayOf(root.totals, "$buyCostBundleV2.totals").map((total, i) =>
      parseBuyCostTotal(total, `$buyCostBundleV2.totals[${i}]`)
    ),
    coverage: parseBuyCostCoverage(root.coverage),
    gaps: arrayOf(root.gaps, "$buyCostBundleV2.gaps").map((gap, i) =>
      parseGap(gap, `$buyCostBundleV2.gaps[${i}]`)
    ),
  });
}

/**
 * Compose a v1 bundle with estimate annexes. The base bundle, configuration,
 * and pricing context are preserved exactly: any divergence, unknown line,
 * duplicate annex line, or simultaneous usable ERP price and usable estimate
 * for one line is refused.
 */
export async function computeBuyCostCandidateV2(input: {
  readonly configuration: BuyConfiguration;
  readonly configurationDigest: string;
  readonly baseBundle: BuyCostBundle;
  readonly estimates: readonly BuyProductionEstimateBundle[];
  readonly pricingContext: BuyPricingContext;
}): Promise<BuyCostBundleV2> {
  const configuration = validateBuyConfiguration(input.configuration);
  const verifiedDigest = await canonicalDigest(configuration);
  if (verifiedDigest !== input.configurationDigest) {
    throw new TypeError(
      "$buyCostBundleV2.configurationDigest is not the SHA-256 of the validated configuration.",
    );
  }
  const base = validateBuyCostBundle(input.baseBundle);
  if (base.configurationRef.digest !== verifiedDigest) {
    throw new TypeError(
      "$buyCostBundleV2 base bundle configuration digest does not match the validated configuration.",
    );
  }
  if (
    deterministicJson(input.pricingContext) !== deterministicJson(base.pricingContext)
  ) {
    throw new TypeError(
      "$buyCostBundleV2 pricingContext must equal the base bundle pricingContext exactly.",
    );
  }
  const configLineIds = configuration.lines.map((line) => line.id);
  const baseLineIds = base.lines.map((line) => line.configurationLineId);
  if (
    baseLineIds.length !== configLineIds.length ||
    baseLineIds.some((id) => !configLineIds.includes(id))
  ) {
    throw new TypeError(
      "$buyCostBundleV2 base bundle lines must cover the configuration lines exactly.",
    );
  }
  const annexes = input.estimates.map((annex) =>
    validateBuyProductionEstimateBundle(annex)
  );
  for (const annex of annexes) {
    if (annex.estimateRef.configurationDigest !== verifiedDigest) {
      throw new TypeError(
        "$buyCostBundleV2 annex configuration digest does not match the validated configuration.",
      );
    }
  }
  const annexDigests: string[] = [];
  for (const annex of annexes) {
    annexDigests.push(await canonicalDigest(annex));
  }
  rejectDuplicates(annexDigests, "$buyCostBundleV2.estimates.annexDigest");
  const annexLines: Array<
    { readonly annex: BuyProductionEstimateBundle; readonly line: BuyAnnexLine }
  > = annexes.flatMap((annex) => annex.lines.map((line) => ({ annex, line })));
  for (const entry of annexLines) {
    if (!configLineIds.includes(entry.line.configurationLineId)) {
      throw new TypeError(
        `$buyCostBundleV2 annex names unknown configuration line ${entry.line.configurationLineId}.`,
      );
    }
  }
  rejectDuplicates(
    annexLines.map((entry) => entry.line.configurationLineId),
    "$buyCostBundleV2.estimates.configurationLineId",
  );
  const lines = configuration.lines.map((configurationLine) => {
    const baseLine = base.lines.find((line) =>
      line.configurationLineId === configurationLine.id
    )!;
    const annexEntry = annexLines.find((entry) =>
      entry.line.configurationLineId === configurationLine.id
    );
    const usableErp = baseLine.amount !== undefined;
    const usableEstimate = annexEntry?.line.unitCost !== undefined;
    if (usableErp && usableEstimate) {
      throw new TypeError(
        `$buyCostBundleV2 line ${configurationLine.id} has both a usable ERP price and a usable estimate; estimates never silently replace catalogue prices.`,
      );
    }
    if (annexEntry && usableEstimate) {
      const annexIndex = annexes.indexOf(annexEntry.annex);
      return priceEstimateLine({
        configurationLine,
        annex: annexEntry.annex,
        annexLine: annexEntry.line,
        annexDigest: annexDigests[annexIndex]!,
        pricingContext: base.pricingContext,
      });
    }
    return {
      configurationLineId: baseLine.configurationLineId,
      costClass: baseLine.costClass,
      ...(baseLine.citation !== undefined ? { citation: baseLine.citation } : {}),
      quantity: baseLine.quantity,
      uom: baseLine.uom,
      ...(baseLine.unitPrice !== undefined ? { unitPrice: baseLine.unitPrice } : {}),
      ...(baseLine.currency !== undefined ? { currency: baseLine.currency } : {}),
      ...(baseLine.amount !== undefined ? { amount: baseLine.amount } : {}),
      ...(baseLine.capturedAt !== undefined ? { capturedAt: baseLine.capturedAt } : {}),
      ...(baseLine.sourceValidity !== undefined
        ? { sourceValidity: baseLine.sourceValidity }
        : {}),
      asOf: baseLine.asOf,
      provisional: false,
      dimensions: baseLine.dimensions,
      gaps: baseLine.gaps,
    };
  });
  const aggregated = aggregateBuyCoveredTotals({
    currency: base.pricingContext.currency,
    requiredDimensions: base.pricingContext.requiredDimensions,
    rounding: base.pricingContext.rounding,
    lines,
    bundleHasGap: base.gaps.length > 0,
  });
  return deepFreeze({
    schemaVersion: BUY_COST_BUNDLE_V2_SCHEMA,
    configurationRef: { digest: verifiedDigest },
    baseBundle: {
      schemaVersion: BUY_COST_BUNDLE_SCHEMA,
      digest: await canonicalDigest(base),
    },
    sourceCaptures: [...base.sourceCaptures],
    estimateProvenance: annexes.map((annex, i) => ({
      annexFingerprint: `sha256:${annexDigests[i]}`,
      inputFingerprint: annex.estimateSource.inputFingerprint,
      inputCaptureUri: annex.estimateSource.inputCaptureUri,
      inputAsOf: annex.estimateSource.inputAsOf,
      configurationLineIds: annex.lines.map((line) => line.configurationLineId),
      provisionalLineIds: annex.lines
        .filter((line) => line.provisional)
        .map((line) => line.configurationLineId),
    })),
    pricingContext: base.pricingContext,
    lines,
    totals: aggregated.totals,
    coverage: aggregated.coverage,
    gaps: [...base.gaps],
  });
}

/**
 * Recross a v2 bundle against its retained base bundle and annexes without
 * repricing. ERP citation-to-capture checks stay with the existing
 * buy-source-lineage authority over the base bundle and its captures.
 */
export async function assertBuyCostBundleV2Lineage(
  bundle: BuyCostBundleV2,
  retained: {
    readonly baseBundle: BuyCostBundle;
    readonly annexes: readonly BuyProductionEstimateBundle[];
  },
): Promise<void> {
  const v2 = validateBuyCostBundleV2(bundle);
  const base = validateBuyCostBundle(retained.baseBundle);
  const annexes = retained.annexes.map((annex) =>
    validateBuyProductionEstimateBundle(annex)
  );
  if (await canonicalDigest(base) !== v2.baseBundle.digest) {
    throw new TypeError(
      "Buy v2 base bundle digest does not match the retained base bundle.",
    );
  }
  if (
    deterministicJson(v2.pricingContext) !== deterministicJson(base.pricingContext) ||
    deterministicJson(v2.sourceCaptures) !== deterministicJson(base.sourceCaptures) ||
    deterministicJson(v2.gaps) !== deterministicJson(base.gaps)
  ) {
    throw new TypeError(
      "Buy v2 preserved base fields do not match the retained base bundle.",
    );
  }
  const annexDigests: string[] = [];
  for (const annex of annexes) {
    annexDigests.push(await canonicalDigest(annex));
  }
  if (
    annexDigests.length !== v2.estimateProvenance.length ||
    new Set(annexDigests).size !== annexDigests.length
  ) {
    throw new TypeError(
      "Buy v2 estimate provenance must match the retained annexes exactly.",
    );
  }
  for (const [i, annex] of annexes.entries()) {
    const entry = v2.estimateProvenance.find((item) =>
      item.annexFingerprint === `sha256:${annexDigests[i]}`
    );
    if (
      !entry ||
      entry.inputFingerprint !== annex.estimateSource.inputFingerprint ||
      entry.inputCaptureUri !== annex.estimateSource.inputCaptureUri ||
      entry.inputAsOf !== annex.estimateSource.inputAsOf ||
      deterministicJson(entry.configurationLineIds) !==
        deterministicJson(annex.lines.map((line) => line.configurationLineId)) ||
      deterministicJson(entry.provisionalLineIds) !==
        deterministicJson(
          annex.lines
            .filter((line) => line.provisional)
            .map((line) => line.configurationLineId),
        )
    ) {
      throw new TypeError(
        "Buy v2 estimate provenance entry does not match its retained annex.",
      );
    }
  }
  for (const line of v2.lines) {
    if (!line.annexRef) {
      const baseLine = base.lines.find((item) =>
        item.configurationLineId === line.configurationLineId
      );
      if (
        !baseLine || line.provisional !== false ||
        line.configurationLineId !== baseLine.configurationLineId ||
        line.costClass !== baseLine.costClass ||
        optionalJson(line.citation) !== optionalJson(baseLine.citation) ||
        line.quantity !== baseLine.quantity ||
        line.uom !== baseLine.uom ||
        line.unitPrice !== baseLine.unitPrice ||
        line.currency !== baseLine.currency ||
        line.amount !== baseLine.amount ||
        line.capturedAt !== baseLine.capturedAt ||
        optionalJson(line.sourceValidity) !== optionalJson(baseLine.sourceValidity) ||
        line.asOf !== baseLine.asOf ||
        deterministicJson(line.dimensions) !== deterministicJson(baseLine.dimensions) ||
        deterministicJson(line.gaps) !== deterministicJson(baseLine.gaps)
      ) {
        throw new TypeError(
          `Buy v2 preserved line ${line.configurationLineId} does not match the base bundle.`,
        );
      }
      continue;
    }
    const annexIndex = annexDigests.findIndex((digest) =>
      `sha256:${digest}` === line.annexRef!.annexFingerprint
    );
    const annex = annexIndex < 0 ? undefined : annexes[annexIndex];
    const annexLine = annex?.lines.find((item) =>
      item.configurationLineId === line.configurationLineId
    );
    if (
      !annex || !annexLine || annexLine.unitCost === undefined ||
      line.annexRef.inputFingerprint !== annex.estimateSource.inputFingerprint ||
      line.citation?.kind !== "external-documentary" ||
      line.citation.fingerprint !== `sha256:${annexDigests[annexIndex]}` ||
      line.citation.resourceUri !== annex.estimateSource.inputCaptureUri ||
      line.citation.capturedAt !== annex.estimateSource.inputAsOf
    ) {
      throw new TypeError(
        `Buy v2 estimate line ${line.configurationLineId} does not match its retained annex.`,
      );
    }
  }
}

function priceEstimateLine(input: {
  readonly configurationLine: BuyConfiguration["lines"][number];
  readonly annex: BuyProductionEstimateBundle;
  readonly annexLine: BuyAnnexLine;
  readonly annexDigest: string;
  readonly pricingContext: BuyPricingContext;
}): BuyCostBundleV2Line {
  const unitCost = input.annexLine.unitCost!;
  const dimensions = createBuyCostDimensions();
  dimensions.quantity = "established";
  dimensions.uom = "established";
  dimensions.currency = "established";
  dimensions["unit-price"] = "established";
  const gaps: BuyCostBundleV2Gap[] = [...input.annexLine.gaps];
  for (const dimension of input.pricingContext.requiredDimensions) {
    if (
      dimension === "tax" || dimension === "transport" || dimension === "discount" ||
      dimension === "fees" || dimension === "moq" || dimension === "fx"
    ) {
      dimensions[dimension] = "unknown";
      gaps.push({
        code: "dimension-unknown",
        message:
          `Required cost dimension ${dimension} is not attested by a documentary estimate and is not defaulted to zero.`,
        lineId: input.configurationLine.id,
      });
    }
  }
  const validity = input.annex.sourceValidity;
  return {
    configurationLineId: input.configurationLine.id,
    costClass: "estimate",
    citation: {
      kind: "external-documentary",
      resourceUri: input.annex.estimateSource.inputCaptureUri,
      fingerprint: `sha256:${input.annexDigest}`,
      capturedAt: input.annex.estimateSource.inputAsOf,
    },
    quantity: input.configurationLine.quantity,
    uom: input.configurationLine.uom,
    unitPrice: unitCost,
    currency: input.pricingContext.currency,
    amount: roundBuyDecimal(
      multiplyBuyDecimals(input.configurationLine.quantity, unitCost),
      input.pricingContext.rounding,
    ),
    capturedAt: input.annex.estimateSource.inputAsOf,
    ...(Object.keys(validity).length === 0 ? {} : {
      sourceValidity: { ...validity },
    }),
    asOf: input.pricingContext.asOf,
    provisional: input.annexLine.provisional,
    annexRef: {
      annexFingerprint: `sha256:${input.annexDigest}`,
      inputFingerprint: input.annex.estimateSource.inputFingerprint,
    },
    dimensions,
    gaps,
  };
}

async function canonicalDigest(value: unknown): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(deterministicJson(value)));
}

function optionalJson(value: unknown): string {
  return value === undefined ? "undefined" : deterministicJson(value);
}

function parseV2Line(value: unknown, path: string): BuyCostBundleV2Line {
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
    "provisional",
    "annexRef",
    "dimensions",
    "gaps",
  ], [
    "configurationLineId",
    "costClass",
    "quantity",
    "uom",
    "asOf",
    "provisional",
    "dimensions",
    "gaps",
  ], path);
  if (typeof input.provisional !== "boolean") {
    throw new TypeError(`${path}.provisional must be a boolean.`);
  }
  return {
    configurationLineId: safeId(
      input.configurationLineId,
      `${path}.configurationLineId`,
    ),
    costClass: oneOf(input.costClass, BUY_COST_CLASSES, `${path}.costClass`),
    ...(input.citation === undefined || input.citation === null ? {} : {
      citation: parseBuyCostCitation(input.citation, `${path}.citation`),
    }),
    quantity: parseBuyDecimal(input.quantity, `${path}.quantity`),
    uom: nonEmptyText(input.uom, `${path}.uom`),
    ...(input.unitPrice === undefined || input.unitPrice === null ? {} : {
      unitPrice: parseBuyDecimal(input.unitPrice, `${path}.unitPrice`),
    }),
    ...(input.currency === undefined || input.currency === null ? {} : {
      currency: currencyCode(input.currency, `${path}.currency`),
    }),
    ...(input.amount === undefined || input.amount === null ? {} : {
      amount: parseBuyDecimal(input.amount, `${path}.amount`),
    }),
    ...(input.capturedAt === undefined || input.capturedAt === null ? {} : {
      capturedAt: nonEmptyText(input.capturedAt, `${path}.capturedAt`),
    }),
    ...(input.sourceValidity === undefined || input.sourceValidity === null ? {} : {
      sourceValidity: parseValidity(input.sourceValidity, `${path}.sourceValidity`),
    }),
    asOf: nonEmptyText(input.asOf, `${path}.asOf`),
    provisional: input.provisional,
    ...(input.annexRef === undefined || input.annexRef === null ? {} : {
      annexRef: parseAnnexRef(input.annexRef, `${path}.annexRef`),
    }),
    dimensions: parseBuyCostDimensions(input.dimensions, `${path}.dimensions`),
    gaps: arrayOf(input.gaps, `${path}.gaps`).map((gap, i) =>
      parseGap(gap, `${path}.gaps[${i}]`)
    ),
  };
}

function parseAnnexRef(
  value: unknown,
  path: string,
): NonNullable<BuyCostBundleV2Line["annexRef"]> {
  const input = exactRecord(value, ["annexFingerprint", "inputFingerprint"], path);
  return {
    annexFingerprint: prefixedSha256(
      input.annexFingerprint,
      `${path}.annexFingerprint`,
    ),
    inputFingerprint: prefixedSha256(
      input.inputFingerprint,
      `${path}.inputFingerprint`,
    ),
  };
}

function parseProvenance(value: unknown, path: string): BuyV2EstimateProvenance {
  const input = exactRecord(value, [
    "annexFingerprint",
    "inputFingerprint",
    "inputCaptureUri",
    "inputAsOf",
    "configurationLineIds",
    "provisionalLineIds",
  ], path);
  const configurationLineIds = arrayOf(
    input.configurationLineIds,
    `${path}.configurationLineIds`,
  )
    .map((id, i) => safeId(id, `${path}.configurationLineIds[${i}]`));
  const provisionalLineIds = arrayOf(
    input.provisionalLineIds,
    `${path}.provisionalLineIds`,
  )
    .map((id, i) => safeId(id, `${path}.provisionalLineIds[${i}]`));
  for (const id of provisionalLineIds) {
    if (!configurationLineIds.includes(id)) {
      throw new TypeError(
        `${path}.provisionalLineIds names ${id}, which is not a provenance line.`,
      );
    }
  }
  return {
    annexFingerprint: prefixedSha256(
      input.annexFingerprint,
      `${path}.annexFingerprint`,
    ),
    inputFingerprint: prefixedSha256(
      input.inputFingerprint,
      `${path}.inputFingerprint`,
    ),
    inputCaptureUri: nonEmptyText(input.inputCaptureUri, `${path}.inputCaptureUri`),
    inputAsOf: canonicalUtcTimestamp(input.inputAsOf, `${path}.inputAsOf`),
    configurationLineIds,
    provisionalLineIds,
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
      : { from: nonEmptyText(input.from, `${path}.from`) }),
    ...(input.to === undefined || input.to === null
      ? {}
      : { to: nonEmptyText(input.to, `${path}.to`) }),
  };
}

function parseGap(value: unknown, path: string): BuyCostBundleV2Gap {
  const input = closedRecord(
    value,
    ["code", "message", "lineId"],
    ["code", "message"],
    path,
  );
  if (typeof input.code !== "string" || !V2_GAP_CODES.includes(input.code)) {
    throw new TypeError(
      `${path}.code must be one of ${V2_GAP_CODES.join(", ")}.`,
    );
  }
  return {
    code: input.code as BuyCostBundleV2GapCode,
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
