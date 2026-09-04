import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import {
  capabilityRuntimeNonpersistentRemovalIntentId,
  createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  createCapabilityRuntimeNonpersistentMaterialRemovalPlan,
  reconstructCapabilityRuntimeNonpersistentMaterialRemovalPlan,
  validateCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  validateCapabilityRuntimeNonpersistentMaterialRemovalPlan,
} from "./capability-runtime-nonpersistent-material-removal.ts";

const DIGEST = "a".repeat(64);
const MANIFEST = "b".repeat(64);

Deno.test("non-persistent removal plan is closed, fingerprinted and preserves every store", async () => {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan(
    fixture(),
  );

  assertEquals(plan.schemaVersion, "capability-runtime-nonpersistent-removal-plan/1.0");
  assertEquals(plan.material.launchGroup, null);
  assertEquals(plan.backend, "docker-cache");
  assertEquals(plan.observedState, "owned");
  assertEquals(plan.preserveThread, true);
  assertEquals(plan.preserveCas, true);
  assertEquals(plan.preserveWal, true);
  assertEquals(plan.preserveProjectState, true);
  assertEquals(plan.preserveRetainedVolumes, true);
  assertEquals(Object.isFrozen(plan), true);
  assertEquals(
    plan.fingerprint,
    await sha256Fingerprint({
      schemaVersion: plan.schemaVersion,
      unit: plan.unit,
      material: plan.material,
      backend: plan.backend,
      observedState: plan.observedState,
      preserveThread: true,
      preserveCas: true,
      preserveWal: true,
      preserveProjectState: true,
      preserveRetainedVolumes: true,
    }),
  );
  assertEquals(
    await validateCapabilityRuntimeNonpersistentMaterialRemovalPlan(plan),
    plan,
  );
});

Deno.test("non-persistent removal plan refuses a non-null launch group or mutable preservation flag", async () => {
  const valid = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan(
    fixture(),
  );
  await assertRejects(
    () =>
      validateCapabilityRuntimeNonpersistentMaterialRemovalPlan({
        ...valid,
        material: { ...fixture().material, launchGroup: { id: "casys-syson" } },
      }),
    TypeError,
    "launchGroup",
  );
  await assertRejects(
    () =>
      validateCapabilityRuntimeNonpersistentMaterialRemovalPlan({
        ...valid,
        preserveThread: false,
      }),
    TypeError,
    "preserveThread",
  );
  await assertRejects(
    () =>
      validateCapabilityRuntimeNonpersistentMaterialRemovalPlan({
        ...valid,
        fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      }),
    TypeError,
    "does not match the exact body",
  );
});

Deno.test("non-persistent removal plan refuses an inconsistent unit or digest identity", async () => {
  await assertRejects(
    () =>
      createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
        ...fixture(),
        material: { ...fixture().material, unitId: "casys.other" },
      }),
    TypeError,
    "unitId",
  );
  await assertRejects(
    () =>
      createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
        ...fixture(),
        material: {
          ...fixture().material,
          imageDigest: "d".repeat(64),
        },
      }),
    TypeError,
    "imageReference does not attest",
  );
});

Deno.test("non-persistent removal intent includes a positive generation in its identity and fingerprint", async () => {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan(
    fixture(),
  );
  const generation = 2;
  const id = capabilityRuntimeNonpersistentRemovalIntentId({
    planFingerprint: plan.fingerprint,
    generation,
  });
  const intent = await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
    id,
    unit: plan.unit,
    material: plan.material,
    backend: plan.backend,
    generation,
    planFingerprint: plan.fingerprint,
    previousObservation: plan.observedState,
    plannedAt: "2026-08-31T00:00:00.000Z",
  });
  assertEquals(intent.generation, 2);
  assertEquals(
    intent.id,
    `capability-admin-remove-nonpersistent-${plan.fingerprint.digest}-2`,
  );
  assertEquals(
    intent.fingerprint,
    await sha256Fingerprint({
      schemaVersion: intent.schemaVersion,
      id: intent.id,
      action: "material-remove",
      unit: intent.unit,
      material: intent.material,
      backend: intent.backend,
      generation: 2,
      planFingerprint: intent.planFingerprint,
      previousObservation: intent.previousObservation,
      plannedAt: intent.plannedAt,
      preserveThread: true,
      preserveCas: true,
      preserveWal: true,
      preserveProjectState: true,
      preserveRetainedVolumes: true,
    }),
  );
  assertEquals(
    await reconstructCapabilityRuntimeNonpersistentMaterialRemovalPlan(intent),
    plan,
  );
  assertEquals(
    await validateCapabilityRuntimeNonpersistentMaterialRemovalIntent(intent),
    intent,
  );
  await assertRejects(
    () =>
      createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
        ...intent,
        generation: 0,
      }),
    TypeError,
    "positive integer",
  );
});

function fixture() {
  return {
    unit: {
      id: "casys.test-cache-worker",
      version: "1.0.0",
      manifestFingerprint: { algorithm: "sha256" as const, digest: MANIFEST },
    },
    material: {
      unitId: "casys.test-cache-worker",
      materialId: "source-image",
      imageReference: `casys/test-source@sha256:${DIGEST}`,
      imageDigest: DIGEST,
      launchGroup: null,
    },
    backend: "docker-cache" as const,
    observedState: "owned" as const,
  };
}
