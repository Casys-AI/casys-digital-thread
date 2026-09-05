import { assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityRuntimeAuthorizationError,
  CapabilityRuntimeLifecycleCoordinator,
  type CapabilityRuntimeOperationRegistry,
  CapabilityRuntimeSupervisor,
} from "./capability-runtime-supervisor.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  createEffectiveCapabilityRuntimeLaunchProjection,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  InMemoryCapabilityRuntimeHostMutator,
  InMemoryCapabilityRuntimeJournal,
  InMemoryCapabilityRuntimeLeaseStore,
  InMemoryCapabilityRuntimeStateObserver,
  InMemoryProjectCapabilityRuntimeContextReader,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type {
  ProjectCapabilityRuntimeContext,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeCatalog,
  ProjectCapabilityPlan,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type {
  ProjectCapabilityDemand,
} from "../../domain/capability/project-capability-demand.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const REGISTRY_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "b".repeat(64),
};
const AUTHORIZATION_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "c".repeat(64),
};
const IMAGE_DIGEST = "d".repeat(64);
const PROJECT = {
  id: "project:capability-supervisor",
  project: { id: "project:capability-supervisor" },
  revision: 7,
} as unknown as EngineeringProjectSnapshot;
const OPERATION = { id: "verify.static", version: "1", bindings: [] };
const WORK_ITEM = {
  id: "work:static",
  operation: OPERATION,
} as unknown as EngineeringWorkItem;

Deno.test("capability supervisor refuses a demanded runtime before queue when the project has no authorization", async () => {
  const fixture = await readyFixture();
  fixture.contexts.set(PROJECT.id, {
    ...fixture.context,
    authorization: undefined,
  });

  await assertRejects(
    () => fixture.supervisor.validate(queueInput()),
    CapabilityRuntimeAuthorizationError,
    "not-authorized",
  );
});

Deno.test("capability supervisor permits a later demand subset without reapproving an unrelated registry change", async () => {
  const fixture = await readyFixture();
  const changedDemand = {
    ...fixture.context.demand,
    registryFingerprint: { algorithm: "sha256" as const, digest: "e".repeat(64) },
  };
  const context = {
    ...fixture.context,
    demand: changedDemand,
    plan: {
      ...fixture.context.plan,
      registryFingerprint: changedDemand.registryFingerprint,
    },
  };
  fixture.contexts.set(PROJECT.id, context);

  await fixture.supervisor.validate(queueInput());
});

Deno.test("capability supervisor seals the planned exact mode without consulting the Deno process architecture", async () => {
  const fixture = await readyFixture();
  const resolved = await fixture.supervisor.validate(queueInput());
  assertEquals(resolved?.bindings[0]?.runtimeModes, [{
    material: fixture.material,
    targetPlatform: "linux/amd64",
    mode: "emulated",
    qualificationAttestationFingerprint: FINGERPRINT,
  }]);
  assertEquals(resolved?.bindings[0]?.hostLifecycles, [{
    material: fixture.material,
    kind: "ephemeral-microsandbox",
    launchGroup: null,
  }]);
});

Deno.test("capability supervisor refuses JIT when the exact local unit lock is inactive", async () => {
  const fixture = await readyFixture();
  fixture.contexts.set(PROJECT.id, {
    ...fixture.context,
    lock: {
      ...fixture.context.lock,
      units: fixture.context.lock.units.map((unit) => ({
        ...unit,
        desired: "inactive" as const,
      })),
    },
  });
  await assertRejects(
    () => fixture.supervisor.validate(queueInput()),
    CapabilityRuntimeAuthorizationError,
    "local administrative lock does not permit",
  );
});

Deno.test("capability supervisor refuses a selected binding whose qualified profile changed after authorization", async () => {
  const fixture = await readyFixture();
  const authorization = fixture.context.authorization!;
  const context: ProjectCapabilityRuntimeContext = {
    ...fixture.context,
    authorization: {
      ...authorization,
      allowedBindings: authorization.allowedBindings.map((binding) => ({
        ...binding,
        profile: binding.profile === null ? null : {
          ...binding.profile,
          fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
        },
      })),
    },
  };
  fixture.contexts.set(PROJECT.id, context);

  await assertRejects(
    () => fixture.supervisor.validate(queueInput()),
    CapabilityRuntimeAuthorizationError,
    "does not admit binding",
  );
});

Deno.test("capability supervisor refuses a selected binding whose adapter source changed after authorization", async () => {
  const fixture = await readyFixture();
  const authorization = fixture.context.authorization!;
  fixture.contexts.set(PROJECT.id, {
    ...fixture.context,
    authorization: {
      ...authorization,
      allowedBindings: authorization.allowedBindings.map((binding) => ({
        ...binding,
        adapter: { ...binding.adapter, source: "other-server" },
      })),
    },
  });

  await assertRejects(
    () => fixture.supervisor.validate(queueInput()),
    CapabilityRuntimeAuthorizationError,
    "does not admit binding",
  );
});

Deno.test("capability supervisor refuses an authorization that leaves a semantic binding choice ambiguous", async () => {
  const fixture = await readyFixture();
  const authorization = fixture.context.authorization!;
  fixture.contexts.set(PROJECT.id, {
    ...fixture.context,
    authorization: {
      ...authorization,
      allowedBindings: [
        ...authorization.allowedBindings,
        {
          ...authorization.allowedBindings[0]!,
          binding: { id: "replacement-calculix", version: "1" },
        },
      ],
    },
  });

  await assertRejects(
    () => fixture.supervisor.validate(queueInput()),
    CapabilityRuntimeAuthorizationError,
    "multiple exact bindings",
  );
});

Deno.test("capability supervisor resolves exact approved binding, profile, material digest and lifecycle", async () => {
  const fixture = await readyFixture();
  const resolved = await fixture.supervisor.requireExecution({
    project: PROJECT,
    run: { id: "run:static", workItemId: WORK_ITEM.id } as never,
    workItem: WORK_ITEM,
    operation: OPERATION,
  });

  assertEquals(resolved?.authorizationFingerprint, AUTHORIZATION_FINGERPRINT);
  assertEquals(resolved?.bindings, [{
    capability: {
      id: "mechanics.solve-static-structural",
      version: "1",
      use: "execution",
      minimumQualification: "qualified",
    },
    binding: { id: "calculix-static-structural", version: "1" },
    effectiveQualification: "qualified",
    adapter: { id: "isolated-calculix", version: "1", source: "server" },
    profile: {
      id: "calculix-static",
      version: "1",
      fingerprint: FINGERPRINT,
    },
    materials: [{
      unitId: "casys.calculix-worker",
      materialId: "calculix-worker",
      imageDigest: IMAGE_DIGEST,
    }],
    runtimeModes: [{
      material: {
        unitId: "casys.calculix-worker",
        materialId: "calculix-worker",
        imageDigest: IMAGE_DIGEST,
      },
      targetPlatform: "linux/amd64",
      mode: "emulated",
      qualificationAttestationFingerprint: FINGERPRINT,
    }],
    hostLifecycles: [{
      material: {
        unitId: "casys.calculix-worker",
        materialId: "calculix-worker",
        imageDigest: IMAGE_DIGEST,
      },
      kind: "ephemeral-microsandbox",
      launchGroup: null,
    }],
  }]);
});

Deno.test("runtimeDemand none does not require a capability ledger or host observation", async () => {
  const contexts = new InMemoryProjectCapabilityRuntimeContextReader();
  const supervisor = new CapabilityRuntimeSupervisor({
    contexts,
    operations: registry({ kind: "none" }),
  });
  const noRuntimeOperation = { id: "record.note", version: "1", bindings: [] };
  const noRuntimeWork = {
    id: "work:note",
    operation: noRuntimeOperation,
  } as unknown as EngineeringWorkItem;

  await supervisor.validate({
    project: PROJECT,
    workItem: noRuntimeWork,
    operation: noRuntimeOperation,
    basis: { kind: "approved-brief" } as never,
  });
  assertEquals(
    await supervisor.requireExecution({
      project: PROJECT,
      run: { id: "run:note", workItemId: noRuntimeWork.id } as never,
      workItem: noRuntimeWork,
      operation: noRuntimeOperation,
    }),
    undefined,
  );
});

Deno.test("preparation entry refuses a registered execution operation before reading or mutating a host", async () => {
  const fixture = await readyFixture();
  await assertRejects(
    () =>
      fixture.supervisor.requirePreparation({ project: PROJECT, operation: OPERATION }),
    CapabilityRuntimeAuthorizationError,
    "one exact registered preparation demand",
  );
});

Deno.test("lifecycle coordinator journals before host mutation and recovery keeps an unmet intent pending", async () => {
  const journal = new InMemoryCapabilityRuntimeJournal();
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const states = new InMemoryCapabilityRuntimeStateObserver();
  const host = new InMemoryCapabilityRuntimeHostMutator();
  const material = {
    unitId: "casys.calculix-worker",
    materialId: "calculix-worker",
    imageDigest: IMAGE_DIGEST,
  };
  states.set(material, {
    material: "installed",
    runtime: "inactive",
  });
  const coordinator = new CapabilityRuntimeLifecycleCoordinator(
    journal,
    leases,
    states,
    host,
  );
  await coordinator.acquireLease({
    id: "lease:static",
    projectId: "project:capability-supervisor",
    bindingIds: ["calculix-static-structural"],
    materialKeys: ["casys.calculix-worker\u0000calculix-worker"],
    launchGroups: [{
      id: "test-runtime-group",
      version: "1",
      fingerprint: FINGERPRINT,
    }],
    acquiredAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-29T01:00:00.000Z",
  });
  await coordinator.mutate({
    id: "journal:start",
    action: "runtime-start",
    materials: [material],
    launchGroup: {
      id: "test-runtime-group",
      version: "1",
      fingerprint: FINGERPRINT,
    },
    projectId: "project:capability-supervisor",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservations: [{ material, state: null }],
    administrativeRemovalPlanFingerprint: null,
    qualificationStartAuthority: null,
    effectiveRuntimeProjection: await createEffectiveCapabilityRuntimeLaunchProjection({
      launchGroup: {
        id: "test-runtime-group",
        version: "1",
        fingerprint: FINGERPRINT,
      },
      materials: [{
        material,
        binding: { id: "test-binding", version: "1.0.0" },
        effectiveQualification: "qualified",
        minimumQualification: "qualified",
        runtimeMode: {
          material,
          targetPlatform: "linux/arm64",
          mode: "native",
          qualificationAttestationFingerprint: null,
        },
      }],
    }),
  });

  assertEquals((await journal.list()).map((entry) => entry.id), ["journal:start"]);
  assertEquals(host.calls.map((call) => call.entry.id), ["journal:start"]);
  assertEquals((await leases.listActive("2026-08-29T00:30:00.000Z")).length, 1);
  assertEquals(
    (await coordinator.recover([material])).pendingJournalEntries.map((entry) =>
      entry.id
    ),
    ["journal:start"],
  );
});

Deno.test("lifecycle coordinator refuses a private qualification-start before any journal write", async () => {
  const journal = new InMemoryCapabilityRuntimeJournal();
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const states = new InMemoryCapabilityRuntimeStateObserver();
  const host = new InMemoryCapabilityRuntimeHostMutator();
  const material = {
    unitId: "casys.calculix-worker",
    materialId: "calculix-worker",
    imageDigest: IMAGE_DIGEST,
  };
  const coordinator = new CapabilityRuntimeLifecycleCoordinator(
    journal,
    leases,
    states,
    host,
  );

  await assertRejects(
    () =>
      coordinator.mutate({
        id: "journal:qualification",
        action: "runtime-qualification-start",
        materials: [material],
        launchGroup: {
          id: "test-runtime-group",
          version: "1",
          fingerprint: FINGERPRINT,
        },
        projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
        plannedAt: "2026-08-29T00:00:00.000Z",
        previousObservations: [{ material, state: null }],
        administrativeRemovalPlanFingerprint: null,
        effectiveRuntimeProjection: null,
        qualificationStartAuthority: {
          candidate: {
            id: "chrono-arm64-emulation-v1",
            fingerprint: FINGERPRINT,
          },
          reviewFingerprint: REGISTRY_FINGERPRINT,
        },
      }),
    CapabilityRuntimeAuthorizationError,
    "only through the launch-group qualification supervisor",
  );
  assertEquals(await journal.list(), []);
  assertEquals(host.calls, []);
});

function readyFixture() {
  const material = {
    unitId: "casys.calculix-worker",
    materialId: "calculix-worker",
    imageDigest: IMAGE_DIGEST,
  };
  const context = runtimeContext(material);
  const contexts = new InMemoryProjectCapabilityRuntimeContextReader();
  contexts.set(PROJECT.id, context);
  return Promise.resolve({
    material,
    context,
    contexts,
    supervisor: new CapabilityRuntimeSupervisor({
      contexts,
      operations: registry(requiredDemand()),
    }),
  });
}

function queueInput() {
  return {
    project: PROJECT,
    workItem: WORK_ITEM,
    operation: OPERATION,
    basis: { kind: "approved-brief" } as never,
  };
}

function registry(
  runtimeDemand: ReturnType<typeof requiredDemand> | { readonly kind: "none" },
): CapabilityRuntimeOperationRegistry {
  return {
    require(operation) {
      return { id: operation.id, version: operation.version, runtimeDemand };
    },
  };
}

function requiredDemand() {
  return {
    kind: "required" as const,
    capabilities: [{
      id: "mechanics.solve-static-structural",
      version: "1",
      use: "execution" as const,
      minimumQualification: "qualified" as const,
    }],
  };
}

function runtimeContext(
  material: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  },
): ProjectCapabilityRuntimeContext {
  const demand = {
    status: "resolved",
    projectSnapshot: {
      projectId: PROJECT.project.id,
      snapshotId: PROJECT.id,
      revision: PROJECT.revision,
    },
    plannedCeiling: {
      status: "resolved",
      operationGroups: [],
      capabilityRequirements: requiredDemand().capabilities,
    },
    plannedCeilingFingerprint: FINGERPRINT,
    registryFingerprint: REGISTRY_FINGERPRINT,
  } as unknown as ProjectCapabilityDemand;
  const catalog = {
    units: [{
      id: material.unitId,
      version: "1",
      manifestFingerprint: FINGERPRINT,
      materials: [{
        id: material.materialId,
        kind: "microvm-image",
        imageReference: `example.test/calculix@sha256:${material.imageDigest}`,
        platforms: ["linux/amd64"],
        lifecycle: "ephemeral",
        launchGroup: null,
        effects: {},
      }],
    }],
    bindings: [{
      id: "calculix-static-structural",
      version: "1",
      capability: {
        id: "mechanics.solve-static-structural",
        version: "1",
      },
      use: "execution",
      qualification: "qualified",
      adapter: { id: "isolated-calculix", version: "1", source: "server" },
      profile: { id: "calculix-static", version: "1", fingerprint: FINGERPRINT },
      unitIds: [material.unitId],
      qualificationEvidence: { id: "qualification", source: "test", fingerprint: null },
      runtimeModes: [{
        material,
        targetPlatform: "linux/amd64",
        mode: "emulated",
        qualificationAttestationFingerprint: FINGERPRINT,
      }],
      limitations: [],
    }],
  } as unknown as CapabilityRuntimeCatalog;
  const plan = {
    demandFingerprint: FINGERPRINT,
    registryFingerprint: REGISTRY_FINGERPRINT,
    activation: "blocked",
    bindings: [{
      requirement: requiredDemand().capabilities[0],
      status: "selected",
      binding: {
        id: "calculix-static-structural",
        version: "1",
        qualification: "qualified",
      },
      unitIds: [material.unitId],
      reasons: [],
    }],
    materials: [{
      unitId: material.unitId,
      materialId: material.materialId,
      imageReference: `example.test/calculix@sha256:${material.imageDigest}`,
      mode: "emulated",
      imageState: "present",
      desired: "active",
      downloadBytes: null,
      storageBytes: null,
    }],
  } as unknown as ProjectCapabilityPlan;
  return {
    demand,
    plan,
    catalog,
    lock: {
      schemaVersion: "capability-runtime-admin-lock/1.0",
      revision: 1,
      previous: FINGERPRINT,
      units: [{
        id: material.unitId,
        version: "1",
        manifestFingerprint: FINGERPRINT,
        desired: "active",
      }],
    },
    authorization: {
      projectId: PROJECT.project.id,
      status: "authorized",
      fingerprint: AUTHORIZATION_FINGERPRINT,
      allowedCapabilities: [{
        id: "mechanics.solve-static-structural",
        version: "1",
        use: "execution",
        qualification: "qualified",
      }],
      allowedUnits: [{
        id: material.unitId,
        version: "1",
        manifestFingerprint: FINGERPRINT,
      }],
      allowedBindings: [{
        capability: {
          id: "mechanics.solve-static-structural",
          version: "1",
          use: "execution",
        },
        binding: { id: "calculix-static-structural", version: "1" },
        adapter: { id: "isolated-calculix", version: "1", source: "server" },
        profile: {
          id: "calculix-static",
          version: "1",
          fingerprint: FINGERPRINT,
        },
        unitIds: [material.unitId],
        materials: [material],
      }],
    },
  };
}
