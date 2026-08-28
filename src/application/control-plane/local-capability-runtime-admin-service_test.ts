import { assertEquals, assertRejects } from "@std/assert";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeHostMutationLock,
} from "../../adapters/control-plane/file-capability-runtime-host-stores.ts";
import { InMemoryProjectCapabilityLedgerStore } from "../../adapters/control-plane/file-project-capability-ledger-store.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroupRegistry } from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import {
  InMemoryCapabilityRuntimeJournal,
  InMemoryCapabilityRuntimeLeaseStore,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type {
  CapabilityRuntimeAdministrativeRemovalObservation,
  CapabilityRuntimeJournalEntry,
  CapabilityRuntimeJournalOutcome,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { ProjectCapabilityLedger } from "./project-capability-authorization.ts";
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
    // Returning to an equivalent desired state is still a distinct,
    // append-only administrative decision.
    const rollback = await service.rollbackReview(applied.revision);
    assertEquals(rollback.nextLock.revision, 2);
    const rolledBack = await service.rollbackApply(
      applied.revision,
      rollback.reviewFingerprint,
      true,
    );
    assertEquals(rolledBack.revision, 2);
    assertEquals(rolledBack.units, applied.units);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("administrative removal blocks retention from every project ledger", async () => {
  const runtime = await removalRuntime({
    ledgers: [
      revokedLedger("project-a"),
      authorizedLedger("project-b", "casys.syson-stack"),
    ],
  });
  try {
    await assertRejects(
      () => runtime.service.removeReview({ kind: "launch-group", id: "casys-syson" }),
      Error,
      "authorized project ledger",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("administrative removal blocks active lease, JIT demand and unresolved group intent", async () => {
  const leaseRuntime = await removalRuntime({
    leases: "active",
  });
  try {
    await assertRejects(
      () =>
        leaseRuntime.service.removeReview({ kind: "launch-group", id: "casys-syson" }),
      Error,
      "active runtime lease",
    );
  } finally {
    await leaseRuntime.close();
  }

  const demandRuntime = await removalRuntime({
    ledgers: [revokedLedger("project-jit")],
    jit: true,
  });
  try {
    await assertRejects(
      () =>
        demandRuntime.service.removeReview({ kind: "launch-group", id: "casys-syson" }),
      Error,
      "JIT demand",
    );
  } finally {
    await demandRuntime.close();
  }

  const journalRuntime = await removalRuntime({});
  try {
    await journalRuntime.journal.appendBeforeMutation(runtimeEntry(
      journalRuntime.group,
      "runtime-start",
      null,
    ));
    await assertRejects(
      () =>
        journalRuntime.service.removeReview({
          kind: "launch-group",
          id: "casys-syson",
        }),
      Error,
      "pending group journal mutation",
    );
  } finally {
    await journalRuntime.close();
  }
});

Deno.test("administrative removal persists inactive lock before journal intent and resumes only one exact pending intent", async () => {
  const runtime = await removalRuntime({ state: "owned" });
  try {
    const review = await runtime.service.removeReview({
      kind: "launch-group",
      id: "casys-syson",
    });
    const entry = runtimeEntry(
      runtime.group,
      "material-remove",
      review.plan.fingerprint,
    );
    await runtime.journal.appendBeforeMutation(entry);
    const recovered = await runtime.service.removeReview({
      kind: "launch-group",
      id: "casys-syson",
    });
    assertEquals(recovered.recovery, "resume-pending");
    runtime.host.beforeMutate = async () => {
      assertEquals(
        (await runtime.lock.read()).units.every((unit) => unit.desired === "inactive"),
        true,
      );
      assertEquals((await runtime.journal.list()).length, 1);
    };
    const result = await runtime.service.removeApply(
      { kind: "launch-group", id: "casys-syson" },
      recovered.reviewFingerprint,
      true,
    );
    assertEquals(result.status, "removed");
    assertEquals(runtime.host.calls, [entry.id]);
    assertEquals(
      (await runtime.lock.read()).units.every((unit) => unit.desired === "inactive"),
      true,
    );
    assertEquals((await runtime.journal.listOutcomes())[0]?.status, "succeeded");
  } finally {
    await runtime.close();
  }
});

Deno.test("administrative removal is an already-absent no-op and blocks foreign or shared material", async () => {
  const absent = await removalRuntime({ state: "absent" });
  try {
    const review = await absent.service.removeReview({
      kind: "launch-group",
      id: "casys-syson",
    });
    const result = await absent.service.removeApply(
      { kind: "launch-group", id: "casys-syson" },
      review.reviewFingerprint,
      true,
    );
    assertEquals(result.status, "already-absent");
    assertEquals(absent.host.calls, []);
  } finally {
    await absent.close();
  }

  const foreign = await removalRuntime({ state: "owned", safety: "foreign" });
  try {
    await assertRejects(
      () => foreign.service.removeReview({ kind: "launch-group", id: "casys-syson" }),
      Error,
      "foreign host material",
    );
  } finally {
    await foreign.close();
  }

  const shared = await removalRuntime({});
  try {
    await assertRejects(
      () =>
        shared.service.removeReview({
          kind: "launch-group",
          id: "casys-build123d-sandbox",
        }),
      Error,
      "shared catalogue image digest",
    );
  } finally {
    await shared.close();
  }
});

async function removalRuntime(input: {
  readonly state?: "owned" | "absent";
  readonly safety?: CapabilityRuntimeAdministrativeRemovalObservation["safety"];
  readonly ledgers?: readonly ProjectCapabilityLedger[];
  readonly jit?: boolean;
  readonly leases?: "active";
}) {
  const directory = await Deno.makeTempDir({ prefix: "casys-local-admin-removal-" });
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroupRegistry();
  const group = (await groups.list()).find((candidate) =>
    candidate.id === "casys-syson"
  )!;
  const lock = new FileCapabilityRuntimeAdminLockStore(
    `${directory}/lock.json`,
    catalog,
  );
  const journal = new InMemoryCapabilityRuntimeJournal();
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  if (input.leases === "active") {
    await leases.claim({
      id: "lease-active",
      projectId: "project-lease",
      bindingIds: ["binding"],
      materialKeys: group.materials.map((member) =>
        `${member.material.unitId}\u0000${member.material.materialId}`
      ),
      launchGroups: [capabilityRuntimeLaunchGroupReference(group)],
      acquiredAt: "2026-08-29T00:00:00.000Z",
      expiresAt: "2026-08-29T01:00:00.000Z",
    });
  }
  const host = new FakeRemovalHost(
    observation(group, input.state ?? "absent", input.safety ?? "exact"),
  );
  const ledgers = new FakeLedgers(input.ledgers ?? []);
  const service = new LocalCapabilityRuntimeAdminService({
    catalog,
    ledgers,
    lock,
    hostMutationLock: new FileCapabilityRuntimeHostMutationLock(
      `${directory}/mutex.lock`,
    ),
    authorization: {} as never,
    removal: {
      groups,
      journal,
      leases,
      host,
      jitDemand: {
        hasRemainingDemand: () => Promise.resolve(input.jit === true),
      },
      now: () => "2026-08-29T00:30:00.000Z",
    },
  });
  return {
    service,
    group,
    lock,
    journal,
    host,
    close: () => Deno.remove(directory, { recursive: true }),
  };
}

class FakeRemovalHost {
  readonly calls: string[] = [];
  beforeMutate: (() => Promise<void>) | undefined;

  constructor(private observation: CapabilityRuntimeAdministrativeRemovalObservation) {}

  inspectAdministrativeRemoval(): Promise<
    CapabilityRuntimeAdministrativeRemovalObservation
  > {
    return Promise.resolve(structuredClone(this.observation));
  }

  async mutate(input: {
    readonly authorization: { readonly entry: CapabilityRuntimeJournalEntry };
  }): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = input.authorization.entry;
    await this.beforeMutate?.();
    this.calls.push(entry.id);
    this.observation = {
      ...this.observation,
      materials: this.observation.materials.map((material) => ({
        ...material,
        state: "absent" as const,
      })),
      ownedContainerIds: [],
    };
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: "2026-08-29T00:30:00.000Z",
      status: "succeeded",
      observations: entry.materials.map((material) => ({
        material,
        state: {
          material: "absent",
          runtime: "inactive",
          qualification: "unqualified",
        },
      })),
      detail: null,
    };
  }
}

class FakeLedgers {
  constructor(private readonly values: readonly ProjectCapabilityLedger[]) {}

  list(): Promise<readonly ProjectCapabilityLedger[]> {
    return Promise.resolve(structuredClone(this.values));
  }

  get(projectId: string): Promise<ProjectCapabilityLedger | undefined> {
    return Promise.resolve(
      this.values.find((ledger) => ledger.projectId === projectId),
    );
  }

  getPending(): Promise<ProjectCapabilityLedger | undefined> {
    return Promise.resolve(undefined);
  }

  append(): Promise<ProjectCapabilityLedger> {
    return Promise.reject(
      new Error("Administrative removal must not append a project ledger."),
    );
  }
}

function observation(
  group: CapabilityRuntimeLaunchGroup,
  state: "owned" | "absent",
  safety: CapabilityRuntimeAdministrativeRemovalObservation["safety"],
): CapabilityRuntimeAdministrativeRemovalObservation {
  return {
    schemaVersion: "capability-runtime-removal-observation/1.0",
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    materials: group.materials.map((member) => ({
      material: { ...member.material },
      state,
    })),
    ownedContainerIds: [],
    safety,
  };
}

function runtimeEntry(
  group: CapabilityRuntimeLaunchGroup,
  action: CapabilityRuntimeJournalEntry["action"],
  fingerprint: CapabilityRuntimeJournalEntry["administrativeRemovalPlanFingerprint"],
): CapabilityRuntimeJournalEntry {
  return {
    id: action === "material-remove" && fingerprint
      ? `capability-admin-remove-${fingerprint.digest}`
      : "unresolved-group-intent",
    action,
    materials: group.materials.map((member) => ({ ...member.material })),
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    projectId: null,
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservations: group.materials.map((member) => ({
      material: { ...member.material },
      state: {
        material: "installed",
        runtime: "inactive",
        qualification: "unqualified",
      },
    })),
    administrativeRemovalPlanFingerprint: fingerprint,
  };
}

function authorizedLedger(projectId: string, unitId: string): ProjectCapabilityLedger {
  return {
    projectId,
    effectiveEnvelope: {
      status: "authorized",
      proposal: { units: [{ id: unitId }] },
    },
  } as unknown as ProjectCapabilityLedger;
}

function revokedLedger(projectId: string): ProjectCapabilityLedger {
  return {
    projectId,
    effectiveEnvelope: { status: "revoked", proposal: { units: [] } },
  } as unknown as ProjectCapabilityLedger;
}
