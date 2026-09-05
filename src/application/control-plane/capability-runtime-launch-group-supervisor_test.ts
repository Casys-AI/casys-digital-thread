import { assertEquals, assertRejects } from "@std/assert";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  type CapabilityRuntimeExecutionLeaseOwner,
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
  createEffectiveCapabilityRuntimeLaunchProjection,
  deriveEffectiveCapabilityRuntimeLaunchProjection,
  type ResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "./capability-runtime-launch-group-registry.ts";
import { createCapabilityRuntimeQualificationHostStopProof } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import {
  type CapabilityRuntimeLaunchGroupAvailabilityGate,
  CapabilityRuntimeLaunchGroupSafetyError,
  CapabilityRuntimeLaunchGroupSupervisor,
  qualificationStopIntentId,
} from "./capability-runtime-launch-group-supervisor.ts";
import {
  InMemoryCapabilityRuntimeJournal,
  InMemoryCapabilityRuntimeLeaseStore,
  InMemoryCapabilityRuntimeStateObserver,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeSecretSnapshot,
} from "../ports/out/capability/capability-runtime-supervisor.ts";

const AT = "2026-08-29T00:00:00.000Z";
const EXPIRES = "2026-08-29T01:00:00.000Z";

Deno.test("group supervisor shares one lease across N groups and stops eligible groups in reverse order", async () => {
  const [first, second] = await Promise.all([
    group("casys-first", "first"),
    group("casys-second", "second"),
  ]);
  const fixture = supervisor([first, second]);
  const lease = sessionLease([first, second]);

  const firstResult = await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: "project-test",
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });
  const secondResult = await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(second),
    expectedMaterials: exactMaterials(second),
    effectiveRuntimeProjection: await projection(second),
    resolvedOperation: resolvedOperation(second),
    projectId: "project-test",
    lease,
    at: AT,
    reuseExistingLease: "allow",
  });

  assertEquals(firstResult.leaseDisposition, "created");
  assertEquals(secondResult.leaseDisposition, "reused");
  assertEquals((await fixture.leases.listActive(AT)).length, 1);

  await fixture.supervisor.releaseTerminal({
    groups: [
      capabilityRuntimeLaunchGroupReference(first),
      capabilityRuntimeLaunchGroupReference(second),
    ],
    leaseId: lease.id,
    projectId: lease.projectId,
    at: AT,
    hasRemainingJitDemand: (keys) =>
      Promise.resolve(
        keys[0] === capabilityRuntimeMaterialKey(first.materials[0]!.material),
      ),
  });

  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-stop").map((call) =>
      call.groupId
    ),
    ["casys-second"],
  );
  assertEquals(await fixture.leases.listActive(AT), []);
});

Deno.test("a fresh execution lease is not created until delayed launch-group readiness completes", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first]);
  let readinessEntered!: () => void;
  const entered = new Promise<void>((resolve) => readinessEntered = resolve);
  let releaseReadiness!: () => void;
  fixture.host.startGate = new Promise<void>((resolve) => releaseReadiness = resolve);
  fixture.host.onRuntimeStart = readinessEntered;
  const lease = sessionLease([first]);

  const activation = fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: lease.projectId,
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });
  await entered;

  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(fixture.host.calls.map((call) => call.action), [
    "material-acquire",
    "runtime-start",
  ]);

  releaseReadiness();
  const result = await activation;
  assertEquals(result.leaseDisposition, "created");
  assertEquals((await fixture.leases.listActive(AT)).map((item) => item.id), [
    lease.id,
  ]);
});

Deno.test("an already-running readiness group is reconciled before a fresh lease is delivered", async () => {
  const first = await group("casys-first", "first", ["first"], [], true);
  const fixture = supervisor([first]);
  await appendIntent(
    fixture,
    first,
    "runtime-start",
    "previous-ready-start",
    "2026-08-29T00:00:00.000Z",
    inactive(first),
    "succeeded",
  );
  setStates(fixture, first, "active");
  let readinessEntered!: () => void;
  const entered = new Promise<void>((resolve) => readinessEntered = resolve);
  let releaseReadiness!: () => void;
  fixture.host.startGate = new Promise<void>((resolve) => releaseReadiness = resolve);
  fixture.host.onRuntimeStart = readinessEntered;
  const lease = sessionLease([first]);

  const activation = fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: lease.projectId,
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });
  await entered;

  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(fixture.host.calls.map((call) => call.action), ["runtime-start"]);

  releaseReadiness();
  const result = await activation;
  assertEquals(result.leaseDisposition, "created");
  assertEquals((await fixture.leases.listActive(AT)).map((item) => item.id), [
    lease.id,
  ]);
});

Deno.test("queued pre-claim resume rechecks the atomic lease owner before journal or host observation", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first], undefined, "unavailable", { now: () => AT });
  const lease = executionLease([first]);
  await fixture.leases.claim(lease);

  await assertRejects(
    async () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        effectiveRuntimeProjection: await projection(first),
        resolvedOperation: resolvedOperation(first),
        projectId: lease.projectId,
        lease,
        at: AT,
        reuseExistingLease: "allow",
        queuedPreclaimResumeOwner: lease.executionOwner!,
        // This models another durable lease action after the coordinator's
        // pre-read but before H1 atomically claims under the host lock.
        guard: async () => {
          await fixture.leases.release(lease.id);
          await fixture.leases.claim({ ...lease, executionOwner: undefined });
          return true;
        },
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "exact execution owner",
  );

  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
  assertEquals((await fixture.leases.read(lease.id))?.executionOwner, undefined);
});

Deno.test("queued pre-claim resume rejects a vanished retained lease without replacing it", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first], undefined, "unavailable", { now: () => AT });
  const lease = executionLease([first]);
  await fixture.leases.claim(lease);

  await assertRejects(
    async () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        effectiveRuntimeProjection: await projection(first),
        resolvedOperation: resolvedOperation(first),
        projectId: lease.projectId,
        lease,
        at: AT,
        reuseExistingLease: "allow",
        queuedPreclaimResumeOwner: lease.executionOwner!,
        guard: async () => {
          await fixture.leases.release(lease.id);
          return true;
        },
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "replacement session lease",
  );

  assertEquals(await fixture.leases.read(lease.id), undefined);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.observationCalls, 0);
  assertEquals(fixture.host.calls, []);
});

Deno.test("queued pre-claim resume accepts an exact owner-bearing retained lease", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first], undefined, "unavailable", { now: () => AT });
  const lease = executionLease([first]);
  await fixture.leases.claim(lease);
  setStates(fixture, first, "active");

  const result = await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: lease.projectId,
    lease,
    at: AT,
    reuseExistingLease: "allow",
    queuedPreclaimResumeOwner: lease.executionOwner!,
  });

  assertEquals(result.leaseDisposition, "reused");
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("queued pre-claim resume uses H1's fresh lock-bound clock for expiry", async () => {
  const first = await group("casys-first", "first");
  let serverNow = AT;
  const fixture = supervisor([first], undefined, "unavailable", {
    now: () => serverNow,
    beforeLock: () => {
      serverNow = EXPIRES;
    },
  });
  const lease = executionLease([first]);
  await fixture.leases.claim(lease);

  await assertRejects(
    async () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        effectiveRuntimeProjection: await projection(first),
        resolvedOperation: resolvedOperation(first),
        projectId: lease.projectId,
        // The sealed request was issued while the lease was current. H1 waits
        // for its host lock, then evaluates expiry from its own fresh clock.
        at: AT,
        lease,
        reuseExistingLease: "allow",
        queuedPreclaimResumeOwner: lease.executionOwner!,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "expired",
  );

  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
  assertEquals((await fixture.leases.read(lease.id))?.id, lease.id);
});

Deno.test("a pending start that already reached a fully active group converges without a second host call", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first]);
  const lease = sessionLease([first]);
  await appendIntent(
    fixture,
    first,
    "runtime-start",
    "pending-start",
    AT,
    inactive(first),
  );
  setStates(fixture, first, "active");

  const result = await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: "project-test",
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });

  assertEquals(result.mutation, undefined);
  assertEquals(fixture.host.calls, []);
});

Deno.test("an active secret-bearing group reconciles its exact snapshot while an active non-secret group remains a no-op", async () => {
  const secret = await group(
    "casys-secret",
    "secret",
    ["secret"],
    ["chrono-mcp-bearer-token"],
  );
  const plain = await group("casys-plain", "plain");
  const fixture = supervisor([secret, plain], undefined, "available");
  const lease = sessionLease([secret, plain]);
  const snapshot = {} as CapabilityRuntimeSecretSnapshot;
  setStates(fixture, secret, "active");
  setStates(fixture, plain, "active");

  await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(secret),
    expectedMaterials: exactMaterials(secret),
    effectiveRuntimeProjection: await projection(secret),
    resolvedOperation: resolvedOperation(secret),
    projectId: lease.projectId,
    lease,
    at: AT,
    reuseExistingLease: "reject",
    secretSnapshot: snapshot,
  });
  await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(plain),
    expectedMaterials: exactMaterials(plain),
    effectiveRuntimeProjection: await projection(plain),
    resolvedOperation: resolvedOperation(plain),
    projectId: lease.projectId,
    lease,
    at: AT,
    reuseExistingLease: "allow",
  });

  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-start").map((call) =>
      call.groupId
    ),
    ["casys-secret"],
  );
  assertEquals(fixture.host.secretSnapshots, [snapshot]);
});

Deno.test("a launch-group activation rejects an expected material with the same key but another digest before lease or host mutation", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first]);
  const lease = sessionLease([first]);
  const [material] = exactMaterials(first);
  if (!material) throw new Error("Expected one test material.");

  await assertRejects(
    async () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: [{ ...material, imageDigest: "f".repeat(64) }],
        effectiveRuntimeProjection: await projection(first),
        resolvedOperation: resolvedOperation(first),
        projectId: lease.projectId,
        lease,
        at: AT,
        reuseExistingLease: "reject",
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "projection does not cover",
  );
  assertEquals(fixture.host.calls, []);
  assertEquals(await fixture.leases.listActive(AT), []);
});

Deno.test("a canonical projection with a foreign runtime mode fails before lease, journal, or host mutation", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first]);
  const lease = sessionLease([first]);
  const foreignProjection = await createEffectiveCapabilityRuntimeLaunchProjection({
    launchGroup: capabilityRuntimeLaunchGroupReference(first),
    materials: first.materials.map((member) => ({
      material: member.material,
      binding: { id: "test-binding", version: "1.0.0" },
      effectiveQualification: "qualified" as const,
      minimumQualification: "qualified" as const,
      runtimeMode: {
        material: member.material,
        targetPlatform: "linux/arm64" as const,
        mode: "emulated" as const,
        qualificationAttestationFingerprint: {
          algorithm: "sha256" as const,
          digest: "f".repeat(64),
        },
      },
    })),
  });

  await assertRejects(
    () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        effectiveRuntimeProjection: foreignProjection,
        resolvedOperation: resolvedOperation(first),
        projectId: lease.projectId,
        lease,
        at: AT,
        reuseExistingLease: "reject",
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "does not match the exact rechecked ROP",
  );
  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a reviewed launch group can preload material without a qualification or lease", async () => {
  const first = await group(
    "casys-preload",
    "preload",
    ["preload"],
    ["chrono-mcp-bearer-token"],
  );
  const fixture = supervisor([first]);
  await fixture.supervisor.ensureMaterial({
    group: capabilityRuntimeLaunchGroupReference(first),
    projectId: "project-test",
    at: AT,
  });
  assertEquals(fixture.host.calls.map((call) => call.action), ["material-acquire"]);
  assertEquals(await fixture.leases.listActive(AT), []);
});

Deno.test("a server availability gate blocks SysON material preload before a journal or host mutation", async () => {
  const syson = await group("casys-syson", "syson");
  const gate: CapabilityRuntimeLaunchGroupAvailabilityGate = {
    assertLaunchGroupAvailable: () => Promise.reject(new Error("availability blocked")),
  };
  const fixture = supervisor([syson], undefined, "unavailable", {
    availabilityGate: gate,
  });
  await assertRejects(
    () =>
      fixture.supervisor.ensureMaterial({
        group: capabilityRuntimeLaunchGroupReference(syson),
        projectId: "project-test",
        at: AT,
      }),
    Error,
    "availability blocked",
  );
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a private qualification start is separately authorized while a normal start still needs an exact ROP projection", async () => {
  const first = await group("casys-qualification", "qualification");
  const fixture = supervisor([first]);
  const lease = qualificationLease([first]);
  setStates(fixture, first, "inactive");

  await assertRejects(
    () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        effectiveRuntimeProjection: null as never,
        resolvedOperation: resolvedOperation(first),
        projectId: "project-test",
        lease: sessionLease([first]),
        at: AT,
        reuseExistingLease: "reject",
      }),
    TypeError,
    "$effectiveRuntimeProjection must be an object.",
  );
  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);

  const result = await fixture.supervisor.ensureQualificationActive(
    Object.assign({
      group: capabilityRuntimeLaunchGroupReference(first),
      expectedMaterials: exactMaterials(first),
      qualificationStartAuthority: qualificationAuthority(),
      lease,
      at: AT,
      reuseExistingLease: "reject" as const,
      guard: () => Promise.resolve(true),
    }, {
      // Extra caller data cannot select a project owner: the public request
      // does not declare it and runtime logic ignores it.
      projectId: "project-attempted-override",
    }),
  );

  assertEquals(result.mutation?.status, "succeeded");
  const entries = await fixture.journal.list();
  assertEquals(entries.map((entry) => entry.action), [
    "runtime-qualification-start",
  ]);
  assertEquals(
    entries[0]?.projectId,
    CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  );
  assertEquals(entries[0]?.effectiveRuntimeProjection, null);
  assertEquals(entries[0]?.qualificationStartAuthority, qualificationAuthority());
  assertEquals(fixture.host.calls.map((call) => call.action), [
    "runtime-qualification-start",
  ]);
});

Deno.test("a stale private qualification review fails before lease, journal, or host mutation", async () => {
  const first = await group("casys-qualification-stale", "qualification-stale");
  const fixture = supervisor([first]);

  await assertRejects(
    () =>
      fixture.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([first]),
        at: AT,
        reuseExistingLease: "reject",
        guard: () => Promise.resolve(false),
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "candidate or review is no longer current",
  );
  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a disappeared qualification-start secret fails before lease, journal, or host mutation", async () => {
  const first = await group(
    "casys-qualification-secret",
    "qualification-secret",
    ["qualification-secret"],
    ["chrono-mcp-bearer-token"],
  );
  const fixture = supervisor([first], undefined, "unavailable");
  let guarded = false;

  await assertRejects(
    () =>
      fixture.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([first]),
        at: AT,
        reuseExistingLease: "reject",
        guard: () => {
          guarded = true;
          return Promise.resolve(true);
        },
        secretSnapshot: {} as CapabilityRuntimeSecretSnapshot,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "secret availability is unknown or unavailable",
  );
  assertEquals(guarded, true);
  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a missing qualification-start secret snapshot fails before lease, journal, or host mutation", async () => {
  const first = await group(
    "casys-qualification-missing-secret",
    "qualification-missing-secret",
    ["qualification-missing-secret"],
    ["chrono-mcp-bearer-token"],
  );
  const fixture = supervisor([first], undefined, "available");
  let guarded = false;

  await assertRejects(
    () =>
      fixture.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([first]),
        at: AT,
        reuseExistingLease: "reject",
        guard: () => {
          guarded = true;
          return Promise.resolve(true);
        },
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "server-minted launch secret snapshot",
  );
  assertEquals(guarded, true);
  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a qualification start refuses a project-owned lease before mutation", async () => {
  const first = await group(
    "casys-qualification-project-lease",
    "qualification-project-lease",
  );
  const fixture = supervisor([first]);

  await assertRejects(
    () =>
      fixture.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        lease: sessionLease([first]),
        at: AT,
        reuseExistingLease: "reject",
        guard: () => Promise.resolve(true),
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "not current for this group activation",
  );
  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a qualification probe rejects a foreign exact material before lease, journal, or host mutation", async () => {
  const first = await group("casys-qualification-material", "qualification-material");
  const fixture = supervisor([first]);
  const [material] = exactMaterials(first);
  if (!material) throw new Error("Expected one test material.");

  await assertRejects(
    () =>
      fixture.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: [{ ...material, imageDigest: "f".repeat(64) }],
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([first]),
        at: AT,
        reuseExistingLease: "reject",
        guard: () => Promise.resolve(true),
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "does not bind the exact launch-group material digests",
  );
  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a qualification lease exclusively blocks a normal operation start under H1", async () => {
  const first = await group("casys-qualification-exclusive", "qualification-exclusive");
  const fixture = supervisor([first]);
  const qualificationLeaseValue = qualificationLease([first]);
  await fixture.leases.claim(qualificationLeaseValue);

  await assertRejects(
    async () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        effectiveRuntimeProjection: await projection(first),
        resolvedOperation: resolvedOperation(first),
        projectId: "project-test",
        lease: sessionLease([first]),
        at: AT,
        reuseExistingLease: "reject",
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "exclusively leased by a private qualification probe",
  );
  assertEquals(
    (await fixture.leases.listActive(AT)).map((lease) => lease.id),
    [qualificationLeaseValue.id],
  );
  assertEquals((await fixture.journal.list()).length, 0);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a normal operation lease exclusively blocks a qualification start under H1", async () => {
  const first = await group("casys-operation-exclusive", "operation-exclusive");
  const fixture = supervisor([first]);
  await fixture.leases.claim(sessionLease([first]));

  await assertRejects(
    () =>
      fixture.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([first]),
        at: AT,
        reuseExistingLease: "reject",
        guard: () => Promise.resolve(true),
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "requires exclusive possession",
  );
  assertEquals(
    (await fixture.leases.listActive(AT)).map((lease) => lease.id),
    ["lease-session"],
  );
  assertEquals((await fixture.journal.list()).length, 0);
  assertEquals(fixture.host.calls, []);
});

Deno.test("qualification prepareAfterAuthorization runs after H1 preflight and failure leaves no lease or host mutation", async () => {
  const first = await group("casys-qualification-prepare", "qualification-prepare");
  const fixture = supervisor([first]);
  const order: string[] = [];

  await assertRejects(
    () =>
      fixture.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([first]),
        at: AT,
        reuseExistingLease: "reject",
        guard: () => {
          order.push("guard");
          return Promise.resolve(true);
        },
        prepareAfterAuthorization: () => {
          order.push("prepare");
          return Promise.reject(new Error("wal-prepare-failed"));
        },
      }),
    Error,
    "wal-prepare-failed",
  );
  assertEquals(order, ["guard", "prepare"]);
  assertEquals(await fixture.leases.listActive(AT), []);
  assertEquals(await fixture.journal.list(), []);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a durable qualification start is reused without a second Docker start", async () => {
  const first = await group("casys-qualification-reuse", "qualification-reuse");
  const fixture = supervisor([first]);
  setStates(fixture, first, "inactive");
  const request = {
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "allow" as const,
    guard: () => Promise.resolve(true),
  };
  const firstStart = await fixture.supervisor.ensureQualificationActive(request);
  assertEquals(firstStart.qualificationStart?.outcome?.status, "succeeded");
  const second = await fixture.supervisor.ensureQualificationActive(request);
  assertEquals(
    second.qualificationStart?.fingerprint,
    firstStart.qualificationStart?.fingerprint,
  );
  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-qualification-start")
      .length,
    1,
  );
});

Deno.test("qualification recovery reacquires an exact expired lease and rejects a foreign lease", async () => {
  const first = await group("casys-qualification-lease-refresh", "qualification-lease");
  const fixture = supervisor([first]);
  const expired = {
    ...qualificationLease([first]),
    expiresAt: "2026-08-28T00:00:00.000Z",
  };
  await fixture.leases.claim(expired);
  const refreshed = await fixture.supervisor.reacquireQualificationLease({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    lease: qualificationLease([first]),
    at: AT,
  });
  assertEquals(refreshed.id, qualificationLease([first]).id);
  assertEquals(refreshed.expiresAt, EXPIRES);

  const foreign = supervisor([first]);
  await foreign.leases.claim(sessionLease([first]));
  await assertRejects(
    () =>
      foreign.supervisor.reacquireQualificationLease({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        lease: qualificationLease([first]),
        at: AT,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "exclusive possession",
  );
});

Deno.test("qualification terminal release refuses uncertain or still-active stop and reuses an exact succeeded stop", async () => {
  const first = await group("casys-qualification-stop", "qualification-stop");
  const uncertain = supervisor([first], "runtime-stop");
  setStates(uncertain, first, "inactive");
  const started = await uncertain.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  await assertRejects(
    () =>
      uncertain.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: started.qualificationStart!.fingerprint,
        lease: qualificationLease([first]),
        at: AT,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "uncertain",
  );
  assertEquals((await uncertain.leases.listActive(AT)).length, 1);

  const active = supervisor([first]);
  setStates(active, first, "inactive");
  const live = await active.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  active.host.freezeRuntime = true;
  await assertRejects(
    () =>
      active.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: live.qualificationStart!.fingerprint,
        lease: qualificationLease([first]),
        at: AT,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "exact inactive observation",
  );

  const happy = supervisor([first]);
  setStates(happy, first, "inactive");
  const proof = await happy.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  const firstStop = await happy.supervisor.releaseQualificationTerminal({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: proof.qualificationStart!.fingerprint,
    lease: qualificationLease([first]),
    at: AT,
  });
  const again = await happy.supervisor.releaseQualificationTerminal({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: proof.qualificationStart!.fingerprint,
    lease: qualificationLease([first]),
    at: AT,
  });
  assertEquals(again.fingerprint, firstStop.fingerprint);
  assertEquals(
    happy.host.calls.filter((call) => call.action === "runtime-stop").length,
    1,
  );
});

Deno.test("qualification start crash after host mutation reconverges all-active without a second start", async () => {
  const first = await group("casys-qualification-crash-start", "qualification-start");
  const fixture = supervisor([first], undefined, "unavailable", {
    crashAppendOutcomeFor: "runtime-qualification-start",
  });
  setStates(fixture, first, "inactive");
  const request = {
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "allow" as const,
    guard: () => Promise.resolve(true),
  };
  await assertRejects(
    () => fixture.supervisor.ensureQualificationActive(request),
    Error,
    "crash-before-append-outcome",
  );
  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-qualification-start")
      .length,
    1,
  );
  assertEquals((await fixture.journal.listOutcomes()).length, 0);
  assertEquals((await fixture.leases.listActive(AT)).length, 1);

  const recovered = await fixture.supervisor.ensureQualificationActive(request);
  assertEquals(recovered.qualificationStart?.outcome, null);
  assertEquals(
    recovered.qualificationStart?.convergence,
    "observed-all-active-after-exact-intent",
  );
  const again = await fixture.supervisor.ensureQualificationActive(request);
  assertEquals(
    again.qualificationStart?.fingerprint,
    recovered.qualificationStart?.fingerprint,
  );
  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-qualification-start")
      .length,
    1,
  );
});

Deno.test("qualification start pending/uncertain/failed all-active is read-only; inactive retry and foreign/partial block", async () => {
  const first = await group("casys-qualification-start-matrix", "qualification-start");
  const requestOf = (_fixture: ReturnType<typeof supervisor>) => ({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "allow" as const,
    guard: () => Promise.resolve(true),
  });

  for (const status of ["pending", "uncertain", "failed"] as const) {
    const fixture = supervisor([first]);
    setStates(fixture, first, "inactive");
    await appendQualificationStart(
      fixture,
      first,
      "qual-start-active",
      AT,
      inactive(first),
      status === "pending" ? undefined : status,
    );
    setStates(fixture, first, "active");
    const result = await fixture.supervisor.ensureQualificationActive(
      requestOf(fixture),
    );
    assertEquals(result.qualificationStart?.journalEntry.id, "qual-start-active");
    assertEquals(
      result.qualificationStart?.outcome?.status ?? null,
      status === "pending" ? null : status,
    );
    assertEquals(fixture.host.calls, []);
  }

  const retry = supervisor([first]);
  setStates(retry, first, "inactive");
  await appendQualificationStart(
    retry,
    first,
    "qual-start-retry",
    AT,
    inactive(first),
  );
  const retried = await retry.supervisor.ensureQualificationActive(requestOf(retry));
  assertEquals(retried.qualificationStart?.journalEntry.id, "qual-start-retry");
  assertEquals(
    retry.host.calls.filter((call) => call.action === "runtime-qualification-start")
      .length,
    1,
  );

  const blockedOutcome = supervisor([first]);
  setStates(blockedOutcome, first, "inactive");
  await appendQualificationStart(
    blockedOutcome,
    first,
    "qual-start-failed",
    AT,
    inactive(first),
    "failed",
  );
  await assertRejects(
    () =>
      blockedOutcome.supervisor.ensureQualificationActive(requestOf(blockedOutcome)),
    CapabilityRuntimeLaunchGroupSafetyError,
    "second host start is blocked",
  );
  assertEquals(blockedOutcome.host.calls, []);

  const foreign = supervisor([first]);
  setStates(foreign, first, "active");
  await assertRejects(
    () => foreign.supervisor.ensureQualificationActive(requestOf(foreign)),
    CapabilityRuntimeLaunchGroupSafetyError,
    "superseded group tip",
  );
  assertEquals(foreign.host.calls, []);

  const split = await group(
    "casys-qualification-start-partial",
    "qualification-partial",
    ["left", "right"],
  );
  const partial = supervisor([split]);
  setStates(partial, split, "inactive");
  await appendQualificationStart(
    partial,
    split,
    "qual-start-partial",
    AT,
    inactive(split),
  );
  partial.states.set(split.materials[0]!.material, {
    material: "installed",
    runtime: "active",
  });
  await assertRejects(
    () =>
      partial.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(split),
        expectedMaterials: exactMaterials(split),
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([split]),
        at: AT,
        reuseExistingLease: "allow",
        guard: () => Promise.resolve(true),
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "partial group observation",
  );
  assertEquals(partial.host.calls, []);
});

Deno.test("qualification stop crash after host mutation reconverges all-inactive without a second stop", async () => {
  const first = await group("casys-qualification-crash-stop", "qualification-stop");
  const fixture = supervisor([first], undefined, "unavailable", {
    crashAppendOutcomeFor: "runtime-stop",
  });
  setStates(fixture, first, "inactive");
  const started = await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  assertEquals((await fixture.leases.listActive(AT)).length, 1);
  const stopInput = {
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: started.qualificationStart!.fingerprint,
    lease: qualificationLease([first]),
    at: AT,
  };
  await assertRejects(
    () => fixture.supervisor.releaseQualificationTerminal(stopInput),
    Error,
    "crash-before-append-outcome",
  );
  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-stop").length,
    1,
  );
  assertEquals((await fixture.leases.listActive(AT)).length, 1);
  const recovered = await fixture.supervisor.releaseQualificationTerminal(stopInput);
  assertEquals(recovered.outcome, null);
  assertEquals(recovered.convergence, "observed-all-inactive-after-exact-intent");
  assertEquals(await fixture.leases.listActive(AT), []);
  await assertRejects(
    () => fixture.supervisor.releaseQualificationTerminal(stopInput),
    CapabilityRuntimeLaunchGroupSafetyError,
    "without a lease requires the exact prior succeeded stop proof",
  );
  await fixture.supervisor.reacquireQualificationLease({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    lease: qualificationLease([first]),
    at: AT,
  });
  const again = await fixture.supervisor.releaseQualificationTerminal(stopInput);
  assertEquals(again.fingerprint, recovered.fingerprint);
  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-stop").length,
    1,
  );
});

Deno.test("an old qualification stop is not replayed after a later normal start", async () => {
  const first = await group("casys-qualification-stale-tip", "qualification-stale");
  const fixture = supervisor([first], undefined, "unavailable", {
    crashAppendOutcomeFor: "runtime-stop",
  });
  setStates(fixture, first, "inactive");
  const started = await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  await assertRejects(
    () =>
      fixture.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: started.qualificationStart!.fingerprint,
        lease: qualificationLease([first]),
        at: AT,
      }),
    Error,
    "crash-before-append-outcome",
  );
  await fixture.leases.release(qualificationLease([first]).id);
  const session = sessionLease([first]);
  await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: session.projectId,
    lease: session,
    at: "2026-08-29T00:00:01.000Z",
    reuseExistingLease: "reject",
  });
  await fixture.supervisor.releaseTerminal({
    groups: [capabilityRuntimeLaunchGroupReference(first)],
    leaseId: session.id,
    projectId: session.projectId,
    at: "2026-08-29T00:00:01.000Z",
    hasRemainingJitDemand: () => Promise.resolve(true),
  });
  await assertRejects(
    () =>
      fixture.supervisor.requireQualificationMutationTip({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        kind: "stop",
        startProofFingerprint: started.qualificationStart!.fingerprint,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "later group tip",
  );
  await assertRejects(
    () =>
      fixture.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: started.qualificationStart!.fingerprint,
        lease: qualificationLease([first]),
        at: "2026-08-29T00:00:02.000Z",
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "later group tip",
  );
  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-stop").length,
    1,
  );
  const state = fixture.states;
  const observed = await state.observe(exactMaterials(first));
  assertEquals(
    [...observed.values()].every((item) => item.runtime === "active"),
    true,
  );
});

Deno.test("qualification start recovery is blocked when a later group tip exists", async () => {
  const first = await group("casys-qualification-later-tip", "qualification-later");
  const fixture = supervisor([first]);
  setStates(fixture, first, "inactive");
  await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  await appendIntent(
    fixture,
    first,
    "runtime-start",
    "later-normal-start",
    "2026-08-29T00:00:01.000Z",
    active(first),
    "succeeded",
  );
  await assertRejects(
    () =>
      fixture.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([first]),
        at: "2026-08-29T00:00:02.000Z",
        reuseExistingLease: "allow",
        guard: () => Promise.resolve(true),
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "superseded group tip",
  );
  await assertRejects(
    () =>
      fixture.supervisor.readQualificationStartProof({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "superseded group tip",
  );
});

Deno.test("qualification start catch refuses to release a foreign lease", async () => {
  const first = await group("casys-qualification-foreign-catch", "qualification-catch");
  const inner = supervisor([first], undefined, "unavailable", {
    throwOn: "material-acquire",
  });
  const originalRead = inner.leases.read.bind(inner.leases);
  inner.leases.read = async (id: string) => {
    const held = await originalRead(id);
    if (!held) return held;
    return { ...held, bindingIds: ["foreign-binding"] };
  };
  await assertRejects(
    () =>
      inner.supervisor.ensureQualificationActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        lease: qualificationLease([first]),
        at: AT,
        reuseExistingLease: "reject",
        guard: () => Promise.resolve(true),
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "lease is foreign",
  );
  assertEquals((await inner.leases.listActive(AT)).length, 1);
});

Deno.test("lease scope comparison is injective for tokens that contain NUL", async () => {
  const first = await group("casys-qualification-nul-lease", "qualification-nul");
  const fixture = supervisor([first]);
  setStates(fixture, first, "inactive");
  const started = await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  await assertRejects(
    () =>
      fixture.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: started.qualificationStart!.fingerprint,
        lease: {
          ...qualificationLease([first]),
          bindingIds: ["a", "b"],
        },
        at: AT,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "lease is foreign",
  );
  const originalRead = fixture.leases.read.bind(fixture.leases);
  fixture.leases.read = async (id: string) => {
    const held = await originalRead(id);
    if (!held) return held;
    return { ...held, bindingIds: ["a\u0000b"] };
  };
  await assertRejects(
    () =>
      fixture.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: started.qualificationStart!.fingerprint,
        lease: {
          ...qualificationLease([first]),
          bindingIds: ["a", "b"],
        },
        at: AT,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "lease is foreign",
  );
  assertEquals((await fixture.leases.listActive(AT)).length, 1);
});

Deno.test("qualification stop pending/uncertain/failed inactive is read-only; active retry, partial and foreign lease block", async () => {
  const first = await group("casys-qualification-stop-matrix", "qualification-stop");
  const happy = supervisor([first]);
  setStates(happy, first, "inactive");
  const started = await happy.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  const startProof = started.qualificationStart!.fingerprint;
  const stopId = await qualificationStopIntentId(first, startProof);
  const stopInput = {
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: startProof,
    lease: qualificationLease([first]),
    at: AT,
  };

  for (const status of ["pending", "uncertain", "failed"] as const) {
    const fixture = supervisor([first]);
    setStates(fixture, first, "inactive");
    const live = await fixture.supervisor.ensureQualificationActive({
      group: capabilityRuntimeLaunchGroupReference(first),
      expectedMaterials: exactMaterials(first),
      qualificationStartAuthority: qualificationAuthority(),
      lease: qualificationLease([first]),
      at: AT,
      reuseExistingLease: "reject",
      guard: () => Promise.resolve(true),
    });
    await appendQualificationStop(
      fixture,
      first,
      await qualificationStopIntentId(first, live.qualificationStart!.fingerprint),
      AT,
      active(first),
      status === "pending" ? undefined : status,
    );
    setStates(fixture, first, "inactive");
    const starts = fixture.host.calls.filter((call) =>
      call.action === "runtime-stop"
    ).length;
    const proof = await fixture.supervisor.releaseQualificationTerminal({
      group: capabilityRuntimeLaunchGroupReference(first),
      expectedMaterials: exactMaterials(first),
      qualificationStartAuthority: qualificationAuthority(),
      startProofFingerprint: live.qualificationStart!.fingerprint,
      lease: qualificationLease([first]),
      at: AT,
    });
    assertEquals(proof.outcome?.status ?? null, status === "pending" ? null : status);
    assertEquals(
      fixture.host.calls.filter((call) => call.action === "runtime-stop").length,
      starts,
    );
    assertEquals(await fixture.leases.listActive(AT), []);
  }

  const retry = supervisor([first]);
  setStates(retry, first, "inactive");
  const liveRetry = await retry.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  await appendQualificationStop(
    retry,
    first,
    await qualificationStopIntentId(first, liveRetry.qualificationStart!.fingerprint),
    AT,
    active(first),
  );
  const retried = await retry.supervisor.releaseQualificationTerminal({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: liveRetry.qualificationStart!.fingerprint,
    lease: qualificationLease([first]),
    at: AT,
  });
  assertEquals(retried.journalEntry.action, "runtime-stop");
  assertEquals(
    retry.host.calls.filter((call) => call.action === "runtime-stop").length,
    1,
  );

  const blocked = supervisor([first]);
  setStates(blocked, first, "inactive");
  const liveBlocked = await blocked.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  await appendQualificationStop(
    blocked,
    first,
    await qualificationStopIntentId(
      first,
      liveBlocked.qualificationStart!.fingerprint,
    ),
    AT,
    active(first),
    "failed",
  );
  await assertRejects(
    () =>
      blocked.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: liveBlocked.qualificationStart!.fingerprint,
        lease: qualificationLease([first]),
        at: AT,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "second host stop is blocked",
  );
  assertEquals(
    blocked.host.calls.filter((call) => call.action === "runtime-stop").length,
    0,
  );

  const split = await group(
    "casys-qualification-stop-partial",
    "qualification-stop-partial",
    ["left", "right"],
  );
  const partial = supervisor([split]);
  setStates(partial, split, "inactive");
  const livePartial = await partial.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(split),
    expectedMaterials: exactMaterials(split),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([split]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  await appendQualificationStop(
    partial,
    split,
    await qualificationStopIntentId(
      split,
      livePartial.qualificationStart!.fingerprint,
    ),
    AT,
    active(split),
  );
  setStates(partial, split, "active");
  partial.states.set(split.materials[0]!.material, {
    material: "installed",
    runtime: "inactive",
  });
  await assertRejects(
    () =>
      partial.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(split),
        expectedMaterials: exactMaterials(split),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: livePartial.qualificationStart!.fingerprint,
        lease: qualificationLease([split]),
        at: AT,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "partial group observation",
  );

  const scope = supervisor([first]);
  setStates(scope, first, "inactive");
  const liveScope = await scope.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  await assertRejects(
    () =>
      scope.supervisor.releaseQualificationTerminal({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        startProofFingerprint: liveScope.qualificationStart!.fingerprint,
        lease: { ...qualificationLease([first]), bindingIds: ["foreign-binding"] },
        at: AT,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "lease is foreign to this attempt",
  );
  assertEquals((await scope.leases.listActive(AT)).length, 1);
  assertEquals(
    scope.host.calls.filter((call) => call.action === "runtime-stop").length,
    0,
  );

  const firstStop = await happy.supervisor.releaseQualificationTerminal(stopInput);
  await happy.leases.claim({
    ...qualificationLease([first]),
    bindingIds: ["foreign-binding"],
    materialKeys: ["foreign-key"],
  });
  await assertRejects(
    () => happy.supervisor.releaseQualificationTerminal(stopInput),
    CapabilityRuntimeLaunchGroupSafetyError,
    "lease is foreign to this attempt",
  );
  assertEquals((await happy.leases.listActive(AT))[0]?.bindingIds, [
    "foreign-binding",
  ]);
  assertEquals(firstStop.journalEntry.id, stopId);
});

Deno.test("qualification stop proof verifies the derived stop intent and exact inactive group", async () => {
  const first = await group(
    "casys-qualification-stop-proof-verify",
    "qualification-stop-proof",
  );
  const fixture = supervisor([first]);
  setStates(fixture, first, "inactive");
  const started = await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  const proof = await fixture.supervisor.releaseQualificationTerminal({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: started.qualificationStart!.fingerprint,
    lease: qualificationLease([first]),
    at: AT,
  });
  assertEquals(
    proof.journalEntry.id,
    await qualificationStopIntentId(first, started.qualificationStart!.fingerprint),
  );
  const verified = await fixture.supervisor.verifyQualificationStopProof({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    proof,
  });
  assertEquals(verified.fingerprint, proof.fingerprint);
  assertEquals(proof.convergence, "host-outcome-succeeded");
});

Deno.test("a canonical stop proof with the wrong derived stop id is refused", async () => {
  const first = await group(
    "casys-qualification-stop-proof-wrong-id",
    "qualification-stop-wrong-id",
  );
  const { fixture, proof } = await qualifyAndStop(first);
  const wrongId = `capability-group-runtime-stop-${"f".repeat(64)}`;
  const forged = await createCapabilityRuntimeQualificationHostStopProof({
    schemaVersion: proof.schemaVersion,
    journalEntry: { ...structuredClone(proof.journalEntry), id: wrongId },
    outcome: proof.outcome
      ? { ...structuredClone(proof.outcome), journalEntryId: wrongId }
      : null,
    convergence: proof.convergence,
    observations: structuredClone(proof.observations),
    observedAt: proof.observedAt,
    startProofFingerprint: proof.startProofFingerprint,
  });
  await assertRejects(
    () =>
      fixture.supervisor.verifyQualificationStopProof({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        proof: forged,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "derived stop intent",
  );
});

Deno.test("a canonical stop proof with contradictory observations or status is refused", async () => {
  const first = await group(
    "casys-qualification-stop-proof-contradiction",
    "qualification-stop-contradiction",
  );
  const { fixture, proof } = await qualifyAndStop(first);
  const activeObservations = proof.observations.map((item) => ({
    material: item.material,
    state: { material: "installed" as const, runtime: "active" as const },
  }));
  const activeForged = await createCapabilityRuntimeQualificationHostStopProof({
    schemaVersion: proof.schemaVersion,
    journalEntry: structuredClone(proof.journalEntry),
    outcome: structuredClone(proof.outcome),
    convergence: proof.convergence,
    observations: activeObservations,
    observedAt: proof.observedAt,
    startProofFingerprint: proof.startProofFingerprint,
  });
  await assertRejects(
    () =>
      fixture.supervisor.verifyQualificationStopProof({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        proof: activeForged,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "exact inactive group",
  );
  if (!proof.outcome) throw new Error("expected a succeeded stop outcome");
  const failedForged = await createCapabilityRuntimeQualificationHostStopProof({
    schemaVersion: proof.schemaVersion,
    journalEntry: structuredClone(proof.journalEntry),
    outcome: { ...structuredClone(proof.outcome), status: "failed" },
    convergence: "host-outcome-succeeded",
    observations: structuredClone(proof.observations),
    observedAt: proof.observedAt,
    startProofFingerprint: proof.startProofFingerprint,
  });
  await assertRejects(
    () =>
      fixture.supervisor.verifyQualificationStopProof({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        qualificationStartAuthority: qualificationAuthority(),
        proof: failedForged,
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "contradicts its journal outcome",
  );
});

Deno.test("a succeeded start outcome with null observations uses exact observed convergence", async () => {
  const first = await group(
    "casys-qualification-start-null-outcome",
    "qualification-start-null",
  );
  const fixture = supervisor([first], undefined, "unavailable", {
    nullOutcomeObservationsFor: "runtime-qualification-start",
  });
  setStates(fixture, first, "inactive");
  const started = await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  assertEquals(started.mutation?.status, "succeeded");
  assertEquals(
    started.qualificationStart?.convergence,
    "observed-all-active-after-exact-intent",
  );
  assertEquals(
    [...started.qualificationStart!.observations.values()].every((state) =>
      state.runtime === "active"
    ),
    true,
  );
  const reused = await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "allow",
    guard: () => Promise.resolve(true),
  });
  assertEquals(
    reused.qualificationStart?.fingerprint,
    started.qualificationStart?.fingerprint,
  );
  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-qualification-start")
      .length,
    1,
  );
});

Deno.test("a succeeded stop outcome with null observations uses exact observed convergence", async () => {
  const first = await group(
    "casys-qualification-stop-null-outcome",
    "qualification-stop-null",
  );
  const fixture = supervisor([first], undefined, "unavailable", {
    nullOutcomeObservationsFor: "runtime-stop",
  });
  setStates(fixture, first, "inactive");
  const started = await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([first]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  const proof = await fixture.supervisor.releaseQualificationTerminal({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: started.qualificationStart!.fingerprint,
    lease: qualificationLease([first]),
    at: AT,
  });
  assertEquals(proof.outcome?.status, "succeeded");
  assertEquals(proof.convergence, "observed-all-inactive-after-exact-intent");
  assertEquals(
    proof.observations.every((item) => item.state?.runtime === "inactive"),
    true,
  );
  const verified = await fixture.supervisor.verifyQualificationStopProof({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    proof,
  });
  assertEquals(verified.fingerprint, proof.fingerprint);
  await fixture.supervisor.reacquireQualificationLease({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    lease: qualificationLease([first]),
    at: AT,
  });
  const again = await fixture.supervisor.releaseQualificationTerminal({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: started.qualificationStart!.fingerprint,
    lease: qualificationLease([first]),
    at: AT,
  });
  assertEquals(again.fingerprint, proof.fingerprint);
});

Deno.test("a pending start that left every member unchanged is safe to retry", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first]);
  const lease = sessionLease([first]);
  const prior = inactive(first);
  setStates(fixture, first, "inactive");
  await appendIntent(fixture, first, "runtime-start", "pending-start", AT, prior);

  await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: "project-test",
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });

  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-start").map((call) =>
      call.groupId
    ),
    [first.id],
  );
});

Deno.test("a pending start with a partial group observation remains a recovery barrier", async () => {
  const first = await group("casys-first", "first", ["first", "second"]);
  const fixture = supervisor([first]);
  const lease = sessionLease([first]);
  const prior = inactive(first);
  setStates(fixture, first, "inactive");
  fixture.states.set(first.materials[0]!.material, {
    material: "installed",
    runtime: "active",
  });
  await appendIntent(fixture, first, "runtime-start", "pending-start", AT, prior);

  await assertRejects(
    async () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        effectiveRuntimeProjection: await projection(first),
        resolvedOperation: resolvedOperation(first),
        projectId: "project-test",
        lease,
        at: AT,
        reuseExistingLease: "reject",
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "partial or third-party",
  );
  assertEquals(fixture.host.calls, []);
  assertEquals(await fixture.leases.listActive(AT), []);
});

Deno.test("releasing one lease cannot stop a group still protected by another exact lease", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first]);
  const lease = sessionLease([first]);
  await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: lease.projectId,
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });
  const otherLease = { ...lease, id: "lease-other" };
  await fixture.leases.claim(otherLease);

  await fixture.supervisor.releaseTerminal({
    groups: [capabilityRuntimeLaunchGroupReference(first)],
    leaseId: lease.id,
    projectId: lease.projectId,
    at: AT,
    hasRemainingJitDemand: () => Promise.resolve(false),
  });
  assertEquals(
    fixture.host.calls.some((call) => call.action === "runtime-stop"),
    false,
  );
  assertEquals((await fixture.leases.listActive(AT)).map((value) => value.id), [
    otherLease.id,
  ]);

  await fixture.supervisor.releaseTerminal({
    groups: [capabilityRuntimeLaunchGroupReference(first)],
    leaseId: otherLease.id,
    projectId: otherLease.projectId,
    at: AT,
    hasRemainingJitDemand: () => Promise.resolve(false),
  });
  assertEquals(
    fixture.host.calls.filter((call) => call.action === "runtime-stop").map((call) =>
      call.groupId
    ),
    [first.id],
  );
});

Deno.test("an older failed intent is superseded by a later succeeded group tip", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first]);
  const lease = sessionLease([first]);
  await appendIntent(
    fixture,
    first,
    "runtime-start",
    "older-failed",
    "2026-08-29T00:00:00.000Z",
    inactive(first),
    "failed",
  );
  await appendIntent(
    fixture,
    first,
    "runtime-start",
    "latest-succeeded",
    "2026-08-29T00:00:01.000Z",
    inactive(first),
    "succeeded",
  );
  setStates(fixture, first, "active");

  await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(first),
    expectedMaterials: exactMaterials(first),
    effectiveRuntimeProjection: await projection(first),
    resolvedOperation: resolvedOperation(first),
    projectId: lease.projectId,
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });
  assertEquals(fixture.host.calls, []);
});

Deno.test("a succeeded group tip that later returns to its previous state is an external-drift barrier", async () => {
  const first = await group("casys-first", "first");
  const fixture = supervisor([first]);
  const lease = sessionLease([first]);
  const prior = inactive(first);
  await appendIntent(
    fixture,
    first,
    "runtime-start",
    "succeeded-start",
    AT,
    prior,
    "succeeded",
  );
  setStates(fixture, first, "inactive");

  await assertRejects(
    async () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
        expectedMaterials: exactMaterials(first),
        effectiveRuntimeProjection: await projection(first),
        resolvedOperation: resolvedOperation(first),
        projectId: lease.projectId,
        lease,
        at: AT,
        reuseExistingLease: "reject",
      }),
    CapabilityRuntimeLaunchGroupSafetyError,
    "partial or third-party",
  );
  assertEquals(fixture.host.calls, []);
});

function supervisor(
  groups: readonly CapabilityRuntimeLaunchGroup[],
  failAction?: CapabilityRuntimeJournalEntry["action"],
  secretAvailability: "available" | "unavailable" = "unavailable",
  options: {
    readonly crashAppendOutcomeFor?: CapabilityRuntimeJournalEntry["action"];
    readonly reportUncertainFor?: CapabilityRuntimeJournalEntry["action"];
    readonly throwOn?: CapabilityRuntimeJournalEntry["action"];
    readonly nullOutcomeObservationsFor?: CapabilityRuntimeJournalEntry["action"];
    readonly availabilityGate?: CapabilityRuntimeLaunchGroupAvailabilityGate;
    readonly now?: () => string;
    readonly beforeLock?: () => void;
  } = {},
) {
  const states = new InMemoryCapabilityRuntimeStateObserver();
  for (const group of groups) {
    for (const member of group.materials) {
      states.set(member.material, {
        material: "absent",
        runtime: "inactive",
      });
    }
  }
  const innerJournal = new InMemoryCapabilityRuntimeJournal();
  const journal = options.crashAppendOutcomeFor
    ? {
      appendBeforeMutation: (entry: CapabilityRuntimeJournalEntry) =>
        innerJournal.appendBeforeMutation(entry),
      list: () => innerJournal.list(),
      listOutcomes: () => innerJournal.listOutcomes(),
      appendOutcome: async (outcome: CapabilityRuntimeJournalOutcome) => {
        const entry = (await innerJournal.list()).find((item) =>
          item.id === outcome.journalEntryId
        );
        if (entry?.action === options.crashAppendOutcomeFor) {
          throw new Error("crash-before-append-outcome");
        }
        await innerJournal.appendOutcome(outcome);
      },
    }
    : innerJournal;
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  let observationCalls = 0;
  const host = new StateTransitionHost(
    states,
    failAction,
    options.reportUncertainFor,
    options.throwOn,
    options.nullOutcomeObservationsFor,
  );
  const supervisor = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: new FixedCapabilityRuntimeLaunchGroupRegistry(groups),
    journal,
    leases,
    states: {
      observe: async (materials) => {
        observationCalls++;
        return await states.observe(materials);
      },
    },
    host,
    secrets: {
      observe: (slots) =>
        Promise.resolve(new Map(slots.map((slot) => [slot, secretAvailability]))),
    },
    lock: {
      withLock: async (operation) => {
        options.beforeLock?.();
        return await operation();
      },
    },
    availabilityGate: options.availabilityGate,
    now: options.now,
  });
  return {
    supervisor,
    leases,
    host,
    states,
    journal,
    get observationCalls() {
      return observationCalls;
    },
  };
}

function sessionLease(
  groups: readonly CapabilityRuntimeLaunchGroup[],
): CapabilityRuntimeLease {
  return {
    id: "lease-session",
    projectId: "project-test",
    bindingIds: ["binding-test"],
    materialKeys: groups.flatMap((group) =>
      group.materials.map((member) => capabilityRuntimeMaterialKey(member.material))
    ).toSorted(),
    launchGroups: groups.map(capabilityRuntimeLaunchGroupReference).toSorted((
      left,
      right,
    ) => left.id.localeCompare(right.id)),
    acquiredAt: AT,
    expiresAt: EXPIRES,
  };
}

function executionLease(
  groups: readonly CapabilityRuntimeLaunchGroup[],
): CapabilityRuntimeLease {
  return {
    ...sessionLease(groups),
    executionOwner: executionLeaseOwner(),
  };
}

function executionLeaseOwner(): CapabilityRuntimeExecutionLeaseOwner {
  return {
    kind: "execution-run",
    runId: "run:queued",
    operation: { id: "verify.session", version: "1" },
    basis: {
      snapshotId: "subject:thread:r4",
      revision: 4,
      subjectId: "subject",
    },
    operationalCapabilityFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
  };
}

function qualificationLease(
  groups: readonly CapabilityRuntimeLaunchGroup[],
): CapabilityRuntimeLease {
  return {
    ...sessionLease(groups),
    id: "lease-qualification",
    projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
    bindingIds: ["runtime-qualification"],
  };
}

async function qualifyAndStop(group: CapabilityRuntimeLaunchGroup) {
  const fixture = supervisor([group]);
  setStates(fixture, group, "inactive");
  const started = await fixture.supervisor.ensureQualificationActive({
    group: capabilityRuntimeLaunchGroupReference(group),
    expectedMaterials: exactMaterials(group),
    qualificationStartAuthority: qualificationAuthority(),
    lease: qualificationLease([group]),
    at: AT,
    reuseExistingLease: "reject",
    guard: () => Promise.resolve(true),
  });
  const proof = await fixture.supervisor.releaseQualificationTerminal({
    group: capabilityRuntimeLaunchGroupReference(group),
    expectedMaterials: exactMaterials(group),
    qualificationStartAuthority: qualificationAuthority(),
    startProofFingerprint: started.qualificationStart!.fingerprint,
    lease: qualificationLease([group]),
    at: AT,
  });
  return { fixture, started, proof };
}

function qualificationAuthority() {
  return {
    candidate: {
      id: "chrono-arm64-emulation-v1",
      fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    },
    reviewFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
  };
}

class StateTransitionHost implements CapabilityRuntimeHostMutator {
  readonly calls: {
    readonly action: CapabilityRuntimeJournalEntry["action"];
    readonly groupId: string;
  }[] = [];
  readonly secretSnapshots: CapabilityRuntimeSecretSnapshot[] = [];
  freezeRuntime = false;
  startGate: Promise<void> | undefined;
  onRuntimeStart: (() => void) | undefined;

  constructor(
    private readonly states: InMemoryCapabilityRuntimeStateObserver,
    private readonly failAction: CapabilityRuntimeJournalEntry["action"] | undefined,
    private readonly reportUncertainFor:
      | CapabilityRuntimeJournalEntry["action"]
      | undefined = undefined,
    private readonly throwOn:
      | CapabilityRuntimeJournalEntry["action"]
      | undefined = undefined,
    private readonly nullOutcomeObservationsFor:
      | CapabilityRuntimeJournalEntry["action"]
      | undefined = undefined,
  ) {}

  async mutate(
    input: {
      readonly authorization: { readonly entry: CapabilityRuntimeJournalEntry };
      readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
    },
  ): Promise<CapabilityRuntimeJournalOutcome> {
    await Promise.resolve();
    const entry = input.authorization.entry;
    this.calls.push({ action: entry.action, groupId: entry.launchGroup.id });
    if (
      (entry.action === "runtime-start" ||
        entry.action === "runtime-qualification-start")
    ) {
      this.onRuntimeStart?.();
      await this.startGate;
    }
    if (entry.action === this.throwOn) {
      throw new Error(`host-${entry.action}-threw`);
    }
    if (input.secretSnapshot !== undefined) {
      this.secretSnapshots.push(input.secretSnapshot);
    }
    const failed = entry.action === this.failAction;
    const uncertain = failed || entry.action === this.reportUncertainFor;
    if (!this.freezeRuntime) {
      for (const material of entry.materials) {
        const prior = entry.previousObservations.find((observation) =>
          capabilityRuntimeMaterialKey(observation.material) ===
            capabilityRuntimeMaterialKey(material)
        )?.state;
        const state: CapabilityRuntimeObservedState = failed
          ? prior ?? {
            material: "absent",
            runtime: "inactive",
          }
          : transitionState(entry.action);
        this.states.set(material, state);
      }
    }
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: AT,
      status: uncertain ? "uncertain" : "succeeded",
      observations: entry.materials.map((material) => ({
        material,
        state: failed || entry.action === this.reportUncertainFor ||
            entry.action === this.nullOutcomeObservationsFor
          ? null
          : entry.action === "runtime-start" ||
              entry.action === "runtime-qualification-start"
          ? {
            material: "installed",
            runtime: "active",
          } as const
          : {
            material: "installed",
            runtime: "inactive",
          } as const,
      })),
      detail: uncertain ? "transition outcome is unknown" : null,
    };
  }
}

async function group(
  id: string,
  materialId: string,
  memberIds: readonly string[] = [materialId],
  secretSlots: readonly string[] = [],
  readiness = false,
): Promise<CapabilityRuntimeLaunchGroup> {
  const projectName = id;
  const composeContent = deterministicJson({
    services: {
      ...Object.fromEntries(memberIds.map((memberId, index) => {
        const serviceName = `${memberId}-service`;
        const digest = String.fromCharCode(97 + index).repeat(64);
        return [serviceName, {
          image: `example.test/${serviceName}@sha256:${digest}`,
          healthcheck: {
            test: ["CMD", "health"],
            interval: "1s",
            timeout: "1s",
            retries: 1,
          },
          ...(readiness && index === 0 ? { ports: ["127.0.0.1:3000:3000"] } : {}),
        }];
      })),
    },
    volumes: {},
  });
  const materials = memberIds.map((memberId, index) => {
    const serviceName = `${memberId}-service`;
    const digest = String.fromCharCode(97 + index).repeat(64);
    return {
      material: {
        unitId: `casys.${memberId}`,
        materialId: "image",
        imageDigest: digest,
      },
      serviceName,
      imageReference: `example.test/${serviceName}@sha256:${digest}`,
      ownership: [
        { key: "com.docker.compose.project", value: projectName },
        { key: "com.docker.compose.service", value: serviceName },
      ],
    };
  });
  const body = {
    schemaVersion: "capability-runtime-launch-group/2.0" as const,
    id,
    version: "1.0.0",
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName },
    materials,
    compose: {
      schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
      content: composeContent,
      fingerprint: await fingerprintCapabilityRuntimeComposeContent(composeContent),
    },
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots,
    security: "reviewed" as const,
    ...(readiness
      ? {
        readiness: {
          kind: "mcp-tools-list" as const,
          timeoutMs: 15_000,
          attemptTimeoutMs: 1_000,
          retryIntervalMs: 250,
        },
      }
      : {}),
  };
  return { ...body, fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body) };
}

async function projection(group: CapabilityRuntimeLaunchGroup) {
  return await deriveEffectiveCapabilityRuntimeLaunchProjection({
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    operation: resolvedOperation(group),
  });
}

function resolvedOperation(
  group: CapabilityRuntimeLaunchGroup,
): ResolvedCapabilityRuntimeOperation {
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: "project-test",
    operation: { id: `test.${group.id}`, version: "1" },
    authorizationFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    demandFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    registryFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    bindings: [{
      capability: {
        id: `test.${group.id}`,
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "test-binding", version: "1.0.0" },
      effectiveQualification: "qualified",
      adapter: { id: "test-adapter", version: "1", source: "test" },
      profile: null,
      materials: group.materials.map((member) => member.material),
      runtimeModes: group.materials.map((member) => ({
        material: member.material,
        targetPlatform: "linux/arm64" as const,
        mode: "native" as const,
        qualificationAttestationFingerprint: null,
      })),
      hostLifecycles: group.materials.map((member) => ({
        material: member.material,
        kind: "persistent-compose" as const,
        launchGroup: capabilityRuntimeLaunchGroupReference(group),
      })),
    }],
  };
}

function inactive(
  group: CapabilityRuntimeLaunchGroup,
): readonly {
  readonly material: CapabilityRuntimeLaunchGroup["materials"][number]["material"];
  readonly state: CapabilityRuntimeObservedState;
}[] {
  return group.materials.map((member) => ({
    material: member.material,
    state: {
      material: "installed",
      runtime: "inactive",
    },
  }));
}

function active(
  group: CapabilityRuntimeLaunchGroup,
): readonly {
  readonly material: CapabilityRuntimeLaunchGroup["materials"][number]["material"];
  readonly state: CapabilityRuntimeObservedState;
}[] {
  return group.materials.map((member) => ({
    material: member.material,
    state: {
      material: "installed",
      runtime: "active",
    },
  }));
}

function exactMaterials(
  group: CapabilityRuntimeLaunchGroup,
): readonly CapabilityRuntimeLaunchGroup["materials"][number]["material"][] {
  return group.materials.map((member) => member.material);
}

function setStates(
  fixture: ReturnType<typeof supervisor>,
  group: CapabilityRuntimeLaunchGroup,
  runtime: "inactive" | "active",
): void {
  for (const member of group.materials) {
    fixture.states.set(member.material, {
      material: "installed",
      runtime,
    });
  }
}

async function appendIntent(
  fixture: ReturnType<typeof supervisor>,
  group: CapabilityRuntimeLaunchGroup,
  action: CapabilityRuntimeJournalEntry["action"],
  id: string,
  plannedAt: string,
  previousObservations: readonly {
    readonly material: CapabilityRuntimeLaunchGroup["materials"][number]["material"];
    readonly state: CapabilityRuntimeObservedState;
  }[],
  outcome?: CapabilityRuntimeJournalOutcome["status"],
): Promise<void> {
  const entry: CapabilityRuntimeJournalEntry = {
    id,
    action,
    materials: group.materials.map((member) => member.material),
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    projectId: "project-test",
    plannedAt,
    previousObservations,
    effectiveRuntimeProjection: action === "runtime-start"
      ? await projection(group)
      : null,
    qualificationStartAuthority: null,
    administrativeRemovalPlanFingerprint: null,
  };
  await fixture.journal.appendBeforeMutation(entry);
  if (!outcome) return;
  await fixture.journal.appendOutcome({
    schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
    journalEntryId: entry.id,
    recordedAt: plannedAt,
    status: outcome,
    observations: entry.materials.map((material) => ({ material, state: null })),
    detail: outcome === "succeeded" ? null : "recorded test outcome",
  });
}

async function appendQualificationStart(
  fixture: ReturnType<typeof supervisor>,
  group: CapabilityRuntimeLaunchGroup,
  id: string,
  plannedAt: string,
  previousObservations: readonly {
    readonly material: CapabilityRuntimeLaunchGroup["materials"][number]["material"];
    readonly state: CapabilityRuntimeObservedState;
  }[],
  outcome?: CapabilityRuntimeJournalOutcome["status"],
): Promise<void> {
  const entry: CapabilityRuntimeJournalEntry = {
    id,
    action: "runtime-qualification-start",
    materials: group.materials.map((member) => member.material),
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
    plannedAt,
    previousObservations,
    effectiveRuntimeProjection: null,
    qualificationStartAuthority: qualificationAuthority(),
    administrativeRemovalPlanFingerprint: null,
  };
  await fixture.journal.appendBeforeMutation(entry);
  if (!outcome) return;
  await fixture.journal.appendOutcome({
    schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
    journalEntryId: entry.id,
    recordedAt: plannedAt,
    status: outcome,
    observations: entry.materials.map((material) => ({ material, state: null })),
    detail: outcome === "succeeded" ? null : "recorded test outcome",
  });
}

async function appendQualificationStop(
  fixture: ReturnType<typeof supervisor>,
  group: CapabilityRuntimeLaunchGroup,
  id: string,
  plannedAt: string,
  previousObservations: readonly {
    readonly material: CapabilityRuntimeLaunchGroup["materials"][number]["material"];
    readonly state: CapabilityRuntimeObservedState;
  }[],
  outcome?: CapabilityRuntimeJournalOutcome["status"],
): Promise<void> {
  const entry: CapabilityRuntimeJournalEntry = {
    id,
    action: "runtime-stop",
    materials: group.materials.map((member) => member.material),
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
    plannedAt,
    previousObservations,
    effectiveRuntimeProjection: null,
    qualificationStartAuthority: null,
    administrativeRemovalPlanFingerprint: null,
  };
  await fixture.journal.appendBeforeMutation(entry);
  if (!outcome) return;
  await fixture.journal.appendOutcome({
    schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
    journalEntryId: entry.id,
    recordedAt: plannedAt,
    status: outcome,
    observations: entry.materials.map((material) => ({ material, state: null })),
    detail: outcome === "succeeded" ? null : "recorded test outcome",
  });
}

function transitionState(
  action: CapabilityRuntimeJournalEntry["action"],
): CapabilityRuntimeObservedState {
  switch (action) {
    case "material-acquire":
    case "runtime-stop":
      return { material: "installed", runtime: "inactive" };
    case "runtime-start":
    case "runtime-qualification-start":
      return { material: "installed", runtime: "active" };
    case "material-remove":
      return { material: "absent", runtime: "inactive" };
  }
}
