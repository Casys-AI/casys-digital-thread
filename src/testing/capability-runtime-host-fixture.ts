/** Synthetic H1 host profile fixture. It has no provider, Chrono or real OCI identity. */

import {
  CAPABILITY_RUNTIME_LAUNCH_PROFILE_SCHEMA_VERSION,
  type CapabilityRuntimeLaunchProfile,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchProfile,
  validateCapabilityRuntimeLaunchProfile,
} from "../domain/capability/runtime/capability-runtime-host.ts";
import { deterministicJson } from "../domain/kernel/deterministic-json.ts";

export const FAKE_CAPABILITY_RUNTIME_MATERIAL = {
  unitId: "test.host-runtime-unit",
  materialId: "test-host-runtime-image",
  imageDigest: "f".repeat(64),
} as const;

export async function fakeCapabilityRuntimeLaunchProfile(
  overrides: Partial<Omit<CapabilityRuntimeLaunchProfile, "fingerprint">> = {},
): Promise<CapabilityRuntimeLaunchProfile> {
  const composeContent = deterministicJson({
    services: {
      "host-runtime": {
        image:
          `example.invalid/capability-host@sha256:${FAKE_CAPABILITY_RUNTIME_MATERIAL.imageDigest}`,
        labels: {
          "com.casys.capability-runtime.owned": "true",
          "com.docker.compose.project": "test_host_runtime",
          "com.docker.compose.service": "host-runtime",
        },
      },
    },
  });
  const body: Omit<CapabilityRuntimeLaunchProfile, "fingerprint"> = {
    schemaVersion: CAPABILITY_RUNTIME_LAUNCH_PROFILE_SCHEMA_VERSION,
    id: "test.host-runtime-profile",
    version: "1.0.0",
    material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
    activationPolicy: "persistent",
    acquisition: {
      kind: "compose",
      projectName: "test_host_runtime",
      serviceName: "host-runtime",
      imageReference:
        `example.invalid/capability-host@sha256:${FAKE_CAPABILITY_RUNTIME_MATERIAL.imageDigest}`,
    },
    compose: {
      schemaVersion: "capability-runtime-compose-descriptor/1.0",
      content: composeContent,
      fingerprint: await fingerprintCapabilityRuntimeComposeContent(composeContent),
    },
    ownership: {
      labels: [
        { key: "com.docker.compose.project", value: "test_host_runtime" },
        { key: "com.docker.compose.service", value: "host-runtime" },
        { key: "com.casys.capability-runtime.owned", value: "true" },
      ],
    },
    retention: { containers: "stop-only", images: "preserve", volumes: "preserve" },
    secretSlots: [],
    security: "reviewed",
    qualification: "qualified",
    ...overrides,
  };
  const fingerprint = await fingerprintCapabilityRuntimeLaunchProfile(body);
  return await validateCapabilityRuntimeLaunchProfile({ ...body, fingerprint });
}
