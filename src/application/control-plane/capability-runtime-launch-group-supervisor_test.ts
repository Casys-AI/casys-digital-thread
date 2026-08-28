import { assertEquals, assertRejects } from "@std/assert";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
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
import type { CapabilityRuntimeHostMutator } from "../ports/out/capability/capability-runtime-supervisor.ts";

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
    projectId: "project-test",
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });
  const secondResult = await fixture.supervisor.ensureActive({
    group: capabilityRuntimeLaunchGroupReference(second),
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
    projectId: "project-test",
    lease,
    at: AT,
    reuseExistingLease: "reject",
  });

  assertEquals(result.mutation, undefined);
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
    qualification: "qualified",
  });
  await appendIntent(fixture, first, "runtime-start", "pending-start", AT, prior);

  await assertRejects(
    () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
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
    () =>
      fixture.supervisor.ensureActive({
        group: capabilityRuntimeLaunchGroupReference(first),
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
) {
  const states = new InMemoryCapabilityRuntimeStateObserver();
  for (const group of groups) {
    for (const member of group.materials) {
      states.set(member.material, {
        material: "absent",
        runtime: "inactive",
        qualification: "qualified",
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
        Promise.resolve(new Map(slots.map((slot) => [slot, "unavailable" as const]))),
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

class StateTransitionHost implements CapabilityRuntimeHostMutator {
  readonly calls: {
    readonly action: CapabilityRuntimeJournalEntry["action"];
    readonly groupId: string;
  }[] = [];

  constructor(
    private readonly states: InMemoryCapabilityRuntimeStateObserver,
    private readonly failAction: CapabilityRuntimeJournalEntry["action"] | undefined,
  ) {}

  async mutate(
    input: {
      readonly authorization: { readonly entry: CapabilityRuntimeJournalEntry };
    },
  ): Promise<CapabilityRuntimeJournalOutcome> {
    await Promise.resolve();
    const entry = input.authorization.entry;
    this.calls.push({ action: entry.action, groupId: entry.launchGroup.id });
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
          qualification: "qualified",
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
        state: uncertain ? null : entry.action === "runtime-start"
          ? {
            material: "installed",
            runtime: "active",
            qualification: "qualified",
          } as const
          : {
            material: "installed",
            runtime: "inactive",
            qualification: "qualified",
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
    schemaVersion: "capability-runtime-launch-group/1.0" as const,
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
    secretSlots: [],
    security: "reviewed" as const,
    qualification: "qualified" as const,
  };
  return { ...body, fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body) };
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
      qualification: "qualified",
    },
  }));
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
      qualification: "qualified",
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
      return { material: "installed", runtime: "inactive", qualification: "qualified" };
    case "runtime-start":
      return { material: "installed", runtime: "active", qualification: "qualified" };
    case "material-remove":
      return { material: "absent", runtime: "inactive", qualification: "qualified" };
  }
}
