/** Exact authority envelope produced by `simulate.seal-simulation-case@2`. */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  canonicalResourceUri,
  compareAsciiCodeUnits,
  sha256Hex,
} from "../../domain/analysis/provider-resource-reader.ts";
import { SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION } from "../../orchestration/operations/recorded-analysis.ts";

export const SIMULATION_CASE_QUALIFICATION_CAPTURE_SCHEMA =
  "simulation-case-qualification-capture/2.0" as const;

export interface ModelicaQualificationCasReference {
  readonly uri: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface ModelicaSimulationCaseQualificationCapture {
  readonly schemaVersion: typeof SIMULATION_CASE_QUALIFICATION_CAPTURE_SCHEMA;
  readonly operation: typeof SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION;
  readonly trustedRunId: string;
  readonly sealBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
  readonly mrtr: {
    readonly decisionId: string;
    readonly inputFingerprint: string;
    readonly approvalId: string;
    readonly approvalFingerprint: string;
    readonly workItemId: string;
  };
  readonly caseDigest: string;
  readonly simulationCase: ModelicaQualificationCasReference;
  readonly manifest: ModelicaQualificationCasReference;
  readonly sourceCapture: ModelicaQualificationCasReference;
  readonly sources: readonly {
    readonly role: "model" | "scenario" | "parameter_schema";
    readonly mediaType: string;
    readonly resourceUri: string;
    readonly cas: ModelicaQualificationCasReference;
  }[];
  readonly sealedAt: string;
}

export function validateModelicaSimulationCaseQualificationCapture(
  value: unknown,
  path = "$modelicaSimulationCaseQualification",
): ModelicaSimulationCaseQualificationCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "sealBasis",
    "mrtr",
    "caseDigest",
    "simulationCase",
    "manifest",
    "sourceCapture",
    "sources",
    "sealedAt",
  ], path);
  literalValue(
    root.schemaVersion,
    SIMULATION_CASE_QUALIFICATION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.version,
    `${path}.operation.version`,
  );
  const basis = snapshotRef(root.sealBasis, `${path}.sealBasis`);
  const mrtrInput = exactRecord(root.mrtr, [
    "decisionId",
    "inputFingerprint",
    "approvalId",
    "approvalFingerprint",
    "workItemId",
  ], `${path}.mrtr`);
  const simulationCase = cas(root.simulationCase, `${path}.simulationCase`);
  const caseDigest = sha256Hex(root.caseDigest, `${path}.caseDigest`);
  if (simulationCase.sha256 !== caseDigest) {
    throw new TypeError(`${path}.simulationCase must retain the exact case digest.`);
  }
  const sources = arrayOf(root.sources, `${path}.sources`).map((entry, index) =>
    source(entry, `${path}.sources[${index}]`)
  );
  rejectDuplicates(sources.map((entry) => entry.role), `${path}.sources roles`);
  sources.sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  if (
    !sources.some((entry) => entry.role === "model") ||
    !sources.some((entry) => entry.role === "scenario")
  ) {
    throw new TypeError(`${path}.sources must contain model and scenario.`);
  }
  return deepFreeze({
    schemaVersion: SIMULATION_CASE_QUALIFICATION_CAPTURE_SCHEMA,
    operation: SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
    trustedRunId: safeId(root.trustedRunId, `${path}.trustedRunId`),
    sealBasis: basis,
    mrtr: {
      decisionId: safeId(mrtrInput.decisionId, `${path}.mrtr.decisionId`),
      inputFingerprint: sha256Hex(
        mrtrInput.inputFingerprint,
        `${path}.mrtr.inputFingerprint`,
      ),
      approvalId: safeId(mrtrInput.approvalId, `${path}.mrtr.approvalId`),
      approvalFingerprint: sha256Hex(
        mrtrInput.approvalFingerprint,
        `${path}.mrtr.approvalFingerprint`,
      ),
      workItemId: safeId(mrtrInput.workItemId, `${path}.mrtr.workItemId`),
    },
    caseDigest,
    simulationCase,
    manifest: cas(root.manifest, `${path}.manifest`),
    sourceCapture: cas(root.sourceCapture, `${path}.sourceCapture`),
    sources,
    sealedAt: iso(root.sealedAt, `${path}.sealedAt`),
  });
}

export function canonicalModelicaSimulationCaseQualificationCaptureText(
  value: unknown,
): string {
  return deterministicJson(validateModelicaSimulationCaseQualificationCapture(value));
}

/** Reject replacement decoding: evidence bytes must be valid UTF-8 before JSON parse. */
export function decodeExactUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} is not valid UTF-8.`);
  }
}

function cas(value: unknown, path: string): ModelicaQualificationCasReference {
  const input = exactRecord(value, ["uri", "byteCount", "sha256"], path);
  const sha256 = sha256Hex(input.sha256, `${path}.sha256`);
  const uri = canonicalResourceUri(input.uri, `${path}.uri`);
  if (!uri.endsWith(`/sha256/${sha256}`)) {
    throw new TypeError(`${path}.uri must end in its exact sha256.`);
  }
  if (!Number.isSafeInteger(input.byteCount) || Number(input.byteCount) < 0) {
    throw new TypeError(`${path}.byteCount must be a non-negative safe integer.`);
  }
  return deepFreeze({ uri, byteCount: Number(input.byteCount), sha256 });
}

function source(
  value: unknown,
  path: string,
): ModelicaSimulationCaseQualificationCapture["sources"][number] {
  const input = exactRecord(value, ["role", "mediaType", "resourceUri", "cas"], path);
  if (
    input.role !== "model" && input.role !== "scenario" &&
    input.role !== "parameter_schema"
  ) {
    throw new TypeError(`${path}.role is invalid.`);
  }
  const mediaType = nonEmptyText(input.mediaType, `${path}.mediaType`);
  if (mediaType !== (input.role === "model" ? "text/x-modelica" : "application/json")) {
    throw new TypeError(`${path}.mediaType is not permitted for ${input.role}.`);
  }
  return deepFreeze({
    role: input.role,
    mediaType,
    resourceUri: canonicalResourceUri(input.resourceUri, `${path}.resourceUri`),
    cas: cas(input.cas, `${path}.cas`),
  });
}

function snapshotRef(
  value: unknown,
  path: string,
): ModelicaSimulationCaseQualificationCapture["sealBasis"] {
  const input = exactRecord(value, ["snapshotId", "revision", "subjectId"], path);
  return deepFreeze({
    snapshotId: safeId(input.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(input.revision, `${path}.revision`),
    subjectId: safeId(input.subjectId, `${path}.subjectId`),
  });
}

function iso(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  try {
    if (new Date(text).toISOString() !== text) {
      throw new TypeError(`${path} must be canonical ISO-8601 UTC.`);
    }
  } catch {
    throw new TypeError(`${path} must be canonical ISO-8601 UTC.`);
  }
  return text;
}
