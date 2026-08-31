import { assertEquals, assertRejects } from "@std/assert";
import {
  InMemoryProjectCapabilityLedgerStore,
} from "../../adapters/control-plane/file-project-capability-ledger-store.ts";
import { FileCapabilityRuntimeRolloverSagaStore } from "../../adapters/control-plane/file-capability-runtime-rollover-saga-store.ts";
import {
  createFirstPartyCapabilityRuntimeCatalog,
  createFirstPartySysonRolloverPredecessorUnit,
} from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroupRegistry,
  createFirstPartySysonRolloverPredecessorLaunchGroup,
  firstPartySysonLaunchGroupReference,
} from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import { capabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type {
  CapabilityRuntimeRolloverHost,
  CapabilityRuntimeRolloverHostObservation,
} from "../ports/out/capability/capability-runtime-rollover-host.ts";
import type {
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLeaseStore,
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
import type { CapabilityRuntimeAdminLockWriter } from "./project-capability-authorization-service.ts";
import {
  CapabilityRuntimeSysonRolloverService,
  SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
} from "./capability-runtime-syson-rollover-service.ts";
import {
  type AtomicCapabilityRuntimeUnit,
  CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
  type CapabilityRuntimeAdminLock,
  type CapabilityRuntimeCatalog,
} from "./read-model/capability-runtime-catalog.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";

const ROLLOVER_AT = "2026-08-30T12:00:00.000Z";

Deno.test("SysON rollover resumes after a crash after successor Docker activation without repeating it", async () => {
  const fixture = await rolloverFixture(["alpha"]);
  try {
    fixture.ledgers.failNextFor("alpha");
    const ready = await fixture.service.review(
      SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(
      (await fixture.service.review(SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID))
        .reviewFingerprint,
      ready.reviewFingerprint,
    );
    await assertRejects(
      () =>
        fixture.service.apply({
          transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
          reviewFingerprint: ready.reviewFingerprint!,
          confirm: true,
        }),
      Error,
      "simulated ledger interruption",
    );
    assertEquals(
      (await fixture.sagas.read(key()))?.phase,
      "successor-runtime-observed",
    );
    assertEquals(fixture.host.materialAcquireCalls, 1);
    assertEquals(fixture.host.runtimeStartCalls, 1);

    const resumed = await fixture.service.review(
      SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    );
    const completed = await fixture.service.apply({
      transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
      reviewFingerprint: resumed.reviewFingerprint!,
      confirm: true,
    });
    assertEquals(completed.status, "completed");
    assertEquals(fixture.host.materialAcquireCalls, 1);
    assertEquals(fixture.host.runtimeStartCalls, 1);
    assertEquals((await fixture.ledgers.get("alpha"))?.revision, 3);
    assertEquals(
      (await fixture.ledgers.get("alpha"))?.events.at(-1)?.recordedAt,
      ROLLOVER_AT,
    );
  } finally {
    await fixture.dispose();
  }
});

Deno.test("SysON rollover resumes after one project ledger without rewriting its amendment", async () => {
  const fixture = await rolloverFixture(["alpha", "bravo"]);
  try {
    fixture.ledgers.failNextFor("bravo");
    const ready = await fixture.service.review(
      SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(
      (await fixture.service.review(SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID))
        .reviewFingerprint,
      ready.reviewFingerprint,
    );
    await assertRejects(
      () =>
        fixture.service.apply({
          transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
          reviewFingerprint: ready.reviewFingerprint!,
          confirm: true,
        }),
      Error,
      "simulated ledger interruption",
    );
    const alphaAfterCrash = await fixture.ledgers.get("alpha");
    assertEquals(
      (await fixture.sagas.read(key()))?.phase,
      "project-amendment-recorded",
    );
    assertEquals((await fixture.sagas.read(key()))?.projectId, "alpha");
    assertEquals(alphaAfterCrash?.revision, 3);

    const resumed = await fixture.service.review(
      SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    );
    const completed = await fixture.service.apply({
      transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
      reviewFingerprint: resumed.reviewFingerprint!,
      confirm: true,
    });
    assertEquals(completed.status, "completed");
    assertEquals(
      (await fixture.ledgers.get("alpha"))?.ledgerFingerprint,
      alphaAfterCrash?.ledgerFingerprint,
    );
    assertEquals((await fixture.ledgers.get("bravo"))?.revision, 3);
    assertEquals(fixture.host.runtimeStartCalls, 1);
    for (const projectId of ["alpha", "bravo"]) {
      const successor = (await fixture.ledgers.get(projectId))?.effectiveEnvelope
        ?.proposal.units.find((unit) => unit.id === "casys.syson-stack");
      assertEquals(successor?.version, fixture.successor.unit.version);
      assertEquals(
        successor?.manifestFingerprint,
        fixture.successor.unit.manifestFingerprint,
      );
    }
    const locked = (await fixture.lock.read()).units.find((unit) =>
      unit.id === "casys.syson-stack"
    );
    assertEquals(locked?.version, fixture.successor.unit.version);
    assertEquals(
      locked?.manifestFingerprint,
      fixture.successor.unit.manifestFingerprint,
    );
  } finally {
    await fixture.dispose();
  }
});

Deno.test("SysON rollover preflight blocks a retained lease and hybrid host without a saga or mutation", async () => {
  const fixture = await rolloverFixture(["alpha"], {
    activePredecessorLease: true,
    forcedHostClassification: "hybrid",
  });
  try {
    const review = await fixture.service.review(
      SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("active runtime lease")),
      true,
    );
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("hybrid or foreign")),
      true,
    );
    assertEquals(await fixture.sagas.read(key()), undefined);
    assertEquals(fixture.host.materialAcquireCalls, 0);
    assertEquals(fixture.host.runtimeStartCalls, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("SysON rollover preflight blocks a remaining JIT demand without a saga or mutation", async () => {
  const fixture = await rolloverFixture(["alpha"], { remainingJitDemand: true });
  try {
    const review = await fixture.service.review(
      SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "blocked");
    assertEquals(
      review.blockers.some((blocker) => blocker.includes("JIT demand for alpha")),
      true,
    );
    assertEquals(await fixture.sagas.read(key()), undefined);
    assertEquals(fixture.host.materialAcquireCalls, 0);
    assertEquals(fixture.host.runtimeStartCalls, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("SysON rollover preflight recognizes a ledger whose exact SysON materials are permuted", async () => {
  const fixture = await rolloverFixture(["alpha"], {
    permutePredecessorMaterials: true,
  });
  try {
    const review = await fixture.service.review(
      SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    );
    assertEquals(review.status, "ready");
    assertEquals(review.blockers, []);
  } finally {
    await fixture.dispose();
  }
});

async function rolloverFixture(
  projectIds: readonly string[],
  options: {
    readonly activePredecessorLease?: boolean;
    readonly forcedHostClassification?: "hybrid" | "foreign";
    readonly permutePredecessorMaterials?: boolean;
    readonly remainingJitDemand?: boolean;
  } = {},
) {
  const [catalog, predecessorUnit, predecessorGroup, registry] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    createFirstPartySysonRolloverPredecessorUnit(),
    createFirstPartySysonRolloverPredecessorLaunchGroup(),
    createFirstPartyCapabilityRuntimeLaunchGroupRegistry(),
  ]);
  const successorUnit = catalog.units.find((unit) => unit.id === "casys.syson-stack");
  if (!successorUnit) throw new Error("missing successor unit");
  const successorGroup = await registry.require(
    await firstPartySysonLaunchGroupReference(),
  );
  const baseLedgers = new InMemoryProjectCapabilityLedgerStore();
  for (const projectId of projectIds) {
    await seedAuthorizedLedger(
      baseLedgers,
      projectId,
      predecessorUnit,
      options.permutePredecessorMaterials,
    );
  }
  const ledgers = new InterruptingLedgerStore(baseLedgers);
  const directory = await Deno.makeTempDir({ prefix: "syson-rollover-" });
  const sagas = new FileCapabilityRuntimeRolloverSagaStore(directory);
  const lock = new MemoryLock(await predecessorLock(predecessorUnit));
  const host = new RecordingRolloverHost();
  host.forceClassification(options.forcedHostClassification);
  const leases: CapabilityRuntimeLeaseStore = options.activePredecessorLease
    ? {
      ...EMPTY_LEASES,
      listActive: async () =>
        [{
          launchGroups: [capabilityRuntimeLaunchGroupReference(predecessorGroup)],
        }] as never,
    }
    : EMPTY_LEASES;
  const service = new CapabilityRuntimeSysonRolloverService({
    catalog,
    predecessor: { unit: predecessorUnit, launchGroup: predecessorGroup },
    successor: { unit: successorUnit, launchGroup: successorGroup },
    ledgers,
    lock,
    leases,
    journal: EMPTY_JOURNAL,
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
    successor: { unit: successorUnit, launchGroup: successorGroup },
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

class RecordingRolloverHost implements CapabilityRuntimeRolloverHost {
  #stage: "predecessor" | "material" | "successor" = "predecessor";
  materialAcquireCalls = 0;
  runtimeStartCalls = 0;
  #forcedClassification: "hybrid" | "foreign" | undefined;

  forceClassification(value: "hybrid" | "foreign" | undefined): void {
    this.#forcedClassification = value;
  }

  observeRollover(): Promise<CapabilityRuntimeRolloverHostObservation> {
    return Promise.resolve(this.#observation());
  }

  acquireRolloverSuccessorMaterial(): Promise<
    CapabilityRuntimeRolloverHostObservation
  > {
    this.materialAcquireCalls += 1;
    this.#stage = "material";
    return Promise.resolve(this.#observation());
  }

  activateRolloverSuccessor(): Promise<CapabilityRuntimeRolloverHostObservation> {
    this.runtimeStartCalls += 1;
    this.#stage = "successor";
    return Promise.resolve(this.#observation());
  }

  retireRolloverPredecessor(): Promise<CapabilityRuntimeRolloverHostObservation> {
    return Promise.resolve(this.#observation());
  }

  #observation(): CapabilityRuntimeRolloverHostObservation {
    if (this.#forcedClassification) {
      return observation(
        this.#forcedClassification,
        "complete",
        "active",
        "complete",
        "active",
      );
    }
    if (this.#stage === "predecessor") {
      return observation("predecessor", "complete", "active", "incomplete", "inactive");
    }
    if (this.#stage === "material") {
      return observation("predecessor", "complete", "active", "complete", "inactive");
    }
    return observation("successor", "incomplete", "inactive", "complete", "active");
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

class InterruptingLedgerStore implements ProjectCapabilityLedgerStore {
  #failProject: string | undefined;

  constructor(private readonly delegate: InMemoryProjectCapabilityLedgerStore) {}

  failNextFor(projectId: string): void {
    this.#failProject = projectId;
  }

  get(projectId: string) {
    return this.delegate.get(projectId);
  }

  list() {
    return this.delegate.list();
  }

  listPending() {
    return this.delegate.listPending();
  }

  getPending(projectId: string) {
    return this.delegate.getPending(projectId);
  }

  append(ledger: ProjectCapabilityLedger, expectedRevision: number) {
    if (this.#failProject === ledger.projectId) {
      this.#failProject = undefined;
      throw new Error("simulated ledger interruption");
    }
    return this.delegate.append(ledger, expectedRevision);
  }
}

class MemoryLock implements CapabilityRuntimeAdminLockWriter {
  #history = new Map<number, CapabilityRuntimeAdminLock>();

  constructor(private current: CapabilityRuntimeAdminLock) {
    this.#history.set(current.revision, structuredClone(current));
  }

  read(): Promise<CapabilityRuntimeAdminLock> {
    return Promise.resolve(structuredClone(this.current));
  }

  async save(value: CapabilityRuntimeAdminLock): Promise<void> {
    this.current = structuredClone(value);
    this.#history.set(value.revision, structuredClone(value));
  }

  async readRevision(revision: number): Promise<CapabilityRuntimeAdminLock> {
    const value = this.#history.get(revision);
    if (!value) throw new Error(`missing lock revision ${revision}`);
    return structuredClone(value);
  }

  list(): Promise<readonly CapabilityRuntimeAdminLock[]> {
    return Promise.resolve(
      [...this.#history.values()].map((value) => structuredClone(value)),
    );
  }
}

const DIRECT_LOCK: CapabilityRuntimeHostMutationLock = {
  withLock: async <T>(operation: () => Promise<T>) => await operation(),
};

const EMPTY_LEASES: CapabilityRuntimeLeaseStore = {
  claim: async () => {
    throw new Error("not used by rollover");
  },
  read: async () => undefined,
  release: async () => {},
  listActive: async () => [],
};

const EMPTY_JOURNAL: CapabilityRuntimeJournal = {
  appendBeforeMutation: async () => {},
  appendOutcome: async () => {},
  list: async () => [],
  listOutcomes: async () => [],
};

async function seedAuthorizedLedger(
  store: InMemoryProjectCapabilityLedgerStore,
  projectId: string,
  unit: AtomicCapabilityRuntimeUnit,
  permuteMaterials = false,
): Promise<void> {
  const proposal = await proposalFor(projectId, unit, permuteMaterials);
  const prepared = await preparedEvent(proposal);
  const first = await ledger(projectId, null, [prepared]);
  await store.append(first, 0);
  const authorized = await authorizedEvent(proposal);
  await store.append(await ledger(projectId, first, [...first.events, authorized]), 1);
}

async function proposalFor(
  projectId: string,
  unit: AtomicCapabilityRuntimeUnit,
  permuteMaterials: boolean,
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
    materials: (permuteMaterials ? [...unit.materials].toReversed() : unit.materials)
      .map((material) => ({
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
    recordedAt: "2026-08-30T11:59:00.000Z",
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
    recordedAt: "2026-08-30T11:59:01.000Z",
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

async function predecessorLock(
  unit: AtomicCapabilityRuntimeUnit,
): Promise<CapabilityRuntimeAdminLock> {
  return {
    schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
    revision: 1,
    previous: null,
    units: [{
      id: unit.id,
      version: unit.version,
      manifestFingerprint: structuredClone(unit.manifestFingerprint),
      desired: "active",
    }],
  };
}

function key() {
  return { transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID } as const;
}
