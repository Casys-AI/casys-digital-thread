import { assertEquals, assertRejects } from "@std/assert";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
  validateCapabilityRuntimeLaunchGroup,
} from "./capability-runtime-launch-group.ts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

Deno.test("launch group seals one ordered multi-service Compose topology", async () => {
  const group = await validGroup();
  const parsed = await validateCapabilityRuntimeLaunchGroup(group);

  assertEquals(parsed.materials.map((material) => material.serviceName), [
    "database",
    "worker",
  ]);
  assertEquals(capabilityRuntimeLaunchGroupReference(parsed), {
    id: "casys.test-stack",
    version: "1.0.0",
    fingerprint: parsed.fingerprint,
  });
});

Deno.test("launch group rejects public port publication before a profile is enrolled", async () => {
  const group = await validGroup();
  const mutated = structuredClone(group) as {
    compose: { content: string };
  };
  const compose = JSON.parse(mutated.compose.content) as {
    services: { database: Record<string, unknown> };
  };
  compose.services.database.ports = ["127.0.0.1:8180:8180"];
  mutated.compose.content = deterministicJson(compose);

  await assertRejects(
    () => validateCapabilityRuntimeLaunchGroup(mutated),
    TypeError,
    "host port publication",
  );
});

Deno.test("launch group rejects unknown fields rather than widening a host contract", async () => {
  const group = await validGroup() as Record<string, unknown>;
  await assertRejects(
    () => validateCapabilityRuntimeLaunchGroup({ ...group, extra: true }),
    TypeError,
    "unsupported field",
  );
});

async function validGroup(): Promise<unknown> {
  const projectName = "casys-test";
  const materials = [
    material("casys.test-stack", "database-image", DIGEST_A, "database", projectName),
    material("casys.test-stack", "worker-image", DIGEST_B, "worker", projectName),
  ];
  const content = deterministicJson({
    services: Object.fromEntries(materials.map((material) => [
      material.serviceName,
      {
        image: material.imageReference,
        labels: Object.fromEntries(
          material.ownership.map((label) => [label.key, label.value]),
        ),
      },
    ])),
  });
  const body = {
    schemaVersion: CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
    id: "casys.test-stack",
    version: "1.0.0",
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName },
    materials,
    compose: {
      schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
      content,
      fingerprint: await fingerprintCapabilityRuntimeComposeContent(content),
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

function material(
  unitId: string,
  materialId: string,
  imageDigest: string,
  serviceName: string,
  projectName: string,
) {
  return {
    material: { unitId, materialId, imageDigest },
    serviceName,
    imageReference: `ghcr.io/casys-ai/${serviceName}@sha256:${imageDigest}`,
    ownership: [
      { key: "com.docker.compose.project", value: projectName },
      { key: "com.docker.compose.service", value: serviceName },
    ],
  };
}
