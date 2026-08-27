/** Documentary capture for one generic admitted Modelica v2 isolated run. */

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
import { authorizeModelicaClosedSubsetV2Source } from "../source/closed-subset-v2.ts";

export const MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA =
  "modelica-admitted-execution-capture/2.0" as const;

export interface ModelicaAdmittedScenario {
  readonly startTimeS: number;
  readonly stopTimeS: number;
  readonly intervalS: number;
  readonly tolerance: number;
  readonly numberOfIntervals: number;
  readonly solver: "dassl";
}

export interface ModelicaAdmittedParameterEvidence {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
}

export interface ModelicaAdmittedOutputContract {
  readonly name: string;
  readonly unit: string;
}

export interface ModelicaAdmittedMetricEvidence {
  readonly outputName: string;
  readonly statistic: "final" | "max_abs";
  readonly value: number;
  readonly unit: string;
}

export interface ModelicaAdmittedExecutionContract {
  readonly modelName: string;
  readonly scenario: ModelicaAdmittedScenario;
  readonly parameters: readonly ModelicaAdmittedParameterEvidence[];
  readonly outputs: readonly ModelicaAdmittedOutputContract[];
}

export interface ModelicaAdmittedExecutionEvidenceFacts
  extends Omit<ModelicaAdmittedExecutionContract, "outputs"> {
  readonly metrics: readonly ModelicaAdmittedMetricEvidence[];
}

export interface ModelicaAdmittedExecutionCapture
  extends ModelicaAdmittedExecutionEvidenceFacts {
  readonly schemaVersion: typeof MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA;
  readonly operation: typeof SIMULATE_RUN_ADMITTED_MODELICA_OPERATION;
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly sourceSha256: string;
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
}

export function admittedModelicaExecutionContractFromSourceBytes(
  bytes: Uint8Array,
): ModelicaAdmittedExecutionContract {
  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("The reopened admitted Modelica source is not UTF-8.");
  }
  if (new TextEncoder().encode(sourceText).byteLength !== bytes.byteLength) {
    throw new TypeError(
      "The reopened admitted Modelica source is not canonical UTF-8.",
    );
  }
  const authorized = authorizeModelicaClosedSubsetV2Source(sourceText);
  return deepFreeze({
    modelName: authorized.modelName,
    scenario: {
      ...authorized.scenario,
      solver: "dassl",
    },
    parameters: authorized.parameters.map((parameter) => ({
      name: parameter.name,
      value: parameter.defaultValue,
      unit: requiredAttributeText(parameter.attributes, "unit", parameter.name),
    })),
    outputs: authorized.outputs.map((output) => ({
      name: output.name,
      unit: requiredAttributeText(output.attributes, "unit", output.name),
    })),
  });
}

export function assertAdmittedModelicaEvidenceMatchesContract(
  evidence: ModelicaAdmittedExecutionEvidenceFacts,
  contract: ModelicaAdmittedExecutionContract,
): void {
  if (
    evidence.modelName !== contract.modelName ||
    JSON.stringify(evidence.scenario) !== JSON.stringify(contract.scenario) ||
    JSON.stringify(evidence.parameters) !== JSON.stringify(contract.parameters)
  ) {
    throw new TypeError(
      "The admitted Modelica evidence does not match the reopened model, scenario, or parameters.",
    );
  }
  const expected = contract.outputs.flatMap((output) =>
    [
      { outputName: output.name, statistic: "final", unit: output.unit },
      { outputName: output.name, statistic: "max_abs", unit: output.unit },
    ] as const
  );
  if (evidence.metrics.length !== expected.length) {
    throw new TypeError(
      "The admitted Modelica evidence metrics do not match declared outputs.",
    );
  }
  for (const [index, metric] of evidence.metrics.entries()) {
    const expectedMetric = expected[index]!;
    if (
      metric.outputName !== expectedMetric.outputName ||
      metric.statistic !== expectedMetric.statistic ||
      metric.unit !== expectedMetric.unit
    ) {
      throw new TypeError(
        "The admitted Modelica evidence metrics do not match declared outputs.",
      );
    }
  }
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
  readonly evidence: ModelicaAdmittedExecutionEvidenceFacts;
  readonly contract: ModelicaAdmittedExecutionContract;
}): Promise<ModelicaAdmittedExecutionCapture> {
  assertAdmittedModelicaEvidenceMatchesContract(input.evidence, input.contract);
  return await validateModelicaAdmittedExecutionCapture({
    schemaVersion: MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA,
    operation: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    executionRunId: input.executionRunId,
    admission: input.admission,
    sourceSha256: input.sourceSha256,
    receipt: isolatedCodeExecutionReceiptRecord(input.receipt),
    modelName: input.evidence.modelName,
    scenario: input.evidence.scenario,
    parameters: input.evidence.parameters,
    metrics: input.evidence.metrics,
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
    "modelName",
    "scenario",
    "parameters",
    "metrics",
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
  const projectId = safeId(root.projectId, `${path}.projectId`);
  const agentRunId = safeId(root.agentRunId, `${path}.agentRunId`);
  const executionRunId = nonEmptyText(root.executionRunId, `${path}.executionRunId`);
  const admission = validateModelicaAdmittedRunAdmission(
    root.admission,
    `${path}.admission`,
  );
  const sourceSha256 = sha256Hex(root.sourceSha256, `${path}.sourceSha256`);
  const receipt = await validateIsolatedCodeExecutionReceiptRecord(root.receipt);
  const modelName = safeId(root.modelName, `${path}.modelName`);
  const scenario = parseScenario(root.scenario, `${path}.scenario`);
  const parameters = parseParameters(root.parameters, `${path}.parameters`);
  const metrics = parseMetrics(root.metrics, `${path}.metrics`);
  if (executionRunId !== receipt.runId) {
    throw new TypeError(
      `${path}.executionRunId does not match the isolated receipt run.`,
    );
  }
  return deepFreeze({
    schemaVersion: MODELICA_ADMITTED_EXECUTION_CAPTURE_SCHEMA,
    operation: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
    projectId,
    agentRunId,
    executionRunId,
    admission,
    sourceSha256,
    receipt,
    modelName,
    scenario,
    parameters,
    metrics,
  });
}

export function parseScenario(value: unknown, path: string): ModelicaAdmittedScenario {
  const record = exactRecord(value, [
    "startTimeS",
    "stopTimeS",
    "intervalS",
    "tolerance",
    "numberOfIntervals",
    "solver",
  ], path);
  literalValue(record.solver, "dassl", `${path}.solver`);
  return deepFreeze({
    startTimeS: finite(record.startTimeS, `${path}.startTimeS`),
    stopTimeS: finite(record.stopTimeS, `${path}.stopTimeS`),
    intervalS: finite(record.intervalS, `${path}.intervalS`),
    tolerance: finite(record.tolerance, `${path}.tolerance`),
    numberOfIntervals: finite(record.numberOfIntervals, `${path}.numberOfIntervals`),
    solver: "dassl",
  });
}

export function parseParameters(
  value: unknown,
  path: string,
): readonly ModelicaAdmittedParameterEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty array.`);
  }
  return deepFreeze(value.map((item, index) => {
    const record = exactRecord(item, ["name", "value", "unit"], `${path}[${index}]`);
    return {
      name: safeId(record.name, `${path}[${index}].name`),
      value: finite(record.value, `${path}[${index}].value`),
      unit: nonEmptyText(record.unit, `${path}[${index}].unit`),
    };
  }));
}

export function parseMetrics(
  value: unknown,
  path: string,
): readonly ModelicaAdmittedMetricEvidence[] {
  if (!Array.isArray(value) || value.length === 0 || value.length % 2 !== 0) {
    throw new TypeError(`${path} must be a non-empty final/max_abs metric sequence.`);
  }
  return deepFreeze(value.map((item, index) => {
    const record = exactRecord(
      item,
      ["outputName", "statistic", "value", "unit"],
      `${path}[${index}]`,
    );
    if (record.statistic !== "final" && record.statistic !== "max_abs") {
      throw new TypeError(`${path}[${index}].statistic must be final or max_abs.`);
    }
    return {
      outputName: safeId(record.outputName, `${path}[${index}].outputName`),
      statistic: record.statistic,
      value: finite(record.value, `${path}[${index}].value`),
      unit: nonEmptyText(record.unit, `${path}[${index}].unit`),
    };
  }));
}

function requiredAttributeText(
  attributes: readonly { readonly name: string; readonly value: unknown }[],
  name: string,
  label: string,
): string {
  const matches = attributes.filter((attribute) => attribute.name === name);
  if (matches.length !== 1 || typeof matches[0]!.value !== "string") {
    throw new TypeError(`The authorized Modelica ${label} has no exact ${name}.`);
  }
  return matches[0]!.value;
}
