import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringDecisionProposalParameter } from "../../../project/engineering-project.ts";
import {
  encodeSpiceAdmittedRunAdmissionParameters,
  parseSpiceAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  SPICE_ADMITTED_COMPILATION_PROFILE_ID,
  SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  SPICE_ADMITTED_EXECUTION_PROFILE,
  SPICE_ADMITTED_OUTPUT_MANIFEST,
  SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
  validateSpiceAdmittedRunAdmission,
} from "./run-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../compile/isolation/local-isolation-runtime.ts";

function fingerprint(
  character: "0" | "1" | "2" | "3" | "4" | "5" | "a" | "b" | "c" | "d" | "e" | "f",
) {
  return { algorithm: "sha256", digest: character.repeat(64) } as const;
}

function admission(): Record<string, unknown> {
  const artifactFingerprint = fingerprint("a");
  return {
    schemaVersion: SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
    admissionArtifact: {
      schemaVersion: SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
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
        target: "spice-circuit-source",
        fingerprint: fingerprint("c"),
        status: "ready-for-review",
      },
      source: {
        id: "source.spice.divider",
        sourceFingerprint: fingerprint("d"),
        captureFingerprint: fingerprint("e"),
        analysisFingerprint: fingerprint("f"),
      },
      profile: {
        id: SPICE_ADMITTED_COMPILATION_PROFILE_ID,
        version: "1.0.0",
        fingerprint: fingerprint("a"),
      },
    },
    execution: {
      profile: {
        id: SPICE_ADMITTED_EXECUTION_PROFILE.id,
        version: SPICE_ADMITTED_EXECUTION_PROFILE.version,
        fingerprint: fingerprint("b"),
      },
      isolationPolicy: {
        id: "spice-admitted-microsandbox-deny-all-v1",
        version: "1.0.0",
        fingerprint: fingerprint("c"),
      },
      runtimeBackend: {
        ...MICROSANDBOX_LOCAL_RUNTIME_REF,
        imageReference: `casys/ngspice-microsandbox-worker@sha256:${"5".repeat(64)}`,
        imageDigest: fingerprint("5"),
      },
      runtime: {
        imageDigest: fingerprint("5"),
        isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
        limits: {
          maxWallTimeMs: 30_000,
          maxCpuTimeMs: 25_000,
          maxMemoryBytes: 512 * 1_048_576,
          maxProcesses: 16,
          maxStdoutBytes: 65_536,
          maxStderrBytes: 65_536,
          maxOutputFileBytes: 262_144,
          maxOutputTotalBytes: 524_288,
        },
        limitAssurance: {
          maxWallTimeMs: "backend-attested",
          maxCpuTimeMs: "unattested",
          maxMemoryBytes: "backend-attested",
          maxProcesses: "unattested",
          maxStdoutBytes: "broker-observed-cap",
          maxStderrBytes: "broker-observed-cap",
          maxOutputFileBytes: "broker-observed-cap",
          maxOutputTotalBytes: "broker-observed-cap",
        },
      },
      outputValidator: {
        id: "spice-operating-point-print-vectors",
        version: "1.0.0",
      },
      outputs: SPICE_ADMITTED_OUTPUT_MANIFEST,
      minimumDestructionAssurance: "proven",
    },
    status: "ready-for-execution-review",
  };
}

Deno.test("admitted SPICE MRTR round-trips and names only the registered operation", () => {
  const parameters = encodeSpiceAdmittedRunAdmissionParameters(admission());
  const parsed = parseSpiceAdmittedRunAdmissionParameters(parameters);
  assertEquals(parsed.compilation.projection.target, "spice-circuit-source");
  assertEquals(
    parsed.execution.outputs,
    SPICE_ADMITTED_OUTPUT_MANIFEST,
  );
  assertEquals(
    parameters.find((item) => item.key === "simulate.spice.admitted.operation")
      ?.value,
    `${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id}@${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version}`,
  );
  assertEquals(
    encodeSpiceAdmittedRunAdmissionParameters(parsed),
    parameters,
  );
});

Deno.test("admitted SPICE MRTR refuses extra caller fields and foreign artifact ids", () => {
  assertThrows(
    () =>
      validateSpiceAdmittedRunAdmission({ ...admission(), sourceText: "Vin 1 0 5" }),
    TypeError,
  );
  const spoofed = admission();
  (spoofed.admissionArtifact as { id: string }).id = `spice-circuit-admission-${
    "a".repeat(64)
  }`;
  assertThrows(() => validateSpiceAdmittedRunAdmission(spoofed), TypeError);
  const extra: EngineeringDecisionProposalParameter[] = [
    ...encodeSpiceAdmittedRunAdmissionParameters(admission()),
    { key: "simulate.spice.admitted.image", label: "Image", value: "latest" },
  ];
  assertThrows(
    () => parseSpiceAdmittedRunAdmissionParameters(extra),
    TypeError,
  );
});
