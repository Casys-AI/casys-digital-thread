import { assertEquals, assertRejects } from "@std/assert";
import { ProjectCapabilityJitDemandReader } from "./project-capability-jit-demand-reader.ts";

const PROJECT = { id: "project:jit:r9", project: { id: "project:jit" } } as never;
const REQUIREMENT = {
  id: "mechanics.observe-prescribed-kinematics",
  version: "1",
  use: "execution" as const,
  minimumQualification: "qualified" as const,
};
const OLD = {
  unitId: "casys.legacy-kinematics",
  materialId: "worker-image",
  imageDigest: "a".repeat(64),
};
const SUCCESSOR = {
  unitId: "casys.successor-kinematics",
  materialId: "worker-image",
  imageDigest: "b".repeat(64),
};

Deno.test("terminal group release follows the exact selected authorized successor, not an older catalogue binding", async () => {
  const reader = readerForContext(contextWithAuthorization("successor-kinematics"));

  assertEquals(
    await reader.hasRemainingDemand({
      projectId: "project:jit",
      materialKeys: [key(OLD)],
    }),
    false,
  );
  assertEquals(
    await reader.hasRemainingDemand({
      projectId: "project:jit",
      materialKeys: [key(SUCCESSOR)],
    }),
    true,
  );
});

Deno.test("terminal group release proceeds when the exact current authorization is revoked", async () => {
  const reader = readerForContext(
    contextWithAuthorization("successor-kinematics", "revoked"),
  );

  assertEquals(
    await reader.hasRemainingDemand({
      projectId: "project:jit",
      materialKeys: [key(SUCCESSOR)],
    }),
    false,
  );
});

Deno.test("terminal group release sees no remaining JIT demand after the local unit lock is inactive", async () => {
  const context = contextWithAuthorization("successor-kinematics") as {
    lock: { units: Array<{ desired: "active" | "inactive" }> };
  };
  context.lock.units.forEach((unit) => unit.desired = "inactive");
  const reader = readerForContext(context);
  assertEquals(
    await reader.hasRemainingDemand({
      projectId: "project:jit",
      materialKeys: [key(SUCCESSOR)],
    }),
    false,
  );
});

Deno.test("shared launch-group cleanup sees a ready demand from another project", async () => {
  const alpha = { id: "snapshot:alpha", project: { id: "project:alpha" } } as never;
  const bravo = { id: "snapshot:bravo", project: { id: "project:bravo" } } as never;
  const alphaContext = contextWithAuthorization("successor-kinematics") as {
    demand: { jitDemand: { capabilityRequirements: unknown[] } };
  };
  alphaContext.demand.jitDemand.capabilityRequirements = [];
  const reader = new ProjectCapabilityJitDemandReader({
    projects: {
      get: (projectId) =>
        Promise.resolve(
          projectId === "project:alpha"
            ? alpha
            : projectId === "project:bravo"
            ? bravo
            : undefined,
        ),
    },
    contexts: {
      read: (project) =>
        Promise.resolve(
          project.project.id === "project:alpha"
            ? alphaContext as never
            : contextWithAuthorization("successor-kinematics") as never,
        ),
    },
    ledgers: {
      list: () =>
        Promise.resolve([
          { projectId: "project:alpha" },
          { projectId: "project:bravo" },
        ] as never),
      listPending: () => Promise.resolve([]),
    },
  });

  assertEquals(
    await reader.hasAnyRemainingDemand({ materialKeys: [key(SUCCESSOR)] }),
    true,
  );
});

Deno.test("shared launch-group cleanup fails closed when its project census cannot be read", async () => {
  const reader = new ProjectCapabilityJitDemandReader({
    projects: { get: () => Promise.reject(new Error("not reached")) },
    contexts: { read: () => Promise.reject(new Error("not reached")) },
    ledgers: {
      list: () => Promise.resolve([]),
      listPending: () => Promise.reject(new Error("unreadable")),
    },
  });
  await assertRejects(
    () => reader.hasAnyRemainingDemand({ materialKeys: [key(SUCCESSOR)] }),
    Error,
    "global JIT demand census cannot be read",
  );
});

Deno.test("terminal group release fails closed when selected and authorized bindings differ", async () => {
  const reader = readerForContext(contextWithAuthorization("legacy-kinematics"));
  await assertRejects(
    () =>
      reader.hasRemainingDemand({ projectId: "project:jit", materialKeys: [key(OLD)] }),
    Error,
    "does not match one exact authorized binding",
  );
});

Deno.test("terminal group release fails closed when the exact current JIT demand cannot be read", async () => {
  const reader = new ProjectCapabilityJitDemandReader({
    projects: { get: () => Promise.resolve(undefined) },
    contexts: { read: () => Promise.reject(new Error("must not read")) },
  });
  await assertRejects(
    () => reader.hasRemainingDemand({ projectId: "project:missing", materialKeys: [] }),
    Error,
    "cannot read project",
  );
});

function readerForContext(context: unknown): ProjectCapabilityJitDemandReader {
  return new ProjectCapabilityJitDemandReader({
    projects: { get: () => Promise.resolve(PROJECT) },
    contexts: { read: () => Promise.resolve(context as never) },
  });
}

function contextWithAuthorization(
  authorizedBindingId: string,
  authorizationStatus: "authorized" | "revoked" = "authorized",
) {
  const bindings = [
    catalogueBinding("legacy-kinematics", OLD),
    catalogueBinding("successor-kinematics", SUCCESSOR),
  ];
  return {
    catalog: {
      units: [unit(OLD), unit(SUCCESSOR)],
      bindings,
    },
    demand: {
      jitDemand: { status: "resolved", capabilityRequirements: [REQUIREMENT] },
    },
    plan: {
      bindings: [{
        requirement: REQUIREMENT,
        status: "selected",
        binding: {
          id: "successor-kinematics",
          version: "1",
          qualification: "qualified",
        },
        unitIds: [SUCCESSOR.unitId],
      }],
    },
    lock: {
      schemaVersion: "capability-runtime-admin-lock/1.0",
      revision: 1,
      previous: { algorithm: "sha256", digest: "a".repeat(64) },
      units: [OLD, SUCCESSOR].map((material) => ({
        id: material.unitId,
        version: "1",
        manifestFingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
        desired: "active" as const,
      })),
    },
    authorization: {
      status: authorizationStatus,
      allowedUnits: [OLD, SUCCESSOR].map((material) => ({
        id: material.unitId,
        version: "1",
        manifestFingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
      })),
      allowedBindings: [{
        capability: {
          id: REQUIREMENT.id,
          version: REQUIREMENT.version,
          use: REQUIREMENT.use,
        },
        binding: { id: authorizedBindingId, version: "1" },
        adapter: { id: "test", version: "1", source: "test" },
        profile: null,
        unitIds: [
          authorizedBindingId === "successor-kinematics"
            ? SUCCESSOR.unitId
            : OLD.unitId,
        ],
        materials: [
          authorizedBindingId === "successor-kinematics" ? SUCCESSOR : OLD,
        ],
      }],
    },
  } as never;
}

function catalogueBinding(
  id: string,
  material: typeof OLD,
) {
  return {
    id,
    version: "1",
    capability: { id: REQUIREMENT.id, version: REQUIREMENT.version },
    use: REQUIREMENT.use,
    unitIds: [material.unitId],
  };
}

function unit(material: typeof OLD) {
  return {
    id: material.unitId,
    materials: [{
      id: material.materialId,
      imageReference: `example.test/${material.unitId}@sha256:${material.imageDigest}`,
    }],
  };
}

function key(material: typeof OLD): string {
  return `${material.unitId}\u0000${material.materialId}`;
}
