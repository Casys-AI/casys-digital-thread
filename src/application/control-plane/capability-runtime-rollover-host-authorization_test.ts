import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { FileCapabilityRuntimeRolloverSagaStore } from "../../adapters/control-plane/file-capability-runtime-rollover-saga-store.ts";
import {
  authorizeDurableRolloverSuccessorMaterialAcquire,
  authorizeDurableRolloverSuccessorRuntimeStart,
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
