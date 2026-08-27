import { assertEquals, assertRejects } from "@std/assert";
import {
  FixedModelicaIsolatedExecutionProfileCatalog,
  MODELICA_ISOLATED_OUTPUT_VALIDATOR,
  MODELICA_QUALIFIED_KIT_WRAPPER_SHA256,
  validateModelicaIsolatedExecutionProfile,
} from "./execution-profile.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { MODELICA_ISOLATED_EXECUTION_PROFILE } from "../../../domain/modelica/qualified-kit/isolated-execution.ts";

const DIGEST = "a".repeat(64);

Deno.test("fixed Modelica profile binds the local Microsandbox OCI identity without self-asserted qualification", async () => {
  const catalog = new FixedModelicaIsolatedExecutionProfileCatalog(options());
  const profile = await catalog.initial();

  assertEquals(await catalog.resolve(MODELICA_ISOLATED_EXECUTION_PROFILE), profile);
  assertEquals(profile.runtimeBackend, {
    ...MICROSANDBOX_LOCAL_RUNTIME_REF,
    imageReference: `ghcr.io/casys/modelica-runtime@sha256:${DIGEST}`,
    imageDigest: { algorithm: "sha256", digest: DIGEST },
  });
  assertEquals(profile.runtime.isolationClass, MICROSANDBOX_LOCAL_ISOLATION_CLASS);
  assertEquals(profile.wrapper.invocation, "direct-executable-no-shell");
  assertEquals(profile.wrapper.sha256, MODELICA_QUALIFIED_KIT_WRAPPER_SHA256);
  assertEquals(profile.outputValidator, MODELICA_ISOLATED_OUTPUT_VALIDATOR);
  assertEquals("qualification" in profile, false);
});

Deno.test("fixed Modelica profile rejects mutable images and replay drift", async () => {
  assertRejects(
    async () => {
      const catalog = new FixedModelicaIsolatedExecutionProfileCatalog({
        ...options(),
        imageReference: "ghcr.io/casys/modelica-runtime:latest",
      });
      await catalog.initial();
    },
    TypeError,
    "OCI image",
  );
  const profile = await new FixedModelicaIsolatedExecutionProfileCatalog(options())
    .initial();
  const drift = structuredClone(profile) as unknown as {
    method: { engine: { version: string } };
    [key: string]: unknown;
  };
  drift.method.engine.version = "1.24";
  await assertRejects(
    () => validateModelicaIsolatedExecutionProfile(drift),
    TypeError,
    "stale",
  );
});

Deno.test("fixed Modelica profile rejects caller-fabricated live-smoke hashes", async () => {
  const profile = await new FixedModelicaIsolatedExecutionProfileCatalog(options())
    .initial();
  await assertRejects(
    () =>
      validateModelicaIsolatedExecutionProfile({
        ...profile,
        qualification: {
          status: "qualified-live-smoke",
          evidence: {
            imageDigest: profile.runtime.imageDigest,
            wrapperSha256: profile.wrapper.sha256,
            inputBundleSha256: "d".repeat(64),
            resultSha256: "e".repeat(64),
            evidenceSha256: "f".repeat(64),
          },
        },
      }),
    TypeError,
    "unsupported field qualification",
  );
});

function options() {
  return {
    imageReference: `ghcr.io/casys/modelica-runtime@sha256:${DIGEST}`,
    policy: {
      id: "modelica-local-no-network",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    },
    limits: {
      maxWallTimeMs: 120_000,
      maxCpuTimeMs: 120_000,
      maxMemoryBytes: 2 * 1024 * 1024 * 1024,
      maxProcesses: 32,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
      maxOutputFileBytes: 16 * 1_048_576,
      maxOutputTotalBytes: 17 * 1_048_576,
    },
    engine: { name: "OpenModelica" as const, version: "1.23", mslVersion: "4.0" },
  };
}
