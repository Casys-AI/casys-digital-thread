import { assertEquals, assertRejects } from "@std/assert";
import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { MICROSANDBOX_LOCAL_RUNTIME_REF } from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  SPICE_ADMITTED_OUTPUT_MANIFEST,
  SPICE_ADMITTED_REQUESTED_LIMITS,
} from "../../../../domain/electrical/spice/admitted/contract.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "./local-image-references.ts";
import {
  admittedSpiceIsolatedWorkerInvocation,
  createAdmittedSpiceExecutionComposition,
} from "./execution-composition.ts";

const PROFILE = Object.freeze({
  imageReference: LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
  policy: Object.freeze<IsolatedCodePolicyRef>({
    id: "spice-admitted-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
  }),
  limits: Object.freeze<IsolatedCodeExecutionLimits>(
    SPICE_ADMITTED_REQUESTED_LIMITS,
  ),
});

const PATHS = Object.freeze({
  outputCasDirectory: "/tmp/casys-spice-composition-test",
});

Deno.test("admitted SPICE worker invocation has zero extra args and fixed mounts", () => {
  const invocation = admittedSpiceIsolatedWorkerInvocation();
  assertEquals(invocation.extraWorkerArguments, []);
  assertEquals(invocation.args, NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.args);
  assertEquals(
    invocation.args[invocation.args.length - 1],
    "/opt/casys/src/adapters/electrical/spice/admitted/run.ts",
  );
  assertEquals(invocation.sourcePath, "/input/source.cir");
  assertEquals(invocation.outputDirectory, "/out");
  assertEquals(
    invocation.expectedImageEntrypoint,
    [
      NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.executable,
      ...NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.args,
    ],
  );
  assertEquals(invocation.requestedLimits, SPICE_ADMITTED_REQUESTED_LIMITS);
  assertEquals(
    NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.rootDiskMiB <=
      SPICE_ADMITTED_REQUESTED_LIMITS.maxMemoryBytes / (1024 * 1024),
    true,
  );
});

Deno.test("admitted SPICE profile-only composition exposes review facts and no runner", async () => {
  const composition = await createAdmittedSpiceExecutionComposition(
    { profile: PROFILE },
    PATHS,
  );

  assertEquals(composition.execution, undefined);
  const profile = await composition.profiles.initial();
  assertEquals(profile.isolationPolicy, PROFILE.policy);
  assertEquals(
    profile.runtime.imageDigest.digest,
    "54079cf7c0e1fcdf9dc30941cc97a752460d787d8d27dd9617d4cfe462e59720",
  );
  assertEquals(profile.runtimeBackend, {
    ...MICROSANDBOX_LOCAL_RUNTIME_REF,
    imageReference: `docker.io/${PROFILE.imageReference}`,
    imageDigest: profile.runtime.imageDigest,
  });
  assertEquals(profile.runtime.requestedLimits, PROFILE.limits);
  assertEquals(profile.outputManifest, [...SPICE_ADMITTED_OUTPUT_MANIFEST]);
  assertEquals(profile.compilationTarget, "spice-circuit-source");
});

Deno.test("admitted SPICE composition rejects caller capability fields", async () => {
  await assertRejects(
    () =>
      createAdmittedSpiceExecutionComposition(
        {
          profile: PROFILE,
          image: "caller-selected",
        },
        PATHS,
      ),
    TypeError,
  );
});
