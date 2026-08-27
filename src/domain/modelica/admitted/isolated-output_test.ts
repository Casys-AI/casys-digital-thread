import { assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  admittedModelicaExecutionContractFromSourceBytes,
  assertAdmittedModelicaEvidenceMatchesContract,
} from "./execution-evidence.ts";
import { parseAdmittedModelicaIsolatedEvidence } from "./isolated-output.ts";

const OSCILLATOR = `model Oscillator
  parameter Real x0(unit = "m") = 0;
  parameter Real drive(unit = "m/s2") = 2;
  output Real x(unit = "m", start = x0, fixed = true);
  output Real v(unit = "m/s", start = 0, fixed = true);
equation
  der(x) = v;
  der(v) = drive-x;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end Oscillator;
`;

const SINGLE_OUTPUT = `model PositionOnly
  parameter Real rate(unit = "m/s") = 2;
  output Real position(unit = "m", start = 0, fixed = true);
equation
  der(position) = rate;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end PositionOnly;
`;

function evidence(source: string): Uint8Array {
  const contract = admittedModelicaExecutionContractFromSourceBytes(
    new TextEncoder().encode(source),
  );
  return new TextEncoder().encode(deterministicJson({
    schemaVersion: "modelica-isolated-evidence/2.0",
    inputBundleSha256: "a".repeat(64),
    status: "succeeded",
    method: {
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      resultNormalizer: {
        id: "modelica-closed-subset-v2-result-normalizer",
        version: "2.0.0",
      },
      engine: { name: "OpenModelica", version: "1.25.0", mslVersion: "not-used" },
    },
    modelName: contract.modelName,
    scenario: contract.scenario,
    resolvedParameters: contract.parameters,
    metrics: contract.outputs.flatMap((output) => [
      { outputName: output.name, statistic: "final", value: 0, unit: output.unit },
      { outputName: output.name, statistic: "max_abs", value: 0, unit: output.unit },
    ]),
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: 12,
      sha256: "b".repeat(64),
    },
    warnings: [],
  }));
}

Deno.test("admitted Modelica evidence accepts two models with ordered outputs of different quantities", () => {
  for (const source of [OSCILLATOR, SINGLE_OUTPUT]) {
    const contract = admittedModelicaExecutionContractFromSourceBytes(
      new TextEncoder().encode(source),
    );
    const parsed = parseAdmittedModelicaIsolatedEvidence(evidence(source));
    assertAdmittedModelicaEvidenceMatchesContract(parsed, contract);
    assertEquals(parsed.metrics.length, contract.outputs.length * 2);
  }
});

Deno.test("admitted Modelica evidence rejects missing, extra, and wrong-unit output metrics", () => {
  const contract = admittedModelicaExecutionContractFromSourceBytes(
    new TextEncoder().encode(OSCILLATOR),
  );
  const base = JSON.parse(new TextDecoder().decode(evidence(OSCILLATOR)));
  for (
    const mutate of [
      (value: { metrics: unknown[] }) => value.metrics.pop(),
      (value: { metrics: unknown[] }) => value.metrics.push(value.metrics[0]),
      (value: { metrics: Array<{ unit: string }> }) => value.metrics[0]!.unit = "wrong",
    ]
  ) {
    const value = structuredClone(base);
    mutate(value);
    assertThrows(
      () => {
        const parsed = parseAdmittedModelicaIsolatedEvidence(
          new TextEncoder().encode(deterministicJson(value)),
        );
        assertAdmittedModelicaEvidenceMatchesContract(parsed, contract);
      },
      TypeError,
    );
  }
});
