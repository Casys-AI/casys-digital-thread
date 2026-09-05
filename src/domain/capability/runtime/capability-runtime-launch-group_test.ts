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

Deno.test("launch group seals an ordered multi-service topology with exact retained volume", async () => {
  const parsed = await validateCapabilityRuntimeLaunchGroup(await validGroup());

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

Deno.test("launch group topology rejects a legacy qualification field", async () => {
  const group = structuredClone(await validGroup()) as Record<string, unknown>;
  group.qualification = "qualified";

  await assertRejects(
    () => validateCapabilityRuntimeLaunchGroup(group),
    TypeError,
    "unsupported field qualification",
  );
});

Deno.test("launch group seals a bounded read-only MCP readiness contract to one loopback publication", async () => {
  const parsed = await validateCapabilityRuntimeLaunchGroup(
    await validGroup({ readiness: true }),
  );

  assertEquals(parsed.readiness, {
    kind: "mcp-tools-list",
    timeoutMs: 15_000,
    attemptTimeoutMs: 1_000,
    retryIntervalMs: 250,
  });
});

Deno.test("launch group refuses MCP readiness without one published loopback port", async () => {
  await assertRejects(
    async () =>
      await validateCapabilityRuntimeLaunchGroup(
        await validGroup({ readiness: true, readinessWithoutPort: true }),
      ),
    TypeError,
    "requires exactly one published loopback host port",
  );
});

Deno.test("launch group rejects a non-loopback port before it can publish a service", async () => {
  const group = structuredClone(await validGroup()) as { compose: { content: string } };
  const compose = JSON.parse(group.compose.content) as {
    services: { worker: Record<string, unknown> };
  };
  compose.services.worker.ports = ["0.0.0.0:3000:3000"];
  group.compose.content = deterministicJson(compose);

  await assertRejects(
    () => validateCapabilityRuntimeLaunchGroup(group),
    TypeError,
    "loopback-only",
  );
});

Deno.test("launch group rejects duplicate loopback ports even when neither service mounts a volume", async () => {
  const group = structuredClone(await validGroup({ volume: false })) as {
    compose: { content: string };
  };
  const compose = JSON.parse(group.compose.content) as {
    services: { database: Record<string, unknown>; worker: Record<string, unknown> };
  };
  compose.services.database.ports = ["127.0.0.1:3000:3000"];
  compose.services.worker.ports = ["127.0.0.1:3000:3001"];
  group.compose.content = deterministicJson(compose);

  await assertRejects(
    () => validateCapabilityRuntimeLaunchGroup(group),
    TypeError,
    "ports must be unique",
  );
});

Deno.test("launch group rejects interpolation and undeclared Compose topology", async () => {
  const group = structuredClone(await validGroup()) as { compose: { content: string } };
  const compose = JSON.parse(group.compose.content) as {
    services: { worker: Record<string, unknown> };
  };
  compose.services.worker.environment = { VALUE: "${NOT_ALLOWED}" };
  group.compose.content = deterministicJson(compose);

  await assertRejects(
    () => validateCapabilityRuntimeLaunchGroup(group),
    TypeError,
    "must not interpolate",
  );
});

async function validGroup(
  options: {
    readonly volume?: boolean;
    readonly readiness?: boolean;
    readonly readinessWithoutPort?: boolean;
  } = {},
): Promise<unknown> {
  const projectName = "casys-test";
  const materials = [
    material("casys.test-stack", "database-image", DIGEST_A, "database", projectName),
    material("casys.test-stack", "worker-image", DIGEST_B, "worker", projectName),
  ];
  const content = deterministicJson({
    services: {
      database: {
        image: materials[0]!.imageReference,
        ...(options.volume === false ? {} : { volumes: ["test-data:/var/lib/test"] }),
        healthcheck: health(),
      },
      worker: {
        image: materials[1]!.imageReference,
        depends_on: { database: { condition: "service_healthy" } },
        healthcheck: health(),
        ...(options.readiness && !options.readinessWithoutPort
          ? { ports: ["127.0.0.1:3000:3000"] }
          : {}),
      },
    },
    volumes: options.volume === false ? {} : { "test-data": {} },
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
    ...(options.readiness
      ? {
        readiness: {
          kind: "mcp-tools-list" as const,
          timeoutMs: 15_000,
          attemptTimeoutMs: 1_000,
          retryIntervalMs: 250,
        },
      }
      : {}),
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots: [],
    security: "reviewed" as const,
  };
  return { ...body, fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body) };
}

function health() {
  return {
    test: ["CMD", "health"],
    interval: "1s",
    timeout: "1s",
    retries: 1,
  };
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
