import { assertEquals, assertRejects } from "@std/assert";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeAdminPolicyStore,
  FileCapabilityRuntimeJournal,
  FileCapabilityRuntimeLeaseStore,
} from "./file-capability-runtime-host-stores.ts";
import {
  createFirstPartyCapabilityRuntimeCatalog,
} from "./first-party-capability-binding-catalog.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "./first-party-capability-runtime-launch-groups.ts";

Deno.test("file capability lease atomically preserves one multi-group session claim", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-launch-group-lease-" });
  try {
    const [group] = await createFirstPartyCapabilityRuntimeLaunchGroups();
    const lease = {
      id: "lease:shared",
      projectId: "project:host-runtime",
      bindingIds: ["binding:fake"],
      materialKeys: group!.materials.map((member) =>
        `${member.material.unitId}\u0000${member.material.materialId}`
      ),
      launchGroups: [capabilityRuntimeLaunchGroupReference(group!)],
      acquiredAt: "2026-08-29T00:00:00.000Z",
      expiresAt: "2026-08-29T00:01:00.000Z",
    };
    const first = new FileCapabilityRuntimeLeaseStore(directory);
    const second = new FileCapabilityRuntimeLeaseStore(directory);
    const claims = await Promise.all([first.claim(lease), second.claim(lease)]);

    assertEquals(claims.map((claim) => claim.status).toSorted(), [
      "created",
      "existing",
    ]);
    assertEquals((await first.read(lease.id))?.launchGroups, lease.launchGroups);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file group journal is append-only and refuses an incomplete group outcome", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-launch-group-journal-" });
  try {
    const [group] = await createFirstPartyCapabilityRuntimeLaunchGroups();
    const journal = new FileCapabilityRuntimeJournal(directory);
    const entry = {
      id: "host-runtime:journal",
      action: "runtime-start" as const,
      materials: group!.materials.map((member) => member.material),
      launchGroup: capabilityRuntimeLaunchGroupReference(group!),
      projectId: "project:host-runtime",
      plannedAt: "2026-08-29T00:00:00.000Z",
      previousObservations: group!.materials.map((member) => ({
        material: member.material,
        state: null,
      })),
      administrativeRemovalPlanFingerprint: null,
    };
    await journal.appendBeforeMutation(entry);
    const outcome = {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0" as const,
      journalEntryId: entry.id,
      recordedAt: entry.plannedAt,
      status: "uncertain" as const,
      observations: entry.materials.map((material) => ({ material, state: null })),
      detail: "host command ended without confirmation",
    };
    await assertRejects(
      () =>
        journal.appendOutcome({
          ...outcome,
          observations: outcome.observations.slice(0, 1),
        }),
      Error,
      "every exact group material",
    );
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

Deno.test("local capability admin readers default safely only when their files are absent", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-capability-admin-" });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const policyPath = `${directory}/admin-policy.json`;
    const lockPath = `${directory}/admin-lock.json`;
    const policy = new FileCapabilityRuntimeAdminPolicyStore(policyPath, catalog);
    const lock = new FileCapabilityRuntimeAdminLockStore(lockPath, catalog);

    assertEquals(await policy.read(), {
      schemaVersion: "capability-runtime-admin-policy/1.0",
      disabledBindingIds: [],
      preferences: [],
    });
    assertEquals(await lock.read(), {
      schemaVersion: "capability-runtime-admin-lock/1.0",
      revision: 0,
      previous: null,
      units: [],
    });

    await Deno.writeTextFile(
      policyPath,
      JSON.stringify({
        schemaVersion: "capability-runtime-admin-policy/1.0",
        disabledBindingIds: [],
        preferences: [],
        invented: true,
      }) + "\n",
    );
    await assertRejects(() => policy.read(), TypeError, "unsupported field");

    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({
        schemaVersion: "capability-runtime-admin-lock/1.0",
        revision: 0,
        previous: null,
        units: [{
          id: "casys.unknown",
          version: "1.0.0",
          manifestFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          desired: "active",
        }],
      }) + "\n",
    );
    await assertRejects(() => lock.read(), TypeError, "unknown unit");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
