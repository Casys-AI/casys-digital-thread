/** Output validator for one generic admitted Modelica v2 isolated run. */

import { type IsolatedCodeOutputDeclaration } from "../../compile/isolation/isolated-code-execution.ts";
import {
  MODELICA_ADMITTED_OUTPUT_MANIFEST,
  MODELICA_ADMITTED_OUTPUT_VALIDATOR,
} from "./run-proposal.ts";
import {
  type ModelicaAdmittedExecutionEvidenceFacts,
  parseMetrics,
  parseParameters,
  parseScenario,
} from "./execution-evidence.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import { sha256Hex } from "../../compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";

export const MODELICA_ADMITTED_ISOLATED_EVIDENCE_SCHEMA =
  "modelica-isolated-evidence/2.0" as const;

export type AdmittedModelicaIsolatedEvidence =
  & ModelicaAdmittedExecutionEvidenceFacts
  & {
    readonly inputBundleSha256: string;
    readonly result: { readonly byteCount: number; readonly sha256: string };
  };

export function validateAdmittedModelicaIsolatedOutput(
  declaration: IsolatedCodeOutputDeclaration,
  bytes: Uint8Array,
): void {
  const expected = MODELICA_ADMITTED_OUTPUT_MANIFEST.find((entry) =>
    entry.role === declaration.role
  );
  if (!expected || deterministicJson(expected) !== deterministicJson(declaration)) {
    throw new TypeError("The admitted Modelica output declaration is not registered.");
  }
  if (declaration.role === "result") {
    const text = exactUtf8(bytes, "$admittedModelicaOutput.result");
    if (
      text.length === 0 || !text.endsWith("\n") || text.includes("\0") ||
      !text.slice(0, text.indexOf("\n")).includes(",")
    ) {
      throw new TypeError(
        "The admitted Modelica result must be a LF-terminated CSV with a header.",
      );
    }
    return;
  }
  parseAdmittedModelicaIsolatedEvidence(bytes);
}

export function parseAdmittedModelicaIsolatedEvidence(
  bytes: Uint8Array,
): AdmittedModelicaIsolatedEvidence {
  const text = exactUtf8(bytes, "$admittedModelicaOutput.evidence");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("The admitted Modelica evidence output is not JSON.");
  }
  const root = exactRecord(parsed, [
    "schemaVersion",
    "inputBundleSha256",
    "status",
    "method",
    "modelName",
    "scenario",
    "resolvedParameters",
    "metrics",
    "result",
    "warnings",
  ], "$admittedModelicaEvidence");
  literalValue(
    root.schemaVersion,
    MODELICA_ADMITTED_ISOLATED_EVIDENCE_SCHEMA,
    "$admittedModelicaEvidence.schemaVersion",
  );
  literalValue(root.status, "succeeded", "$admittedModelicaEvidence.status");
  if (
    typeof root.inputBundleSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(root.inputBundleSha256)
  ) {
    throw new TypeError("$admittedModelicaEvidence.inputBundleSha256 must be sha256.");
  }
  const method = exactRecord(
    root.method,
    ["lowering", "resultNormalizer", "engine"],
    "$admittedModelicaEvidence.method",
  );
  const resultNormalizer = exactRecord(
    method.resultNormalizer,
    ["id", "version"],
    "$admittedModelicaEvidence.method.resultNormalizer",
  );
  literalValue(
    resultNormalizer.id,
    MODELICA_ADMITTED_OUTPUT_VALIDATOR.id,
    "$admittedModelicaEvidence.method.resultNormalizer.id",
  );
  literalValue(
    resultNormalizer.version,
    MODELICA_ADMITTED_OUTPUT_VALIDATOR.version,
    "$admittedModelicaEvidence.method.resultNormalizer.version",
  );
  const lowering = exactRecord(
    method.lowering,
    ["id", "version"],
    "$admittedModelicaEvidence.method.lowering",
  );
  literalValue(
    lowering.id,
    "modelica-omc-lowering",
    "$admittedModelicaEvidence.method.lowering.id",
  );
  literalValue(
    lowering.version,
    "1.0.0",
    "$admittedModelicaEvidence.method.lowering.version",
  );
  const engine = exactRecord(
    method.engine,
    ["name", "version", "mslVersion"],
    "$admittedModelicaEvidence.method.engine",
  );
  literalValue(
    engine.name,
    "OpenModelica",
    "$admittedModelicaEvidence.method.engine.name",
  );
  literalValue(
    engine.mslVersion,
    "not-used",
    "$admittedModelicaEvidence.method.engine.mslVersion",
  );
  nonEmptyText(engine.version, "$admittedModelicaEvidence.method.engine.version");
  if (!Array.isArray(root.warnings) || root.warnings.length !== 0) {
    throw new TypeError("$admittedModelicaEvidence.warnings must be empty.");
  }
  const result = exactRecord(
    root.result,
    ["role", "basename", "byteCount", "sha256"],
    "$admittedModelicaEvidence.result",
  );
  literalValue(result.role, "result", "$admittedModelicaEvidence.result.role");
  literalValue(
    result.basename,
    "result.csv",
    "$admittedModelicaEvidence.result.basename",
  );
  return {
    modelName: safeId(root.modelName, "$admittedModelicaEvidence.modelName"),
    scenario: parseScenario(root.scenario, "$admittedModelicaEvidence.scenario"),
    parameters: parseParameters(
      root.resolvedParameters,
      "$admittedModelicaEvidence.resolvedParameters",
    ),
    metrics: parseMetrics(root.metrics, "$admittedModelicaEvidence.metrics"),
    inputBundleSha256: root.inputBundleSha256,
    result: {
      byteCount: positiveInteger(
        result.byteCount,
        "$admittedModelicaEvidence.result.byteCount",
      ),
      sha256: sha256Hex(
        result.sha256,
        "$admittedModelicaEvidence.result.sha256",
      ),
    },
  };
}

function exactUtf8(bytes: Uint8Array, path: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${path} is not UTF-8.`);
  }
  if (new TextEncoder().encode(text).byteLength !== bytes.byteLength) {
    throw new TypeError(`${path} is not canonical UTF-8.`);
  }
  return text;
}
