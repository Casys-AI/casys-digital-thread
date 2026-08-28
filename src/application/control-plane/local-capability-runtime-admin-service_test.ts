import { assertEquals, assertRejects } from "@std/assert";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeHostMutationLock,
} from "../../adapters/control-plane/file-capability-runtime-host-stores.ts";
import { InMemoryProjectCapabilityLedgerStore } from "../../adapters/control-plane/file-project-capability-ledger-store.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { LocalCapabilityRuntimeAdminService } from "./local-capability-runtime-admin-service.ts";

Deno.test("local admin lock review requires exact fingerprint and explicit confirmation", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-local-admin-service-" });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const lock = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/admin-lock.json`,
      catalog,
    );
    const service = new LocalCapabilityRuntimeAdminService({
      catalog,
      ledgers: new InMemoryProjectCapabilityLedgerStore(),
      lock,
      hostMutationLock: new FileCapabilityRuntimeHostMutationLock(
        `${directory}/mutation.lock`,
      ),
      authorization: {} as never,
    });
    const review = await service.lockReview();
    await assertRejects(
      () => service.lockApply(review.reviewFingerprint, false),
      Error,
      "--confirm",
    );
    const applied = await service.lockApply(review.reviewFingerprint, true);
    assertEquals(applied.revision, 1);
    assertEquals(applied.units.every((unit) => unit.desired === "inactive"), true);
    await assertRejects(
      () => service.lockApply(review.reviewFingerprint, true),
      Error,
      "stale",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
