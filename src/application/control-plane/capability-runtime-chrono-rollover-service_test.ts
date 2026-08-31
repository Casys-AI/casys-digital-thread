import { assertEquals, assertRejects } from "@std/assert";
import {
  InMemoryProjectCapabilityLedgerStore,
} from "../../adapters/control-plane/file-project-capability-ledger-store.ts";
import { FileCapabilityRuntimeRolloverSagaStore } from "../../adapters/control-plane/file-capability-runtime-rollover-saga-store.ts";
import {
  createFirstPartyCapabilityRuntimeCatalog,
  createFirstPartyChronoRolloverPredecessorUnit,
} from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroupRegistry,
  createFirstPartyChronoRolloverPredecessorLaunchGroup,
  firstPartyChronoLaunchGroupReference,
} from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import { capabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type {
  CapabilityRuntimeRolloverHost,
  CapabilityRuntimeRolloverHostObservation,
} from "../ports/out/capability/capability-runtime-rollover-host.ts";
import type {
  CapabilityRuntimeHostMutationLock,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import {
  fingerprintProjectCapabilityAuthorizationEvent,
  fingerprintProjectCapabilityProposal,
  PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
  PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
  type ProjectCapabilityAuthorizationEvent,
  type ProjectCapabilityLedger,
  type ProjectCapabilityProposal,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "./project-capability-authorization.ts";
import {
  CapabilityRuntimeChronoRolloverGate,
  CapabilityRuntimeChronoRolloverService,
  CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
} from "./capability-runtime-chrono-rollover-service.ts";
import {
  type AtomicCapabilityRuntimeUnit,
  CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
  type CapabilityRuntimeAdminLock,
  fingerprintAtomicCapabilityRuntimeUnit,
} from "./read-model/capability-runtime-catalog.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  InMemoryCapabilityRuntimeJournal,
  InMemoryCapabilityRuntimeLeaseStore,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type { CapabilityRuntimeLaunchGroup } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";

const ROLLOVER_AT = "2026-08-31T12:00:00.000Z";

Deno.test("Chrono rollover pulls, retires, records a verified no-op lock and never activates", async () => {
  const fixture = await rolloverFixture(["alpha"]);
  try {
    const ready = await fixture.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(ready.status, "ready");
    assertEquals(ready.identity?.affectedProjects, []);
    await assertRejects(
      () =>
        fixture.service.apply({
          transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
          reviewFingerprint: ready.reviewFingerprint!,
          confirm: false,
        }),
      Error,
      "explicit local operator confirmation",
    );
    const completed = await fixture.service.apply({
      transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
      reviewFingerprint: ready.reviewFingerprint!,
      confirm: true,
    });
    assertEquals(completed.status, "completed");
    assertEquals(completed.identity?.affectedProjects, []);
    assertEquals(fixture.host.materialAcquireCalls, 1);
    assertEquals(fixture.host.retireCalls, 1);
    assertEquals(fixture.host.activateCalls, 0);
    assertEquals(fixture.lock.saveCalls, 0);
    assertEquals(fixture.ledgers.appendCalls, 0);
    assertEquals((await fixture.ledgers.get("alpha"))?.revision, 2);
    assertEquals((await fixture.lock.read()).revision, 1);
    assertEquals((await fixture.sagas.read(key()))?.phase, "completed");
  } finally {
    await fixture.dispose();
  }
});

Deno.test("Chrono rollover resume after material and after retirement is idempotent", async () => {
  const afterMaterial = await rolloverFixture(["alpha"]);
  try {
    afterMaterial.host.failNextRetire();
    const ready = await afterMaterial.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    await assertRejects(
      () =>
        afterMaterial.service.apply({
          transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
          reviewFingerprint: ready.reviewFingerprint!,
          confirm: true,
        }),
      Error,
      "simulated retire interruption",
    );
    assertEquals(
      (await afterMaterial.sagas.read(key()))?.phase,
      "successor-material-observed",
    );
    assertEquals(afterMaterial.host.materialAcquireCalls, 1);
    assertEquals(afterMaterial.host.retireCalls, 1);
    assertEquals(afterMaterial.host.activateCalls, 0);

    const resumed = await afterMaterial.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    const completed = await afterMaterial.service.apply({
      transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
      reviewFingerprint: resumed.reviewFingerprint!,
      confirm: true,
    });
    assertEquals(completed.status, "completed");
    assertEquals(afterMaterial.host.materialAcquireCalls, 1);
    assertEquals(afterMaterial.host.retireCalls, 2);
    assertEquals(afterMaterial.host.activateCalls, 0);
  } finally {
    await afterMaterial.dispose();
  }

  const afterRetire = await rolloverFixture(["alpha"]);
  try {
    afterRetire.lock.failAtRead = 3;
    const ready = await afterRetire.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    await assertRejects(
      () =>
        afterRetire.service.apply({
          transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
          reviewFingerprint: ready.reviewFingerprint!,
          confirm: true,
        }),
      Error,
      "simulated lock interruption",
    );
    assertEquals(
      (await afterRetire.sagas.read(key()))?.phase,
      "successor-runtime-observed",
    );
    assertEquals(afterRetire.host.materialAcquireCalls, 1);
    assertEquals(afterRetire.host.retireCalls, 1);
    assertEquals(afterRetire.lock.saveCalls, 0);

    const resumed = await afterRetire.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    const completed = await afterRetire.service.apply({
      transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
      reviewFingerprint: resumed.reviewFingerprint!,
      confirm: true,
    });
    assertEquals(completed.status, "completed");
    assertEquals(afterRetire.host.materialAcquireCalls, 1);
    assertEquals(afterRetire.host.retireCalls, 1);
    assertEquals(afterRetire.host.activateCalls, 0);
    assertEquals(afterRetire.lock.saveCalls, 0);
    assertEquals(afterRetire.ledgers.appendCalls, 0);
  } finally {
    await afterRetire.dispose();
  }
});

Deno.test("Chrono rollover preflight blocks old or unknown ledger and old lock", async () => {
  const oldLedger = await rolloverFixture(["alpha"], { ledgerUnit: "predecessor" });
  try {
    const review = await oldLedger.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("not the exact successor")),
      true,
    );
    assertEquals(await oldLedger.sagas.read(key()), undefined);
    assertEquals(oldLedger.host.materialAcquireCalls, 0);
  } finally {
    await oldLedger.dispose();
  }

  const unknownLedger = await rolloverFixture(["alpha"], { ledgerUnit: "unknown" });
  try {
    const review = await unknownLedger.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("unknown Chrono unit")),
      true,
    );
  } finally {
    await unknownLedger.dispose();
  }

  const oldLock = await rolloverFixture(["alpha"], { lockUnit: "predecessor" });
  try {
    const review = await oldLock.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) =>
        blocker.includes("exact successor administrative lock")
      ),
      true,
    );
  } finally {
    await oldLock.dispose();
  }

  const inactiveDesired = await rolloverFixture(["alpha"], {
    lockDesired: "inactive",
  });
  try {
    const review = await inactiveDesired.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("authorized successor use")),
      true,
    );
  } finally {
    await inactiveDesired.dispose();
  }
});

Deno.test("Chrono rollover preflight blocks active lease, pending journal, JIT and host mismatch", async () => {
  const lease = await rolloverFixture(["alpha"], { activePredecessorLease: true });
  try {
    const review = await lease.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("active runtime lease")),
      true,
    );
    assertEquals(await lease.sagas.read(key()), undefined);
  } finally {
    await lease.dispose();
  }

  const journal = await rolloverFixture(["alpha"], { pendingJournal: true });
  try {
    const review = await journal.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("pending runtime journal")),
      true,
    );
  } finally {
    await journal.dispose();
  }

  const jit = await rolloverFixture(["alpha"], { remainingJitDemand: true });
  try {
    const review = await jit.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("JIT demand for alpha")),
      true,
    );
  } finally {
    await jit.dispose();
  }

  const pendingLedger = await rolloverFixture(["alpha"], { pendingLedger: true });
  try {
    const review = await pendingLedger.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) =>
        blocker.includes("pending project capability ledger")
      ),
      true,
    );
  } finally {
    await pendingLedger.dispose();
  }

  for (const classification of ["hybrid", "foreign", "unknown", "successor"] as const) {
    const mismatched = await rolloverFixture(["alpha"], {
      forcedHostClassification: classification,
    });
    try {
      const review = await mismatched.service.review(
        CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
      );
      assertEquals(review.status, "blocked");
      assertEquals(await mismatched.sagas.read(key()), undefined);
      assertEquals(mismatched.host.materialAcquireCalls, 0);
      assertEquals(mismatched.host.retireCalls, 0);
      assertEquals(mismatched.host.activateCalls, 0);
    } finally {
      await mismatched.dispose();
    }
  }
});

Deno.test("Chrono rollover admits predecessor or absent host and ignores expired leases", async () => {
  const absent = await rolloverFixture([], {
    initialHost: "absent",
    lockDesired: "inactive",
  });
  try {
    const review = await absent.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "ready");
    const completed = await absent.service.apply({
      transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
      reviewFingerprint: review.reviewFingerprint!,
      confirm: true,
    });
    assertEquals(completed.status, "completed");
    assertEquals(completed.identity?.affectedProjects, []);
    assertEquals(absent.host.activateCalls, 0);
  } finally {
    await absent.dispose();
  }

  const expired = await rolloverFixture(["alpha"], { expiredPredecessorLease: true });
  try {
    const review = await expired.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "ready");
    assertEquals((await expired.leases.read("expired-chrono"))?.id, "expired-chrono");
    assertEquals(await expired.leases.listActive(ROLLOVER_AT), []);
  } finally {
    await expired.dispose();
  }
});

Deno.test("Chrono rollover hybrid after durable intent becomes recovery-required", async () => {
  const fixture = await rolloverFixture(["alpha"]);
  try {
    fixture.host.forceClassificationAfterAcquire("hybrid");
    const ready = await fixture.service.review(
      CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    );
    const review = await fixture.service.apply({
      transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
      reviewFingerprint: ready.reviewFingerprint!,
      confirm: true,
    });
    assertEquals(review.status, "recovery-required");
    assertEquals((await fixture.sagas.read(key()))?.phase, "recovery-required");
    assertEquals(fixture.host.retireCalls, 0);
    assertEquals(fixture.host.activateCalls, 0);
    assertEquals(fixture.lock.saveCalls, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("Chrono rollover gate blocks only casys-chrono while the saga is nonterminal", async () => {
  const [chrono, syson] = await Promise.all([
    firstPartyGroup("casys-chrono"),
    firstPartyGroup("casys-syson"),
  ]);
  const store = new StaticSagaStore({ phase: "intent-recorded" });
  const gate = new CapabilityRuntimeChronoRolloverGate(store as never);
  await assertRejects(
    () => gate.assertLaunchGroupAvailable(chrono),
    Error,
    "non-terminal server-owned rollover",
  );
  await gate.assertLaunchGroupAvailable(syson);
  store.saga = { phase: "successor-runtime-observed" };
  await assertRejects(
    () => gate.assertLaunchGroupAvailable(chrono),
    Error,
    "non-terminal",
  );
  store.saga = { phase: "completed" };
  await gate.assertLaunchGroupAvailable(chrono);
  store.saga = undefined;
  await gate.assertLaunchGroupAvailable(chrono);
});

async function firstPartyGroup(id: string): Promise<CapabilityRuntimeLaunchGroup> {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroupRegistry();
  const catalog = await groups.list();
  const match = catalog.find((group) => group.id === id);
  if (!match) throw new Error(`missing ${id}`);
  return match;
}

async function rolloverFixture(
  projectIds: readonly string[],
  options: {
    readonly activePredecessorLease?: boolean;
    readonly expiredPredecessorLease?: boolean;
    readonly pendingJournal?: boolean;
    readonly remainingJitDemand?: boolean;
    readonly pendingLedger?: boolean;
    readonly forcedHostClassification?:
      | "hybrid"
      | "foreign"
      | "unknown"
      | "successor";
    readonly initialHost?: "predecessor" | "absent";
    readonly ledgerUnit?: "successor" | "predecessor" | "unknown";
    readonly lockUnit?: "successor" | "predecessor";
    readonly lockDesired?: "active" | "inactive";
  } = {},
) {
  const [catalog, predecessorUnit, predecessorGroup, registry] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    createFirstPartyChronoRolloverPredecessorUnit(),
    createFirstPartyChronoRolloverPredecessorLaunchGroup(),
    createFirstPartyCapabilityRuntimeLaunchGroupRegistry(),
  ]);
  const successorUnit = catalog.units.find((unit) => unit.id === "casys.mcp-chrono");
  if (!successorUnit) throw new Error("missing successor unit");
  const successorGroup = await registry.require(
    await firstPartyChronoLaunchGroupReference(),
  );
  const baseLedgers = new InMemoryProjectCapabilityLedgerStore();
  const ledgerUnit = options.ledgerUnit === "predecessor"
    ? predecessorUnit
    : options.ledgerUnit === "unknown"
    ? await unknownChronoUnit(successorUnit)
    : successorUnit;
  for (const projectId of projectIds) {
    await seedAuthorizedLedger(baseLedgers, projectId, ledgerUnit);
  }
  const ledgers = new CountingLedgerStore(baseLedgers, options.pendingLedger === true);
  const directory = await Deno.makeTempDir({ prefix: "chrono-rollover-" });
  const sagas = new FileCapabilityRuntimeRolloverSagaStore(directory);
  const lockUnit = options.lockUnit === "predecessor" ? predecessorUnit : successorUnit;
  const lock = new MemoryLock(
    successorLock(lockUnit, options.lockDesired ?? "active"),
  );
  const host = new RecordingChronoRolloverHost(
    options.initialHost ?? "predecessor",
  );
  host.forceClassification(options.forcedHostClassification);
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  if (options.activePredecessorLease) {
    await leases.claim({
      id: "active-chrono",
      projectId: "alpha",
      bindingIds: ["chrono"],
      materialKeys: ["casys.mcp-chrono\u0000mcp-chrono-image"],
      launchGroups: [capabilityRuntimeLaunchGroupReference(predecessorGroup)],
      acquiredAt: "2026-08-31T11:00:00.000Z",
      expiresAt: "2026-08-31T13:00:00.000Z",
    });
  }
  if (options.expiredPredecessorLease) {
    await leases.claim({
      id: "expired-chrono",
      projectId: "alpha",
      bindingIds: ["chrono"],
      materialKeys: ["casys.mcp-chrono\u0000mcp-chrono-image"],
      launchGroups: [capabilityRuntimeLaunchGroupReference(predecessorGroup)],
      acquiredAt: "2026-08-31T10:00:00.000Z",
      expiresAt: "2026-08-31T11:00:00.000Z",
    });
  }
  const journal = new InMemoryCapabilityRuntimeJournal();
  if (options.pendingJournal) {
    await journal.appendBeforeMutation({
      id: "pending-chrono",
      launchGroup: capabilityRuntimeLaunchGroupReference(predecessorGroup),
    } as never);
  }
  const service = new CapabilityRuntimeChronoRolloverService({
    catalog,
    predecessor: { unit: predecessorUnit, launchGroup: predecessorGroup },
    successor: { unit: successorUnit, launchGroup: successorGroup },
    ledgers,
    lock,
    leases,
    journal,
    sagas,
    host,
    hostMutationLock: DIRECT_LOCK,
    jitDemand: {
      hasRemainingDemand: () => Promise.resolve(options.remainingJitDemand === true),
    },
    now: () => ROLLOVER_AT,
  });
  return {
    service,
    ledgers,
    sagas,
    host,
    lock,
    leases,
    predecessorGroup,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

class RecordingChronoRolloverHost implements CapabilityRuntimeRolloverHost {
  #stage: "predecessor" | "material" | "absent";
  materialAcquireCalls = 0;
  retireCalls = 0;
  activateCalls = 0;
  #forcedClassification:
    | "hybrid"
    | "foreign"
    | "unknown"
    | "successor"
    | undefined;
  #classificationAfterAcquire: "hybrid" | "foreign" | undefined;
  #failNextRetire = false;

  constructor(initial: "predecessor" | "absent") {
    this.#stage = initial === "absent" ? "absent" : "predecessor";
  }

  forceClassification(
    value: "hybrid" | "foreign" | "unknown" | "successor" | undefined,
  ): void {
    this.#forcedClassification = value;
  }

  forceClassificationAfterAcquire(value: "hybrid" | "foreign"): void {
    this.#classificationAfterAcquire = value;
  }

  failNextRetire(): void {
    this.#failNextRetire = true;
  }

  observeRollover(): Promise<CapabilityRuntimeRolloverHostObservation> {
    return Promise.resolve(this.#observation());
  }

  acquireRolloverSuccessorMaterial(): Promise<
    CapabilityRuntimeRolloverHostObservation
  > {
    this.materialAcquireCalls += 1;
    if (this.#classificationAfterAcquire) {
      this.#forcedClassification = this.#classificationAfterAcquire;
      return Promise.resolve(this.#observation());
    }
    if (this.#stage === "predecessor") this.#stage = "material";
    return Promise.resolve(this.#observation());
  }

  activateRolloverSuccessor(): Promise<CapabilityRuntimeRolloverHostObservation> {
    this.activateCalls += 1;
    return Promise.resolve(this.#observation());
  }

  retireRolloverPredecessor(): Promise<CapabilityRuntimeRolloverHostObservation> {
    this.retireCalls += 1;
    if (this.#failNextRetire) {
      this.#failNextRetire = false;
      return Promise.reject(new Error("simulated retire interruption"));
    }
    this.#stage = "absent";
    return Promise.resolve(this.#observation());
  }

  #observation(): CapabilityRuntimeRolloverHostObservation {
    if (this.#forcedClassification) {
      return observation(
        this.#forcedClassification,
        "complete",
        this.#forcedClassification === "successor" ? "active" : "inactive",
        "complete",
        this.#forcedClassification === "successor" ? "active" : "inactive",
      );
    }
    if (this.#stage === "predecessor") {
      return observation("predecessor", "complete", "active", "incomplete", "inactive");
    }
    if (this.#stage === "material") {
      return observation("predecessor", "complete", "active", "complete", "inactive");
    }
    return observation("absent", "incomplete", "inactive", "complete", "inactive");
  }
}

function observation(
  classification: CapabilityRuntimeRolloverHostObservation["classification"],
  predecessorMaterials: "complete" | "incomplete",
  predecessorRuntime: "active" | "inactive" | "degraded",
  successorMaterials: "complete" | "incomplete",
  successorRuntime: "active" | "inactive" | "degraded",
): CapabilityRuntimeRolloverHostObservation {
  return {
    schemaVersion: "capability-runtime-rollover-host-observation/1.0",
    classification,
    predecessor: { materials: predecessorMaterials, runtime: predecessorRuntime },
    successor: { materials: successorMaterials, runtime: successorRuntime },
  };
}

class CountingLedgerStore implements ProjectCapabilityLedgerStore {
  appendCalls = 0;

  constructor(
    private readonly delegate: InMemoryProjectCapabilityLedgerStore,
    private readonly pending = false,
  ) {}

  get(projectId: string) {
    return this.delegate.get(projectId);
  }

  list() {
    return this.delegate.list();
  }

  listPending() {
    return this.pending ? this.delegate.list() : this.delegate.listPending();
  }

  getPending(projectId: string) {
    return this.delegate.getPending(projectId);
  }

  append(ledger: ProjectCapabilityLedger, expectedRevision: number) {
    this.appendCalls += 1;
    return this.delegate.append(ledger, expectedRevision);
  }
}

class MemoryLock {
  saveCalls = 0;
  failAtRead = 0;
  #reads = 0;
  #history = new Map<number, CapabilityRuntimeAdminLock>();

  constructor(private current: CapabilityRuntimeAdminLock) {
    this.#history.set(current.revision, structuredClone(current));
  }

  read(): Promise<CapabilityRuntimeAdminLock> {
    this.#reads += 1;
    if (this.#reads === this.failAtRead) {
      return Promise.reject(new Error("simulated lock interruption"));
    }
    return Promise.resolve(structuredClone(this.current));
  }

  save(value: CapabilityRuntimeAdminLock): Promise<void> {
    this.saveCalls += 1;
    this.current = structuredClone(value);
    this.#history.set(value.revision, structuredClone(value));
    return Promise.resolve();
  }
}

class StaticSagaStore {
  constructor(
    public saga: { readonly phase: string } | undefined,
  ) {}

  read(): Promise<{ readonly phase: string } | undefined> {
    return Promise.resolve(this.saga);
  }
}

const DIRECT_LOCK: CapabilityRuntimeHostMutationLock = {
  withLock: async <T>(operation: () => Promise<T>) => await operation(),
};

async function seedAuthorizedLedger(
  store: InMemoryProjectCapabilityLedgerStore,
  projectId: string,
  unit: AtomicCapabilityRuntimeUnit,
): Promise<void> {
  const proposal = await proposalFor(projectId, unit);
  const prepared = await preparedEvent(proposal);
  const first = await ledger(projectId, null, [prepared]);
  await store.append(first, 0);
  const authorized = await authorizedEvent(proposal);
  await store.append(await ledger(projectId, first, [...first.events, authorized]), 1);
}

async function proposalFor(
  projectId: string,
  unit: AtomicCapabilityRuntimeUnit,
): Promise<ProjectCapabilityProposal> {
  const body = {
    schemaVersion: PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
    mutatesRuntime: false as const,
    projectId,
    source: "published-plan" as const,
    brief: {
      briefSnapshotId: "brief-snapshot",
      briefRevision: 1,
      briefReviewFingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
    },
    intent: null,
    semanticRequirements: [],
    bindings: [],
    units: [unit],
    materials: unit.materials.map((material) => ({
      unitId: unit.id,
      materialId: material.id,
      imageReference: material.imageReference,
      mode: "native" as const,
      downloadBytes: material.effects.downloadBytes,
      storageBytes: material.effects.storageBytes,
    })),
    effects: {
      downloadBytes: 0,
      storageBytes: 0,
      services: [],
      volumes: [],
      networks: [],
      loopbackPorts: [],
      bindMounts: [],
      privileged: false as const,
      dockerSocket: false as const,
      devices: [],
      secretSlots: [],
      licences: [],
      security: "reviewed" as const,
    },
    status: "ready" as const,
    activation: "allowed" as const,
    blockers: [],
  };
  return {
    ...body,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(body),
  };
}

async function preparedEvent(
  proposal: ProjectCapabilityProposal,
): Promise<ProjectCapabilityAuthorizationEvent> {
  const body = {
    kind: "initial-prepared" as const,
    recordedAt: "2026-08-31T11:59:00.000Z",
    proposal,
  };
  return {
    ...body,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(body),
  };
}

async function authorizedEvent(
  proposal: ProjectCapabilityProposal,
): Promise<ProjectCapabilityAuthorizationEvent> {
  const body = {
    kind: "initial-authorized" as const,
    recordedAt: "2026-08-31T11:59:01.000Z",
    proposalFingerprint: proposal.capabilityProposalFingerprint,
    approval: {
      projectSnapshotId: "project-snapshot",
      projectRevision: 1,
      approvedBriefFingerprint: proposal.brief.briefReviewFingerprint,
    },
  };
  return {
    ...body,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(body),
  };
}

async function ledger(
  projectId: string,
  previous: ProjectCapabilityLedger | null,
  events: readonly ProjectCapabilityAuthorizationEvent[],
): Promise<ProjectCapabilityLedger> {
  const effectiveEnvelope = await reconstructProjectCapabilityEffectiveEnvelope(events);
  const body = {
    schemaVersion: PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
    projectId,
    revision: (previous?.revision ?? 0) + 1,
    previous: previous?.ledgerFingerprint ?? null,
    events,
    effectiveEnvelope,
  } as const;
  return { ...body, ledgerFingerprint: await sha256Fingerprint(body) };
}

function successorLock(
  unit: AtomicCapabilityRuntimeUnit,
  desired: "active" | "inactive",
): CapabilityRuntimeAdminLock {
  return {
    schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
    revision: 1,
    previous: null,
    units: [{
      id: unit.id,
      version: unit.version,
      manifestFingerprint: structuredClone(unit.manifestFingerprint),
      desired,
    }],
  };
}

async function unknownChronoUnit(
  successor: AtomicCapabilityRuntimeUnit,
): Promise<AtomicCapabilityRuntimeUnit> {
  const body = {
    id: successor.id,
    version: "0.0.0",
    materials: successor.materials,
  };
  return {
    ...body,
    manifestFingerprint: await fingerprintAtomicCapabilityRuntimeUnit(body),
  };
}

function key() {
  return { transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID } as const;
}
