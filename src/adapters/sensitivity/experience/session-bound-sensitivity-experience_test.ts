import { assertEquals } from "@std/assert";
import type { CapabilityRuntimeLaunchGroup } from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { CapabilityRuntimeLease } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { capabilityRuntimeMaterialKey } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeObservedState } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { solverRuntimeIdentityFromImageReference } from "../../../domain/sensitivity/experience/sensitivity-experience.ts";
import { FileSensitivityExperienceRepository } from "./file-sensitivity-experience-repository.ts";
import { FileSensitivityExperienceReuseAttemptStore } from "./file-sensitivity-experience-reuse-attempt-store.ts";
import {
  createSensitivityExperienceSessionFactory,
  SENSITIVITY_EXPERIENCE_CALCULIX_GROUP_ID,
  SENSITIVITY_EXPERIENCE_CALCULIX_SERVICE_NAME,
  SessionBoundSensitivitySolverRuntimeAuthority,
} from "./session-bound-sensitivity-experience.ts";

const AT = "2026-08-23T00:00:00.000Z";
const DIGEST = "c".repeat(64);
const IMAGE = `ghcr.io/casys-ai/mcp-calculix@sha256:${DIGEST}`;
const GROUP_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "2".repeat(64),
};
const MATERIAL: CapabilityRuntimeMaterialIdentity = {
  unitId: "casys.mcp-calculix",
  materialId: "mcp-calculix-image",
  imageDigest: DIGEST,
};

Deno.test("session factory derives the pinned group-member identity and attests a healthy observation", async () => {
  const harness = await createFactoryHarness();
  try {
    const bound = await harness.factory.forActiveCapabilitySession(harness.session);
    assertEquals(bound !== undefined, true);
    assertEquals(
      bound!.solverRuntime,
      solverRuntimeIdentityFromImageReference(IMAGE),
    );
  } finally {
    await harness.dispose();
  }
});

Deno.test("session factory refuses uncovered lease, group mismatch, digest mismatch, and ambiguity", async () => {
  const harness = await createFactoryHarness();
  try {
    const uncoveredLease = await harness.factory.forActiveCapabilitySession({
      ...harness.session,
      lease: {
        ...harness.session.lease,
        launchGroups: [],
      },
    });
    assertEquals(uncoveredLease, undefined);

    const wrongGroup = await harness.factory.forActiveCapabilitySession({
      ...harness.session,
      launchGroup: {
        ...harness.session.launchGroup,
        fingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
      },
    });
    assertEquals(wrongGroup, undefined);

    const digestMismatch = await harness.factory.forActiveCapabilitySession({
      ...harness.session,
      material: { ...MATERIAL, imageDigest: "d".repeat(64) },
    });
    assertEquals(digestMismatch, undefined);

    const duplicate = harness.group.materials[0]!;
    (harness.group as { materials: typeof harness.group.materials }).materials = [
      duplicate,
      duplicate,
    ];
    const ambiguous = await harness.factory.forActiveCapabilitySession(harness.session);
    assertEquals(ambiguous, undefined);
  } finally {
    await harness.dispose();
  }
});

Deno.test("session factory cannot bind or attest from unavailable or unhealthy observation", async () => {
  const harness = await createFactoryHarness({
    observation: { material: "installed", runtime: "degraded" },
  });
  try {
    assertEquals(
      await harness.factory.forActiveCapabilitySession(harness.session),
      undefined,
    );
  } finally {
    await harness.dispose();
  }

  const missing = await createFactoryHarness({ observation: "missing" });
  try {
    assertEquals(
      await missing.factory.forActiveCapabilitySession(missing.session),
      undefined,
    );
  } finally {
    await missing.dispose();
  }
});

Deno.test("fresh admission and recross attest the same session identity", async () => {
  const harness = await createFactoryHarness();
  try {
    const expected = solverRuntimeIdentityFromImageReference(IMAGE);
    const authority = new SessionBoundSensitivitySolverRuntimeAuthority({
      expected,
      session: harness.session,
      groups: harness.groups,
      observer: harness.observer,
    });
    assertEquals(await authority.attest(expected), true);
    assertEquals(
      await authority.attest(
        solverRuntimeIdentityFromImageReference(
          `ghcr.io/casys-ai/mcp-calculix@sha256:${"e".repeat(64)}`,
        ),
      ),
      false,
    );
  } finally {
    await harness.dispose();
  }
});

async function createFactoryHarness(
  options: {
    readonly observation?: CapabilityRuntimeObservedState | "missing";
  } = {},
) {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "sensitivity-session-factory-" }),
  );
  const group = fakeCalculixGroup();
  const launchGroup = capabilityRuntimeLaunchGroupReference(group);
  const groups = {
    require: (reference: typeof launchGroup) => {
      if (
        reference.id !== launchGroup.id ||
        reference.version !== launchGroup.version ||
        reference.fingerprint.digest !== launchGroup.fingerprint.digest
      ) {
        return Promise.reject(new Error("launch group is not registered"));
      }
      return Promise.resolve(group);
    },
    list: () => Promise.resolve([group]),
  };
  const observer = {
    observe: (materials: readonly CapabilityRuntimeMaterialIdentity[]) => {
      const observed = new Map<string, CapabilityRuntimeObservedState>();
      if (options.observation !== "missing") {
        for (const material of materials) {
          if (
            material.unitId === MATERIAL.unitId &&
            material.materialId === MATERIAL.materialId &&
            material.imageDigest === MATERIAL.imageDigest
          ) {
            observed.set(
              capabilityRuntimeMaterialKey(material),
              options.observation ?? { material: "installed", runtime: "active" },
            );
          }
        }
      }
      return Promise.resolve(observed);
    },
  };
  const repository = new FileSensitivityExperienceRepository(root);
  const factory = createSensitivityExperienceSessionFactory({
    repository,
    projects: { get: () => Promise.resolve(undefined) },
    snapshots: { get: () => Promise.resolve(undefined) },
    caseCaptures: { read: () => Promise.resolve(undefined) },
    studyCaptures: { read: () => Promise.resolve(undefined) },
    admissions: { read: () => Promise.resolve(undefined) },
    executionAttempts: { read: () => Promise.resolve(undefined) },
    groups,
    observer,
    reuseAttempts: new FileSensitivityExperienceReuseAttemptStore(
      `${root}/reuse-attempts`,
    ),
  });
  const lease: CapabilityRuntimeLease = {
    id: "lease-calculix",
    projectId: "project-a",
    bindingIds: ["calculix-static-sensitivity"],
    materialKeys: [capabilityRuntimeMaterialKey(MATERIAL)],
    launchGroups: [launchGroup],
    acquiredAt: AT,
    expiresAt: "2026-08-23T06:00:00.000Z",
  };
  return {
    root,
    group,
    groups,
    observer,
    factory,
    session: { lease, launchGroup, material: MATERIAL },
    dispose: () => Deno.remove(root, { recursive: true }),
  };
}

function fakeCalculixGroup(): CapabilityRuntimeLaunchGroup {
  return {
    schemaVersion: "capability-runtime-launch-group/2.0",
    id: SENSITIVITY_EXPERIENCE_CALCULIX_GROUP_ID,
    version: "1.0.0",
    fingerprint: GROUP_FINGERPRINT,
    activationPolicy: "persistent",
    acquisition: { kind: "compose", projectName: "casys-mcp-calculix-v1" },
    materials: [{
      material: MATERIAL,
      serviceName: SENSITIVITY_EXPERIENCE_CALCULIX_SERVICE_NAME,
      imageReference: IMAGE,
      ownership: [
        { key: "com.docker.compose.project", value: "casys-mcp-calculix-v1" },
        { key: "com.docker.compose.service", value: "mcp-calculix" },
      ],
    }],
    compose: {
      schemaVersion: "capability-runtime-compose-descriptor/1.0",
      content: "{}",
      fingerprint: GROUP_FINGERPRINT,
    },
    retention: {
      containers: "stop-only",
      images: "preserve",
      volumes: "preserve",
    },
    secretSlots: [],
    security: "reviewed",
  };
}
