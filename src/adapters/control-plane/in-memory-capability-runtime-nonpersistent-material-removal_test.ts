import { assertEquals, assertRejects } from "@std/assert";
import {
  capabilityRuntimeNonpersistentRemovalIntentId,
  createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  createCapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  createCapabilityRuntimeNonpersistentMaterialRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import { InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal } from "./in-memory-capability-runtime-nonpersistent-material-removal.ts";

const DIGEST = "a".repeat(64);

Deno.test("in-memory non-persistent journal matches file intent/outcome cross-reference semantics", async () => {
  const journal = new InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal();
  const {
    intent,
    laterIntent,
    outcome,
    laterOutcome,
    mismatchedOutcome,
    earlyOutcome,
  } = await fixture();
  await assertRejects(
    () => journal.appendOutcome(outcome),
    Error,
    "has no durable intent",
  );
  await journal.appendIntent(intent);
  await journal.appendIntent(intent);
  await assertRejects(
    () => journal.appendIntent(laterIntent),
    Error,
    "already exists with different content",
  );
  await assertRejects(
    () => journal.appendOutcome(mismatchedOutcome),
    Error,
    "does not attest its exact intent",
  );
  await assertRejects(
    () => journal.appendOutcome(earlyOutcome),
    Error,
    "predates its durable intent",
  );
  await journal.appendOutcome(outcome);
  await journal.appendOutcome(outcome);
  await assertRejects(
    () => journal.appendOutcome(laterOutcome),
    Error,
    "already exists with different content",
  );
  assertEquals(await journal.listIntents(), [intent]);
  assertEquals(await journal.listOutcomes(), [outcome]);
});

async function fixture() {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
    unit: {
      id: "casys.cache-worker",
      version: "1.0.0",
      manifestFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    material: {
      unitId: "casys.cache-worker",
      materialId: "cache-source-image",
      imageReference: `casys/source@sha256:${DIGEST}`,
      imageDigest: DIGEST,
      launchGroup: null,
    },
    backend: "docker-cache",
    observedState: "owned",
  });
  const intent = await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
    id: capabilityRuntimeNonpersistentRemovalIntentId({
      planFingerprint: plan.fingerprint,
      generation: 1,
    }),
    unit: plan.unit,
    material: plan.material,
    backend: plan.backend,
    generation: 1,
    planFingerprint: plan.fingerprint,
    previousObservation: "owned",
    plannedAt: "2026-08-31T00:00:00.000Z",
  });
  const laterIntent = await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
    id: intent.id,
    unit: plan.unit,
    material: plan.material,
    backend: plan.backend,
    generation: 1,
    planFingerprint: plan.fingerprint,
    previousObservation: "owned",
    plannedAt: "2026-08-31T00:00:01.000Z",
  });
  const outcome = await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome({
    intentId: intent.id,
    intentFingerprint: intent.fingerprint,
    recordedAt: "2026-08-31T00:00:01.000Z",
    status: "succeeded",
    observedState: "absent",
    detail: null,
  });
  const laterOutcome = await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome(
    {
      intentId: intent.id,
      intentFingerprint: intent.fingerprint,
      recordedAt: "2026-08-31T00:00:02.000Z",
      status: "succeeded",
      observedState: "absent",
      detail: null,
    },
  );
  const mismatchedOutcome =
    await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome({
      intentId: intent.id,
      intentFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      recordedAt: "2026-08-31T00:00:01.000Z",
      status: "succeeded",
      observedState: "absent",
      detail: null,
    });
  const earlyOutcome = await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome(
    {
      intentId: intent.id,
      intentFingerprint: intent.fingerprint,
      recordedAt: "2026-08-30T23:59:59.000Z",
      status: "succeeded",
      observedState: "absent",
      detail: null,
    },
  );
  return {
    intent,
    laterIntent,
    outcome,
    laterOutcome,
    mismatchedOutcome,
    earlyOutcome,
  };
}
