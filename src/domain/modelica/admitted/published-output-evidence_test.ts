import { assertEquals, assertRejects } from "@std/assert";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeRuntimeAttestation,
  validateIsolatedCodeExecutionRequest,
} from "../../compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  admittedModelicaExecutionContractFromSourceBytes,
  type ModelicaAdmittedExecutionCapture,
} from "./execution-evidence.ts";
import { parseAdmittedModelicaIsolatedEvidence } from "./isolated-output.ts";
import {
  encodeModelicaAdmittedRunAdmissionParameters,
  MODELICA_ADMITTED_COMPILATION_PROFILE_ID,
  MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  MODELICA_ADMITTED_EXECUTION_PROFILE,
  MODELICA_ADMITTED_OUTPUT_MANIFEST,
  MODELICA_ADMITTED_RUN_ADMISSION_SCHEMA,
  parseModelicaAdmittedRunAdmissionParameters,
} from "./run-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../compile/isolation/local-isolation-runtime.ts";
import { buildAdmittedModelicaPublishedOutputCapture } from "./published-output-evidence.ts";

const SOURCE = `model GenericOscillator
  parameter Real initialPosition(unit = "m") = 0;
  parameter Real drive(unit = "m/s2") = 2;
  output Real position(unit = "m", start = initialPosition, fixed = true);
  output Real velocity(unit = "m/s", start = 0, fixed = true);
equation
  der(position) = velocity;
  der(velocity) = drive-position;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end GenericOscillator;
`;

const RUNTIME: IsolatedCodeRuntimeAttestation = {
  isolationClass: "kernel-isolated",
  imageDigest: { algorithm: "sha256", digest: "4".repeat(64) },
  requestedLimits: {
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
};

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}

function admissionRecord() {
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
        limits: RUNTIME.requestedLimits,
        limitAssurance: RUNTIME.limitAssurance,
      },
      outputValidator: {
        id: "modelica-closed-subset-v2-result-normalizer",
        version: "2.0.0",
      },
      outputs: MODELICA_ADMITTED_OUTPUT_MANIFEST,
      minimumDestructionAssurance: "acknowledged-unattested",
    },
    status: "ready-for-execution-review",
  };
}

async function publishedFixture(options: {
  readonly evidenceInputBundleDrift?: boolean;
  readonly evidenceResultDrift?: boolean;
  readonly extraOutput?: boolean;
} = {}) {
  const sourceBytes = new TextEncoder().encode(SOURCE);
  const sourceSha256 = await fingerprintResourceBytes(sourceBytes);
  const contract = admittedModelicaExecutionContractFromSourceBytes(sourceBytes);
  const resultBytes = new TextEncoder().encode(
    `time,${contract.outputs.map((output) => output.name).join(",")}\n0,${
      contract.outputs.map(() => "0").join(",")
    }\n`,
  );
  const resultSha256 = await fingerprintResourceBytes(resultBytes);
  const evidenceBytes = new TextEncoder().encode(deterministicJson({
    schemaVersion: "modelica-isolated-evidence/2.0",
    inputBundleSha256: options.evidenceInputBundleDrift ? "a".repeat(64) : sourceSha256,
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
      byteCount: resultBytes.byteLength,
      sha256: options.evidenceResultDrift ? "b".repeat(64) : resultSha256,
    },
    warnings: [],
  }));
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: "isolated-code-execution-request/1.0",
    runId: "admitted-modelica-run",
    producerGeneration: 0,
    profile: MODELICA_ADMITTED_EXECUTION_PROFILE,
    source: { bytes: sourceBytes, sha256: sourceSha256 },
    policy: {
      id: "isolation.modelica-deny-net",
      version: "2.0.0",
      fingerprint: fingerprint("3"),
    },
    outputs: options.extraOutput
      ? [...MODELICA_ADMITTED_OUTPUT_MANIFEST, {
        role: "trace",
        basename: "trace.log",
        mediaType: "text/plain",
        format: "log",
      }]
      : [...MODELICA_ADMITTED_OUTPUT_MANIFEST],
  });
  const members = await Promise.all(
    request.outputs.map(async (declaration) => {
      const bytes = declaration.role === "result" ? resultBytes : evidenceBytes;
      const sha256 = await fingerprintResourceBytes(bytes);
      return {
        ...declaration,
        bytes,
        byteCount: bytes.byteLength,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
      };
    }),
  );
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: RUNTIME,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs: members,
    destruction: {
      status: "proven",
      runId: request.runId,
      proofFingerprint: fingerprint("7"),
    },
    publication: await createIsolatedOutputPublicationRef(
      request.runId,
      request.producerGeneration,
      fingerprint("8"),
    ),
  });
  return {
    sourceBytes,
    sourceSha256,
    evidenceBytes,
    resultBytes,
    receipt,
    admission: parseModelicaAdmittedRunAdmissionParameters(
      encodeModelicaAdmittedRunAdmissionParameters(admissionRecord()),
    ),
  };
}

async function buildFrom(
  fixture: Awaited<ReturnType<typeof publishedFixture>>,
  receipt = fixture.receipt,
  executionRunId = "admitted-modelica-run",
) {
  return await buildAdmittedModelicaPublishedOutputCapture({
    projectId: "project.ramp",
    agentRunId: "run.admitted",
    executionRunId,
    admission: fixture.admission,
    sourceBytes: fixture.sourceBytes,
    sourceSha256: fixture.sourceSha256,
    receipt,
    evidenceBytes: fixture.evidenceBytes,
    resultBytes: fixture.resultBytes,
  });
}

Deno.test("published output evidence accepts hash-attested v2 evidence and result", async () => {
  const fixture = await publishedFixture();
  const capture = await buildFrom(fixture);
  assertEquals(capture.schemaVersion, "modelica-admitted-execution-capture/2.0");
  assertEquals(capture.sourceSha256, fixture.sourceSha256);
  assertEquals(capture.executionRunId, "admitted-modelica-run");
  parseAdmittedModelicaIsolatedEvidence(fixture.evidenceBytes);
});

Deno.test("published output evidence rejects source or result attestation drift", async () => {
  for (
    const options of [
      { evidenceInputBundleDrift: true },
      { evidenceResultDrift: true },
    ] as const
  ) {
    const fixture = await publishedFixture(options);
    await assertRejects(
      () => buildFrom(fixture),
      TypeError,
      "does not attest the reopened source and exact result bytes",
    );
  }
});

Deno.test("published output evidence rejects journaled hash mismatch and extra outputs", async () => {
  const fixture = await publishedFixture();
  const drifted = {
    ...fixture.receipt,
    outputs: fixture.receipt.outputs.map((output) =>
      output.role === "result" ? { ...output, sha256: "c".repeat(64) } : output
    ),
  } as IsolatedCodeExecutionReceipt;
  await assertRejects(
    () => buildFrom(fixture, drifted),
    TypeError,
    "published bytes differ from their journaled output hashes",
  );
  const extra = await publishedFixture({ extraOutput: true });
  await assertRejects(
    () => buildFrom(extra),
    TypeError,
    "must publish evidence.json and result.csv",
  );
});

Deno.test("published output evidence rejects executionRunId drift from the receipt run", async () => {
  const fixture = await publishedFixture();
  await assertRejects(
    () => buildFrom(fixture, fixture.receipt, "admitted-modelica-foreign"),
    TypeError,
    "does not match the isolated receipt run",
  );
});

Deno.test("published output evidence stays a closed Modelica capture, not a kit document", async () => {
  const fixture = await publishedFixture();
  const capture: ModelicaAdmittedExecutionCapture = await buildFrom(fixture);
  assertEquals(capture.operation.id, "simulate.run-admitted-modelica");
  const source = await Deno.readTextFile(
    new URL("./published-output-evidence.ts", import.meta.url),
  );
  assertEquals(source.includes("qualified-kit"), false);
  assertEquals(source.includes("parseAdmittedModelicaIsolatedEvidence"), true);
  assertEquals(source.includes("assertAdmittedModelicaEvidenceMatchesContract"), true);
});
