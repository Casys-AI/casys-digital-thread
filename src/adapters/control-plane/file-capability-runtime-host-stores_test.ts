import { assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  createEffectiveCapabilityRuntimeLaunchProjection,
  validateCapabilityRuntimeJournalEntry,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeAdminPolicyStore,
  FileCapabilityRuntimeJournal,
  FileCapabilityRuntimeLeaseStore,
} from "./file-capability-runtime-host-stores.ts";
import {
  createFirstPartyCapabilityRuntimeCatalog,
  createFirstPartyChronoRolloverPredecessorUnit,
  firstPartyBuild123dObservationHistoryPredecessor,
  firstPartyBuild123dSandboxHistoryPredecessor,
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
      action: "material-acquire" as const,
      materials: group!.materials.map((member) => member.material),
      launchGroup: capabilityRuntimeLaunchGroupReference(group!),
      projectId: "project:host-runtime",
      plannedAt: "2026-08-29T00:00:00.000Z",
      previousObservations: group!.materials.map((member) => ({
        material: member.material,
        state: null,
      })),
      administrativeRemovalPlanFingerprint: null,
      effectiveRuntimeProjection: null,
      qualificationStartAuthority: null,
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

Deno.test("host journal accepts private qualification authority only on its dedicated action", async () => {
  const [group] = await createFirstPartyCapabilityRuntimeLaunchGroups();
  if (!group) throw new Error("Expected first-party launch group.");
  const authority = {
    candidate: {
      id: "chrono-arm64-emulation-v1",
      fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    },
    reviewFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
  };
  const qualification = {
    id: "host-runtime:qualification",
    action: "runtime-qualification-start" as const,
    materials: group.materials.map((member) => member.material),
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservations: group.materials.map((member) => ({
      material: member.material,
      state: null,
    })),
    effectiveRuntimeProjection: null,
    qualificationStartAuthority: authority,
    administrativeRemovalPlanFingerprint: null,
  };

  assertEquals(
    (await validateCapabilityRuntimeJournalEntry(qualification)).action,
    "runtime-qualification-start",
  );
  await assertRejects(
    () =>
      validateCapabilityRuntimeJournalEntry({
        ...qualification,
        projectId: "project-attempted-override",
      }),
    TypeError,
    "reserved local qualification project owner",
  );
  await assertRejects(
    () =>
      validateCapabilityRuntimeJournalEntry({
        ...qualification,
        action: "material-acquire",
      }),
    TypeError,
    "only allowed for its matching start action",
  );
  await assertRejects(
    () =>
      validateCapabilityRuntimeJournalEntry({
        ...qualification,
        qualificationStartAuthority: null,
      }),
    TypeError,
    "requires only its exact private qualification authority",
  );
  const projection = await createEffectiveCapabilityRuntimeLaunchProjection({
    launchGroup: qualification.launchGroup,
    materials: group.materials.map((member) => ({
      material: member.material,
      binding: { id: "test-binding", version: "1.0.0" },
      effectiveQualification: "qualified" as const,
      minimumQualification: "qualified" as const,
      runtimeMode: {
        material: member.material,
        targetPlatform: "linux/arm64" as const,
        mode: "native" as const,
        qualificationAttestationFingerprint: null,
      },
    })),
  });
  await assertRejects(
    () =>
      validateCapabilityRuntimeJournalEntry({
        ...qualification,
        effectiveRuntimeProjection: projection,
      }),
    TypeError,
    "requires only its exact private qualification authority",
  );
  await assertRejects(
    () =>
      validateCapabilityRuntimeJournalEntry({
        ...qualification,
        action: "runtime-start",
        effectiveRuntimeProjection: projection,
      }),
    TypeError,
    "must not carry a qualification start authority",
  );
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
    // The overwrite-era file is deliberately ignored by the append-only
    // history store; it must not silently regain runtime authority.
    assertEquals(await lock.read(), {
      schemaVersion: "capability-runtime-admin-lock/1.0",
      revision: 0,
      previous: null,
      units: [],
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("admin lock retains immutable history and rollback writes a successor", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-capability-lock-history-",
  });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const store = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/admin-lock.json`,
      catalog,
    );
    const empty = await store.read();
    const firstUnit = catalog.units[0]!;
    const first = {
      schemaVersion: empty.schemaVersion,
      revision: 1,
      previous: await sha256Fingerprint(empty),
      units: catalog.units.map((unit) => ({
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
        desired: unit.id === firstUnit.id ? "active" as const : "inactive" as const,
      })),
    };
    await store.save(first);
    const second = {
      ...first,
      revision: 2,
      previous: await sha256Fingerprint(first),
      units: first.units.map((unit) => ({ ...unit, desired: "inactive" as const })),
    };
    await store.save(second);
    assertEquals((await store.list()).map((lock) => lock.revision), [0, 1, 2]);
    assertEquals(
      (await new FileCapabilityRuntimeAdminLockStore(
        `${directory}/admin-lock.json`,
        catalog,
      ).read()).revision,
      2,
    );
    const rolledBack = await store.rollback(1);
    assertEquals(rolledBack.revision, 3);
    assertEquals(rolledBack.units, first.units);
    assertEquals((await store.readRevision(2)).units, second.units);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("admin lock rejects a head whose earlier immutable predecessor is absent", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-capability-lock-chain-",
  });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const store = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/admin-lock.json`,
      catalog,
    );
    const empty = await store.read();
    const first = {
      schemaVersion: empty.schemaVersion,
      revision: 1,
      previous: await sha256Fingerprint(empty),
      units: catalog.units.map((unit) => ({
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
        desired: "inactive" as const,
      })),
    };
    await store.save(first);
    const second = {
      ...first,
      revision: 2,
      previous: await sha256Fingerprint(first),
    };
    await store.save(second);
    await Deno.remove(`${directory}/admin-lock-revisions/0000000001.json`);
    await assertRejects(() => store.read(), Error, "revision 1 is absent");
    const third = {
      ...second,
      revision: 3,
      previous: await sha256Fingerprint(second),
    };
    await assertRejects(
      () => store.save(third),
      Error,
      "revision 1 is absent",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("admin lock reads an exact declared transition predecessor through the complete immutable chain", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-capability-lock-historical-transition-",
  });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const current = catalog.units[0]!;
    const retired = {
      id: current.id,
      version: "0.0.1",
      manifestFingerprint: await sha256Fingerprint({
        retiredUnit: current.id,
        retiredVersion: "0.0.1",
      }),
    };
    const empty = {
      schemaVersion: "capability-runtime-admin-lock/1.0" as const,
      revision: 0,
      previous: null,
      units: [],
    };
    const first = {
      schemaVersion: empty.schemaVersion,
      revision: 1,
      previous: await sha256Fingerprint(empty),
      units: catalog.units.map((unit) => ({
        ...(unit.id === current.id ? retired : {
          id: unit.id,
          version: unit.version,
          manifestFingerprint: unit.manifestFingerprint,
        }),
        desired: "inactive" as const,
      })),
    };
    const second = {
      ...first,
      revision: 2,
      previous: await sha256Fingerprint(first),
      units: catalog.units.map((unit) => ({
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
        desired: "inactive" as const,
      })),
    };
    const store = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/admin-lock.json`,
      catalog,
      {
        transitionPredecessors: [{
          predecessor: retired,
          successor: {
            id: current.id,
            version: current.version,
            manifestFingerprint: current.manifestFingerprint,
          },
        }],
      },
    );
    // The first post-catalogue-replacement boot still points at the retired
    // lock. It remains readable only via the declared exact transition.
    await writeAdminLockHistory(directory, [first]);
    assertEquals((await store.readRevision(1)).units[0]?.version, retired.version);
    assertEquals((await store.read()).revision, 1);

    await writeAdminLockHistory(directory, [first, second]);
    assertEquals((await store.read()).revision, 2);
    assertEquals((await store.list()).map((lock) => lock.revision), [0, 1, 2]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("admin lock reads exact historical Build123d locks before their current readiness successors", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-capability-lock-build123d-readiness-transition-",
  });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const predecessors = [
      firstPartyBuild123dSandboxHistoryPredecessor(),
      firstPartyBuild123dObservationHistoryPredecessor(),
    ];
    const transitionPredecessors = predecessors.map((predecessor) => {
      const successor = catalog.units.find((unit) => unit.id === predecessor.id);
      if (!successor) {
        throw new Error(`Current catalogue lacks ${predecessor.id}.`);
      }
      return {
        predecessor,
        successor: {
          id: successor.id,
          version: successor.version,
          manifestFingerprint: successor.manifestFingerprint,
        },
      };
    });
    const empty = {
      schemaVersion: "capability-runtime-admin-lock/1.0" as const,
      revision: 0,
      previous: null,
      units: [],
    };
    const historical = {
      schemaVersion: empty.schemaVersion,
      revision: 1,
      previous: await sha256Fingerprint(empty),
      units: catalog.units.map((unit) => {
        const predecessor = predecessors.find((value) => value.id === unit.id);
        const identity = predecessor ?? {
          id: unit.id,
          version: unit.version,
          manifestFingerprint: unit.manifestFingerprint,
        };
        return { ...identity, desired: "inactive" as const };
      }),
    };
    const current = {
      schemaVersion: empty.schemaVersion,
      revision: 2,
      previous: await sha256Fingerprint(historical),
      units: catalog.units.map((unit) => ({
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
        desired: "inactive" as const,
      })),
    };
    const store = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/admin-lock.json`,
      catalog,
      { transitionPredecessors },
    );

    await writeAdminLockHistory(directory, [historical]);
    assertEquals(
      (await store.read()).units.filter((unit) =>
        predecessors.some((predecessor) => predecessor.id === unit.id)
      ),
      historical.units.filter((unit) =>
        predecessors.some((predecessor) => predecessor.id === unit.id)
      ),
    );

    await writeAdminLockHistory(directory, [historical, current]);
    assertEquals((await store.read()).revision, current.revision);
    assertEquals(
      (await store.read()).units.filter((unit) =>
        predecessors.some((predecessor) => predecessor.id === unit.id)
      ),
      current.units.filter((unit) =>
        predecessors.some((predecessor) => predecessor.id === unit.id)
      ),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("admin lock reads exact historical Chrono 0.3.1 then saves only the current successor", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-capability-lock-chrono-transition-",
  });
  try {
    const [catalog, predecessor] = await Promise.all([
      createFirstPartyCapabilityRuntimeCatalog(),
      createFirstPartyChronoRolloverPredecessorUnit(),
    ]);
    const successor = catalog.units.find((unit) => unit.id === "casys.mcp-chrono");
    if (!successor) throw new Error("Current catalogue lacks casys.mcp-chrono.");
    const empty = {
      schemaVersion: "capability-runtime-admin-lock/1.0" as const,
      revision: 0,
      previous: null,
      units: [],
    };
    const historical = {
      schemaVersion: empty.schemaVersion,
      revision: 1,
      previous: await sha256Fingerprint(empty),
      units: catalog.units.map((unit) => ({
        ...(unit.id === predecessor.id
          ? {
            id: predecessor.id,
            version: predecessor.version,
            manifestFingerprint: predecessor.manifestFingerprint,
          }
          : {
            id: unit.id,
            version: unit.version,
            manifestFingerprint: unit.manifestFingerprint,
          }),
        desired: "inactive" as const,
      })),
    };
    const current = {
      schemaVersion: empty.schemaVersion,
      revision: 2,
      previous: await sha256Fingerprint(historical),
      units: catalog.units.map((unit) => ({
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
        desired: "inactive" as const,
      })),
    };
    const authority = {
      transitionPredecessors: [{
        predecessor: {
          id: predecessor.id,
          version: predecessor.version,
          manifestFingerprint: predecessor.manifestFingerprint,
        },
        successor: {
          id: successor.id,
          version: successor.version,
          manifestFingerprint: successor.manifestFingerprint,
        },
      }],
    };
    const store = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/admin-lock.json`,
      catalog,
      authority,
    );

    await writeAdminLockHistory(directory, [historical]);
    assertEquals(
      (await store.read()).units.find((unit) => unit.id === "casys.mcp-chrono"),
      historical.units.find((unit) => unit.id === "casys.mcp-chrono"),
    );

    await assertRejects(
      () =>
        new FileCapabilityRuntimeAdminLockStore(
          `${directory}/admin-lock.json`,
          catalog,
          {
            transitionPredecessors: [{
              predecessor: {
                ...authority.transitionPredecessors[0]!.predecessor,
                manifestFingerprint: {
                  algorithm: "sha256",
                  digest: "f".repeat(64),
                },
              },
              successor: authority.transitionPredecessors[0]!.successor,
            }],
          },
        ).read(),
      TypeError,
      "current unit or declared transition predecessor",
    );

    await assertRejects(
      () => store.save(historical),
      TypeError,
      "does not match the exact catalogue unit",
    );

    await writeAdminLockHistory(directory, [historical, current]);
    assertEquals(
      (await store.read()).units.find((unit) => unit.id === "casys.mcp-chrono"),
      current.units.find((unit) => unit.id === "casys.mcp-chrono"),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("admin lock refuses undeclared and forged historical unit identities", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-capability-lock-historical-refusal-",
  });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const current = catalog.units[0]!;
    const retired = {
      id: current.id,
      version: "0.0.1",
      manifestFingerprint: await sha256Fingerprint({ retiredUnit: current.id }),
    };
    const empty = {
      schemaVersion: "capability-runtime-admin-lock/1.0" as const,
      revision: 0,
      previous: null,
      units: [],
    };
    const historicalLock = async (unit: typeof retired) => ({
      schemaVersion: empty.schemaVersion,
      revision: 1,
      previous: await sha256Fingerprint(empty),
      units: catalog.units.map((candidate) => ({
        ...(candidate.id === current.id ? unit : {
          id: candidate.id,
          version: candidate.version,
          manifestFingerprint: candidate.manifestFingerprint,
        }),
        desired: "inactive" as const,
      })),
    });
    const authority = {
      transitionPredecessors: [{
        predecessor: retired,
        successor: {
          id: current.id,
          version: current.version,
          manifestFingerprint: current.manifestFingerprint,
        },
      }],
    };

    await assertRejects(
      async () =>
        await new FileCapabilityRuntimeAdminLockStore(
          `${directory}/fresh-admin-lock.json`,
          catalog,
          authority,
        ).save(await historicalLock(retired)),
      TypeError,
      "does not match the exact catalogue unit",
    );

    await writeAdminLockHistory(directory, [await historicalLock(retired)]);
    await assertRejects(
      () =>
        new FileCapabilityRuntimeAdminLockStore(`${directory}/admin-lock.json`, catalog)
          .read(),
      TypeError,
      "current unit or declared transition predecessor",
    );

    const wrongVersion = { ...retired, version: "0.0.2" };
    await writeAdminLockHistory(directory, [await historicalLock(wrongVersion)]);
    await assertRejects(
      () =>
        new FileCapabilityRuntimeAdminLockStore(
          `${directory}/admin-lock.json`,
          catalog,
          authority,
        ).read(),
      TypeError,
      "current unit or declared transition predecessor",
    );

    const wrongFingerprint = {
      ...retired,
      manifestFingerprint: await sha256Fingerprint({ forged: current.id }),
    };
    await writeAdminLockHistory(directory, [await historicalLock(wrongFingerprint)]);
    await assertRejects(
      () =>
        new FileCapabilityRuntimeAdminLockStore(
          `${directory}/admin-lock.json`,
          catalog,
          authority,
        ).read(),
      TypeError,
      "current unit or declared transition predecessor",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function writeAdminLockHistory(
  directory: string,
  revisions: readonly {
    readonly schemaVersion: "capability-runtime-admin-lock/1.0";
    readonly revision: number;
    readonly previous: Awaited<ReturnType<typeof sha256Fingerprint>>;
    readonly units: readonly unknown[];
  }[],
): Promise<void> {
  const historyDirectory = `${directory}/admin-lock-revisions`;
  await Deno.mkdir(historyDirectory, { recursive: true });
  for (const revision of revisions) {
    await Deno.writeTextFile(
      `${historyDirectory}/${String(revision.revision).padStart(10, "0")}.json`,
      `${deterministicJson(revision)}\n`,
    );
  }
  const tip = revisions.at(-1)!;
  await Deno.writeTextFile(
    `${directory}/admin-lock-head.json`,
    `${
      deterministicJson({
        schemaVersion: "capability-runtime-admin-lock-head/1.0",
        revision: tip.revision,
        lockFingerprint: await sha256Fingerprint(tip),
      })
    }\n`,
  );
}
