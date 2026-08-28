import { assertEquals, assertRejects } from "@std/assert";
import {
  CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
  validateCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "./capability-runtime-launch-group-registry.ts";

Deno.test("launch-group registry resolves only its exact sealed reference", async () => {
  const group = await sealedGroup();
  const registry = new FixedCapabilityRuntimeLaunchGroupRegistry([group]);
  const reference = capabilityRuntimeLaunchGroupReference(
    await validateCapabilityRuntimeLaunchGroup(group),
  );

  assertEquals((await registry.require(reference)).id, "casys.chrono");
  await assertRejects(
    () => registry.require({ ...reference, version: "9.9.9" }),
    TypeError,
    "0 exact matches",
  );
});

async function sealedGroup(): Promise<unknown> {
  const digest = "c".repeat(64);
  const material = {
    material: {
      unitId: "casys.mcp-chrono",
      materialId: "chrono-image",
      imageDigest: digest,
    },
    serviceName: "chrono",
    imageReference: `ghcr.io/casys-ai/mcp-chrono@sha256:${digest}`,
    ownership: [
      { key: "com.docker.compose.project", value: "casys-chrono" },
      { key: "com.docker.compose.service", value: "chrono" },
    ],
  };
  const content = deterministicJson({
    services: {
      chrono: {
        image: material.imageReference,
        labels: Object.fromEntries(
          material.ownership.map((label) => [label.key, label.value]),
        ),
      },
    },
  });
  const body = {
    schemaVersion: CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
    id: "casys.chrono",
    version: "0.3.1",
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName: "casys-chrono" },
    materials: [material],
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
