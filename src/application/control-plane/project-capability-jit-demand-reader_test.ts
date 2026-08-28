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

function contextWithAuthorization(authorizedBindingId: string) {
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
    authorization: {
      status: "authorized",
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
