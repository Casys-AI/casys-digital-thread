import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { FileCapabilityRuntimeRolloverSagaStore } from "../../adapters/control-plane/file-capability-runtime-rollover-saga-store.ts";
import {
  authorizeDurableRolloverPredecessorRuntimeRetire,
  authorizeDurableRolloverSuccessorMaterialAcquire,
  authorizeDurableRolloverSuccessorRuntimeStart,
  consumeAuthorizedRolloverPredecessorRuntimeRetire,
  consumeAuthorizedRolloverSuccessorMaterialAcquire,
  consumeAuthorizedRolloverSuccessorRuntimeStart,
} from "./capability-runtime-rollover-host-authorization.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { CapabilityRuntimeRolloverIdentity } from "../../domain/capability/runtime/capability-runtime-rollover-saga.ts";

Deno.test("rollover host authority exists only after its durable phase and is single-use", async () => {
  const directory = await Deno.makeTempDir({ prefix: "rollover-host-authority-" });
  try {
    const store = new FileCapabilityRuntimeRolloverSagaStore(directory);
    const identity = await fixtureIdentity();
    await assertRejects(
      () => authorizeDurableRolloverSuccessorMaterialAcquire(identity, store),
      Error,
      "durable intent",
    );
    await store.prepare(identity);
    const material = await authorizeDurableRolloverSuccessorMaterialAcquire(
      identity,
      store,
    );
    assertEquals(consumeAuthorizedRolloverSuccessorMaterialAcquire(material), identity);
    assertThrows(
      () => consumeAuthorizedRolloverSuccessorMaterialAcquire(material),
      Error,
      "absent or consumed",
    );
    await store.advance(identity, {
      phase: "successor-material-observed",
      evidenceFingerprint: await sha256Fingerprint({ material: "observed" }),
    });
    const runtime = await authorizeDurableRolloverSuccessorRuntimeStart(
      identity,
      store,
    );
    assertEquals(consumeAuthorizedRolloverSuccessorRuntimeStart(runtime), identity);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("rollover predecessor-retire authority exists only at successor-material-observed, is single-use, and is distinct from successor-start", async () => {
  const directory = await Deno.makeTempDir({ prefix: "rollover-host-retire-" });
  try {
    const store = new FileCapabilityRuntimeRolloverSagaStore(directory);
    const identity = await fixtureIdentity();
    await assertRejects(
      () => authorizeDurableRolloverPredecessorRuntimeRetire(identity, store),
      Error,
      "durable intent",
    );
    await store.prepare(identity);
    await assertRejects(
      () => authorizeDurableRolloverPredecessorRuntimeRetire(identity, store),
      Error,
      "predecessor-runtime-retire requires exact phase successor-material-observed",
    );
    const material = await authorizeDurableRolloverSuccessorMaterialAcquire(
      identity,
      store,
    );
    assertEquals(consumeAuthorizedRolloverSuccessorMaterialAcquire(material), identity);
    await store.advance(identity, {
      phase: "successor-material-observed",
      evidenceFingerprint: await sha256Fingerprint({ material: "observed" }),
    });
    const retireMismatched = await authorizeDurableRolloverPredecessorRuntimeRetire(
      identity,
      store,
    );
    assertThrows(
      () => consumeAuthorizedRolloverSuccessorRuntimeStart(retireMismatched),
      Error,
      "absent or consumed",
    );
    const startMismatched = await authorizeDurableRolloverSuccessorRuntimeStart(
      identity,
      store,
    );
    assertThrows(
      () => consumeAuthorizedRolloverPredecessorRuntimeRetire(startMismatched),
      Error,
      "absent or consumed",
    );
    const retire = await authorizeDurableRolloverPredecessorRuntimeRetire(
      identity,
      store,
    );
    assertEquals(consumeAuthorizedRolloverPredecessorRuntimeRetire(retire), identity);
    assertThrows(
      () => consumeAuthorizedRolloverPredecessorRuntimeRetire(retire),
      Error,
      "absent or consumed",
    );
    const start = await authorizeDurableRolloverSuccessorRuntimeStart(
      identity,
      store,
    );
    assertEquals(consumeAuthorizedRolloverSuccessorRuntimeStart(start), identity);
    await store.advance(identity, {
      phase: "successor-runtime-observed",
      evidenceFingerprint: await sha256Fingerprint({ successor: "observed" }),
    });
    await assertRejects(
      () => authorizeDurableRolloverPredecessorRuntimeRetire(identity, store),
      Error,
      "predecessor-runtime-retire requires exact phase successor-material-observed",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function fixtureIdentity(): Promise<CapabilityRuntimeRolloverIdentity> {
  const predecessor = await sha256Fingerprint({ version: "old" });
  const successor = await sha256Fingerprint({ version: "new" });
  return {
    transitionId: "syson-host-authority-test",
    authorizedAt: "2026-08-30T12:00:00.000Z",
    predecessor: {
      launchGroup: { id: "casys-syson", version: "1.0.0", fingerprint: predecessor },
      unit: {
        id: "casys.syson-stack",
        version: "1.0.0",
        manifestFingerprint: predecessor,
      },
    },
    successor: {
      launchGroup: { id: "casys-syson", version: "1.0.1", fingerprint: successor },
      unit: {
        id: "casys.syson-stack",
        version: "1.0.1",
        manifestFingerprint: successor,
      },
    },
    affectedProjects: [],
    preserved: {
      thread: "preserve",
      cas: "preserve",
      wal: "preserve",
      project: "preserve",
      volumes: [{ id: "syson-db-data", action: "preserve" }],
    },
  };
}
