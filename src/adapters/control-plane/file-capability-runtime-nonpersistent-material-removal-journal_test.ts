import { assertEquals, assertRejects } from "@std/assert";
import {
  capabilityRuntimeNonpersistentRemovalIntentId,
  createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  createCapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  createCapabilityRuntimeNonpersistentMaterialRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { FileCapabilityRuntimeNonpersistentMaterialRemovalJournal } from "./file-capability-runtime-nonpersistent-material-removal-journal.ts";

const DIGEST = "a".repeat(64);

Deno.test("file non-persistent removal journal round-trips an exact intent and outcome", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-nonpersistent-removal-journal-",
  });
  try {
    const journal = new FileCapabilityRuntimeNonpersistentMaterialRemovalJournal(
      directory,
    );
    const { intent, outcome } = await fixture();
    await journal.appendIntent(intent);
    await journal.appendIntent(intent);
    await journal.appendOutcome(outcome);
    await journal.appendOutcome(outcome);
    const restarted = new FileCapabilityRuntimeNonpersistentMaterialRemovalJournal(
      directory,
    );
    assertEquals(await restarted.listIntents(), [intent]);
    assertEquals(await restarted.listOutcomes(), [outcome]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file non-persistent removal journal refuses a conflicting intent or outcome body", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-nonpersistent-removal-conflict-",
  });
  try {
    const journal = new FileCapabilityRuntimeNonpersistentMaterialRemovalJournal(
      directory,
    );
    const { intent, outcome, laterIntent, laterOutcome } = await fixture();
    await journal.appendIntent(intent);
    await assertRejects(
      () => journal.appendIntent(laterIntent),
      Error,
      "already exists with different content",
    );
    await journal.appendOutcome(outcome);
    await assertRejects(
      () => journal.appendOutcome(laterOutcome),
      Error,
      "already exists with different content",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file non-persistent removal journal requires the exact intent, fingerprint and time order", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-nonpersistent-removal-outcome-",
  });
  try {
    const journal = new FileCapabilityRuntimeNonpersistentMaterialRemovalJournal(
      directory,
    );
    const { intent, outcome, mismatchedOutcome, earlyOutcome } = await fixture();
    await assertRejects(
      () => journal.appendOutcome(outcome),
      Error,
      "has no durable intent",
    );
    await journal.appendIntent(intent);
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
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file non-persistent removal journal refuses noncanonical or unsupported entries", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-nonpersistent-removal-canonical-",
  });
  try {
    const journal = new FileCapabilityRuntimeNonpersistentMaterialRemovalJournal(
      directory,
    );
    const { intent } = await fixture();
    await journal.appendIntent(intent);
    const key = (await sha256Fingerprint({ id: intent.id })).digest;
    await Deno.writeTextFile(
      `${directory}/intents/${key}.json`,
      `${JSON.stringify(intent, null, 2)}\n`,
    );
    await assertRejects(
      () => journal.listIntents(),
      Error,
      "is not canonical",
    );
    await Deno.writeTextFile(
      `${directory}/intents/${key}.json`,
      `${deterministicJson(intent)}\n`,
    );
    await Deno.writeTextFile(`${directory}/intents/notes.txt`, "nope\n");
    await assertRejects(
      () => journal.listIntents(),
      Error,
      "unsupported entry",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file non-persistent removal journal ignores a leftover durable temp file", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-nonpersistent-removal-tmp-",
  });
  try {
    const journal = new FileCapabilityRuntimeNonpersistentMaterialRemovalJournal(
      directory,
    );
    const { intent } = await fixture();
    await journal.appendIntent(intent);
    await Deno.writeTextFile(
      `${directory}/intents/.${crypto.randomUUID()}.tmp`,
      "partial\n",
    );
    assertEquals(await journal.listIntents(), [intent]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file non-persistent removal journal refuses a noncanonical storage key", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-nonpersistent-removal-key-",
  });
  try {
    const journal = new FileCapabilityRuntimeNonpersistentMaterialRemovalJournal(
      directory,
    );
    const { intent } = await fixture();
    await journal.appendIntent(intent);
    const key = (await sha256Fingerprint({ id: intent.id })).digest;
    await Deno.mkdir(`${directory}/intents`, { recursive: true });
    const wrong = `${"d".repeat(64)}.json`;
    await Deno.rename(
      `${directory}/intents/${key}.json`,
      `${directory}/intents/${wrong}`,
    );
    await assertRejects(
      () => journal.listIntents(),
      Error,
      "noncanonical storage key",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function fixture() {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
    unit: {
      id: "casys.test-cache-worker",
      version: "1.0.0",
      manifestFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    material: {
      unitId: "casys.test-cache-worker",
      materialId: "source-image",
      imageReference: `casys/test-source@sha256:${DIGEST}`,
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
