import { assertEquals, assertRejects } from "@std/assert";
import type { IsolatedCodeExecutionLimits } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  CALCULIX_ISOLATED_EXECUTION_PROFILE,
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
} from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  CALCULIX_MAXIMUM_ISOLATED_BUNDLE_BYTES,
  CalculixIsolatedExecutionProfileNotRegisteredError,
  FixedCalculixIsolatedExecutionProfileCatalog,
  validateCalculixIsolatedExecutionProfile,
} from "./fixed-calculix-isolated-execution-profile.ts";

const DIGEST = "a".repeat(64);
const LIMITS: IsolatedCodeExecutionLimits = {
  maxWallTimeMs: 180_000,
  maxCpuTimeMs: 160_000,
  maxMemoryBytes: 2 * 1_073_741_824,
  maxProcesses: 16,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 128 * 1_048_576,
  maxOutputTotalBytes: 256 * 1_048_576,
};

Deno.test("fixed CalculiX profile binds Microsandbox, digest-pinned OCI and exact outputs", async () => {
  const catalog = new FixedCalculixIsolatedExecutionProfileCatalog(options());
  const profile = await catalog.initial();

  assertEquals(profile.executionProfile, CALCULIX_ISOLATED_EXECUTION_PROFILE);
  assertEquals(
    profile.imageReference,
    `ghcr.io/casys-ai/calculix-static@sha256:${DIGEST}`,
  );
  assertEquals(profile.runtime.isolationClass, "microsandbox-local-microvm-v1");
  assertEquals(profile.runtime.imageDigest.digest, DIGEST);
  assertEquals(profile.runtimeBackend, {
    id: "microsandbox-local",
    version: "0.6.8",
    lifecycle: "attached",
    network: "none",
    imageReference: `ghcr.io/casys-ai/calculix-static@sha256:${DIGEST}`,
    imageDigest: { algorithm: "sha256", digest: DIGEST },
  });
  assertEquals(profile.runtime.limitAssurance.maxCpuTimeMs, "unattested");
  assertEquals(profile.runtime.limitAssurance.maxProcesses, "unattested");
  assertEquals(profile.outputManifest, CALCULIX_ISOLATED_OUTPUT_MANIFEST);
  assertEquals(profile.maximumBundleBytes, CALCULIX_MAXIMUM_ISOLATED_BUNDLE_BYTES);
  assertEquals(profile.minimumDestructionAssurance, "proven");
  assertEquals(await validateCalculixIsolatedExecutionProfile(profile), profile);
  assertEquals(await catalog.resolve(CALCULIX_ISOLATED_EXECUTION_PROFILE), profile);
});

Deno.test("fixed CalculiX profile rejects floating images and unknown profile refs", async () => {
  await assertRejects(
    async () => {
      const catalog = new FixedCalculixIsolatedExecutionProfileCatalog({
        ...options(),
        imageReference: "ghcr.io/casys-ai/calculix-static:latest",
      });
      await catalog.initial();
    },
    TypeError,
    "pinned by a lowercase sha256 digest",
  );
  const catalog = new FixedCalculixIsolatedExecutionProfileCatalog(options());
  const profile = await catalog.initial();
  await assertRejects(
    () =>
      validateCalculixIsolatedExecutionProfile({
        ...profile,
        runtime: {
          ...profile.runtime,
          limitAssurance: {
            ...profile.runtime.limitAssurance,
            maxCpuTimeMs: "backend-attested",
          },
        },
      }),
    TypeError,
    "differs from the local Microsandbox contract",
  );
  await assertRejects(
    () => catalog.resolve({ id: "calculix-static-proof-v2", version: "2.0.0" }),
    CalculixIsolatedExecutionProfileNotRegisteredError,
  );
});

function options() {
  return {
    imageReference: `ghcr.io/casys-ai/calculix-static@sha256:${DIGEST}`,
    wrapperSha256: "b".repeat(64),
    policy: {
      id: "calculix-microsandbox-no-network",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    },
    limits: LIMITS,
  };
}
