import { assertEquals, assertFalse, assertRejects } from "@std/assert";
import type {
  CapabilityRuntimeStateObserver,
  ProjectCapabilityRuntimeContext,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  PROJECT_CAPABILITY_WORKBENCH_SCHEMA_VERSION,
  ProjectCapabilityWorkbenchProjector,
} from "./project-capability-workbench.ts";

const DIGEST = "d".repeat(64);
const FINGERPRINT = { algorithm: "sha256" as const, digest: "f".repeat(64) };
const PROJECT = {
  id: "project-revision-7",
  revision: 7,
  project: { id: "capability-workbench-test" },
} as EngineeringProjectSnapshot;

Deno.test("capability workbench projects the exact runtime context without recompiling it", async () => {
  const context = fixtureContext();
  const contexts = new Contexts(context);
  const states = new States();
  const projection = await new ProjectCapabilityWorkbenchProjector({
    contexts,
    states,
  }).read(PROJECT);

  assertEquals(projection.schemaVersion, PROJECT_CAPABILITY_WORKBENCH_SCHEMA_VERSION);
  assertEquals(projection.project, {
    id: "capability-workbench-test",
    snapshotId: "project-revision-7",
    revision: 7,
  });
  assertEquals(contexts.reads, 1);
  assertEquals(states.observed, [{
    unitId: "casys.calculix-worker",
    materialId: "calculix-worker",
    imageDigest: DIGEST,
  }]);
  assertEquals(projection.authorization, {
    status: "authorized",
    fingerprint: FINGERPRINT,
  });
  assertEquals(projection.demand.plannedCeiling.requirements.map((item) => item.key), [
    "mechanics.solve-static-structural\u00001\u0000execution",
  ]);
  assertEquals(projection.demand.jit.requirements.map((item) => item.key), [
    "mechanics.solve-static-structural\u00001\u0000execution",
  ]);
  assertEquals(projection.plan, {
    status: "blocked",
    activation: "blocked",
    blockers: [
      await sha256Fingerprint({
        blocker:
          "docker compose --file /host/private.yml --secret PROD_TOKEN tool --args=hidden",
      }),
    ],
  });
  assertEquals(projection.bindings, [{
    capability: {
      id: "mechanics.solve-static-structural",
      version: "1",
      use: "execution",
      minimumQualification: "qualified",
      key: "mechanics.solve-static-structural\u00001\u0000execution",
      fingerprint: await sha256Fingerprint({
        id: "mechanics.solve-static-structural",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      }),
    },
    status: "selected",
    binding: {
      id: "calculix-static-structural",
      version: "3",
      qualification: "qualified",
    },
    unitIds: ["casys.calculix-worker"],
  }, {
    capability: {
      id: "mechanics.unsupported",
      version: "1",
      use: "execution",
      minimumQualification: "qualified",
      key: "mechanics.unsupported\u00001\u0000execution",
      fingerprint: await sha256Fingerprint({
        id: "mechanics.unsupported",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      }),
    },
    status: "unavailable",
    binding: null,
    unitIds: ["missing-unit"],
  }]);
  assertEquals(projection.units, [{
    id: "casys.calculix-worker",
    version: "3.2.0",
    manifestFingerprint: FINGERPRINT,
  }, {
    id: "missing-unit",
    version: null,
    manifestFingerprint: null,
  }]);
  assertEquals(projection.materials, [{
    unitId: "casys.calculix-worker",
    materialId: "calculix-worker",
    digest: DIGEST,
    mode: "native",
    material: "installed",
    runtime: "active",
    qualification: "qualified",
  }, {
    unitId: "missing-unit",
    materialId: "missing-material",
    digest: null,
    mode: "unavailable",
    material: "unavailable",
    runtime: "unavailable",
    qualification: "unavailable",
  }]);
  assertEquals(projection.footprint, {
    downloadBytes: null,
    storageBytes: 1024,
  });
  assertEquals(projection.effects, {
    serviceCount: 1,
    volumeCount: 2,
    networkModes: ["internal", "loopback-only"],
    bindMountCount: 1,
    deviceCount: 1,
    licences: { reviewed: 1, unknown: 1 },
    security: "unknown",
  });
  const { projectionFingerprint, ...body } = projection;
  assertEquals(projectionFingerprint, await sha256Fingerprint(body));
});

Deno.test("capability workbench redacts transport, host, secret and operational details", async () => {
  const projection = await new ProjectCapabilityWorkbenchProjector({
    contexts: new Contexts(fixtureContext()),
    states: new States(),
  }).read(PROJECT);
  const serialized = JSON.stringify(projection);

  for (
    const forbidden of [
      "registry.private.example/casys/calculix-worker@sha256",
      "imageReference",
      "3014",
      "/host/private.yml",
      "/private/compose/path",
      "docker compose",
      "PROD_TOKEN",
      "server-provider-tool",
      "--args=hidden",
      "private-license-reference",
      "capability-runtime-ledger",
      "capability-runtime-journal",
    ]
  ) {
    assertFalse(
      serialized.includes(forbidden),
      `Unexpected projection leak: ${forbidden}`,
    );
  }
  assertEquals(serialized.includes(DIGEST), true);
});

Deno.test("capability workbench keeps missing authorization and footprint literal", async () => {
  const context = fixtureContext();
  (context as { authorization: undefined }).authorization = undefined;
  (context.plan.effects as { storageBytes: null }).storageBytes = null;
  const projection = await new ProjectCapabilityWorkbenchProjector({
    contexts: new Contexts(context),
    states: new States(),
  }).read(PROJECT);

  assertEquals(projection.authorization, {
    status: "not-authorized",
    fingerprint: null,
  });
  assertEquals(projection.footprint, null);
});

Deno.test("capability workbench refuses a context from another project snapshot", async () => {
  const context = fixtureContext();
  (context.demand.projectSnapshot as { snapshotId: string }).snapshotId =
    "project-revision-other";

  await assertRejects(
    () => projector(context).read(PROJECT),
    TypeError,
    "exact requested project revision",
  );
});

Deno.test("capability workbench refuses a context from another project revision", async () => {
  const context = fixtureContext();
  (context.demand.projectSnapshot as { revision: number }).revision = 8;

  await assertRejects(
    () => projector(context).read(PROJECT),
    TypeError,
    "exact requested project revision",
  );
});

Deno.test("capability workbench refuses a plan with another planned-ceiling demand fingerprint", async () => {
  const context = fixtureContext();
  (context.plan as { demandFingerprint: typeof FINGERPRINT }).demandFingerprint = {
    algorithm: "sha256",
    digest: "a".repeat(64),
  };

  await assertRejects(
    () => projector(context).read(PROJECT),
    TypeError,
    "exact planned-ceiling demand fingerprint",
  );
});

Deno.test("capability workbench does not substitute the JIT demand for its planned-ceiling plan binding", async () => {
  const context = fixtureContext();
  (context.demand as { jitDemandFingerprint: typeof FINGERPRINT })
    .jitDemandFingerprint = {
      algorithm: "sha256",
      digest: "a".repeat(64),
    };

  const projection = await projector(context).read(PROJECT);

  assertEquals(projection.demand.plannedCeiling.fingerprint, FINGERPRINT);
  assertEquals(projection.demand.jit.fingerprint, {
    algorithm: "sha256",
    digest: "a".repeat(64),
  });
});

Deno.test("capability workbench refuses a plan with another registry fingerprint", async () => {
  const context = fixtureContext();
  (context.plan as { registryFingerprint: typeof FINGERPRINT }).registryFingerprint = {
    algorithm: "sha256",
    digest: "b".repeat(64),
  };

  await assertRejects(
    () => projector(context).read(PROJECT),
    TypeError,
    "exact runtime registry fingerprint",
  );
});

Deno.test("capability workbench refuses an authorization from another project", async () => {
  const context = fixtureContext();
  (context.authorization as { projectId: string }).projectId = "another-project";

  await assertRejects(
    () => projector(context).read(PROJECT),
    TypeError,
    "authorization belongs to another project",
  );
});

class Contexts implements ProjectCapabilityRuntimeContextReader {
  reads = 0;

  constructor(private readonly context: ProjectCapabilityRuntimeContext) {}

  read(project: EngineeringProjectSnapshot): Promise<ProjectCapabilityRuntimeContext> {
    assertEquals(project.id, PROJECT.id);
    this.reads += 1;
    return Promise.resolve(structuredClone(this.context));
  }
}

class States implements CapabilityRuntimeStateObserver {
  observed: readonly CapabilityRuntimeMaterialIdentity[] = [];

  observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<
    ReadonlyMap<string, {
      readonly material: "installed";
      readonly runtime: "active";
    }>
  > {
    this.observed = structuredClone(materials);
    return Promise.resolve(
      new Map(materials.map((material) => [
        `${material.unitId}\u0000${material.materialId}`,
        {
          material: "installed" as const,
          runtime: "active" as const,
        },
      ])),
    );
  }
}

function projector(
  context: ProjectCapabilityRuntimeContext,
): ProjectCapabilityWorkbenchProjector {
  return new ProjectCapabilityWorkbenchProjector({
    contexts: new Contexts(context),
    states: new States(),
  });
}

function fixtureContext(): ProjectCapabilityRuntimeContext {
  const requirement = {
    id: "mechanics.solve-static-structural",
    version: "1",
    use: "execution" as const,
    minimumQualification: "qualified" as const,
  };
  const unsupported = {
    id: "mechanics.unsupported",
    version: "1",
    use: "execution" as const,
    minimumQualification: "qualified" as const,
  };
  return {
    demand: {
      schemaVersion: "project-capability-demand/2.0",
      mutatesRuntime: false,
      status: "resolved",
      projectSnapshot: {
        projectId: PROJECT.project.id,
        snapshotId: PROJECT.id,
        revision: PROJECT.revision,
      },
      plannedCeiling: {
        status: "resolved",
        operationGroups: [],
        capabilityRequirements: [requirement],
      },
      jitDemand: {
        status: "resolved",
        operationGroups: [],
        capabilityRequirements: [requirement],
      },
      plannedCeilingFingerprint: FINGERPRINT,
      jitDemandFingerprint: FINGERPRINT,
      registryFingerprint: FINGERPRINT,
    },
    plan: {
      schemaVersion: "project-capability-plan/1.0",
      mutatesRuntime: false,
      demandFingerprint: FINGERPRINT,
      registryFingerprint: FINGERPRINT,
      status: "blocked",
      activation: "blocked",
      blockers: [
        "docker compose --file /host/private.yml --secret PROD_TOKEN tool --args=hidden",
      ],
      bindings: [{
        requirement,
        status: "selected",
        binding: {
          id: "calculix-static-structural",
          version: "3",
          qualification: "qualified",
        },
        unitIds: ["casys.calculix-worker"],
        reasons: ["server-provider-tool requires private arguments"],
        candidate: {
          id: "calculix-static-structural",
          version: "3",
          qualification: "qualified",
          adapter: {
            id: "server-provider-tool",
            version: "3",
            source: "private-compose-profile",
          },
          profile: null,
          unitIds: ["casys.calculix-worker"],
        },
      }, {
        requirement: unsupported,
        status: "unavailable",
        binding: null,
        unitIds: ["missing-unit"],
        reasons: ["provider tool is unavailable"],
      }],
      materials: [{
        unitId: "casys.calculix-worker",
        materialId: "calculix-worker",
        imageReference:
          `registry.private.example/casys/calculix-worker@sha256:${DIGEST}`,
        mode: "native",
        imageState: "present",
        desired: "active",
        downloadBytes: null,
        storageBytes: 1024,
      }, {
        unitId: "missing-unit",
        materialId: "missing-material",
        imageReference:
          "registry.private.example/should-not-be-read@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mode: "unavailable",
        imageState: "absent",
        desired: "absent",
        downloadBytes: null,
        storageBytes: null,
      }],
      effects: {
        downloadBytes: null,
        storageBytes: 1024,
        services: [{ id: "private-service", lifecycle: "ephemeral" }],
        volumes: [
          { id: "private-volume", access: "read-write", preservation: "preserve" },
          { id: "ephemeral-volume", access: "read-only", preservation: "ephemeral" },
        ],
        networks: ["internal", "loopback-only"],
        loopbackPorts: [3014],
        bindMounts: [{ target: "/private/compose/path", access: "read-only" }],
        privileged: false,
        dockerSocket: false,
        devices: ["/dev/private-device"],
        secretSlots: ["PROD_TOKEN"],
        licences: [
          { status: "reviewed", reference: "private-license-reference" },
          { status: "unknown", reference: null },
        ],
        security: "unknown",
      },
    },
    catalog: {
      schemaVersion: "capability-runtime-catalog/1.0",
      productionEligible: false,
      units: [{
        id: "casys.calculix-worker",
        version: "3.2.0",
        manifestFingerprint: FINGERPRINT,
        materials: [{
          id: "calculix-worker",
          kind: "microvm-image",
          imageReference:
            `registry.private.example/casys/calculix-worker@sha256:${DIGEST}`,
          platforms: ["linux/arm64"],
          lifecycle: "ephemeral",
          launchGroup: {
            id: "private-compose-profile",
            version: "1",
            fingerprint: FINGERPRINT,
          },
          effects: {
            downloadBytes: null,
            storageBytes: 1024,
            services: [],
            volumes: [],
            network: "internal",
            loopbackPorts: [3014],
            bindMounts: [],
            privileged: false,
            dockerSocket: false,
            devices: [],
            secretSlots: ["PROD_TOKEN"],
            licence: { status: "reviewed", reference: "private-license-reference" },
            security: "reviewed",
          },
        }],
      }],
      bindings: [{
        id: "calculix-static-structural",
        version: "3",
        qualification: "qualified",
        unitIds: ["casys.calculix-worker"],
        runtimeModes: [{
          material: {
            unitId: "casys.calculix-worker",
            materialId: "calculix-worker",
            imageDigest: DIGEST,
          },
          targetPlatform: "linux/arm64",
          mode: "native",
          qualificationAttestationFingerprint: null,
        }],
      }],
    },
    authorization: {
      projectId: PROJECT.project.id,
      status: "authorized",
      fingerprint: FINGERPRINT,
      allowedCapabilities: [],
      allowedBindings: [{
        capability: {
          id: "mechanics.solve-static-structural",
          version: "1",
          use: "execution",
        },
        binding: { id: "calculix-static-structural", version: "3" },
        adapter: { id: "server-provider-tool", version: "3", source: "private" },
        profile: null,
        unitIds: ["casys.calculix-worker"],
        materials: [{
          unitId: "casys.calculix-worker",
          materialId: "calculix-worker",
          imageDigest: DIGEST,
        }],
      }],
    },
  } as unknown as ProjectCapabilityRuntimeContext;
}
