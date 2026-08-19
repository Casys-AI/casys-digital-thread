import { assertEquals, assertRejects } from "@std/assert";
import { createModelicaIsolatedExecutionComposition } from "./execution-composition.ts";

const DIGEST = "a".repeat(64);

Deno.test("Modelica composition is review-only until runtime is explicitly present", async () => {
  const composition = await createModelicaIsolatedExecutionComposition(
    options(),
    { outputCasDirectory: "state/local/test-modelica-outputs" },
  );
  assertEquals(composition.execution, undefined);
  const profile = await composition.profiles.initial();
  assertEquals(profile.runtimeBackend.imageReference, imageReference());
  assertEquals(profile.runtime.imageDigest.digest, DIGEST);
});

Deno.test("Modelica composition rejects mutable images and runtime knobs", async () => {
  await assertRejects(
    () =>
      createModelicaIsolatedExecutionComposition({
        ...options(),
        profile: {
          ...options().profile,
          imageReference: "ghcr.io/casys/modelica-runtime:latest",
        },
      }, { outputCasDirectory: "state/local/test-modelica-outputs" }),
    TypeError,
    "OCI image",
  );
  await assertRejects(
    () =>
      createModelicaIsolatedExecutionComposition({
        ...options(),
        runtime: { command: ["sh", "-c", "omc"] },
      }, { outputCasDirectory: "state/local/test-modelica-outputs" }),
    TypeError,
    "unsupported field command",
  );
});

function options() {
  return {
    profile: {
      imageReference: imageReference(),
      policy: {
        id: "modelica-local-no-network",
        version: "1.0.0",
        fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
      },
      limits: {
        maxWallTimeMs: 120_000,
        maxCpuTimeMs: 120_000,
        maxMemoryBytes: 3 * 1_024 * 1_024 * 1_024,
        maxProcesses: 64,
        maxStdoutBytes: 1_048_576,
        maxStderrBytes: 1_048_576,
        maxOutputFileBytes: 16 * 1_048_576,
        maxOutputTotalBytes: 17 * 1_048_576,
      },
      engine: {
        name: "OpenModelica" as const,
        version: "1.27.0",
        mslVersion: "4.1.0",
      },
    },
  };
}

function imageReference(): string {
  return `ghcr.io/casys/modelica-runtime@sha256:${DIGEST}`;
}
