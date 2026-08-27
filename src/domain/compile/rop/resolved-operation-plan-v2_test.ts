import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE,
  CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE,
  canonicalResolvedOperationPlanV2Text,
  fingerprintResolvedOperationPlanV2,
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
  return validLocalCalculixPlan();
}

function validCalculixPlan(): Record<string, unknown> {
  return {
    schemaVersion: RESOLVED_OPERATION_PLAN_V2_SCHEMA,
    id: "run:calculix-recorded-21",
    run: {
      projectId: "project.cm01",
      runId: "run:calculix-recorded-21",
      workItemId: "verify-fea",
      inputFingerprint: fingerprint("1"),
      queueBasisProject: {
        snapshotId: "project.cm01:project:r17:0123456789abcdef",
        revision: 17,
        fingerprint: fingerprint("2"),
      },
    },
    workItem: {
      id: "verify-fea",
      operation: { id: "verify.run-fea-static-proof", version: "2" },
      operationFingerprint: fingerprint("3"),
    },
    authorization: {
      kind: "human-mrtr-and-qualified-method",
      mrtr: {
        decisionId: "decision.fea-method",
        decisionInputFingerprint: fingerprint("4"),
        approvalId: "approval.fea-method",
        approvalFingerprint: fingerprint("5"),
      },
      methodQualification: {
        id: "qualified-static-structural-proof-case",
        version: "1.0",
        fingerprint: fingerprint("c"),
      },
    },
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread.cm01",
      revision: 12,
      subjectId: "coffee-machine",
      fingerprint: fingerprint("7"),
    },
    sources: [{
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
    }],
    action: {
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
    },
    expectedProviderResources: {
      ledgerSchema: "provider-resource-acquisition-ledger/1.0",
      captureManifestSchema: "provider-artifact-capture-manifest/1.0",
      resourceProfile: {
        id: "mcp-calculix.recorded-static-artifacts",
        version: "1.0",
      },
    },
    recovery: {
      policy: "mcp-calculix.recorded-static-recovery@1.0",
      requestId: "request.calculix.1",
      mode: "same-request-readback-no-blind-redispatch",
      ambiguousOutcome: "quarantine-for-human-review",
      capturedOutcome: "cas-only-recovery",
    },
  };
}

function validLocalCalculixPlan(): Record<string, unknown> {
  const plan = validCalculixPlan();
  (plan.workItem as Record<string, Record<string, unknown>>).operation.version = "3";
  (plan.authorization as Record<string, Record<string, unknown>>)
    .methodQualification = {
      id: "qualified-calculix-isolated-static-proof",
      version: "1.0",
      fingerprint: fingerprint("e"),
    };
  plan.action = {
    kind: "isolated-static-structural-analysis",
    executor: {
      id: "casys-local-microsandbox",
      contract: { id: "calculix-static-proof-v1", version: "1.0.0" },
      profileFingerprint: fingerprint("e"),
    },
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    requestId: "request.calculix.local.1",
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
    receiptSchema: "isolated-code-execution-receipt-record/1.0",
    evidenceSchema: "calculix-isolated-static-evidence/1.0",
    resourceProfile: {
      id: CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.id,
      version: CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.version,
    },
  };
  plan.recovery = {
    policy: "calculix-isolated-generation-recovery@1.0",
    requestId: "request.calculix.local.1",
    mode: "same-request-readback-no-blind-redispatch",
    ambiguousOutcome: "quarantine-for-human-review",
    capturedOutcome: "cas-only-recovery",
  };
  return plan;
}

Deno.test("ResolvedOperationPlan keeps MCP @2 and local @3 CalculiX identities disjoint", async () => {
  const historical = validateResolvedOperationPlanV2(validCalculixPlan());
  const historicalText = canonicalResolvedOperationPlanV2Text(historical);
  const local = validateResolvedOperationPlanV2(validLocalCalculixPlan());
  assertEquals(historical.action.kind, "static-structural-analysis");
  assertEquals(local.action.kind, "isolated-static-structural-analysis");
  if (local.action.kind !== "isolated-static-structural-analysis") throw new Error();
  assertEquals(Object.hasOwn(local.action, "provider"), false);
  assertEquals(Object.hasOwn(local.action, "tool"), false);
  assertEquals(local.action.executor.profileFingerprint, fingerprint("e"));
  assertEquals(
    canonicalResolvedOperationPlanV2Text(validCalculixPlan()),
    historicalText,
  );
  assertNotEquals(
    await fingerprintResolvedOperationPlanV2(local),
    await fingerprintResolvedOperationPlanV2(historical),
  );

  const transplanted = validLocalCalculixPlan();
  (transplanted.action as Record<string, unknown>).kind = "static-structural-analysis";
  assertThrows(() => validateResolvedOperationPlanV2(transplanted), TypeError);
});

Deno.test("ResolvedOperationPlan 2.0 canonicalizes unordered evidence and freezes the closed local CalculiX action", async () => {
  const plan = validateResolvedOperationPlanV2(validPlan());
  assertEquals(plan.sources.map((source) => source.bindingName), [
    "geometry",
    "proofCase",
  ]);
  assertEquals(plan.expectedProviderResources.resourceProfile, {
    id: CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.id,
    version: CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.version,
  });
  assertEquals(plan.action.kind, "isolated-static-structural-analysis");
  if (plan.action.kind === "isolated-static-structural-analysis") {
    assertEquals(
      plan.action.executor.profileFingerprint,
      plan.authorization.methodQualification.fingerprint,
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
      const artifact = (plan.sources as Record<string, unknown>[]).find((source) =>
        source.bindingName === "geometry"
      )!.artifact as Record<string, unknown>;
      artifact.fingerprint = fingerprint("b");
      artifact.casUri = `casys://thread-asset/sha256/${"b".repeat(64)}`;
    },
    (plan) => {
      const fp = fingerprint("b");
      ((plan.action as Record<string, unknown>).executor as Record<string, unknown>)
        .profileFingerprint = fp;
      ((plan.authorization as Record<string, unknown>)
        .methodQualification as Record<string, unknown>).fingerprint = fp;
    },
    (plan) =>
      ((plan.action as Record<string, unknown>).input as Record<string, unknown>)
        .effectiveTimeoutMs = 31_000,
    (plan) =>
      ((plan.action as Record<string, unknown>).input as Record<string, unknown>)
        .effectiveElementOrder = 1,
  ];
  for (const mutate of variants) {
    const variant = validPlan();
    mutate(variant);
    assertNotEquals(await fingerprintResolvedOperationPlanV2(variant), baseline);
  }
});

Deno.test("ResolvedOperationPlan 2.0 admits only code-owned provider, lowering, resource, and recovery profiles", () => {
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

Deno.test("ResolvedOperationPlan 2.0 rejects DAG vocabulary, noncanonical media, duplicate source roles, and empty sources", () => {
  const dag = validPlan();
  dag.dispatches = [];
  assertThrows(
    () => validateResolvedOperationPlanV2(dag),
    TypeError,
    "unsupported field",
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

  const duplicateGeometryRole = validPlan();
  (duplicateGeometryRole.sources as Record<string, unknown>[]).find((source) =>
    source.bindingName === "geometry"
  )!.role = "proof-case";
  assertThrows(
    () => validateResolvedOperationPlanV2(duplicateGeometryRole),
    TypeError,
    "must name a geometry-source source",
  );

  const emptySources = validPlan();
  emptySources.sources = [];
  assertThrows(
    () => validateResolvedOperationPlanV2(emptySources),
    TypeError,
    "must not be empty",
  );
});

Deno.test("ResolvedOperationPlan 2.0 closes each action to its exact registered operation and source", () => {
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
    id: "verify.run-fea-static-proof",
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
    .proofCase as Record<string, unknown>).sourceBinding;
  assertThrows(
    () => validateResolvedOperationPlanV2(missingBinding),
    TypeError,
    "sourceBinding",
  );

  const foreignSource = validPlan();
  (((foreignSource.action as Record<string, unknown>).input as Record<string, unknown>)
    .proofCase as Record<string, unknown>).fingerprint = fingerprint("f");
  assertThrows(
    () => validateResolvedOperationPlanV2(foreignSource),
    TypeError,
    "case fingerprint",
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
    planId: "run:calculix-isolated-3",
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
