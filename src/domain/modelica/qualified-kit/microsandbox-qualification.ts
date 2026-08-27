/** Durable qualification evidence for the exact local Modelica profile. */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type IsolatedCodeExecutionReceiptRecord,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  MODELICA_ISOLATED_EXECUTION_PROFILE,
  type ModelicaIsolatedEvidence,
  type ModelicaIsolatedInputBundle,
  validateModelicaIsolatedEvidence,
  validateModelicaIsolatedInputBundle,
} from "./isolated-execution.ts";
import {
  fingerprintResourceBytes,
  sha256Hex,
} from "../../compile/source/provider-resource-reader.ts";

export const MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA =
  "modelica-microsandbox-qualification-reference/1.0" as const;
export const MODELICA_MICROSANDBOX_QUALIFICATION_CAPTURE_SCHEMA =
  "modelica-microsandbox-qualification-capture/1.0" as const;

const QUALIFICATION_URI_PREFIX = "casys://modelica-microsandbox-qualification/sha256/";

export interface ModelicaMicrosandboxQualificationReference {
  readonly schemaVersion: typeof MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA;
  readonly uri: string;
  /** Fingerprint of the complete qualification capture document. */
  readonly fingerprint: ContentFingerprint;
  /** Exact execution profile proven by that capture. */
  readonly executionProfileFingerprint: ContentFingerprint;
}

export interface ModelicaMicrosandboxQualificationBasis {
  readonly case: Readonly<Record<string, unknown>>;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly sourceCapture: Readonly<Record<string, unknown>>;
}

export interface ModelicaMicrosandboxQualificationCapture {
  readonly schemaVersion: typeof MODELICA_MICROSANDBOX_QUALIFICATION_CAPTURE_SCHEMA;
  readonly status: "qualified-live-smoke";
  readonly qualifiedAt: string;
  readonly executionProfileFingerprint: ContentFingerprint;
  readonly image: {
    readonly reference: string;
    readonly digest: ContentFingerprint;
  };
  readonly worker: {
    readonly wrapperSha256: string;
    readonly workerContractSha256: string;
    readonly denoLockSha256: string;
  };
  readonly basis: ModelicaMicrosandboxQualificationBasis;
  readonly bundle: {
    readonly document: ModelicaIsolatedInputBundle;
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  };
  readonly executionRunId: string;
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly evidence: ModelicaIsolatedEvidence;
}

export async function createModelicaMicrosandboxQualificationCapture(
  value: ModelicaMicrosandboxQualificationCapture,
): Promise<ModelicaMicrosandboxQualificationCapture> {
  return await validateModelicaMicrosandboxQualificationCapture(value);
}

export async function validateModelicaMicrosandboxQualificationCapture(
  value: unknown,
  path = "$modelicaMicrosandboxQualificationCapture",
): Promise<ModelicaMicrosandboxQualificationCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "status",
    "qualifiedAt",
    "executionProfileFingerprint",
    "image",
    "worker",
    "basis",
    "bundle",
    "executionRunId",
    "receipt",
    "evidence",
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_MICROSANDBOX_QUALIFICATION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.status, "qualified-live-smoke", `${path}.status`);
  const qualifiedAt = canonicalTimestamp(root.qualifiedAt, `${path}.qualifiedAt`);
  const executionProfileFingerprint = validateContentFingerprint(
    root.executionProfileFingerprint,
    `${path}.executionProfileFingerprint`,
  );
  const imageRoot = exactRecord(
    root.image,
    ["reference", "digest"],
    `${path}.image`,
  );
  const imageReference = nonEmptyCanonicalText(
    imageRoot.reference,
    `${path}.image.reference`,
  );
  const imageDigest = validateContentFingerprint(
    imageRoot.digest,
    `${path}.image.digest`,
  );
  if (!imageReference.endsWith(`@sha256:${imageDigest.digest}`)) {
    throw new TypeError(`${path}.image does not close its OCI digest.`);
  }
  const workerRoot = exactRecord(root.worker, [
    "wrapperSha256",
    "workerContractSha256",
    "denoLockSha256",
  ], `${path}.worker`);
  const worker = deepFreeze({
    wrapperSha256: sha256Hex(
      workerRoot.wrapperSha256,
      `${path}.worker.wrapperSha256`,
    ),
    workerContractSha256: sha256Hex(
      workerRoot.workerContractSha256,
      `${path}.worker.workerContractSha256`,
    ),
    denoLockSha256: sha256Hex(
      workerRoot.denoLockSha256,
      `${path}.worker.denoLockSha256`,
    ),
  });
  const basis = validateQualificationBasis(root.basis, `${path}.basis`);
  const bundleRoot = exactRecord(
    root.bundle,
    ["document", "fingerprint", "byteCount"],
    `${path}.bundle`,
  );
  const bundleDocument = await validateModelicaIsolatedInputBundle(
    bundleRoot.document,
  );
  const bundleFingerprint = validateContentFingerprint(
    bundleRoot.fingerprint,
    `${path}.bundle.fingerprint`,
  );
  const bundleBytes = new TextEncoder().encode(deterministicJson(bundleDocument));
  if (
    await fingerprintResourceBytes(bundleBytes) !== bundleFingerprint.digest ||
    bundleBytes.byteLength !==
      nonNegativeInteger(bundleRoot.byteCount, `${path}.bundle.byteCount`)
  ) throw new TypeError(`${path}.bundle does not close its canonical bytes.`);
  const [caseFingerprint, manifestFingerprint, sourceCaptureFingerprint] = await Promise
    .all([
      sha256Fingerprint(basis.case),
      sha256Fingerprint(basis.manifest),
      sha256Fingerprint(basis.sourceCapture),
    ]);
  if (
    bundleDocument.qualification.caseSha256 !== caseFingerprint.digest ||
    bundleDocument.qualification.manifestSha256 !== manifestFingerprint.digest ||
    bundleDocument.qualification.sourceCaptureSha256 !==
      sourceCaptureFingerprint.digest
  ) {
    throw new TypeError(`${path}.basis does not authorize the bundle hashes.`);
  }
  const executionRunId = safeId(root.executionRunId, `${path}.executionRunId`);
  const receipt = await validateIsolatedCodeExecutionReceiptRecord(root.receipt);
  const evidence = validateModelicaIsolatedEvidence(
    root.evidence,
    `${path}.evidence`,
  );
  const evidenceOutput = receipt.outputs.find((output) => output.role === "evidence");
  const resultOutput = receipt.outputs.find((output) => output.role === "result");
  const evidenceFingerprint = await sha256Fingerprint(evidence);
  if (
    receipt.runId !== executionRunId || receipt.producerGeneration !== 0 ||
    receipt.profile.id !== MODELICA_ISOLATED_EXECUTION_PROFILE.id ||
    receipt.profile.version !== MODELICA_ISOLATED_EXECUTION_PROFILE.version ||
    receipt.sourceSha256 !== bundleFingerprint.digest ||
    receipt.runtime.imageDigest.digest !== imageDigest.digest ||
    receipt.termination.kind !== "exited" || receipt.termination.exitCode !== 0 ||
    receipt.destruction.status !== "proven" ||
    evidence.inputBundleSha256 !== bundleFingerprint.digest ||
    !evidenceOutput || !resultOutput || receipt.outputs.length !== 2 ||
    evidenceOutput.sha256 !== evidenceFingerprint.digest ||
    evidenceOutput.byteCount !==
      new TextEncoder().encode(deterministicJson(evidence)).byteLength ||
    resultOutput.sha256 !== evidence.result.sha256 ||
    resultOutput.byteCount !== evidence.result.byteCount ||
    resultOutput.basename !== evidence.result.basename
  ) {
    throw new TypeError(`${path} does not close its run, cleanup and outputs.`);
  }
  return deepFreeze({
    schemaVersion: MODELICA_MICROSANDBOX_QUALIFICATION_CAPTURE_SCHEMA,
    status: "qualified-live-smoke",
    qualifiedAt,
    executionProfileFingerprint,
    image: { reference: imageReference, digest: imageDigest },
    worker,
    basis,
    bundle: {
      document: bundleDocument,
      fingerprint: bundleFingerprint,
      byteCount: bundleBytes.byteLength,
    },
    executionRunId,
    receipt,
    evidence,
  });
}

export function validateModelicaMicrosandboxQualificationReference(
  value: unknown,
  expectedExecutionProfileFingerprint?: ContentFingerprint,
  path = "$modelicaMicrosandboxQualification",
): ModelicaMicrosandboxQualificationReference {
  const root = exactRecord(value, [
    "schemaVersion",
    "uri",
    "fingerprint",
    "executionProfileFingerprint",
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    `${path}.fingerprint`,
  );
  const executionProfileFingerprint = validateContentFingerprint(
    root.executionProfileFingerprint,
    `${path}.executionProfileFingerprint`,
  );
  if (
    typeof root.uri !== "string" ||
    root.uri !== `${QUALIFICATION_URI_PREFIX}${fingerprint.digest}`
  ) {
    throw new TypeError(`${path}.uri does not name the exact qualification capture.`);
  }
  if (
    expectedExecutionProfileFingerprint &&
    !fingerprintsEqual(
      executionProfileFingerprint,
      validateContentFingerprint(
        expectedExecutionProfileFingerprint,
        `${path}.expectedExecutionProfileFingerprint`,
      ),
    )
  ) {
    throw new TypeError(`${path} qualifies another execution profile.`);
  }
  return Object.freeze({
    schemaVersion: MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
    uri: root.uri,
    fingerprint,
    executionProfileFingerprint,
  });
}

function validateQualificationBasis(
  value: unknown,
  path: string,
): ModelicaMicrosandboxQualificationBasis {
  const root = exactRecord(value, ["case", "manifest", "sourceCapture"], path);
  return deepFreeze({
    case: canonicalDocument(root.case, `${path}.case`),
    manifest: canonicalDocument(root.manifest, `${path}.manifest`),
    sourceCapture: canonicalDocument(root.sourceCapture, `${path}.sourceCapture`),
  });
}

function canonicalDocument(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a JSON object.`);
  }
  const text = deterministicJson(value);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${path} must be a JSON object.`);
  }
  return deepFreeze(parsed as Record<string, unknown>);
}

function canonicalTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new TypeError(`${path} must be a canonical UTC timestamp.`);
  }
  return value;
}

function nonEmptyCanonicalText(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0")
  ) throw new TypeError(`${path} must be canonical non-empty text.`);
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return value as number;
}
