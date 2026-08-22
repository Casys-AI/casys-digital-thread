/** Documentary capture for one generic admitted SPICE operating-point isolated run. */

import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionReceiptRecord,
} from "../../../compile/isolation/isolated-code-execution.ts";
import {
  SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  type SpiceAdmittedRunAdmission,
  validateSpiceAdmittedRunAdmission,
} from "./run-proposal.ts";
import {
  parseSpiceIsolatedEvidence,
  parseSpiceOperatingPointResult,
  type SpiceIsolatedEvidence,
  type SpiceOperatingPointObservable,
  type SpiceOperatingPointResult,
} from "./isolated-output.ts";
import {
  SPICE_ADMITTED_MAX_DURATION_MS,
  SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
  SPICE_ADMITTED_MAX_OBSERVABLES,
  SPICE_ADMITTED_MAX_RESULT_BYTES,
  SPICE_ADMITTED_MAX_SOURCE_BYTES,
  SPICE_ADMITTED_MAX_VECTOR_BYTES,
  SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
  SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
  SPICE_ISOLATED_EVIDENCE_SCHEMA,
  SPICE_OPERATING_POINT_ANALYSIS_KIND,
  SPICE_OPERATING_POINT_ENGINE_NAME,
  SPICE_OPERATING_POINT_EXPORT,
  SPICE_OPERATING_POINT_RESULT_SCHEMA,
  SPICE_OPERATING_POINT_SIGN_CONVENTION,
  SPICE_OPERATING_POINT_WRAPPER,
} from "./contract.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../kernel/deterministic-json.ts";
import { sha256Hex } from "../../../compile/source/provider-resource-reader.ts";

export const SPICE_ADMITTED_EXECUTION_CAPTURE_SCHEMA =
  "spice-admitted-execution-capture/1.0" as const;

export interface SpiceAdmittedExecutionCapture {
  readonly schemaVersion: typeof SPICE_ADMITTED_EXECUTION_CAPTURE_SCHEMA;
  readonly operation: typeof SIMULATE_RUN_ADMITTED_SPICE_OPERATION;
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly admission: SpiceAdmittedRunAdmission;
  readonly sourceSha256: string;
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly analysisKind: typeof SPICE_OPERATING_POINT_ANALYSIS_KIND;
  readonly engine: { readonly name: "ngspice"; readonly version: string };
  readonly observables: readonly SpiceOperatingPointObservable[];
  readonly counts: SpiceIsolatedEvidence["counts"];
  readonly limitations: typeof SPICE_ISOLATED_EVIDENCE_LIMITATIONS;
}

export async function deriveAdmittedSpiceExecutionRunId(
  projectIdValue: unknown,
  agentRunIdValue: unknown,
): Promise<string> {
  const projectId = safeId(projectIdValue, "$executionRunId.projectId");
  const agentRunId = safeId(agentRunIdValue, "$executionRunId.agentRunId");
  const fingerprint = await sha256Fingerprint({
    projectId,
    agentRunId,
    operation: SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  });
  return `admitted-spice-${fingerprint.digest}`;
}

export async function createSpiceAdmittedExecutionCapture(input: {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly admission: SpiceAdmittedRunAdmission;
  readonly sourceSha256: string;
  readonly receipt: IsolatedCodeExecutionReceipt;
  readonly result: SpiceOperatingPointResult;
  readonly evidence: SpiceIsolatedEvidence;
}): Promise<SpiceAdmittedExecutionCapture> {
  return await validateSpiceAdmittedExecutionCapture({
    schemaVersion: SPICE_ADMITTED_EXECUTION_CAPTURE_SCHEMA,
    operation: SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    executionRunId: input.executionRunId,
    admission: input.admission,
    sourceSha256: input.sourceSha256,
    receipt: isolatedCodeExecutionReceiptRecord(input.receipt),
    analysisKind: SPICE_OPERATING_POINT_ANALYSIS_KIND,
    engine: input.evidence.method.engine,
    observables: input.result.observables,
    counts: input.evidence.counts,
    limitations: SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
  });
}

export async function validateSpiceAdmittedExecutionCapture(
  value: unknown,
  path = "$admittedSpiceCapture",
): Promise<SpiceAdmittedExecutionCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "projectId",
    "agentRunId",
    "executionRunId",
    "admission",
    "sourceSha256",
    "receipt",
    "analysisKind",
    "engine",
    "observables",
    "counts",
    "limitations",
  ], path);
  literalValue(
    root.schemaVersion,
    SPICE_ADMITTED_EXECUTION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version,
    `${path}.operation.version`,
  );
  const projectId = safeId(root.projectId, `${path}.projectId`);
  const agentRunId = safeId(root.agentRunId, `${path}.agentRunId`);
  const executionRunId = nonEmptyText(root.executionRunId, `${path}.executionRunId`);
  const admission = validateSpiceAdmittedRunAdmission(
    root.admission,
    `${path}.admission`,
  );
  const sourceSha256 = sha256Hex(root.sourceSha256, `${path}.sourceSha256`);
  const receipt = await validateIsolatedCodeExecutionReceiptRecord(root.receipt);
  literalValue(
    root.analysisKind,
    SPICE_OPERATING_POINT_ANALYSIS_KIND,
    `${path}.analysisKind`,
  );
  const engine = exactRecord(root.engine, ["name", "version"], `${path}.engine`);
  literalValue(
    engine.name,
    SPICE_OPERATING_POINT_ENGINE_NAME,
    `${path}.engine.name`,
  );
  const engineVersion = nonEmptyText(engine.version, `${path}.engine.version`);
  if (!/^[0-9]{1,8}$/.test(engineVersion)) {
    throw new TypeError(`${path}.engine.version must be the ngspice major version.`);
  }
  if (executionRunId !== receipt.runId) {
    throw new TypeError(
      `${path}.executionRunId does not match the isolated receipt run.`,
    );
  }
  const resultOutput = receipt.outputs.find((output) => output.role === "result");
  if (!resultOutput) {
    throw new TypeError(`${path}.receipt must publish a result output.`);
  }
  const result = parseSpiceOperatingPointResult(
    new TextEncoder().encode(deterministicJson({
      schemaVersion: SPICE_OPERATING_POINT_RESULT_SCHEMA,
      analysisKind: SPICE_OPERATING_POINT_ANALYSIS_KIND,
      signConvention: SPICE_OPERATING_POINT_SIGN_CONVENTION,
      observables: root.observables,
    })),
  );
  const evidence = parseSpiceIsolatedEvidence(
    new TextEncoder().encode(deterministicJson({
      schemaVersion: SPICE_ISOLATED_EVIDENCE_SCHEMA,
      status: "succeeded",
      analysisKind: SPICE_OPERATING_POINT_ANALYSIS_KIND,
      inputSourceSha256: sourceSha256,
      profile: SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
      wrapper: SPICE_OPERATING_POINT_WRAPPER,
      method: {
        engine: { name: SPICE_OPERATING_POINT_ENGINE_NAME, version: engineVersion },
        export: SPICE_OPERATING_POINT_EXPORT,
      },
      counts: root.counts,
      limits: {
        maxSourceBytes: SPICE_ADMITTED_MAX_SOURCE_BYTES,
        maxObservables: SPICE_ADMITTED_MAX_OBSERVABLES,
        maxResultBytes: SPICE_ADMITTED_MAX_RESULT_BYTES,
        maxEvidenceBytes: SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
        maxVectorBytes: SPICE_ADMITTED_MAX_VECTOR_BYTES,
        maxDurationMs: SPICE_ADMITTED_MAX_DURATION_MS,
      },
      limitations: root.limitations,
      warnings: [],
      result: {
        role: "result",
        basename: "result.json",
        byteCount: resultOutput.byteCount,
        sha256: resultOutput.sha256,
      },
    })),
  );
  if (result.observables.length !== evidence.counts.observableCount) {
    throw new TypeError(
      `${path}.observables length does not match evidence counts.`,
    );
  }
  return deepFreeze({
    schemaVersion: SPICE_ADMITTED_EXECUTION_CAPTURE_SCHEMA,
    operation: SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
    projectId,
    agentRunId,
    executionRunId,
    admission,
    sourceSha256,
    receipt,
    analysisKind: SPICE_OPERATING_POINT_ANALYSIS_KIND,
    engine: { name: SPICE_OPERATING_POINT_ENGINE_NAME, version: engineVersion },
    observables: result.observables,
    counts: evidence.counts,
    limitations: SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
  });
}
