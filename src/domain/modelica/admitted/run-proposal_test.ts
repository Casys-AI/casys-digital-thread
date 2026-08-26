import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  encodeModelicaAdmittedRunAdmissionParameters,
  MODELICA_ADMITTED_COMPILATION_PROFILE_ID,
  MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  MODELICA_ADMITTED_EXECUTION_PROFILE,
  MODELICA_ADMITTED_RUN_ADMISSION_SCHEMA,
  parseModelicaAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  validateModelicaAdmittedRunAdmission,
} from "./run-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../compile/isolation/local-isolation-runtime.ts";

function fingerprint(character: string) {
  return { algorithm: "sha256", digest: character.repeat(64) } as const;
}

function admission(): Record<string, unknown> {
  const artifactFingerprint = fingerprint("a");
  return {
    schemaVersion: MODELICA_ADMITTED_RUN_ADMISSION_SCHEMA,
    admissionArtifact: {
      schemaVersion: MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
      id: `technical-compilation-admission-${artifactFingerprint.digest}`,
      fingerprint: artifactFingerprint,
    },
    compilation: {
      document: {
        schemaVersion: "technical-compilation/2.0",
        fingerprint: fingerprint("b"),
        status: "ready-for-review",
      },
      projection: {
        target: "modelica-source-qualification",
        fingerprint: fingerprint("c"),
        status: "ready-for-review",
      },
      source: {
        id: "source.generic-oscillator",
        sourceFingerprint: fingerprint("d"),
        captureFingerprint: fingerprint("e"),
        analysisFingerprint: fingerprint("f"),
      },
      profile: {
        id: MODELICA_ADMITTED_COMPILATION_PROFILE_ID,
        version: "2.0.0",
        fingerprint: fingerprint("1"),
      },
    },
    execution: {
      profile: {
        ...MODELICA_ADMITTED_EXECUTION_PROFILE,
        fingerprint: fingerprint("2"),
      },
      isolationPolicy: {
        id: "isolation.modelica-deny-net",
        version: "2.0.0",
        fingerprint: fingerprint("3"),
      },
      runtimeBackend: {
        ...MICROSANDBOX_LOCAL_RUNTIME_REF,
        imageReference: `casys/modelica-microsandbox-worker@sha256:${"4".repeat(64)}`,
        imageDigest: fingerprint("4"),
      },
      runtime: {
        imageDigest: fingerprint("4"),
        isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
        limits: {
          maxWallTimeMs: 30_000,
          maxCpuTimeMs: 20_000,
          maxMemoryBytes: 512_000_000,
          maxProcesses: 8,
          maxStdoutBytes: 65_536,
          maxStderrBytes: 65_536,
          maxOutputFileBytes: 1_048_576,
          maxOutputTotalBytes: 2_097_152,
        },
        limitAssurance: {
          maxWallTimeMs: "backend-attested",
          maxCpuTimeMs: "backend-attested",
          maxMemoryBytes: "backend-attested",
          maxProcesses: "backend-attested",
          maxStdoutBytes: "broker-observed-cap",
          maxStderrBytes: "broker-observed-cap",
          maxOutputFileBytes: "broker-observed-cap",
          maxOutputTotalBytes: "broker-observed-cap",
        },
      },
      outputValidator: {
        id: "modelica-closed-subset-v2-result-normalizer",
        version: "2.0.0",
      },
      outputs: [
        {
          role: "evidence",
          basename: "evidence.json",
          mediaType: "application/json",
          format: "modelica-isolated-evidence-v2",
        },
        {
          role: "result",
          basename: "result.csv",
          mediaType: "text/csv",
          format: "openmodelica-result-csv",
        },
      ],
      minimumDestructionAssurance: "acknowledged-unattested",
    },
    status: "ready-for-execution-review",
  };
}

Deno.test("admitted Modelica MRTR round-trips and never carries source text", () => {
  const encoded = encodeModelicaAdmittedRunAdmissionParameters(admission());
  assertEquals(encoded.length, 60);
  assertEquals(
    encoded.find((parameter) => parameter.key.endsWith(".operation"))?.value,
    `${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id}@${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version}`,
  );
  for (const parameter of encoded) {
    assertEquals(
      String(parameter.value).includes("model "),
      false,
    );
    assertEquals(parameter.key.includes("modelicaText"), false);
  }
  const parsed = parseModelicaAdmittedRunAdmissionParameters(encoded);
  assertEquals(
    encodeModelicaAdmittedRunAdmissionParameters(parsed),
    encoded,
  );
});

Deno.test("admitted Modelica MRTR refuses a Build123d projection target", () => {
  const value = admission();
  (value.compilation as { projection: { target: string } }).projection.target =
    "build123d-source";
  assertThrows(
    () => validateModelicaAdmittedRunAdmission(value),
    TypeError,
    "modelica-source-qualification",
  );
});

Deno.test("admitted Modelica MRTR refuses caller-shaped extra keys", () => {
  const encoded = [
    ...encodeModelicaAdmittedRunAdmissionParameters(admission()),
    {
      key: "simulate.modelica.admitted.modelicaText",
      label: "Caller Modelica",
      value: "model X end X;",
    },
  ] as EngineeringDecisionProposalParameter[];
  assertThrows(
    () => parseModelicaAdmittedRunAdmissionParameters(encoded),
    TypeError,
    "exactly 60",
  );
});
