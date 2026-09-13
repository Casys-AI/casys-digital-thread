/**
 * MRTR grammars for `buy.capture-configuration-cost@1` and
 * `buy.seal-configuration-cost@1`.
 *
 * Capture signs configuration, STEP, ERP document refs, pricing scope and
 * the authorized site fingerprint. Seal signs the candidate/bundle hashes
 * and coverage. Tool names stay server locks.
 */

import type { EngineeringDecisionProposalParameter } from "../project/engineering-project.ts";
import {
  BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
  BUY_SEAL_CONFIGURATION_COST_OPERATION,
  ERPNEXT_BUY_CAPTURE_TOOL,
} from "./buy-operations.ts";
import {
  BUY_CONFIGURATION_SCHEMA,
  type BuyConfiguration,
} from "./buy-configuration.ts";
import { BUY_CLOSED_DOCTYPES, type BuyClosedDoctype } from "./buy-source-capture.ts";
import {
  BUY_COST_DIMENSIONS,
  BUY_COVERAGE_STATUSES,
  type BuyCostDimension,
  type BuyCoverageStatus,
  type BuyPricingContext,
} from "./buy-cost-bundle.ts";
import { BUY_DECIMAL_SCHEMA } from "./buy-decimal.ts";

export {
  BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
  BUY_SEAL_CONFIGURATION_COST_OPERATION,
  ERPNEXT_BUY_CAPTURE_TOOL,
};

export type BuyProposalErrorCode =
  | "missing_parameter"
  | "unexpected_parameter"
  | "duplicate_parameter"
  | "invalid_schema"
  | "invalid_format"
  | "invalid_fingerprint"
  | "parameter_mismatch";

export class BuyProposalError extends Error {
  constructor(
    readonly code: BuyProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BuyProposalError";
  }
}

export interface BuyDocumentRequest {
  readonly doctype: BuyClosedDoctype;
  readonly name: string;
  readonly expectedModified?: string;
}

export interface BuyCaptureDecisionParameters {
  readonly configurationDigest: string;
  readonly configurationResourceUri: string;
  readonly configurationResourceDigest: string;
  readonly schemaVersion: typeof BUY_CONFIGURATION_SCHEMA;
  readonly projectId: string;
  readonly subjectId: string;
  readonly configurationRevision: number;
  readonly basisSnapshotId: string;
  readonly basisRevision: number;
  readonly geometry: BuyConfiguration["geometry"];
  readonly documents: readonly BuyDocumentRequest[];
  readonly pricing: BuyPricingContext;
  readonly authorizedSiteFingerprint: string;
  readonly providerTool: typeof ERPNEXT_BUY_CAPTURE_TOOL;
}

export interface BuySealDecisionParameters {
  readonly candidateDigest: string;
  readonly bundleDigest: string;
  readonly configurationDigest: string;
  readonly stepFingerprint: string;
  readonly coverageStatus: BuyCoverageStatus;
  readonly sourceCaptureCount: number;
  readonly sourceCaptureDigests: readonly string[];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function encodeBuyCaptureDecisionParameters(
  params: BuyCaptureDecisionParameters,
): readonly EngineeringDecisionProposalParameter[] {
  assertFingerprint(params.configurationDigest, "configurationDigest");
  const result: EngineeringDecisionProposalParameter[] = [];
  const p = (
    key: string,
    label: string,
    value: string | number | boolean,
  ) => result.push({ key, label, value });
  p(
    "buy.capture.configuration.digest",
    "Configuration SHA-256",
    params.configurationDigest,
  );
  p(
    "buy.capture.configuration.resource.uri",
    "Configuration agent-resource URI",
    params.configurationResourceUri,
  );
  p(
    "buy.capture.configuration.resource.digest",
    "Configuration agent-resource digest",
    params.configurationResourceDigest,
  );
  p(
    "buy.capture.configuration.schemaVersion",
    "Configuration schema",
    params.schemaVersion,
  );
  p("buy.capture.project.id", "Project ID", params.projectId);
  p("buy.capture.project.subjectId", "Subject ID", params.subjectId);
  p(
    "buy.capture.configuration.revision",
    "Configuration revision",
    params.configurationRevision,
  );
  p("buy.capture.basis.snapshotId", "Basis snapshot ID", params.basisSnapshotId);
  p("buy.capture.basis.revision", "Basis revision", params.basisRevision);
  p(
    "buy.capture.geometry.parentArtifactId",
    "Geometry parent artifact",
    params.geometry.parentArtifactId,
  );
  p(
    "buy.capture.geometry.parentFingerprint",
    "Geometry parent SHA-256",
    params.geometry.parentFingerprint,
  );
  p(
    "buy.capture.geometry.stepArtifactId",
    "STEP artifact",
    params.geometry.stepArtifactId,
  );
  p(
    "buy.capture.geometry.stepFingerprint",
    "STEP SHA-256",
    params.geometry.stepFingerprint,
  );
  p("buy.capture.geometry.stepUri", "STEP URI", params.geometry.stepUri);
  p("buy.capture.documents.count", "ERP document count", params.documents.length);
  for (const [i, document] of params.documents.entries()) {
    p(`buy.capture.documents.${i}.doctype`, `Document ${i} doctype`, document.doctype);
    p(`buy.capture.documents.${i}.name`, `Document ${i} name`, document.name);
    if (document.expectedModified) {
      p(
        `buy.capture.documents.${i}.expectedModified`,
        `Document ${i} expected modified`,
        document.expectedModified,
      );
    }
  }
  p("buy.capture.pricing.currency", "Pricing currency", params.pricing.currency);
  p("buy.capture.pricing.asOf", "Pricing asOf", params.pricing.asOf);
  p(
    "buy.capture.pricing.rounding.scale",
    "Rounding scale",
    params.pricing.rounding.scale,
  );
  p(
    "buy.capture.pricing.rounding.mode",
    "Rounding mode",
    params.pricing.rounding.mode,
  );
  p(
    "buy.capture.pricing.requiredDimensions.count",
    "Required dimension count",
    params.pricing.requiredDimensions.length,
  );
  for (const [i, dimension] of params.pricing.requiredDimensions.entries()) {
    p(
      `buy.capture.pricing.requiredDimensions.${i}`,
      `Required dimension ${i}`,
      dimension,
    );
  }
  p(
    "buy.capture.authorizedSiteFingerprint",
    "Authorized ERP site fingerprint",
    params.authorizedSiteFingerprint,
  );
  p("buy.capture.providerTool", "Provider tool lock", params.providerTool);
  return result;
}

export function encodeBuySealDecisionParameters(
  params: BuySealDecisionParameters,
): readonly EngineeringDecisionProposalParameter[] {
  assertFingerprint(params.candidateDigest, "candidateDigest");
  assertFingerprint(params.bundleDigest, "bundleDigest");
  assertFingerprint(params.configurationDigest, "configurationDigest");
  assertFingerprint(params.stepFingerprint, "stepFingerprint");
  const result: EngineeringDecisionProposalParameter[] = [
    {
      key: "buy.seal.candidate.digest",
      label: "Candidate capture SHA-256",
      value: params.candidateDigest,
    },
    {
      key: "buy.seal.bundle.digest",
      label: "Cost bundle SHA-256",
      value: params.bundleDigest,
    },
    {
      key: "buy.seal.configuration.digest",
      label: "Configuration SHA-256",
      value: params.configurationDigest,
    },
    {
      key: "buy.seal.geometry.stepFingerprint",
      label: "Bound STEP SHA-256",
      value: params.stepFingerprint,
    },
    {
      key: "buy.seal.coverage.status",
      label: "Reviewed coverage status",
      value: params.coverageStatus,
    },
    {
      key: "buy.seal.sourceCaptures.count",
      label: "Source capture count",
      value: params.sourceCaptureCount,
    },
  ];
  for (const [i, digest] of params.sourceCaptureDigests.entries()) {
    result.push({
      key: `buy.seal.sourceCaptures.${i}.digest`,
      label: `Source capture ${i} SHA-256`,
      value: digest,
    });
  }
  return result;
}

export function parseBuyCaptureDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): BuyCaptureDecisionParameters {
  const params = toMap(parameters, "Buy capture");
  const expected = new Set<string>();
  const str = stringReader(params, expected, "Buy capture");
  const posInt = positiveIntReader(params, expected, "Buy capture");
  const nonNegInt = nonNegativeIntReader(params, expected, "Buy capture");
  const configurationDigest = str("buy.capture.configuration.digest");
  assertFingerprint(configurationDigest, "buy.capture.configuration.digest");
  const schemaVersion = str("buy.capture.configuration.schemaVersion");
  if (schemaVersion !== BUY_CONFIGURATION_SCHEMA) {
    invalid(
      "invalid_schema",
      `buy.capture.configuration.schemaVersion must be ${BUY_CONFIGURATION_SCHEMA}.`,
    );
  }
  const parentFingerprint = str("buy.capture.geometry.parentFingerprint");
  const stepFingerprint = str("buy.capture.geometry.stepFingerprint");
  assertFingerprint(parentFingerprint, "buy.capture.geometry.parentFingerprint");
  assertFingerprint(stepFingerprint, "buy.capture.geometry.stepFingerprint");
  const documentCount = nonNegInt("buy.capture.documents.count");
  const documents: BuyDocumentRequest[] = [];
  for (let i = 0; i < documentCount; i++) {
    const doctype = str(`buy.capture.documents.${i}.doctype`);
    if (!(BUY_CLOSED_DOCTYPES as readonly string[]).includes(doctype)) {
      invalid("invalid_format", `Document ${i} doctype is not in the closed set.`);
    }
    const expectedModifiedKey = `buy.capture.documents.${i}.expectedModified`;
    const expectedModified = params.has(expectedModifiedKey)
      ? str(expectedModifiedKey)
      : "";
    documents.push({
      doctype: doctype as BuyClosedDoctype,
      name: str(`buy.capture.documents.${i}.name`),
      ...(expectedModified === "" ? {} : { expectedModified }),
    });
  }
  const dimensionCount = posInt("buy.capture.pricing.requiredDimensions.count");
  const requiredDimensions: BuyCostDimension[] = [];
  for (let i = 0; i < dimensionCount; i++) {
    const dimension = str(`buy.capture.pricing.requiredDimensions.${i}`);
    if (!(BUY_COST_DIMENSIONS as readonly string[]).includes(dimension)) {
      invalid("invalid_format", `Required dimension ${i} is not in the closed set.`);
    }
    requiredDimensions.push(dimension as BuyCostDimension);
  }
  const roundingScale = posInt("buy.capture.pricing.rounding.scale");
  const roundingMode = str("buy.capture.pricing.rounding.mode");
  if (roundingMode !== "half-up") {
    invalid("invalid_format", "Buy rounding mode must be half-up.");
  }
  const providerTool = str("buy.capture.providerTool");
  if (providerTool !== ERPNEXT_BUY_CAPTURE_TOOL) {
    invalid("invalid_format", "Buy provider tool lock is divergent.");
  }
  const authorizedSiteFingerprint = str("buy.capture.authorizedSiteFingerprint");
  assertPrefixedFingerprint(
    authorizedSiteFingerprint,
    "buy.capture.authorizedSiteFingerprint",
  );
  const configurationResourceDigest = str(
    "buy.capture.configuration.resource.digest",
  );
  assertFingerprint(
    configurationResourceDigest,
    "buy.capture.configuration.resource.digest",
  );
  const parsed: BuyCaptureDecisionParameters = {
    configurationDigest,
    configurationResourceUri: str("buy.capture.configuration.resource.uri"),
    configurationResourceDigest,
    schemaVersion: BUY_CONFIGURATION_SCHEMA,
    projectId: str("buy.capture.project.id"),
    subjectId: str("buy.capture.project.subjectId"),
    configurationRevision: posInt("buy.capture.configuration.revision"),
    basisSnapshotId: str("buy.capture.basis.snapshotId"),
    basisRevision: posInt("buy.capture.basis.revision"),
    geometry: {
      parentOperation: "design.write-geometry@1",
      parentArtifactId: str("buy.capture.geometry.parentArtifactId"),
      parentFingerprint,
      stepArtifactId: str("buy.capture.geometry.stepArtifactId"),
      stepFingerprint,
      stepUri: str("buy.capture.geometry.stepUri"),
      mediaType: "model/step",
    },
    documents,
    pricing: {
      currency: str("buy.capture.pricing.currency"),
      asOf: str("buy.capture.pricing.asOf"),
      requiredDimensions,
      rounding: {
        schemaVersion: BUY_DECIMAL_SCHEMA,
        scale: roundingScale,
        mode: "half-up",
      },
    },
    authorizedSiteFingerprint,
    providerTool: ERPNEXT_BUY_CAPTURE_TOOL,
  };
  rejectUnexpected(params, expected, "Buy capture");
  return parsed;
}

export function parseBuySealDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): BuySealDecisionParameters {
  const params = toMap(parameters, "Buy seal");
  const expected = new Set<string>();
  const str = stringReader(params, expected, "Buy seal");
  const nonNegInt = nonNegativeIntReader(params, expected, "Buy seal");
  const candidateDigest = str("buy.seal.candidate.digest");
  const bundleDigest = str("buy.seal.bundle.digest");
  const configurationDigest = str("buy.seal.configuration.digest");
  const stepFingerprint = str("buy.seal.geometry.stepFingerprint");
  assertFingerprint(candidateDigest, "buy.seal.candidate.digest");
  assertFingerprint(bundleDigest, "buy.seal.bundle.digest");
  assertFingerprint(configurationDigest, "buy.seal.configuration.digest");
  assertFingerprint(stepFingerprint, "buy.seal.geometry.stepFingerprint");
  const coverageStatus = str("buy.seal.coverage.status");
  if (!(BUY_COVERAGE_STATUSES as readonly string[]).includes(coverageStatus)) {
    invalid("invalid_format", "Buy seal coverage status is not in the closed set.");
  }
  const count = nonNegInt("buy.seal.sourceCaptures.count");
  const sourceCaptureDigests: string[] = [];
  for (let i = 0; i < count; i++) {
    const digest = str(`buy.seal.sourceCaptures.${i}.digest`);
    assertFingerprint(digest, `buy.seal.sourceCaptures.${i}.digest`);
    sourceCaptureDigests.push(digest);
  }
  rejectUnexpected(params, expected, "Buy seal");
  return {
    candidateDigest,
    bundleDigest,
    configurationDigest,
    stepFingerprint,
    coverageStatus: coverageStatus as BuyCoverageStatus,
    sourceCaptureCount: count,
    sourceCaptureDigests,
  };
}

function toMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
  label: string,
): ReadonlyMap<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const param of parameters) {
    if (result.has(param.key)) {
      invalid("duplicate_parameter", `Duplicate ${label} parameter: ${param.key}`);
    }
    result.set(param.key, param.value);
  }
  return result;
}

function stringReader(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): (key: string) => string {
  return (key: string): string => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing ${label} parameter: ${key}`);
    }
    return String(value);
  };
}

function positiveIntReader(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): (key: string) => number {
  return intReader(params, expected, label, 1);
}

function nonNegativeIntReader(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): (key: string) => number {
  return intReader(params, expected, label, 0);
}

function intReader(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
  minimum: number,
): (key: string) => number {
  return (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing ${label} parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < minimum) {
      invalid(
        "invalid_format",
        `${label} parameter ${key} must be an integer >= ${minimum} (got: ${value}).`,
      );
    }
    return n;
  };
}

function rejectUnexpected(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): void {
  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid("unexpected_parameter", `Unexpected ${label} parameter: ${key}`);
    }
  }
}

function assertFingerprint(value: string, path: string): void {
  if (!SHA256_HEX.test(value)) {
    invalid(
      "invalid_fingerprint",
      `${path} must be a lowercase 64-character hex SHA-256 digest.`,
    );
  }
}

function assertPrefixedFingerprint(value: string, path: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    invalid(
      "invalid_fingerprint",
      `${path} must be sha256:<64 lowercase hex>.`,
    );
  }
}

function invalid(code: BuyProposalErrorCode, message: string): never {
  throw new BuyProposalError(code, message);
}
