import { assertEquals } from "@std/assert";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { isolatedOutputCasObjectStore } from "../../shared/cas/file-isolated-output-cas.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { admittedModelicaExecutionContractFromSourceBytes } from "../../../domain/modelica/admitted/execution-evidence.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { createAdmittedObservationEvidenceReader } from "../server-composition.ts";

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

Deno.test(
  "admitted observation evidence reopens FileIsolatedOutputCas nested objects",
  async () => {
    const recordedAnalysisDirectory = await Deno.makeTempDir({
      prefix: "admitted-observation-evidence-",
    });
    const casRoot = `${recordedAnalysisDirectory}/modelica/admitted/outputs`;
    try {
      const bytes = evidenceBytes();
      const fingerprint = {
        algorithm: "sha256" as const,
        digest: await fingerprintResourceBytes(bytes),
      };
      await isolatedOutputCasObjectStore(casRoot).save(fingerprint, bytes);
      assertEquals(
        await Deno.readFile(`${casRoot}/objects/${fingerprint.digest}`),
        bytes,
      );
      const casRootStore = new FileByteStore({
        kind: "isolated-output",
        directory: casRoot,
        uriNamespace: "isolated-output",
        label: "Isolated output",
      });
      assertEquals(await casRootStore.read(fingerprint), undefined);

      const reader = createAdmittedObservationEvidenceReader(
        recordedAnalysisDirectory,
      );
      const evidence = await reader.read(fingerprint);
      assertEquals(evidence?.modelName, "Oscillator");
      assertEquals(evidence?.outputs, [
        { name: "x", unit: "m" },
        { name: "v", unit: "m/s" },
      ]);
    } finally {
      await Deno.remove(recordedAnalysisDirectory, { recursive: true });
    }
  },
);

function evidenceBytes(): Uint8Array {
  const contract = admittedModelicaExecutionContractFromSourceBytes(
    new TextEncoder().encode(OSCILLATOR),
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
      {
        outputName: output.name,
        statistic: "final",
        value: 0,
        unit: output.unit,
      },
      {
        outputName: output.name,
        statistic: "max_abs",
        value: 0,
        unit: output.unit,
      },
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
