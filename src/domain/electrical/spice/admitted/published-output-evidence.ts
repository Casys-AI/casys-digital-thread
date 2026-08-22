/**
 * Pure published-output validation for one admitted SPICE isolated run.
 *
 * The adapter reopens receipt, evidence, and result bytes. This module attests
 * those values against the closed operating-point contracts and builds the
 * capture. It has no path, CAS, or runner. It does not derive power.
 */

import {
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
} from "../../../compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../compile/source/provider-resource-reader.ts";
import {
  createSpiceAdmittedExecutionCapture,
  type SpiceAdmittedExecutionCapture,
} from "./execution-evidence.ts";
import {
  parseSpiceIsolatedEvidence,
  parseSpiceOperatingPointResult,
} from "./isolated-output.ts";
import type { SpiceAdmittedRunAdmission } from "./run-proposal.ts";

export interface AdmittedSpicePublishedOutputEvidenceInput {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly admission: SpiceAdmittedRunAdmission;
  readonly sourceBytes: Uint8Array;
  readonly sourceSha256: string;
  readonly receipt: IsolatedCodeExecutionReceipt;
  readonly evidenceBytes: Uint8Array;
  readonly resultBytes: Uint8Array;
}

export async function buildAdmittedSpicePublishedOutputCapture(
  input: AdmittedSpicePublishedOutputEvidenceInput,
): Promise<SpiceAdmittedExecutionCapture> {
  const record = isolatedCodeExecutionReceiptRecord(input.receipt);
  const outputs = new Map(record.outputs.map((output) => [output.role, output]));
  const evidenceOutput = outputs.get("evidence");
  const resultOutput = outputs.get("result");
  if (!evidenceOutput || !resultOutput || outputs.size !== 2) {
    throw new TypeError(
      "The admitted SPICE run must publish evidence.json and result.json.",
    );
  }
  const [evidenceSha256, resultSha256] = await Promise.all([
    fingerprintResourceBytes(input.evidenceBytes),
    fingerprintResourceBytes(input.resultBytes),
  ]);
  if (
    evidenceSha256 !== evidenceOutput.sha256 ||
    resultSha256 !== resultOutput.sha256
  ) {
    throw new TypeError(
      "The admitted SPICE published bytes differ from their journaled output hashes.",
    );
  }
  let evidence;
  try {
    evidence = parseSpiceIsolatedEvidence(input.evidenceBytes);
  } catch {
    throw new TypeError(
      "The admitted SPICE evidence does not match spice-isolated-evidence/1.0.",
    );
  }
  if (
    evidence.inputSourceSha256 !== input.sourceSha256 ||
    evidence.result.byteCount !== input.resultBytes.byteLength ||
    evidence.result.sha256 !== resultSha256
  ) {
    throw new TypeError(
      "The admitted SPICE evidence does not attest the reopened source and exact result bytes.",
    );
  }
  let result;
  try {
    result = parseSpiceOperatingPointResult(input.resultBytes);
  } catch {
    throw new TypeError(
      "The admitted SPICE result does not match spice-operating-point-result/1.0.",
    );
  }
  if (result.observables.length !== evidence.counts.observableCount) {
    throw new TypeError(
      "The admitted SPICE result observables do not match evidence counts.",
    );
  }
  return await createSpiceAdmittedExecutionCapture({
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    executionRunId: input.executionRunId,
    admission: input.admission,
    sourceSha256: input.sourceSha256,
    receipt: input.receipt,
    result,
    evidence,
  });
}
