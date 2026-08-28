import { assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityRuntimeHostSafetyError,
  CapabilityRuntimeHostSupervisor,
} from "./capability-runtime-host-supervisor.ts";
import { FixedCapabilityRuntimeLaunchProfileRegistry } from "./capability-runtime-launch-profile-registry.ts";
import {
  type CapabilityRuntimeLaunchProfile,
  capabilityRuntimeLaunchProfileReference,
} from "../../domain/capability/runtime/capability-runtime-host.ts";
import type {
  CapabilityRuntimeJournalEntry,
  CapabilityRuntimeJournalOutcome,
  CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  InMemoryCapabilityRuntimeJournal,
  InMemoryCapabilityRuntimeLeaseStore,
  InMemoryCapabilityRuntimeStateObserver,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeSecretSlotObserver,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import {
  FAKE_CAPABILITY_RUNTIME_MATERIAL,
  fakeCapabilityRuntimeLaunchProfile,
} from "../../testing/capability-runtime-host-fixture.ts";

Deno.test("cache-only profiles are materialized but never activated", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile({
    activationPolicy: "cache-only",
  });
  const fixture = await supervisorFixture(profile, {
    material: "installed",
    runtime: "inactive",
    qualification: "qualified",
  });
  await fixture.supervisor.ensureMaterial(request(profile));
  await assertRejects(
    () =>
      fixture.supervisor.ensureActive({
        ...request(profile),
        lease: lease("lease:cache", profile),
      }),
    CapabilityRuntimeHostSafetyError,
    "must never be activated",
  );
  assertEquals(fixture.host.calls, []);
});

Deno.test("unknown profile security and unavailable or unknown secret slots block before a host command", async () => {
  const unknownSecurity = await fakeCapabilityRuntimeLaunchProfile({
    security: "unknown",
  });
  const unsafe = await supervisorFixture(unknownSecurity, undefined);
  await assertRejects(
    () => unsafe.supervisor.ensureMaterial(request(unknownSecurity)),
    CapabilityRuntimeHostSafetyError,
    "security is unknown",
  );
  assertEquals(unsafe.host.calls, []);

  const secretProfile = await fakeCapabilityRuntimeLaunchProfile({
    secretSlots: ["host-token"],
  });
  const secretUnknown = await supervisorFixture(
    secretProfile,
    undefined,
    new SecretSlots(),
  );
  await assertRejects(
    () => secretUnknown.supervisor.ensureMaterial(request(secretProfile)),
    CapabilityRuntimeHostSafetyError,
    "host-token is unknown",
  );
  assertEquals(secretUnknown.host.calls, []);
});

Deno.test("revoked qualification blocks the supervisor before a host command", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile({
    qualification: "revoked",
  });
  const fixture = await supervisorFixture(profile, undefined);

  await assertRejects(
    () => fixture.supervisor.ensureMaterial(request(profile)),
    CapabilityRuntimeHostSafetyError,
    "qualification is revoked",
  );
  assertEquals(fixture.host.calls, []);
});

Deno.test("ensureActive refuses a lease expired at the requested activation instant", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, {
    material: "installed",
    runtime: "inactive",
    qualification: "qualified",
  });
  await assertRejects(
    () =>
      fixture.supervisor.ensureActive({
        ...request(profile),
        lease: {
          ...lease("lease:expired", profile),
          acquiredAt: "2026-08-28T23:59:00.000Z",
          expiresAt: "2026-08-29T00:00:00.000Z",
        },
      }),
    CapabilityRuntimeHostSafetyError,
    "expired",
  );
  assertEquals(fixture.host.calls, []);
});

Deno.test("ensureActive refuses an atomically returned expired lease before reuse or host observation", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, {
    material: "installed",
    runtime: "active",
    qualification: "qualified",
  });
  const candidate = lease("lease:expired-existing", profile);
  await fixture.leases.claim({
    ...candidate,
    acquiredAt: "2026-08-28T22:00:00.000Z",
    expiresAt: "2026-08-29T00:00:00.000Z",
  });
  await assertRejects(
    () =>
      fixture.supervisor.ensureActive({
        ...request(profile),
        lease: candidate,
        reuseExistingLease: "allow",
      }),
    CapabilityRuntimeHostSafetyError,
    "expired",
  );
  assertEquals(fixture.host.calls, []);
});

Deno.test("ensureActive never trusts an active observation while a failed or uncertain host intent remains", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, {
    material: "installed",
    runtime: "active",
    qualification: "qualified",
  });
  const entry = {
    id: "host-runtime:uncertain-active",
    action: "runtime-start" as const,
    material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
    launchProfile: capabilityRuntimeLaunchProfileReference(profile),
    projectId: "project:host-runtime",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservation: null,
    administrativeRemovalPlanFingerprint: null,
  };
  await fixture.journal.appendBeforeMutation(entry);
  await fixture.journal.appendOutcome({
    schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
    journalEntryId: entry.id,
    recordedAt: entry.plannedAt,
    status: "uncertain",
    observation: null,
    detail: "host acknowledgement is absent",
  });
  await assertRejects(
    () =>
      fixture.supervisor.ensureActive({
        ...request(profile),
        lease: lease("lease:active-recovery", profile),
      }),
    CapabilityRuntimeHostSafetyError,
    "unreconciled pending host intent",
  );
  assertEquals(fixture.host.calls, []);
});

Deno.test("releaseLease attests the durable lease project, material and profile before deletion", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, {
    material: "installed",
    runtime: "active",
    qualification: "qualified",
  });
  const durable = lease("lease:attested", profile);
  await fixture.leases.claim(durable);

  await assertRejects(
    () =>
      fixture.supervisor.releaseLease({
        profile: capabilityRuntimeLaunchProfileReference(profile),
        leaseId: durable.id,
        projectId: "project:another",
        at: "2026-08-29T00:00:00.000Z",
        jitDemand: false,
      }),
    CapabilityRuntimeHostSafetyError,
    "project does not match",
  );
  assertEquals((await fixture.leases.read(durable.id))?.id, durable.id);

  await fixture.leases.release(durable.id);
  await fixture.leases.claim({
    ...durable,
    id: "lease:wrong-material",
    materialKeys: ["test.host-runtime-unit\u0000another-material"],
  });
  await assertRejects(
    () =>
      fixture.supervisor.releaseLease({
        profile: capabilityRuntimeLaunchProfileReference(profile),
        leaseId: "lease:wrong-material",
        projectId: durable.projectId,
        at: "2026-08-29T00:00:00.000Z",
        jitDemand: false,
      }),
    CapabilityRuntimeHostSafetyError,
    "exact profile material",
  );
  assertEquals(
    (await fixture.leases.read("lease:wrong-material"))?.id,
    "lease:wrong-material",
  );

  await fixture.leases.release("lease:wrong-material");
  await fixture.leases.claim({
    ...durable,
    id: "lease:wrong-profile",
    launchProfiles: [{
      ...capabilityRuntimeLaunchProfileReference(profile),
      id: "other-runtime-profile",
    }],
  });
  await assertRejects(
    () =>
      fixture.supervisor.releaseLease({
        profile: capabilityRuntimeLaunchProfileReference(profile),
        leaseId: "lease:wrong-profile",
        projectId: durable.projectId,
        at: "2026-08-29T00:00:00.000Z",
        jitDemand: false,
      }),
    CapabilityRuntimeHostSafetyError,
    "exact launch profile",
  );
  assertEquals(
    (await fixture.leases.read("lease:wrong-profile"))?.id,
    "lease:wrong-profile",
  );
  assertEquals(fixture.host.calls, []);
});

Deno.test("release stops a persistent runtime only after every lease expired or released and no JIT demand remains", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, {
    material: "installed",
    runtime: "active",
    qualification: "qualified",
  });
  await fixture.supervisor.ensureActive({
    ...request(profile),
    lease: lease("lease:first", profile),
  });
  await fixture.supervisor.ensureActive({
    ...request(profile),
    lease: lease("lease:second", profile),
  });
  assertEquals(
    (await fixture.supervisor.releaseLease({
      profile: capabilityRuntimeLaunchProfileReference(profile),
      leaseId: "lease:first",
      projectId: "project:host-runtime",
      at: "2026-08-29T00:00:00.000Z",
      jitDemand: false,
    })).deactivation,
    undefined,
  );
  assertEquals(
    (await fixture.supervisor.releaseLease({
      profile: capabilityRuntimeLaunchProfileReference(profile),
      leaseId: "lease:second",
      projectId: "project:host-runtime",
      at: "2026-08-29T00:00:00.000Z",
      jitDemand: true,
    })).deactivation,
    undefined,
  );
  await fixture.supervisor.ensureActive({
    ...request(profile),
    lease: lease("lease:third", profile),
  });
  const stopped = await fixture.supervisor.releaseLease({
    profile: capabilityRuntimeLaunchProfileReference(profile),
    leaseId: "lease:third",
    projectId: "project:host-runtime",
    at: "2026-08-29T00:00:00.000Z",
    jitDemand: false,
  });
  assertEquals(stopped.deactivation?.status, "succeeded");
  assertEquals(fixture.host.calls.map((entry) => entry.action), ["runtime-stop"]);
});

Deno.test("an uncertain host command changes no project proof and remains a host journal outcome", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, undefined, undefined, "uncertain");
  const projectProof = {
    artifactId: "thread:proof:unchanged",
    fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
  };
  const before = structuredClone(projectProof);

  const result = await fixture.supervisor.ensureMaterial(request(profile));

  assertEquals(result.mutation?.status, "uncertain");
  assertEquals(projectProof, before);
  assertEquals(
    (await fixture.journal.listOutcomes()).map((outcome) => outcome.status),
    [
      "uncertain",
    ],
  );
});

Deno.test("a crash-pending host intent blocks a new matching intent until recovery reconciles it", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, undefined);
  await fixture.journal.appendBeforeMutation({
    id: "host-runtime:crash-pending",
    action: "material-acquire",
    material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
    launchProfile: capabilityRuntimeLaunchProfileReference(profile),
    projectId: "project:host-runtime",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservation: null,
    administrativeRemovalPlanFingerprint: null,
  });

  await assertRejects(
    () => fixture.supervisor.ensureMaterial(request(profile)),
    CapabilityRuntimeHostSafetyError,
    "unreconciled pending host intent",
  );
  assertEquals((await fixture.journal.list()).map((entry) => entry.id), [
    "host-runtime:crash-pending",
  ]);
  assertEquals(fixture.host.calls, []);
});

Deno.test("a pending material acquisition blocks activation for the same material/profile before any host dispatch", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, {
    material: "installed",
    runtime: "inactive",
    qualification: "qualified",
  });
  await fixture.journal.appendBeforeMutation({
    id: "host-runtime:crash-acquire",
    action: "material-acquire",
    material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
    launchProfile: capabilityRuntimeLaunchProfileReference(profile),
    projectId: "project:host-runtime",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservation: null,
    administrativeRemovalPlanFingerprint: null,
  });

  await assertRejects(
    () =>
      fixture.supervisor.ensureActive({
        ...request(profile),
        lease: lease("lease:blocked-start", profile),
      }),
    CapabilityRuntimeHostSafetyError,
    "unreconciled pending host intent",
  );
  assertEquals(fixture.host.calls, []);
  assertEquals(await fixture.leases.read("lease:blocked-start"), undefined);
});

Deno.test("a pending activation blocks stop for the same material/profile before any host dispatch", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = await supervisorFixture(profile, {
    material: "installed",
    runtime: "active",
    qualification: "qualified",
  });
  const durable = lease("lease:blocked-stop", profile);
  await fixture.leases.claim(durable);
  await fixture.journal.appendBeforeMutation({
    id: "host-runtime:crash-start",
    action: "runtime-start",
    material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
    launchProfile: capabilityRuntimeLaunchProfileReference(profile),
    projectId: "project:host-runtime",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservation: {
      material: "installed",
      runtime: "inactive",
      qualification: "qualified",
    },
    administrativeRemovalPlanFingerprint: null,
  });

  await assertRejects(
    () =>
      fixture.supervisor.releaseLease({
        profile: capabilityRuntimeLaunchProfileReference(profile),
        leaseId: durable.id,
        projectId: durable.projectId,
        at: "2026-08-29T00:00:00.000Z",
        jitDemand: false,
      }),
    CapabilityRuntimeHostSafetyError,
    "unreconciled pending host intent",
  );
  assertEquals(fixture.host.calls, []);
  assertEquals((await fixture.leases.read(durable.id))?.id, durable.id);
});

async function supervisorFixture(
  profile: CapabilityRuntimeLaunchProfile,
  initial: CapabilityRuntimeObservedState | undefined,
  secrets: CapabilityRuntimeSecretSlotObserver = new SecretSlots(["available"]),
  hostStatus: CapabilityRuntimeJournalOutcome["status"] = "succeeded",
) {
  const states = new InMemoryCapabilityRuntimeStateObserver();
  if (initial) states.set(FAKE_CAPABILITY_RUNTIME_MATERIAL, initial);
  const journal = new InMemoryCapabilityRuntimeJournal();
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const host = new RecordingHost(hostStatus);
  const supervisor = new CapabilityRuntimeHostSupervisor({
    profiles: new FixedCapabilityRuntimeLaunchProfileRegistry([profile]),
    journal,
    leases,
    states,
    host,
    secrets,
    lock: new ImmediateLock(),
  });
  return { supervisor, journal, host, leases };
}

function request(profile: CapabilityRuntimeLaunchProfile) {
  return {
    profile: capabilityRuntimeLaunchProfileReference(profile),
    projectId: "project:host-runtime",
    at: "2026-08-29T00:00:00.000Z",
  };
}

function lease(id: string, profile: CapabilityRuntimeLaunchProfile) {
  return {
    id,
    projectId: "project:host-runtime",
    bindingIds: ["binding:fake"],
    materialKeys: ["test.host-runtime-unit\u0000test-host-runtime-image"],
    launchProfiles: [capabilityRuntimeLaunchProfileReference(profile)],
    acquiredAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-29T01:00:00.000Z",
  };
}

class ImmediateLock implements CapabilityRuntimeHostMutationLock {
  withLock<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

class SecretSlots implements CapabilityRuntimeSecretSlotObserver {
  constructor(
    private readonly states: readonly ("available" | "unavailable" | "unknown")[] = [],
  ) {}

  async observe(
    slots: readonly string[],
  ): Promise<ReadonlyMap<string, "available" | "unavailable" | "unknown">> {
    return new Map(slots.map((slot, index) => [slot, this.states[index] ?? "unknown"]));
  }
}

class RecordingHost implements CapabilityRuntimeHostMutator {
  readonly calls: CapabilityRuntimeJournalEntry[] = [];

  constructor(private readonly status: CapabilityRuntimeJournalOutcome["status"]) {}

  async mutate(input: {
    readonly authorization: AuthorizedCapabilityRuntimeHostMutation;
  }): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = input.authorization.entry;
    this.calls.push(structuredClone(entry));
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: entry.plannedAt,
      status: this.status,
      observation: null,
      detail: this.status === "succeeded" ? null : "simulated host uncertainty",
    };
  }
}
