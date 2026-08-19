/**
 * Output validator for one admitted Modelica closed-subset isolated run.
 *
 * The worker emits evidence.json plus result.csv. Source bytes never appear
 * here. Canonical-kit bundle hashes are not this contract.
 */

import { type IsolatedCodeOutputDeclaration } from "./isolated-code-execution.ts";
import { MODELICA_ADMITTED_OUTPUT_MANIFEST } from "./modelica-admitted-run-proposal.ts";
import {
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";

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
      !text.includes("temperatureC")
    ) {
      throw new TypeError(
        "The admitted Modelica result must be LF-terminated CSV with temperatureC.",
      );
    }
    return;
  }
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
    "resolvedParameters",
    "metrics",
    "result",
    "warnings",
  ], "$admittedModelicaEvidence");
  literalValue(root.status, "succeeded", "$admittedModelicaEvidence.status");
  if (
    typeof root.inputBundleSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(root.inputBundleSha256)
  ) {
    throw new TypeError("$admittedModelicaEvidence.inputBundleSha256 must be sha256.");
  }
  if (!Array.isArray(root.metrics) || root.metrics.length !== 1) {
    throw new TypeError(
      "$admittedModelicaEvidence.metrics must be the one ramp metric.",
    );
  }
  const metric = exactRecord(
    root.metrics[0],
    ["id", "value", "unit"],
    "$admittedModelicaEvidence.metrics[0]",
  );
  literalValue(
    metric.id,
    "temperature_final",
    "$admittedModelicaEvidence.metrics[0].id",
  );
  literalValue(metric.unit, "degC", "$admittedModelicaEvidence.metrics[0].unit");
  finite(metric.value, "$admittedModelicaEvidence.metrics[0].value");
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
  safeId(result.sha256, "$admittedModelicaEvidence.result.sha256");
  nonEmptyText(root.schemaVersion, "$admittedModelicaEvidence.schemaVersion");
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
