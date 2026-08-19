import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { createCalculixIsolatedExecutionComposition } from "./calculix-isolated-execution-composition.ts";

const DIGEST = "a".repeat(64);
const PROFILE = Object.freeze({
  imageReference: `casys/calculix-microsandbox-worker@sha256:${DIGEST}`,
  wrapperSha256: "b".repeat(64),
  policy: Object.freeze<IsolatedCodePolicyRef>({
    id: "calculix-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
  }),
  limits: Object.freeze<IsolatedCodeExecutionLimits>({
    maxWallTimeMs: 180_000,
    maxCpuTimeMs: 160_000,
    maxMemoryBytes: 3 * 1_073_741_824,
    maxProcesses: 64,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    maxOutputFileBytes: 128 * 1_048_576,
    maxOutputTotalBytes: 256 * 1_048_576,
  }),
});
const PATHS = Object.freeze({
  outputCasDirectory: "/tmp/casys-calculix-composition-test/cas",
  attemptDirectory: "/tmp/casys-calculix-composition-test/attempts",
  evidenceDirectory: "/tmp/casys-calculix-composition-test/evidence",
  leaseDirectory: "/tmp/casys-calculix-composition-test/leases",
});

Deno.test("CalculiX profile-only composition exposes facts without a runtime", async () => {
  const composition = await createCalculixIsolatedExecutionComposition(
    { profile: PROFILE },
    PATHS,
  );
  assertEquals(composition.execution, undefined);
  const profile = await composition.profiles.initial();
  assertEquals(profile.imageReference, PROFILE.imageReference);
  assertEquals(profile.wrapper.sha256, PROFILE.wrapperSha256);
  assertEquals(profile.runtime.requestedLimits, PROFILE.limits);
});

Deno.test("CalculiX runtime composition wires runner, recovery, CAS and use case", async () => {
  const composition = await createCalculixIsolatedExecutionComposition(
    { profile: PROFILE, runtime: {} },
    PATHS,
  );
  assertEquals(typeof composition.execution?.runner.run, "function");
  assertEquals(typeof composition.execution?.recovery.destroyByRunId, "function");
  assertEquals(
    typeof composition.execution?.publications.resolvePublicationByRunId,
    "function",
  );
  assertEquals(typeof composition.execution?.execute.execute, "function");
  assertStrictEquals(composition.execution?.runner, composition.execution?.recovery);
});

Deno.test("CalculiX composition rejects mutable images and runtime knobs", async () => {
  await assertRejects(
    () =>
      createCalculixIsolatedExecutionComposition({
        profile: { ...PROFILE, imageReference: "casys/calculix:latest" },
      }, PATHS),
    TypeError,
    "digest",
  );
  await assertRejects(
    () =>
      createCalculixIsolatedExecutionComposition({
        profile: PROFILE,
        runtime: { command: ["sh", "-c", "ccx"] },
      }, PATHS),
    TypeError,
    "unsupported field command",
  );
  await assertRejects(
    () =>
      createCalculixIsolatedExecutionComposition(
        { profile: PROFILE },
        { ...PATHS, workDirectory: "/host" },
      ),
    TypeError,
    "unsupported field workDirectory",
  );
});
