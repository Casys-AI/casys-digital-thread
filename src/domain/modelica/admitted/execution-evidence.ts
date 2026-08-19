/**
 * Documentary capture for one admitted Modelica isolated run.
 * Source bytes never enter this document.
 */

import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionReceiptRecord,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  type ModelicaAdmittedRunAdmission,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  validateModelicaAdmittedRunAdmission,
} from "./run-proposal.ts";
import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../kernel/case-validation.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { sha256Hex } from "../../compile/source/provider-resource-reader.ts";

export const MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA =
  "modelica-admitted-execution-capture/1.0" as const;

export interface ModelicaAdmittedExecutionCapture {
  readonly schemaVersion: typeof MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA;
  readonly operation: typeof SIMULATE_RUN_ADMITTED_MODELICA_OPERATION;
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly sourceSha256: string;
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly temperatureFinal: { readonly value: number; readonly unit: "degC" };
}

export async function deriveAdmittedModelicaExecutionRunId(
  projectIdValue: unknown,
  agentRunIdValue: unknown,
): Promise<string> {
  const projectId = safeId(projectIdValue, "$executionRunId.projectId");
  const agentRunId = safeId(agentRunIdValue, "$executionRunId.agentRunId");
  const fingerprint = await sha256Fingerprint({
    projectId,
    agentRunId,
    operation: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  });
  return `admitted-modelica-${fingerprint.digest}`;
}

export async function createModelicaAdmittedExecutionCapture(input: {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly sourceSha256: string;
  readonly receipt: IsolatedCodeExecutionReceipt;
  readonly temperatureFinal: { readonly value: number; readonly unit: "degC" };
}): Promise<ModelicaAdmittedExecutionCapture> {
  return validateModelicaAdmittedExecutionCapture({
    schemaVersion: MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA,
    operation: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    executionRunId: input.executionRunId,
    admission: input.admission,
    sourceSha256: input.sourceSha256,
    receipt: isolatedCodeExecutionReceiptRecord(input.receipt),
    temperatureFinal: input.temperatureFinal,
  });
}

export async function validateModelicaAdmittedExecutionCapture(
  value: unknown,
  path = "$admittedModelicaCapture",
): Promise<ModelicaAdmittedExecutionCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "projectId",
    "agentRunId",
    "executionRunId",
    "admission",
    "sourceSha256",
    "receipt",
    "temperatureFinal",
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version,
    `${path}.operation.version`,
  );
  const temperature = exactRecord(
    root.temperatureFinal,
    ["value", "unit"],
    `${path}.temperatureFinal`,
  );
  literalValue(temperature.unit, "degC", `${path}.temperatureFinal.unit`);
  return deepFreeze({
    schemaVersion: MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA,
    operation: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
    projectId: safeId(root.projectId, `${path}.projectId`),
    agentRunId: safeId(root.agentRunId, `${path}.agentRunId`),
    executionRunId: nonEmptyText(root.executionRunId, `${path}.executionRunId`),
    admission: validateModelicaAdmittedRunAdmission(
      root.admission,
      `${path}.admission`,
    ),
    sourceSha256: sha256Hex(root.sourceSha256, `${path}.sourceSha256`),
    receipt: await validateIsolatedCodeExecutionReceiptRecord(root.receipt),
    temperatureFinal: {
      value: finite(temperature.value, `${path}.temperatureFinal.value`),
      unit: "degC",
    },
  });
}
