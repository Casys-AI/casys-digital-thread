import { assertEquals, assertRejects } from "@std/assert";
import {
  createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  createCapabilityRuntimeNonpersistentMaterialRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import { InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal } from "../../adapters/control-plane/in-memory-capability-runtime-nonpersistent-material-removal.ts";
import {
  authorizeDurableNonpersistentMaterialRemoval,
  consumeAuthorizedNonpersistentMaterialRemoval,
} from "./capability-runtime-nonpersistent-material-removal-authorization.ts";

Deno.test("non-persistent removal authorization is one-shot and requires the durable intent", async () => {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
    unit: {
      id: "casys.cache-worker",
      version: "1.0.0",
      manifestFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    material: {
      unitId: "casys.cache-worker",
      materialId: "cache-source-image",
      imageReference: `casys/source@sha256:${"a".repeat(64)}`,
      imageDigest: "a".repeat(64),
      launchGroup: null,
    },
    backend: "docker-cache",
    observedState: "owned",
  });
  const intent = await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
    id: "intent-1",
    unit: plan.unit,
    material: plan.material,
    backend: plan.backend,
    generation: 1,
    planFingerprint: plan.fingerprint,
    previousObservation: "owned",
    plannedAt: "2026-08-31T00:00:00.000Z",
  });
  const journal = new InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal();
  await assertRejects(
    () => authorizeDurableNonpersistentMaterialRemoval(intent, plan, journal),
    Error,
    "not the exact durable journal entry",
  );
  await journal.appendIntent(intent);
  const authorization = await authorizeDurableNonpersistentMaterialRemoval(
    intent,
    plan,
    journal,
  );
  assertEquals(
    consumeAuthorizedNonpersistentMaterialRemoval(authorization)?.id,
    "intent-1",
  );
  assertEquals(consumeAuthorizedNonpersistentMaterialRemoval(authorization), undefined);
});

Deno.test("non-persistent removal authorization refuses a forged plan that keeps digest but not identity", async () => {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
    unit: {
      id: "casys.cache-worker",
      version: "1.0.0",
      manifestFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    material: {
      unitId: "casys.cache-worker",
      materialId: "cache-source-image",
      imageReference: `casys/source@sha256:${"a".repeat(64)}`,
      imageDigest: "a".repeat(64),
      launchGroup: null,
    },
    backend: "docker-cache",
    observedState: "owned",
  });
  const intent = await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
    id: "intent-1",
    unit: plan.unit,
    material: plan.material,
    backend: plan.backend,
    generation: 1,
    planFingerprint: plan.fingerprint,
    previousObservation: "owned",
    plannedAt: "2026-08-31T00:00:00.000Z",
  });
  const journal = new InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal();
  await journal.appendIntent(intent);

  await assertRejects(
    () =>
      authorizeDurableNonpersistentMaterialRemoval(intent, {
        ...plan,
        material: {
          ...plan.material,
          imageReference: `mirror.example/ngspice@sha256:${plan.material.imageDigest}`,
        },
      }, journal),
    Error,
    "exact reviewed removal plan",
  );
  await assertRejects(
    () =>
      authorizeDurableNonpersistentMaterialRemoval(intent, {
        ...plan,
        unit: { ...plan.unit, version: "9.9.9" },
      }, journal),
    Error,
    "exact reviewed removal plan",
  );
  await assertRejects(
    () =>
      authorizeDurableNonpersistentMaterialRemoval(intent, {
        ...plan,
        unit: {
          ...plan.unit,
          manifestFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        },
      }, journal),
    Error,
    "exact reviewed removal plan",
  );
  await assertRejects(
    () =>
      authorizeDurableNonpersistentMaterialRemoval(
        intent,
        {
          ...plan,
          material: {
            ...plan.material,
            launchGroup: { id: "casys-syson" },
          },
        } as unknown as typeof plan,
        journal,
      ),
    Error,
    "exact reviewed removal plan",
  );
});
