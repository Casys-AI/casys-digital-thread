import { assertEquals, assertRejects } from "@std/assert";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
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
import {
  CapabilityRuntimeLaunchGroupSafetyError,
  CapabilityRuntimeLaunchGroupSupervisor,
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
  const journal = new InMemoryCapabilityRuntimeJournal();
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const host = new StateTransitionHost(states, failAction);
  const supervisor = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: new FixedCapabilityRuntimeLaunchGroupRegistry(groups),
    journal,
    leases,
    states,
    host,
    secrets: {
      observe: (slots) =>
        Promise.resolve(new Map(slots.map((slot) => [slot, secretAvailability]))),
    },
    lock: { withLock: (operation) => operation() },
  });
  return { supervisor, leases, host, states, journal };
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

  constructor(
    private readonly states: InMemoryCapabilityRuntimeStateObserver,
    private readonly failAction: CapabilityRuntimeJournalEntry["action"] | undefined,
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
    if (input.secretSnapshot !== undefined) {
      this.secretSnapshots.push(input.secretSnapshot);
    }
    const uncertain = entry.action === this.failAction;
    for (const material of entry.materials) {
      const prior = entry.previousObservations.find((observation) =>
        capabilityRuntimeMaterialKey(observation.material) ===
          capabilityRuntimeMaterialKey(material)
      )?.state;
      const state: CapabilityRuntimeObservedState = uncertain
        ? prior ?? {
          material: "absent",
          runtime: "inactive",
        }
        : transitionState(entry.action);
      this.states.set(material, state);
    }
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: AT,
      status: uncertain ? "uncertain" : "succeeded",
      observations: entry.materials.map((material) => ({
        material,
        state: uncertain ? null : entry.action === "runtime-start" ||
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
