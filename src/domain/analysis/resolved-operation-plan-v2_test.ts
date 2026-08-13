import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE,
  canonicalResolvedOperationPlanV2Text,
  fingerprintResolvedOperationPlanV2,
  MODELICA_RESUMABLE_RESOURCE_PROFILE,
  RESOLVED_OPERATION_PLAN_REF_SCHEMA,
  RESOLVED_OPERATION_PLAN_V2_SCHEMA,
  sameResolvedOperationPlanRef,
  validateResolvedOperationPlanRef,
  validateResolvedOperationPlanV2,
} from "./resolved-operation-plan-v2.ts";

const fingerprint = (character: string) => ({
  algorithm: "sha256" as const,
  digest: character.repeat(64),
});

function validPlan(): Record<string, unknown> {
  const sourceFingerprint = fingerprint("5");
  return {
    schemaVersion: RESOLVED_OPERATION_PLAN_V2_SCHEMA,
    id: "run:modelica-recorded-21",
    run: {
      projectId: "project.cm01",
      runId: "run:modelica-recorded-21",
      workItemId: "simulate-thermal",
      inputFingerprint: fingerprint("1"),
      queueBasisProject: {
        snapshotId: "project.cm01:project:r17:0123456789abcdef",
        revision: 17,
        fingerprint: fingerprint("2"),
      },
    },
    workItem: {
      id: "simulate-thermal",
      operation: { id: "simulate.run-modelica-scenario", version: "2" },
      operationFingerprint: fingerprint("3"),
    },
    authorization: {
      kind: "human-mrtr-and-qualified-method",
      mrtr: {
        decisionId: "decision.thermal-method",
        decisionInputFingerprint: fingerprint("4"),
        approvalId: "approval.thermal-method",
        approvalFingerprint: fingerprint("5"),
      },
      methodQualification: {
        id: "qualified-modelica-resumable",
        version: "2.1",
        fingerprint: fingerprint("6"),
      },
    },
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread.cm01",
      revision: 12,
      subjectId: "coffee-machine",
      fingerprint: fingerprint("7"),
    },
    sources: [
      {
        bindingName: "modelSource",
        role: "model-source",
        threadRef: {
          snapshotId: "thread.cm01",
          snapshotRevision: 12,
          kind: "artifact",
          id: "artifact.modelica-source",
        },
        artifact: {
          fingerprint: sourceFingerprint,
          byteCount: 123,
          mediaType: "text/x-modelica",
          casUri: `casys://modelica-source/sha256/${sourceFingerprint.digest}`,
        },
      },
      {
        bindingName: "scenarioSource",
        role: "scenario-source",
        threadRef: {
          snapshotId: "thread.cm01",
          snapshotRevision: 12,
          kind: "artifact",
          id: "artifact.modelica-scenario-source",
        },
        artifact: {
          fingerprint: fingerprint("8"),
          byteCount: 124,
          mediaType: "application/json",
          casUri: `casys://modelica-scenario-source/sha256/${"8".repeat(64)}`,
        },
      },
      {
        bindingName: "simulationCase",
        role: "simulation-case",
        threadRef: {
          snapshotId: "thread.cm01",
          snapshotRevision: 12,
          kind: "artifact",
          id: "artifact.modelica-simulation-case",
        },
        artifact: {
          fingerprint: fingerprint("9"),
          byteCount: 125,
          mediaType: "application/json",
          casUri: `casys://simulation-case-capture/sha256/${"9".repeat(64)}`,
        },
      },
      {
        bindingName: "methodManifest",
        role: "provider-manifest",
        threadRef: {
          snapshotId: "thread.cm01",
          snapshotRevision: 12,
          kind: "artifact",
          id: "artifact.modelica-provider-manifest",
        },
        artifact: {
          fingerprint: fingerprint("b"),
          byteCount: 126,
          mediaType: "application/json",
          casUri: `casys://modelica-provider-manifest/sha256/${"b".repeat(64)}`,
        },
      },
      {
        bindingName: "qualificationAuthority",
        role: "qualification-authority",
        threadRef: {
          snapshotId: "thread.cm01",
          snapshotRevision: 12,
          kind: "artifact",
          id: "artifact.modelica-qualification-authority",
        },
        artifact: {
          fingerprint: fingerprint("6"),
          byteCount: 127,
          mediaType: "application/json",
          casUri: `casys://modelica-qualification/sha256/${"6".repeat(64)}`,
        },
      },
      {
        bindingName: "parameterSchema",
        role: "parameter-schema",
        threadRef: {
          snapshotId: "thread.cm01",
          snapshotRevision: 12,
          kind: "artifact",
          id: "artifact.modelica-parameter-schema",
        },
        artifact: {
          fingerprint: fingerprint("a"),
          byteCount: 128,
          mediaType: "application/json",
          casUri: `casys://modelica-parameter-schema/sha256/${"a".repeat(64)}`,
        },
      },
    ],
    action: {
      kind: "dynamic-system-simulation",
      provider: {
        id: "mcp-modelica",
        contract: { id: "resumable", version: "2.1" },
      },
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      normalizer: {
        id: "modelica-run-normalizer",
        version: "2.1",
        authority: "exact-provider-manifest",
      },
      requestId: "request.modelica.1",
      input: {
        simulationCase: {
          id: "coffee-machine-thermal",
          fingerprint: fingerprint("9"),
          sourceBinding: "simulationCase",
        },
        providerManifestFingerprint: fingerprint("a"),
        methodManifestSourceBinding: "methodManifest",
        scenarioStartTimeSeconds: 0,
        effectiveTimeoutMs: 30_000,
      },
    },
    expectedProviderResources: {
      ledgerSchema: "provider-resource-acquisition-ledger/1.0",
      captureManifestSchema: "provider-artifact-capture-manifest/1.0",
      resourceProfile: {
        id: "mcp-modelica.resumable-artifacts",
        version: "2.1",
      },
      parameterSchema: "required",
    },
    recovery: {
      policy: "mcp-modelica.resumable-recovery@2.1",
      requestId: "request.modelica.1",
      mode: "same-request-readback-no-blind-redispatch",
      ambiguousOutcome: "quarantine-for-human-review",
      capturedOutcome: "cas-only-recovery",
    },
  };
}

function validCalculixPlan(): Record<string, unknown> {
  const plan = validPlan();
  plan.id = "run:calculix-recorded-21";
  (plan.run as Record<string, unknown>).runId = "run:calculix-recorded-21";
  (plan.workItem as Record<string, unknown>).operation = {
    id: "verify.run-fea-static-proof",
    version: "2",
  };
  (plan.authorization as Record<string, Record<string, unknown>>)
    .methodQualification = {
      id: "qualified-static-structural-proof-case",
      version: "1.0",
      fingerprint: fingerprint("c"),
    };
  plan.sources = [{
    bindingName: "proofCase",
    role: "proof-case",
    threadRef: {
      snapshotId: "thread.cm01",
      snapshotRevision: 12,
      kind: "artifact",
      id: "artifact.fea-proof-case",
    },
    artifact: {
      fingerprint: fingerprint("c"),
      byteCount: 127,
      mediaType: "application/json",
      casUri: `casys://fea-proof-case-capture/sha256/${"c".repeat(64)}`,
    },
  }, {
    bindingName: "geometry",
    role: "geometry-source",
    threadRef: {
      snapshotId: "thread.cm01",
      snapshotRevision: 12,
      kind: "artifact",
      id: "artifact.geometry-step",
    },
    artifact: {
      fingerprint: fingerprint("d"),
      byteCount: 128,
      mediaType: "model/step",
      casUri: `casys://thread-asset/sha256/${"d".repeat(64)}`,
    },
  }];
  plan.action = {
    kind: "static-structural-analysis",
    provider: {
      id: "mcp-calculix",
      contract: { id: "calculix_solve_static_recorded", version: "1.0" },
      executionIdentitySchema: "1.0",
      runSchema: "2.0",
      resultSchema: "2.0",
    },
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    requestId: "request.calculix.1",
    input: {
      proofCase: {
        id: "drip-tray-static",
        fingerprint: fingerprint("c"),
        sourceBinding: "proofCase",
      },
      geometrySourceBinding: "geometry",
      effectiveElementOrder: 2,
      effectiveTimeoutMs: 60_000,
    },
  };
  plan.expectedProviderResources = {
    ledgerSchema: "provider-resource-acquisition-ledger/1.0",
    captureManifestSchema: "provider-artifact-capture-manifest/1.0",
    resourceProfile: {
      id: "mcp-calculix.recorded-static-artifacts",
      version: "1.0",
    },
  };
  plan.recovery = {
    policy: "mcp-calculix.recorded-static-recovery@1.0",
    requestId: "request.calculix.1",
    mode: "same-request-readback-no-blind-redispatch",
    ambiguousOutcome: "quarantine-for-human-review",
    capturedOutcome: "cas-only-recovery",
  };
  return plan;
}

Deno.test("ResolvedOperationPlan 2.0 canonicalizes unordered evidence and freezes the closed Modelica action", async () => {
  const plan = validateResolvedOperationPlanV2(validPlan());
  assertEquals(plan.sources.map((source) => source.bindingName), [
    "methodManifest",
    "modelSource",
    "parameterSchema",
    "qualificationAuthority",
    "scenarioSource",
    "simulationCase",
  ]);
  assertEquals(plan.expectedProviderResources.resourceProfile, {
    id: "mcp-modelica.resumable-artifacts",
    version: "2.1",
  });
  assertEquals(plan.action.kind, "dynamic-system-simulation");
  if (plan.action.kind === "dynamic-system-simulation") {
    assertNotEquals(
      plan.action.input.providerManifestFingerprint,
      plan.sources.find((source) => source.bindingName === "methodManifest")?.artifact
        .fingerprint,
    );
  }
  assertEquals(Object.isFrozen(plan), true);
  assertEquals(Object.isFrozen(plan.action.input), true);

  const permuted = validPlan();
  (permuted.sources as unknown[]).reverse();
  assertEquals(
    await fingerprintResolvedOperationPlanV2(permuted),
    await fingerprintResolvedOperationPlanV2(validPlan()),
  );
});

Deno.test("ResolvedOperationPlan 2.0 binds every authority and effective execution identity", async () => {
  const baseline = await fingerprintResolvedOperationPlanV2(validPlan());
  const variants: readonly ((plan: Record<string, unknown>) => void)[] = [
    (plan) => ((plan.basis as Record<string, unknown>).fingerprint = fingerprint("b")),
    (plan) =>
      ((plan.authorization as Record<string, unknown>).mrtr as Record<string, unknown>)
        .decisionInputFingerprint = fingerprint("b"),
    (plan) =>
      ((plan.authorization as Record<string, unknown>).mrtr as Record<string, unknown>)
        .approvalFingerprint = fingerprint("b"),
    (plan) => {
      const artifact = (plan.sources as Record<string, unknown>[])[0]!
        .artifact as Record<string, unknown>;
      artifact.fingerprint = fingerprint("b");
      artifact.casUri = `casys://modelica-source/sha256/${"b".repeat(64)}`;
    },
    (plan) =>
      ((plan.action as Record<string, unknown>).normalizer as Record<string, unknown>)
        .version = "2",
    (plan) =>
      ((plan.action as Record<string, unknown>).input as Record<string, unknown>)
        .effectiveTimeoutMs = 31_000,
    (plan) => {
      (plan.expectedProviderResources as Record<string, unknown>).parameterSchema =
        "absent";
      plan.sources = (plan.sources as Record<string, unknown>[]).filter((source) =>
        source.bindingName !== "parameterSchema"
      );
    },
  ];
  for (const mutate of variants) {
    const variant = validPlan();
    mutate(variant);
    assertNotEquals(await fingerprintResolvedOperationPlanV2(variant), baseline);
  }
});

Deno.test("ResolvedOperationPlan 2.0 admits only code-owned provider, lowering, resource, and recovery profiles", () => {
  assertEquals(MODELICA_RESUMABLE_RESOURCE_PROFILE.always, [
    { role: "request", mediaType: "application/json" },
    { role: "resolved_parameters", mediaType: "application/json" },
    { role: "model", mediaType: "text/x-modelica" },
    { role: "scenario", mediaType: "application/json" },
    { role: "script", mediaType: "text/plain" },
    { role: "diagnostics", mediaType: "text/plain" },
    { role: "evidence", mediaType: "application/json" },
    { role: "run.json", mediaType: "application/json" },
  ]);
  assertEquals(MODELICA_RESUMABLE_RESOURCE_PROFILE.whenParameterSchemaRequired, {
    role: "parameter_schema",
    mediaType: "application/json",
  });
  assertEquals(MODELICA_RESUMABLE_RESOURCE_PROFILE.whenRunSucceeded, {
    role: "result",
    mediaType: "text/csv",
  });
  assertEquals(CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.resources, [
    { role: "input.step", mediaType: "model/step" },
    { role: "request.json", mediaType: "application/json" },
    { role: "mesh.geo", mediaType: "text/plain" },
    { role: "mesh.inp", mediaType: "text/plain" },
    { role: "gmsh.log", mediaType: "text/plain" },
    { role: "job.inp", mediaType: "text/plain" },
    { role: "ccx.log", mediaType: "text/plain" },
    { role: "job.dat", mediaType: "text/plain" },
    { role: "result.json", mediaType: "application/json" },
  ]);

  const modelicaMutations: readonly ((plan: Record<string, unknown>) => void)[] = [
    (plan) =>
      (((plan.action as Record<string, unknown>).provider as Record<string, unknown>)
        .contract as Record<string, unknown>).version = "2.2",
    (plan) =>
      ((plan.action as Record<string, unknown>).lowering as Record<string, unknown>)
        .id = "invented-lowering",
    (plan) =>
      ((plan.expectedProviderResources as Record<string, unknown>)
        .resourceProfile as Record<string, unknown>).version = "2.2",
    (plan) =>
      (plan.recovery as Record<string, unknown>).policy = "invented-recovery@9.9",
    (plan) =>
      ((plan.action as Record<string, unknown>).normalizer as Record<string, unknown>)
        .id = `n${"x".repeat(128)}`,
    (plan) =>
      ((plan.action as Record<string, unknown>).normalizer as Record<string, unknown>)
        .authority = "caller-selected",
    (plan) =>
      (plan.expectedProviderResources as Record<string, unknown>).resources = [],
  ];
  for (const mutate of modelicaMutations) {
    const plan = validPlan();
    mutate(plan);
    assertThrows(() => validateResolvedOperationPlanV2(plan), TypeError);
  }

  const calculixMutations: readonly ((plan: Record<string, unknown>) => void)[] = [
    (plan) =>
      (((plan.action as Record<string, unknown>).provider as Record<string, unknown>)
        .contract as Record<string, unknown>).id = "calculix_solve_static",
    (plan) =>
      ((plan.action as Record<string, unknown>).provider as Record<string, unknown>)
        .executionIdentitySchema = "2.0",
    (plan) =>
      ((plan.action as Record<string, unknown>).provider as Record<string, unknown>)
        .runSchema = "1.0",
    (plan) =>
      ((plan.action as Record<string, unknown>).provider as Record<string, unknown>)
        .resultSchema = "1.0",
    (plan) =>
      ((plan.action as Record<string, unknown>).lowering as Record<string, unknown>)
        .version = "2.0",
    (plan) => ((plan.action as Record<string, unknown>).normalizer = {
      id: "invented-calculix-normalizer",
      version: "1.0",
    }),
    (plan) =>
      ((plan.expectedProviderResources as Record<string, unknown>)
        .resourceProfile as Record<string, unknown>).id = "invented-profile",
    (plan) =>
      (plan.recovery as Record<string, unknown>).policy =
        "mcp-modelica.resumable-recovery@2.1",
    (plan) => (((plan.authorization as Record<string, unknown>)
      .methodQualification as Record<string, unknown>).fingerprint = fingerprint("e")),
  ];
  for (const mutate of calculixMutations) {
    const plan = validCalculixPlan();
    mutate(plan);
    assertThrows(() => validateResolvedOperationPlanV2(plan), TypeError);
  }
});

Deno.test("ResolvedOperationPlan 2.0 rejects DAG vocabulary, noncanonical media, duplicate source roles, and an unsealed Modelica manifest", () => {
  const dag = validPlan();
  dag.dispatches = [];
  assertThrows(
    () => validateResolvedOperationPlanV2(dag),
    TypeError,
    "unsupported field",
  );

  const missingManifest = validPlan();
  delete ((missingManifest.action as Record<string, unknown>).input as Record<
    string,
    unknown
  >)
    .providerManifestFingerprint;
  assertThrows(
    () => validateResolvedOperationPlanV2(missingManifest),
    TypeError,
    "providerManifestFingerprint is required",
  );

  const uppercaseMedia = validPlan();
  (((uppercaseMedia.sources as Record<string, unknown>[])[0]!.artifact as Record<
    string,
    unknown
  >).mediaType) = "Text/Plain";
  assertThrows(
    () => validateResolvedOperationPlanV2(uppercaseMedia),
    TypeError,
    "canonical media type",
  );

  const duplicateModelSourceRole = validPlan();
  (duplicateModelSourceRole.sources as Record<string, unknown>[]).find((source) =>
    source.bindingName === "scenarioSource"
  )!.role = "model-source";
  assertThrows(
    () => validateResolvedOperationPlanV2(duplicateModelSourceRole),
    TypeError,
    "must name a scenario-source source",
  );

  const emptySources = validPlan();
  emptySources.sources = [];
  assertThrows(
    () => validateResolvedOperationPlanV2(emptySources),
    TypeError,
    "must not be empty",
  );
});

Deno.test("ResolvedOperationPlan 2.0 closes each action to its exact @2 operation and source", () => {
  const wrongOperation = validPlan();
  (wrongOperation.workItem as Record<string, unknown>).operation = {
    id: "verify.run-fea-static-proof",
    version: "2",
  };
  assertThrows(
    () => validateResolvedOperationPlanV2(wrongOperation),
    TypeError,
    "requires",
  );

  const historicalOperation = validPlan();
  (historicalOperation.workItem as Record<string, unknown>).operation = {
    id: "simulate.run-modelica-scenario",
    version: "1",
  };
  assertThrows(
    () => validateResolvedOperationPlanV2(historicalOperation),
    TypeError,
    "requires",
  );

  const missingBinding = validPlan();
  delete (((missingBinding.action as Record<string, unknown>).input as Record<
    string,
    unknown
  >)
    .simulationCase as Record<string, unknown>).sourceBinding;
  assertThrows(
    () => validateResolvedOperationPlanV2(missingBinding),
    TypeError,
    "sourceBinding",
  );

  const foreignSource = validPlan();
  (((foreignSource.action as Record<string, unknown>).input as Record<string, unknown>)
    .simulationCase as Record<string, unknown>).fingerprint = fingerprint("f");
  assertThrows(
    () => validateResolvedOperationPlanV2(foreignSource),
    TypeError,
    "case fingerprint",
  );

  const missingManifestBinding = validPlan();
  delete ((missingManifestBinding.action as Record<string, unknown>).input as Record<
    string,
    unknown
  >)
    .methodManifestSourceBinding;
  assertThrows(
    () => validateResolvedOperationPlanV2(missingManifestBinding),
    TypeError,
    "methodManifestSourceBinding",
  );

  const absentManifest = validPlan();
  ((absentManifest.action as Record<string, unknown>).input as Record<string, unknown>)
    .methodManifestSourceBinding = "not-a-source";
  assertThrows(
    () => validateResolvedOperationPlanV2(absentManifest),
    TypeError,
    "methodManifestSourceBinding",
  );

  const wrongCaseSourceRole = validPlan();
  (wrongCaseSourceRole.sources as Record<string, unknown>[]).find((source) =>
    source.bindingName === "simulationCase"
  )!.role = "model-source";
  assertThrows(
    () => validateResolvedOperationPlanV2(wrongCaseSourceRole),
    TypeError,
    "simulation-case",
  );
});

Deno.test("ResolvedOperationPlan 2.0 keeps Modelica case and method manifest on distinct evidence", () => {
  const sameBinding = validPlan();
  ((sameBinding.action as Record<string, unknown>).input as Record<string, unknown>)
    .methodManifestSourceBinding = "simulationCase";
  assertThrows(
    () => validateResolvedOperationPlanV2(sameBinding),
    TypeError,
    "distinct source bindings",
  );

  const sameThreadRef = validPlan();
  const sameThreadSources = sameThreadRef.sources as Record<string, unknown>[];
  const sameThreadCase = sameThreadSources.find((source) =>
    source.bindingName === "simulationCase"
  )!;
  const sameThreadManifest = sameThreadSources.find((source) =>
    source.bindingName === "methodManifest"
  )!;
  sameThreadManifest.threadRef = structuredClone(sameThreadCase.threadRef);
  assertThrows(
    () => validateResolvedOperationPlanV2(sameThreadRef),
    TypeError,
    "thread artifact ids must not contain duplicates",
  );

  const sameArtifact = validPlan();
  const sameArtifactSources = sameArtifact.sources as Record<string, unknown>[];
  const artifactCase = sameArtifactSources.find((source) =>
    source.bindingName === "simulationCase"
  )!;
  const artifactManifest = sameArtifactSources.find((source) =>
    source.bindingName === "methodManifest"
  )!;
  artifactManifest.artifact = structuredClone(artifactCase.artifact);
  assertThrows(
    () => validateResolvedOperationPlanV2(sameArtifact),
    TypeError,
    "CAS URIs must not contain duplicates",
  );
});

Deno.test("ResolvedOperationPlan 2.0 keeps CalculiX proof case and geometry on distinct evidence", () => {
  const sameBinding = validCalculixPlan();
  ((sameBinding.action as Record<string, unknown>).input as Record<string, unknown>)
    .geometrySourceBinding = "proofCase";
  assertThrows(
    () => validateResolvedOperationPlanV2(sameBinding),
    TypeError,
    "distinct source bindings",
  );

  const sameThreadRef = validCalculixPlan();
  const sameThreadSources = sameThreadRef.sources as Record<string, unknown>[];
  const proofThreadRef = sameThreadSources.find((source) =>
    source.bindingName === "proofCase"
  )!.threadRef as Record<string, unknown>;
  const geometryThreadRef = sameThreadSources.find((source) =>
    source.bindingName === "geometry"
  )!.threadRef as Record<string, unknown>;
  geometryThreadRef.id = proofThreadRef.id;
  assertThrows(
    () => validateResolvedOperationPlanV2(sameThreadRef),
    TypeError,
    "thread artifact ids must not contain duplicates",
  );

  const sameArtifactBytes = validCalculixPlan();
  const sameArtifactSources = sameArtifactBytes.sources as Record<string, unknown>[];
  const proofArtifact = sameArtifactSources.find((source) =>
    source.bindingName === "proofCase"
  )!.artifact as Record<string, unknown>;
  const geometryArtifact = sameArtifactSources.find((source) =>
    source.bindingName === "geometry"
  )!.artifact as Record<string, unknown>;
  geometryArtifact.fingerprint = structuredClone(proofArtifact.fingerprint);
  geometryArtifact.casUri = `casys://thread-asset/sha256/${"c".repeat(64)}`;
  assertThrows(
    () => validateResolvedOperationPlanV2(sameArtifactBytes),
    TypeError,
    "distinct artifact bytes",
  );
});

Deno.test("ResolvedOperationPlan 2.0 enforces exact provider request ids and timeouts", () => {
  for (const requestId of ["request:modelica", `m${"x".repeat(128)}`]) {
    const plan = validPlan();
    (plan.action as Record<string, unknown>).requestId = requestId;
    (plan.recovery as Record<string, unknown>).requestId = requestId;
    assertThrows(
      () => validateResolvedOperationPlanV2(plan),
      TypeError,
      "exact mcp-modelica 2.1 request_id contract",
    );
  }

  const excessiveModelicaTimeout = validPlan();
  ((excessiveModelicaTimeout.action as Record<string, unknown>).input as Record<
    string,
    unknown
  >).effectiveTimeoutMs = 120_001;
  assertThrows(
    () => validateResolvedOperationPlanV2(excessiveModelicaTimeout),
    TypeError,
    "must not exceed 120000",
  );

  const calculixColon = validCalculixPlan();
  (calculixColon.action as Record<string, unknown>).requestId = "request:calculix:1";
  (calculixColon.recovery as Record<string, unknown>).requestId = "request:calculix:1";
  assertEquals(
    validateResolvedOperationPlanV2(calculixColon).action.requestId,
    "request:calculix:1",
  );

  const excessiveCalculixId = validCalculixPlan();
  const tooLong = `c${"x".repeat(128)}`;
  (excessiveCalculixId.action as Record<string, unknown>).requestId = tooLong;
  (excessiveCalculixId.recovery as Record<string, unknown>).requestId = tooLong;
  assertThrows(
    () => validateResolvedOperationPlanV2(excessiveCalculixId),
    TypeError,
    "exact mcp-calculix request_id contract",
  );

  for (const timeout of [0, Number.MAX_SAFE_INTEGER + 1]) {
    const invalidCalculixTimeout = validCalculixPlan();
    ((invalidCalculixTimeout.action as Record<string, unknown>).input as Record<
      string,
      unknown
    >).effectiveTimeoutMs = timeout;
    assertThrows(
      () => validateResolvedOperationPlanV2(invalidCalculixTimeout),
      TypeError,
      "positive integer",
    );
  }
});

Deno.test("ResolvedOperationPlan 2.0 validates a closed CalculiX action and its exact geometry source", () => {
  const plan = validCalculixPlan();
  assertEquals(
    validateResolvedOperationPlanV2(plan).action.kind,
    "static-structural-analysis",
  );
});

Deno.test("ResolvedOperationPlan 2.0 rejects an aliased CalculiX geometry CAS namespace", () => {
  const plan = validCalculixPlan();
  const geometry = (plan.sources as Record<string, unknown>[]).find((source) =>
    source.bindingName === "geometry"
  )!;
  const artifact = geometry.artifact as Record<string, unknown>;
  artifact.casUri = `casys://thread-asset-alias/sha256/${"d".repeat(64)}`;

  assertThrows(
    () => validateResolvedOperationPlanV2(plan),
    TypeError,
    "must seal the exact thread-asset CAS URI",
  );
});

Deno.test("ResolvedOperationPlan references are exact and cannot be freely exchanged", () => {
  const ref = validateResolvedOperationPlanRef({
    schemaVersion: RESOLVED_OPERATION_PLAN_REF_SCHEMA,
    planId: "run:modelica-recorded-21",
    fingerprint: fingerprint("d"),
    byteCount: 100,
    casUri: `casys://resolved-operation-plan/sha256/${"d".repeat(64)}`,
  });
  assertEquals(sameResolvedOperationPlanRef(ref, { ...ref }), true);
  assertEquals(
    sameResolvedOperationPlanRef(ref, { ...ref, planId: "run:other" }),
    false,
  );

  const mismatched = {
    ...ref,
    casUri: `casys://resolved-operation-plan/sha256/${"e".repeat(64)}`,
  };
  assertThrows(
    () => validateResolvedOperationPlanRef(mismatched),
    TypeError,
    "canonical CAS URI",
  );
  assertEquals(
    canonicalResolvedOperationPlanV2Text(validPlan()).includes("dispatches"),
    false,
  );
});
