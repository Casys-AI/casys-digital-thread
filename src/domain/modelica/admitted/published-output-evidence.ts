/**
 * Pure published-output validation for one admitted Modelica isolated run.
 *
 * The adapter reopens receipt, evidence, and result bytes. This module attests
 * those values against the closed v2 evidence contract and builds the capture.
 * It has no path, CAS, or runner.
 */

import {
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
} from "../../compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import {
  admittedModelicaExecutionContractFromSourceBytes,
  assertAdmittedModelicaEvidenceMatchesContract,
  createModelicaAdmittedExecutionCapture,
  type ModelicaAdmittedExecutionCapture,
} from "./execution-evidence.ts";
import { parseAdmittedModelicaIsolatedEvidence } from "./isolated-output.ts";
import type { ModelicaAdmittedRunAdmission } from "./run-proposal.ts";

export interface AdmittedModelicaPublishedOutputEvidenceInput {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly sourceBytes: Uint8Array;
  readonly sourceSha256: string;
  readonly receipt: IsolatedCodeExecutionReceipt;
  readonly evidenceBytes: Uint8Array;
  readonly resultBytes: Uint8Array;
}

export async function buildAdmittedModelicaPublishedOutputCapture(
  input: AdmittedModelicaPublishedOutputEvidenceInput,
): Promise<ModelicaAdmittedExecutionCapture> {
  const record = isolatedCodeExecutionReceiptRecord(input.receipt);
  const outputs = new Map(record.outputs.map((output) => [output.role, output]));
  const evidenceOutput = outputs.get("evidence");
  const resultOutput = outputs.get("result");
  if (!evidenceOutput || !resultOutput || outputs.size !== 2) {
    throw new TypeError(
      "The admitted Modelica run must publish evidence.json and result.csv.",
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
      "The admitted Modelica published bytes differ from their journaled output hashes.",
    );
  }
  let evidence;
  try {
    evidence = parseAdmittedModelicaIsolatedEvidence(input.evidenceBytes);
  } catch {
    throw new TypeError(
      "The admitted Modelica evidence does not match the generic v2 evidence contract.",
    );
  }
  if (
    evidence.inputBundleSha256 !== input.sourceSha256 ||
    evidence.result.byteCount !== input.resultBytes.byteLength ||
    evidence.result.sha256 !== resultSha256
  ) {
    throw new TypeError(
      "The admitted Modelica v2 evidence does not attest the reopened source and exact result bytes.",
    );
  }
  let contract;
  try {
    contract = admittedModelicaExecutionContractFromSourceBytes(
      input.sourceBytes,
    );
    assertAdmittedModelicaEvidenceMatchesContract(evidence, contract);
  } catch {
    throw new TypeError(
      "The admitted Modelica evidence does not match the reopened source contract.",
    );
  }
  return await createModelicaAdmittedExecutionCapture({
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    executionRunId: input.executionRunId,
    admission: input.admission,
    sourceSha256: input.sourceSha256,
    receipt: input.receipt,
    evidence,
    contract,
  });
}
