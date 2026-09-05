import { assertEquals, assertRejects } from "@std/assert";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeHostMutationLock,
} from "../../adapters/control-plane/file-capability-runtime-host-stores.ts";
import { InMemoryCapabilityRuntimeCachePreparationJournal } from "../../adapters/control-plane/in-memory-capability-runtime-cache-preparation.ts";
import { InMemoryCapabilityRuntimeLeaseStore } from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import { InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal } from "../../adapters/control-plane/in-memory-capability-runtime-nonpersistent-material-removal.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "./capability-runtime-launch-group-registry.ts";
import {
  createCapabilityRuntimeCachePreparationIntent,
  createCapabilityRuntimeCachePreparationRecipe,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { CapabilityRuntimeNonpersistentMaterialRemovalObservation } from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import type { ProjectCapabilityLedger } from "../../domain/capability/project-capability-authorization.ts";
import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { LocalCapabilityRuntimeAdminService } from "./local-capability-runtime-admin-service.ts";

const DIGEST = "a".repeat(64);
const REFERENCE = `casys/cache-source@sha256:${DIGEST}`;
const TARGET = {
  kind: "material" as const,
  unitId: "casys.cache-worker",
  materialId: "cache-source-image",
};

Deno.test("non-persistent removal blocks ledger, lease, JIT, cache preparation, shared digest, lock and stale review", async () => {
  const authorized = await runtime({
    ledgers: [authorizedLedger("project-b", "casys.cache-worker")],
  });
  try {
    await assertRejects(
      () => authorized.service.removeReview(TARGET),
      Error,
      "authorized project ledger",
    );
  } finally {
    await authorized.close();
  }

  const pending = await runtime({
    pendingLedgers: [pendingPreparedLedger("project-pending", "casys.cache-worker")],
  });
  try {
    await assertRejects(
      () => pending.service.removeReview(TARGET),
      Error,
      "pending project capability ledger",
    );
  } finally {
    await pending.close();
  }

  const lease = await runtime({ leases: "active" });
  try {
    await assertRejects(
      () => lease.service.removeReview(TARGET),
      Error,
      "active runtime lease",
    );
  } finally {
    await lease.close();
  }

  const jit = await runtime({
    ledgers: [revokedLedger("project-jit")],
    jit: true,
  });
  try {
    await assertRejects(
      () => jit.service.removeReview(TARGET),
      Error,
      "JIT demand",
    );
  } finally {
    await jit.close();
  }

  const unread = await runtime({
    ledgers: [revokedLedger("project-jit")],
    jitError: true,
  });
  try {
    await assertRejects(
      () => unread.service.removeReview(TARGET),
      Error,
      "JIT demand cannot be read",
    );
  } finally {
    await unread.close();
  }

  const preparing = await runtime({});
  try {
    await preparing.cachePreparations.appendIntent(await pendingCacheIntent());
    await assertRejects(
      () => preparing.service.removeReview(TARGET),
      Error,
      "pending cache preparation",
    );
  } finally {
    await preparing.close();
  }

  const shared = await runtime({ sharedDigest: true });
  try {
    await assertRejects(
      () => shared.service.removeReview(TARGET),
      Error,
      "shared catalogue image digest",
    );
  } finally {
    await shared.close();
  }

  const stale = await runtime({ state: "owned" });
  try {
    const review = await stale.service.removeReview(TARGET);
    await assertRejects(
      () =>
        stale.service.removeApply(TARGET, {
          algorithm: "sha256",
          digest: "f".repeat(64),
        }, true),
      Error,
      "stale",
    );
    await assertRejects(
      () => stale.service.removeApply(TARGET, review.reviewFingerprint, false),
      Error,
      "--confirm",
    );
  } finally {
    await stale.close();
  }
});

Deno.test("non-persistent removal rereads durable intent before one mutation and resumes only the identical plan", async () => {
  const owned = await runtime({ state: "owned" });
  try {
    const review = await owned.service.removeReview(TARGET);
    owned.host.beforeMutate = async () => {
      assertEquals((await owned.journal.listIntents()).length, 1);
      assertEquals(
        (await owned.lock.read()).units.every((unit) => unit.desired === "inactive"),
        true,
      );
    };
    const result = await owned.service.removeApply(
      TARGET,
      review.reviewFingerprint,
      true,
    );
    assertEquals(result.status, "removed");
    assertEquals(owned.host.calls, 1);
    assertEquals((await owned.journal.listOutcomes())[0]?.status, "succeeded");
  } finally {
    await owned.close();
  }

  const recovered = await runtime({ state: "owned" });
  try {
    const first = await recovered.service.removeReview(TARGET);
    if (first.kind !== "remove-nonpersistent-apply") {
      throw new Error("expected non-persistent review");
    }
    const {
      capabilityRuntimeNonpersistentRemovalIntentId,
      createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
    } = await import(
      "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts"
    );
    await recovered.journal.appendIntent(
      await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
        id: capabilityRuntimeNonpersistentRemovalIntentId({
          planFingerprint: first.plan.fingerprint,
          generation: 1,
        }),
        unit: first.plan.unit,
        material: first.plan.material,
        backend: first.plan.backend,
        generation: 1,
        planFingerprint: first.plan.fingerprint,
        previousObservation: first.plan.observedState,
        plannedAt: "2026-08-31T00:00:00.000Z",
      }),
    );
    const resume = await recovered.service.removeReview(TARGET);
    assertEquals(resume.recovery, "resume-pending");
    recovered.host.calls = 0;
    const applied = await recovered.service.removeApply(
      TARGET,
      resume.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "removed");
    assertEquals(recovered.host.calls, 1);
    assertEquals((await recovered.journal.listIntents()).length, 1);
  } finally {
    await recovered.close();
  }
});

Deno.test("non-persistent removal uses the next generation after a succeeded intent and later cache preparation", async () => {
  const owned = await runtime({ state: "owned" });
  try {
    const firstReview = await owned.service.removeReview(TARGET);
    const first = await owned.service.removeApply(
      TARGET,
      firstReview.reviewFingerprint,
      true,
    );
    assertEquals(first.status, "removed");
    assertEquals(owned.host.calls, 1);
    const firstIntents = await owned.journal.listIntents();
    assertEquals(firstIntents.map((intent) => intent.generation), [1]);
    owned.host.observation = { ...owned.host.observation, state: "owned" };
    const secondReview = await owned.service.removeReview(TARGET);
    if (secondReview.kind !== "remove-nonpersistent-apply") {
      throw new Error("expected non-persistent review");
    }
    assertEquals(secondReview.recovery, "none");
    const second = await owned.service.removeApply(
      TARGET,
      secondReview.reviewFingerprint,
      true,
    );
    assertEquals(second.status, "removed");
    assertEquals(owned.host.calls, 2);
    const intents = await owned.journal.listIntents();
    assertEquals(intents.map((intent) => intent.generation), [1, 2]);
    assertEquals((await owned.journal.listOutcomes()).length, 2);
  } finally {
    await owned.close();
  }
});

Deno.test("non-persistent crash after host effect completes the pending intent without another mutation", async () => {
  const crashed = await runtime({ state: "owned" });
  try {
    const first = await crashed.service.removeReview(TARGET);
    if (first.kind !== "remove-nonpersistent-apply") {
      throw new Error("expected non-persistent review");
    }
    const {
      capabilityRuntimeNonpersistentRemovalIntentId,
      createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
    } = await import(
      "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts"
    );
    await crashed.journal.appendIntent(
      await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
        id: capabilityRuntimeNonpersistentRemovalIntentId({
          planFingerprint: first.plan.fingerprint,
          generation: 1,
        }),
        unit: first.plan.unit,
        material: first.plan.material,
        backend: first.plan.backend,
        generation: 1,
        planFingerprint: first.plan.fingerprint,
        previousObservation: first.plan.observedState,
        plannedAt: "2026-08-31T00:00:00.000Z",
      }),
    );
    crashed.host.observation = { ...crashed.host.observation, state: "absent" };
    const recovered = await crashed.service.removeReview(TARGET);
    if (recovered.kind !== "remove-nonpersistent-apply") {
      throw new Error("expected non-persistent review");
    }
    assertEquals(recovered.recovery, "complete-pending-absent");
    assertEquals(recovered.plan.observedState, "absent");
    crashed.host.calls = 0;
    const applied = await crashed.service.removeApply(
      TARGET,
      recovered.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "already-absent");
    assertEquals(crashed.host.calls, 0);
    const outcomes = await crashed.journal.listOutcomes();
    assertEquals(outcomes.length, 1);
    assertEquals(outcomes[0]?.status, "succeeded");
    assertEquals(outcomes[0]?.observedState, "absent");
    assertEquals((await crashed.journal.listIntents()).length, 1);
  } finally {
    await crashed.close();
  }
});

Deno.test("non-persistent already-absent is a no-op without a host mutation", async () => {
  const absent = await runtime({ state: "absent" });
  try {
    const review = await absent.service.removeReview(TARGET);
    const result = await absent.service.removeApply(
      TARGET,
      review.reviewFingerprint,
      true,
    );
    assertEquals(result.status, "already-absent");
    assertEquals(absent.host.calls, 0);
    assertEquals((await absent.journal.listIntents()).length, 0);
  } finally {
    await absent.close();
  }
});

Deno.test("non-persistent removal refuses a different pending plan before mutation", async () => {
  const owned = await runtime({ state: "owned" });
  try {
    const review = await owned.service.removeReview(TARGET);
    if (review.kind !== "remove-nonpersistent-apply") {
      throw new Error("expected non-persistent review");
    }
    const { createCapabilityRuntimeNonpersistentMaterialRemovalIntent } = await import(
      "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts"
    );
    await owned.journal.appendIntent(
      await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
        id: "other-pending-intent",
        unit: review.plan.unit,
        material: review.plan.material,
        backend: review.plan.backend,
        generation: 1,
        planFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
        previousObservation: "owned",
        plannedAt: "2026-08-31T00:00:00.000Z",
      }),
    );
    await assertRejects(
      () => owned.service.removeReview(TARGET),
      Error,
      "pending non-persistent journal mutation",
    );
    assertEquals(owned.host.calls, 0);
  } finally {
    await owned.close();
  }
});

async function runtime(input: {
  readonly state?: "owned" | "absent";
  readonly safety?: CapabilityRuntimeNonpersistentMaterialRemovalObservation["safety"];
  readonly ledgers?: readonly ProjectCapabilityLedger[];
  readonly pendingLedgers?: readonly ProjectCapabilityLedger[];
  readonly jit?: boolean;
  readonly jitError?: boolean;
  readonly leases?: "active";
  readonly sharedDigest?: boolean;
}) {
  const directory = await Deno.makeTempDir({
    prefix: "casys-local-admin-nonpersistent-",
  });
  const catalog = await syntheticCatalog(input.sharedDigest === true);
  const lock = new FileCapabilityRuntimeAdminLockStore(
    `${directory}/lock.json`,
    catalog,
  );
  const journal = new InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal();
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  if (input.leases === "active") {
    await leases.claim({
      id: "lease-active",
      projectId: "project-lease",
      bindingIds: ["binding"],
      materialKeys: [`${TARGET.unitId}\u0000${TARGET.materialId}`],
      launchGroups: [],
      acquiredAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2026-08-31T01:00:00.000Z",
    });
  }
  const host = new FakeNonpersistentHost(
    observation(input.state ?? "absent", input.safety ?? "exact"),
  );
  const cachePreparations = new InMemoryCapabilityRuntimeCachePreparationJournal();
  const service = new LocalCapabilityRuntimeAdminService({
    catalog,
    ledgers: new FakeLedgers(input.ledgers ?? [], input.pendingLedgers ?? []),
    lock,
    hostMutationLock: new FileCapabilityRuntimeHostMutationLock(
      `${directory}/mutex.lock`,
    ),
    authorization: {} as never,
    nonpersistentRemoval: {
      journal,
      leases,
      host,
      groups: new FixedCapabilityRuntimeLaunchGroupRegistry([]),
      cachePreparations,
      jitDemand: {
        hasRemainingDemand: () =>
          input.jitError
            ? Promise.reject(new Error("JIT unread"))
            : Promise.resolve(input.jit === true),
      },
      now: () => "2026-08-31T00:30:00.000Z",
    },
  });
  return {
    service,
    lock,
    journal,
    host,
    cachePreparations,
    close: () => Deno.remove(directory, { recursive: true }),
  };
}

class FakeNonpersistentHost {
  calls = 0;
  beforeMutate: (() => Promise<void>) | undefined;
  observation: CapabilityRuntimeNonpersistentMaterialRemovalObservation;

  constructor(
    observation: CapabilityRuntimeNonpersistentMaterialRemovalObservation,
  ) {
    this.observation = observation;
  }

  inspect() {
    return Promise.resolve(structuredClone(this.observation));
  }

  async mutate(input: {
    readonly authorization: {
      readonly intent: {
        readonly id: string;
        readonly fingerprint: {
          readonly algorithm: "sha256";
          readonly digest: string;
        };
      };
    };
    readonly plan: { readonly fingerprint: { readonly digest: string } };
  }) {
    await this.beforeMutate?.();
    this.calls += 1;
    this.observation = { ...this.observation, state: "absent" };
    const { createCapabilityRuntimeNonpersistentMaterialRemovalOutcome } = await import(
      "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts"
    );
    return await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome({
      intentId: input.authorization.intent.id,
      intentFingerprint: input.authorization.intent.fingerprint,
      recordedAt: "2026-08-31T00:30:00.000Z",
      status: "succeeded",
      observedState: "absent",
      detail: null,
    });
  }
}

class FakeLedgers {
  constructor(
    private readonly values: readonly ProjectCapabilityLedger[],
    private readonly pending: readonly ProjectCapabilityLedger[] = [],
  ) {}

  list() {
    return Promise.resolve(structuredClone(this.values));
  }
  get(projectId: string) {
    return Promise.resolve(
      this.values.find((ledger) => ledger.projectId === projectId),
    );
  }
  getPending() {
    return Promise.resolve(undefined);
  }
  listPending() {
    return Promise.resolve(structuredClone(this.pending));
  }
  append() {
    return Promise.reject(new Error("must not append a project ledger"));
  }
}

function observation(
  state: "owned" | "absent",
  safety: CapabilityRuntimeNonpersistentMaterialRemovalObservation["safety"],
): CapabilityRuntimeNonpersistentMaterialRemovalObservation {
  return {
    schemaVersion: "capability-runtime-nonpersistent-removal-observation/1.0",
    material: {
      unitId: TARGET.unitId,
      materialId: TARGET.materialId,
      imageReference: REFERENCE,
      imageDigest: DIGEST,
      launchGroup: null,
    },
    backend: "docker-cache",
    state,
    safety,
  };
}

async function syntheticCatalog(
  sharedDigest: boolean,
): Promise<CapabilityRuntimeCatalog> {
  const material = {
    id: "cache-source-image",
    kind: "oci-image" as const,
    imageReference: REFERENCE,
    platforms: ["linux/arm64"] as const,
    lifecycle: "cache" as const,
    launchGroup: null,
    effects: emptyEffects(),
  };
  const unit = {
    id: "casys.cache-worker",
    version: "1.0.0",
    materials: sharedDigest
      ? [
        material,
        {
          ...material,
          id: "other-cache-image",
          imageReference: `casys/other@sha256:${DIGEST}`,
        },
      ]
      : [material],
    manifestFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
  };
  unit.manifestFingerprint = await sha256Fingerprint({
    schemaVersion: "capability-runtime-unit/1.0",
    id: unit.id,
    version: unit.version,
    materials: unit.materials,
  });
  return {
    schemaVersion: "capability-runtime-catalog/1.0",
    productionEligible: false,
    units: [unit],
    bindings: [],
  };
}

function emptyEffects() {
  return {
    downloadBytes: null,
    storageBytes: null,
    services: [],
    volumes: [],
    network: "deny-all" as const,
    loopbackPorts: [],
    bindMounts: [],
    privileged: false as const,
    dockerSocket: false as const,
    devices: [],
    secretSlots: [],
    licence: { status: "reviewed" as const, reference: null },
    security: "reviewed" as const,
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

function pendingPreparedLedger(
  projectId: string,
  unitId: string,
): ProjectCapabilityLedger {
  return {
    projectId,
    effectiveEnvelope: null,
    events: [{ kind: "initial-prepared", proposal: { units: [{ id: unitId }] } }],
  } as unknown as ProjectCapabilityLedger;
}

async function pendingCacheIntent() {
  const recipe = await createCapabilityRuntimeCachePreparationRecipe({
    schemaVersion: "capability-runtime-cache-preparation-recipe/1.0",
    id: "cache-source",
    version: "1.0.0",
    scope: {
      materials: [{
        material: {
          unitId: TARGET.unitId,
          materialId: TARGET.materialId,
          imageDigest: DIGEST,
        },
        imageReference: REFERENCE,
        lifecycle: "cache",
        profile: {
          id: "profile",
          version: "1.0.0",
          fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
        },
      }],
    },
  });
  return await createCapabilityRuntimeCachePreparationIntent({
    projectId: "project-prep",
    recipe,
    generation: 1,
    predecessor: null,
    plannedAt: "2026-08-31T00:00:00.000Z",
  });
}
