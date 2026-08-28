import { assertEquals, assertRejects } from "@std/assert";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeJournal,
  FileCapabilityRuntimeLeaseStore,
} from "./file-capability-runtime-host-stores.ts";
import {
  capabilityRuntimeLaunchProfileReference,
} from "../../domain/capability/runtime/capability-runtime-host.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  FAKE_CAPABILITY_RUNTIME_MATERIAL,
  fakeCapabilityRuntimeLaunchProfile,
} from "../../testing/capability-runtime-host-fixture.ts";
import {
  CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
} from "../../application/control-plane/read-model/capability-runtime-catalog.ts";

Deno.test("file capability leases are shared atomically and expire without deleting their history", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-host-runtime-leases-" });
  try {
    const first = new FileCapabilityRuntimeLeaseStore(directory);
    const second = new FileCapabilityRuntimeLeaseStore(directory);
    const lease = {
      id: "lease:shared",
      projectId: "project:host-runtime",
      bindingIds: ["binding:fake"],
      materialKeys: ["test.host-runtime-unit\u0000test-host-runtime-image"],
      launchProfiles: [capabilityRuntimeLaunchProfileReference(
        await fakeCapabilityRuntimeLaunchProfile(),
      )],
      acquiredAt: "2026-08-29T00:00:00.000Z",
      expiresAt: "2026-08-29T00:01:00.000Z",
    };
    await Promise.all([first.acquire(lease), second.acquire(lease)]);
    assertEquals(
      (await first.listActive("2026-08-29T00:00:30.000Z")).map((item) => item.id),
      [
        lease.id,
      ],
    );
    assertEquals(await first.listActive("2026-08-29T00:01:00.000Z"), []);
    assertEquals((await Array.fromAsync(Deno.readDir(directory))).length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file capability journal is append-only across a restart and refuses a divergent terminal outcome", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-host-runtime-journal-" });
  try {
    const profile = await fakeCapabilityRuntimeLaunchProfile();
    const journal = new FileCapabilityRuntimeJournal(directory);
    const entry = {
      id: "host-runtime:journal",
      action: "material-acquire" as const,
      material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
      launchProfile: capabilityRuntimeLaunchProfileReference(profile),
      projectId: null,
      plannedAt: "2026-08-29T00:00:00.000Z",
      previousObservation: null,
      administrativeRemovalPlanFingerprint: null,
    };
    await journal.appendBeforeMutation(entry);
    const outcome = {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0" as const,
      journalEntryId: entry.id,
      recordedAt: entry.plannedAt,
      status: "uncertain" as const,
      observation: null,
      detail: "host command ended without confirmation",
    };
    await journal.appendOutcome(outcome);

    const restarted = new FileCapabilityRuntimeJournal(directory);
    assertEquals((await restarted.list()).map((value) => value.id), [entry.id]);
    assertEquals((await restarted.listOutcomes()).map((value) => value.status), [
      "uncertain",
    ]);
    await assertRejects(
      () => restarted.appendOutcome({ ...outcome, status: "failed" }),
      Error,
      "already exists with different content",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file admin lock advances only through the exact predecessor fingerprint", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-host-runtime-admin-lock-",
  });
  try {
    const store = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/admin-lock.json`,
    );
    const first = {
      schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
      revision: 1,
      previous: null,
      units: [],
    } as const;
    await store.save(first);
    const previous = await sha256Fingerprint(first);
    await store.save({
      ...first,
      revision: 2,
      previous,
    });
    await assertRejects(
      () => store.save({ ...first, revision: 3, previous }),
      Error,
      "advance one revision",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
