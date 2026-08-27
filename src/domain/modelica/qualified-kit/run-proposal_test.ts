import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { FixedModelicaIsolatedExecutionProfileCatalog } from "../../../adapters/modelica/qualified-kit/execution-profile.ts";
import { createModelicaMicrosandboxQualificationKit } from "../../../adapters/modelica/qualified-kit/kit-v1/qualification-kit.ts";
import {
  MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
} from "./microsandbox-qualification.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  encodeModelicaQualifiedKitRunAdmissionParameters,
  MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA,
  MODELICA_QUALIFIED_KIT_RUN_PURPOSE,
  MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
  type ModelicaQualifiedKitRunAdmission,
  parseModelicaQualifiedKitRunAdmissionParameters,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  validateModelicaQualifiedKitRunAdmission,
} from "./run-proposal.ts";

Deno.test("qualified Modelica admission round-trips every scalar fact without exposing source text", async () => {
  const admission = await fixtureAdmission();
  const parameters = encodeModelicaQualifiedKitRunAdmissionParameters(admission);
  const replay = parseModelicaQualifiedKitRunAdmissionParameters(parameters);

  assertEquals(replay, admission);
  assertEquals(
    encodeModelicaQualifiedKitRunAdmissionParameters(replay),
    parameters,
  );
  assertEquals(replay.intent, {
    purpose: "solver-conformance-only",
    arbitraryModelica: false,
  });
  assertEquals(replay.project.basis.subjectId, "subject.motor");
  assertEquals(
    parameters.some((parameter) =>
      parameter.key.includes("text") || parameter.key.includes("sourceText") ||
      String(parameter.value).includes("model LinearThermalRamp")
    ),
    false,
  );
});

Deno.test("qualified Modelica scalar replay rejects tampering, reordering and label drift", async () => {
  const parameters = [
    ...encodeModelicaQualifiedKitRunAdmissionParameters(
      await fixtureAdmission(),
    ),
  ];
  const arbitraryIndex = parameters.findIndex((parameter) =>
    parameter.key.endsWith("intent.arbitraryModelica")
  );
  const arbitrary = parameters[arbitraryIndex]!;
  parameters[arbitraryIndex] = { ...arbitrary, value: true };
  assertThrows(
    () => parseModelicaQualifiedKitRunAdmissionParameters(parameters),
    TypeError,
  );

  const reordered = [
    ...encodeModelicaQualifiedKitRunAdmissionParameters(
      await fixtureAdmission(),
    ),
  ];
  [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
  assertThrows(
    () => parseModelicaQualifiedKitRunAdmissionParameters(reordered),
    TypeError,
  );

  const relabelled = [
    ...encodeModelicaQualifiedKitRunAdmissionParameters(
      await fixtureAdmission(),
    ),
  ];
  relabelled[0] = { ...relabelled[0]!, label: "Generic simulation" };
  assertThrows(
    () => parseModelicaQualifiedKitRunAdmissionParameters(relabelled),
    TypeError,
  );
});

Deno.test("qualified Modelica admission rejects negative zero as a distinct MRTR scalar", async () => {
  const admission = structuredClone(await fixtureAdmission());
  (admission.bundle.invocation as { startTimeS: number }).startTimeS = -0;
  assertThrows(
    () => validateModelicaQualifiedKitRunAdmission(admission),
    TypeError,
  );
});

Deno.test("qualified Modelica admission rejects a foreign kit, case or manifest", async () => {
  const admission = await fixtureAdmission();
  const foreignKit = structuredClone(admission);
  (foreignKit.bundle.selection as { modelId: string }).modelId = "foreign-kit";
  assertThrows(
    () => validateModelicaQualifiedKitRunAdmission(foreignKit),
    TypeError,
  );

  const foreignCase = structuredClone(admission);
  (foreignCase.bundle.qualification as { caseSha256: string }).caseSha256 = "a".repeat(
    64,
  );
  assertThrows(
    () => validateModelicaQualifiedKitRunAdmission(foreignCase),
    TypeError,
  );

  const foreignManifest = structuredClone(admission);
  (foreignManifest.bundle.qualification as { manifestSha256: string })
    .manifestSha256 = "b".repeat(64);
  assertThrows(
    () => validateModelicaQualifiedKitRunAdmission(foreignManifest),
    TypeError,
  );
});

Deno.test("qualified Modelica admission binds basis and qualification to the exact profile", async () => {
  const admission = await fixtureAdmission();
  const latest = structuredClone(admission);
  (latest.project.basis as { snapshotId: string }).snapshotId = "latest";
  assertThrows(
    () => validateModelicaQualifiedKitRunAdmission(latest),
    TypeError,
  );

  const foreignQualification = structuredClone(admission);
  (foreignQualification.execution.runtimeQualification
    .executionProfileFingerprint as { digest: string }).digest = "c".repeat(64);
  assertThrows(
    () => validateModelicaQualifiedKitRunAdmission(foreignQualification),
    TypeError,
  );

  const parameters = encodeModelicaQualifiedKitRunAdmissionParameters(admission);
  const basisSubject = parameters.find((parameter) =>
    parameter.key.endsWith("project.basis.subjectId")
  );
  assertNotEquals(basisSubject, undefined);
  assertEquals(basisSubject?.value, "subject.motor");
});

Deno.test("qualified Modelica admission pins bundle, wrapper, policy, limits, profile and live capture", async () => {
  const mutations: Array<(value: ModelicaQualifiedKitRunAdmission) => void> = [
    (value) => {
      (value.bundle.fingerprint as { digest: string }).digest = "1".repeat(64);
    },
    (value) => {
      (value.bundle as { byteCount: number }).byteCount += 1;
    },
    (value) => {
      (value.execution.profile.wrapper as { sha256: string }).sha256 = "2".repeat(64);
    },
    (value) => {
      (value.execution.profile.isolationPolicy.fingerprint as { digest: string })
        .digest = "3".repeat(64);
    },
    (value) => {
      (value.execution.profile.runtime.requestedLimits as {
        maxMemoryBytes: number;
      }).maxMemoryBytes += 1_048_576;
    },
    (value) => {
      (value.execution.profile.profileFingerprint as { digest: string }).digest = "4"
        .repeat(64);
    },
    (value) => {
      (value.execution.runtimeQualification.fingerprint as { digest: string })
        .digest = "5".repeat(64);
      (value.execution.runtimeQualification as { uri: string }).uri =
        `casys://modelica-microsandbox-qualification/sha256/${"5".repeat(64)}`;
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(await fixtureAdmission());
    mutate(value);
    assertThrows(
      () => validateModelicaQualifiedKitRunAdmission(value),
      TypeError,
    );
  }
});

async function fixtureAdmission(): Promise<ModelicaQualifiedKitRunAdmission> {
  const limits = {
    maxWallTimeMs: 120_000,
    maxCpuTimeMs: 120_000,
    maxMemoryBytes: 3 * 1_073_741_824,
    maxProcesses: 64,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    maxOutputFileBytes: 16 * 1_048_576,
    maxOutputTotalBytes: 17 * 1_048_576,
  };
  const imageReference =
    "casys/modelica-microsandbox-worker@sha256:7d3fdeabe794b0ded5360921b16724c7904487e9d11bc24fa37c72f9b92a1894";
  const profiles = new FixedModelicaIsolatedExecutionProfileCatalog({
    imageReference,
    policy: {
      id: "modelica-microsandbox-deny-all-v1",
      version: "1.0.0",
      fingerprint: {
        algorithm: "sha256",
        digest: "a6eeca8fb305b6fecf6a5f226ddcc9dad8010147afe31d7dd4fe35853d239327",
      },
    },
    limits,
    engine: {
      name: "OpenModelica",
      version: "1.27.0",
      mslVersion: "4.1.0",
    },
  });
  const profile = await profiles.initial();
  const kit = await createModelicaMicrosandboxQualificationKit(
    profile.method.engine,
  );
  const qualificationFingerprint = MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT;
  return validateModelicaQualifiedKitRunAdmission({
    schemaVersion: MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA,
    operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
    project: {
      id: "project.motor",
      basis: {
        kind: "thread-snapshot",
        snapshotId: "thread.motor.7",
        revision: 7,
        subjectId: "subject.motor",
      },
    },
    intent: {
      purpose: MODELICA_QUALIFIED_KIT_RUN_PURPOSE,
      arbitraryModelica: false,
    },
    bundle: {
      schemaVersion: kit.bundle.document.schemaVersion,
      fingerprint: kit.bundle.fingerprint,
      byteCount: kit.bundle.bytes.byteLength,
      qualification: kit.bundle.document.qualification,
      selection: kit.bundle.document.selection,
      invocation: kit.bundle.document.invocation,
      method: kit.bundle.document.method,
      inputs: kit.bundle.document.inputs.map(({ text: _text, ...input }) => input),
    },
    execution: {
      profile,
      runtimeQualification: {
        schemaVersion: MODELICA_MICROSANDBOX_QUALIFICATION_REFERENCE_SCHEMA,
        uri:
          `casys://modelica-microsandbox-qualification/sha256/${qualificationFingerprint.digest}`,
        fingerprint: qualificationFingerprint,
        executionProfileFingerprint: profile.profileFingerprint,
      },
    },
    status: "ready-for-qualified-modelica-review",
  });
}

// Compile-time guard: the public sequence remains scalar-only.
const _parameter: EngineeringDecisionProposalParameter = {
  key: "compile.guard",
  label: "Compile guard",
  value: false,
};
void _parameter;
