/** Durable document evidence for the closed local qualified-kit operation. */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type IsolatedCodeExecutionReceiptRecord,
  type IsolatedOutputProducerGenerationAdvance,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedOutputProducerGenerationAdvance,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  type ModelicaIsolatedEvidence,
  validateModelicaIsolatedEvidence,
} from "./isolated-execution.ts";
import {
  type ModelicaMicrosandboxQualificationReference,
  validateModelicaMicrosandboxQualificationReference,
} from "./microsandbox-qualification.ts";

export const MODELICA_QUALIFIED_KIT_EXECUTION_CAPTURE_SCHEMA =
  "modelica-qualified-kit-execution-capture/1.0" as const;

export interface ModelicaIsolatedExecutionCapture {
  readonly schemaVersion: typeof MODELICA_QUALIFIED_KIT_EXECUTION_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: "simulate.run-qualified-modelica-kit";
    readonly version: "1";
  };
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  /** Exact MRTR-sealed project-run input; this local operation has no ROP2 plan. */
  readonly reviewedRunFingerprint: ContentFingerprint;
  readonly bundle: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
    readonly caseSha256: string;
    readonly manifestSha256: string;
    readonly sourceCaptureSha256: string;
  };
  readonly executionProfileFingerprint: ContentFingerprint;
  readonly runtimeQualification: ModelicaMicrosandboxQualificationReference;
  readonly generationRecovery: {
    readonly generationZeroDestruction: Extract<
      IsolatedCodeExecutionReceiptRecord["destruction"],
      { readonly status: "proven" }
    >;
    readonly advance: IsolatedOutputProducerGenerationAdvance;
  } | null;
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly evidence: ModelicaIsolatedEvidence;
}

export async function createModelicaIsolatedExecutionCapture(
  value: ModelicaIsolatedExecutionCapture,
): Promise<ModelicaIsolatedExecutionCapture> {
  return await validateModelicaIsolatedExecutionCapture(value);
}

export async function validateModelicaIsolatedExecutionCapture(
  value: unknown,
  path = "$modelicaExecutionCapture",
): Promise<ModelicaIsolatedExecutionCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "projectId",
    "agentRunId",
    "executionRunId",
    "reviewedRunFingerprint",
    "bundle",
    "executionProfileFingerprint",
    "runtimeQualification",
    "generationRecovery",
    "receipt",
    "evidence",
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_QUALIFIED_KIT_EXECUTION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    `${path}.operation`,
  );
  literalValue(
    operation.id,
    "simulate.run-qualified-modelica-kit",
    `${path}.operation.id`,
  );
  literalValue(operation.version, "1", `${path}.operation.version`);
  const executionRunId = safeId(root.executionRunId, `${path}.executionRunId`);
  const bundle = exactRecord(root.bundle, [
    "fingerprint",
    "byteCount",
    "caseSha256",
    "manifestSha256",
    "sourceCaptureSha256",
  ], `${path}.bundle`);
  const bundleFingerprint = validateContentFingerprint(
    bundle.fingerprint,
    `${path}.bundle.fingerprint`,
  );
  const receipt = await validateIsolatedCodeExecutionReceiptRecord(root.receipt);
  const generationRecovery = await validateGenerationRecovery(
    root.generationRecovery,
    executionRunId,
    receipt.producerGeneration,
  );
  const evidence = validateModelicaIsolatedEvidence(
    root.evidence,
    `${path}.evidence`,
  );
  const result = receipt.outputs.find((output) => output.role === "result");
  const evidenceOutput = receipt.outputs.find((output) => output.role === "evidence");
  const evidenceFingerprint = await sha256Fingerprint(evidence);
  if (
    receipt.runId !== executionRunId ||
    receipt.sourceSha256 !== bundleFingerprint.digest ||
    evidence.inputBundleSha256 !== bundleFingerprint.digest ||
    !result || !evidenceOutput || receipt.outputs.length !== 2 ||
    result.basename !== evidence.result.basename ||
    result.byteCount !== evidence.result.byteCount ||
    result.sha256 !== evidence.result.sha256 ||
    evidenceOutput.sha256 !== evidenceFingerprint.digest ||
    evidenceOutput.byteCount !==
      new TextEncoder().encode(deterministicJson(evidence)).byteLength
  ) {
    throw new TypeError(`${path} does not close its bundle, receipt and outputs.`);
  }
  const executionProfileFingerprint = validateContentFingerprint(
    root.executionProfileFingerprint,
    `${path}.executionProfileFingerprint`,
  );
  return deepFreeze({
    schemaVersion: MODELICA_QUALIFIED_KIT_EXECUTION_CAPTURE_SCHEMA,
    operation: {
      id: "simulate.run-qualified-modelica-kit",
      version: "1",
    },
    projectId: safeId(root.projectId, `${path}.projectId`),
    agentRunId: safeId(root.agentRunId, `${path}.agentRunId`),
    executionRunId,
    reviewedRunFingerprint: validateContentFingerprint(
      root.reviewedRunFingerprint,
      `${path}.reviewedRunFingerprint`,
    ),
    bundle: {
      fingerprint: bundleFingerprint,
      byteCount: nonNegative(bundle.byteCount, `${path}.bundle.byteCount`),
      caseSha256: digest(bundle.caseSha256, `${path}.bundle.caseSha256`),
      manifestSha256: digest(
        bundle.manifestSha256,
        `${path}.bundle.manifestSha256`,
      ),
      sourceCaptureSha256: digest(
        bundle.sourceCaptureSha256,
        `${path}.bundle.sourceCaptureSha256`,
      ),
    },
    executionProfileFingerprint,
    runtimeQualification: validateModelicaMicrosandboxQualificationReference(
      root.runtimeQualification,
      executionProfileFingerprint,
      `${path}.runtimeQualification`,
    ),
    generationRecovery,
    receipt,
    evidence,
  });
}

async function validateGenerationRecovery(
  value: unknown,
  executionRunId: string,
  producerGeneration: 0 | 1,
): Promise<ModelicaIsolatedExecutionCapture["generationRecovery"]> {
  if (producerGeneration === 0) {
    literalValue(value, null, "$modelicaExecutionCapture.generationRecovery");
    return null;
  }
  const root = exactRecord(
    value,
    ["generationZeroDestruction", "advance"],
    "$modelicaExecutionCapture.generationRecovery",
  );
  const destruction = exactRecord(
    root.generationZeroDestruction,
    ["status", "runId", "proofFingerprint"],
    "$modelicaExecutionCapture.generationRecovery.generationZeroDestruction",
  );
  literalValue(
    destruction.status,
    "proven",
    "$modelicaExecutionCapture.generationRecovery.generationZeroDestruction.status",
  );
  literalValue(
    destruction.runId,
    executionRunId,
    "$modelicaExecutionCapture.generationRecovery.generationZeroDestruction.runId",
  );
  return deepFreeze({
    generationZeroDestruction: {
      status: "proven",
      runId: executionRunId,
      proofFingerprint: validateContentFingerprint(
        destruction.proofFingerprint,
        "$modelicaExecutionCapture.generationRecovery.generationZeroDestruction.proofFingerprint",
      ),
    },
    advance: await validateIsolatedOutputProducerGenerationAdvance(
      root.advance,
      executionRunId,
    ),
  });
}

export async function fingerprintModelicaIsolatedExecutionCapture(
  capture: ModelicaIsolatedExecutionCapture,
): Promise<ContentFingerprint> {
  const validated = await validateModelicaIsolatedExecutionCapture(capture);
  return await sha256Fingerprint(validated);
}

function digest(value: unknown, path: string): string {
  const fingerprint = validateContentFingerprint({
    algorithm: "sha256",
    digest: value,
  }, path);
  return fingerprint.digest;
}

function nonNegative(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}
