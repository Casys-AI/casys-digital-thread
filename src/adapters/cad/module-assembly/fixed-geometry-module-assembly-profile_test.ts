import { assertEquals, assertRejects } from "@std/assert";
import type { IsolatedCodeExecutionLimits } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "./fixed-geometry-module-assembly-execution.ts";
import { GEOMETRY_MODULE_MAXIMUM_BUNDLE_BYTES } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import {
  FixedGeometryModuleAssemblyProfileCatalog,
  GeometryModuleAssemblyProfileNotRegisteredError,
  validateGeometryModuleAssemblyExecutionProfile,
} from "./fixed-geometry-module-assembly-profile.ts";

const DIGEST = "a".repeat(64);
const LIMITS: IsolatedCodeExecutionLimits = {
  maxWallTimeMs: 120_000,
  maxCpuTimeMs: 90_000,
  maxMemoryBytes: 2 * 1_073_741_824,
  maxProcesses: 32,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 65_536,
  maxOutputFileBytes: 64 * 1_048_576,
  maxOutputTotalBytes: 128 * 1_048_576,
};

Deno.test("fixed module-assembly profile binds Microsandbox, digest-pinned OCI and exact outputs", async () => {
  const catalog = new FixedGeometryModuleAssemblyProfileCatalog(options());
  const profile = await catalog.initial();

  assertEquals(profile.executionProfile, GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE);
  assertEquals(
    profile.imageReference,
    `docker.io/casys/build123d-module-assembler-worker@sha256:${DIGEST}`,
  );
  assertEquals(profile.runtime.isolationClass, "microsandbox-local-microvm-v1");
  assertEquals(profile.runtime.imageDigest.digest, DIGEST);
  assertEquals(profile.outputManifest, GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST);
  assertEquals(profile.maximumBundleBytes, GEOMETRY_MODULE_MAXIMUM_BUNDLE_BYTES);
  assertEquals(profile.minimumDestructionAssurance, "proven");
  assertEquals(profile.lowering.source, "reviewed-child-step-and-placement-bundle");
  assertEquals(await validateGeometryModuleAssemblyExecutionProfile(profile), profile);
  assertEquals(
    await catalog.resolve(GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE),
    profile,
  );
});

Deno.test("fixed module-assembly profile rejects floating images and the untrusted Build123d profile", async () => {
  await assertRejects(
    async () => {
      const catalog = new FixedGeometryModuleAssemblyProfileCatalog({
        ...options(),
        imageReference: "casys/build123d-module-assembler-worker:latest",
      });
      await catalog.initial();
    },
    TypeError,
    "digest",
  );
  const catalog = new FixedGeometryModuleAssemblyProfileCatalog(options());
  await assertRejects(
    () => catalog.resolve({ id: "build123d-closed-subset-v1", version: "1.0.0" }),
    GeometryModuleAssemblyProfileNotRegisteredError,
  );
});

function options() {
  return {
    imageReference: `casys/build123d-module-assembler-worker@sha256:${DIGEST}`,
    wrapperSha256: "c".repeat(64),
    policy: {
      id: "geometry-module-assembler-deny-all-v1",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    },
    limits: LIMITS,
  };
}
