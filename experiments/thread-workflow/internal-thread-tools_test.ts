import { assertEquals, assertRejects } from "@std/assert";
import {
  InternalThreadToolClient,
  ThreadNormalizationError,
} from "./internal-thread-tools.ts";

const HASH = "a".repeat(64);

Deno.test("internal normalization keeps units and verifies consumed artifact identity", async () => {
  const result = await new InternalThreadToolClient().callTool({
    name: "thread_observations_normalize",
    arguments: {
      observations: {
        support_mass: { value: 0.42, unit: "kg", produced_by: "cad" },
        support_stress: {
          quantity: { value: 26.6, unit: "MPa", elementId: 81 },
          produced_by: "mechanical",
        },
      },
      artifact_attestations: [{
        producer_sha256: HASH,
        consumer_sha256: HASH,
        relation: "consumed_exact_artifact",
      }],
    },
  });

  assertEquals(result.structuredContent, {
    values: {
      support_mass: { value: 0.42, unit: "kg" },
      support_stress: { value: 26.6, unit: "MPa" },
    },
    provenance: {
      observations: {
        support_mass: { producedBy: "cad" },
        support_stress: { producedBy: "mechanical" },
      },
      artifactAttestations: [{
        relation: "consumed_exact_artifact",
        producerSha256: HASH,
        consumerSha256: HASH,
        status: "verified",
      }],
    },
  });
});

Deno.test("internal normalization rejects a same-path artifact substitution", async () => {
  await assertRejects(
    () =>
      new InternalThreadToolClient().callTool({
        name: "thread_observations_normalize",
        arguments: {
          observations: {},
          artifact_attestations: [{
            producer_sha256: "a".repeat(64),
            consumer_sha256: "b".repeat(64),
            relation: "consumed_exact_artifact",
          }],
        },
      }),
    ThreadNormalizationError,
    "does not match consumed",
  );
});

Deno.test("internal client exposes no arbitrary local tool execution", async () => {
  await assertRejects(
    () => new InternalThreadToolClient().callTool({ name: "shell_execute" }),
    ThreadNormalizationError,
    "Unknown internal tool",
  );
});
