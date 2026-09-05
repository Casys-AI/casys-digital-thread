import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { createGeometryModuleAssemblyComposition } from "./geometry-module-assembly-composition.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const DIGEST = "a".repeat(64);
const PROFILE = Object.freeze({
  imageReference: `casys/build123d-module-assembler-worker@sha256:${DIGEST}`,
  wrapperSha256: "b".repeat(64),
  policy: Object.freeze<IsolatedCodePolicyRef>({
    id: "geometry-module-assembler-deny-all-v1",
    version: "1.0.0",
    fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
  }),
  limits: Object.freeze<IsolatedCodeExecutionLimits>({
    maxWallTimeMs: 120_000,
    maxCpuTimeMs: 90_000,
    maxMemoryBytes: 2 * 1_073_741_824,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 64 * 1_048_576,
    maxOutputTotalBytes: 128 * 1_048_576,
  }),
});
const PATHS = Object.freeze({
  outputCasDirectory: "/tmp/casys-module-assembly-composition-test/cas",
});

Deno.test("module-assembly profile-only composition exposes facts without a runtime", async () => {
  const composition = await createGeometryModuleAssemblyComposition(
    { profile: PROFILE },
    PATHS,
  );
  assertEquals(composition.execution, undefined);
  const profile = await composition.profiles.initial();
  assertEquals(profile.imageReference, `docker.io/${PROFILE.imageReference}`);
  assertEquals(profile.wrapper.sha256, PROFILE.wrapperSha256);
  assertEquals(profile.runtime.requestedLimits, PROFILE.limits);
});

Deno.test("module-assembly runtime composition wires runner, recovery and atomic CAS without dispatch", async () => {
  const composition = await createGeometryModuleAssemblyComposition(
    { profile: PROFILE, runtime: {} },
    PATHS,
  );
  assertEquals(typeof composition.execution?.runner.run, "function");
  assertEquals(typeof composition.execution?.recovery.destroyByRunId, "function");
  assertEquals(
    typeof composition.execution?.publications.resolvePublicationByRunId,
    "function",
  );
  assertStrictEquals(composition.execution?.runner, composition.execution?.recovery);
});

Deno.test("module-assembly composition rejects mutable images, runtime knobs and the untrusted worker paths", async () => {
  await assertRejects(
    () =>
      createGeometryModuleAssemblyComposition({
        profile: {
          ...PROFILE,
          imageReference: "casys/build123d-module-assembler:latest",
        },
      }, PATHS),
    TypeError,
    "digest",
  );
  await assertRejects(
    () =>
      createGeometryModuleAssemblyComposition({
        profile: PROFILE,
        runtime: { command: ["python3", "-c", "print(1)"] },
      }, PATHS),
    TypeError,
    "unsupported field command",
  );
  await assertRejects(
    () =>
      createGeometryModuleAssemblyComposition(
        { profile: PROFILE },
        { ...PATHS, sourcePath: "/input/source.py" },
      ),
    TypeError,
    "unsupported field sourcePath",
  );
  assertEquals(
    GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.sourcePath,
    "/input/geometry-module.bundle",
  );
  assertEquals(
    GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.executable,
    "/usr/local/bin/python3",
  );
});
