import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { createBuild123dExecutionComposition } from "./build123d-execution-composition.ts";
import { BUILD123D_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const PROFILE = Object.freeze({
  imageReference:
    "casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8",
  policy: Object.freeze<IsolatedCodePolicyRef>({
    id: "build123d-deny-all-v1",
    version: "1.0.0",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
  }),
  limits: Object.freeze<IsolatedCodeExecutionLimits>({
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 20_000,
    maxMemoryBytes: 1_024 * 1_048_576,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 32 * 1_048_576,
    maxOutputTotalBytes: 32 * 1_048_576,
  }),
});

const PATHS = Object.freeze({
  outputCasDirectory: "/tmp/casys-build123d-composition-test",
});

Deno.test("Build123d composition reuses the code-owned Microsandbox worker contract", async () => {
  const source = await Deno.readTextFile(
    new URL("./build123d-execution-composition.ts", import.meta.url),
  );
  assertEquals(source.includes("BUILD123D_MICROSANDBOX_WORKER_CONTRACT"), true);
  assertEquals(source.includes("/usr/local/bin/python3"), false);
  assertEquals(
    BUILD123D_MICROSANDBOX_WORKER_CONTRACT.executable,
    "/usr/local/bin/python3",
  );
});

Deno.test("Build123d profile-only composition exposes provider-free review facts and no runner", async () => {
  const composition = await createBuild123dExecutionComposition(
    { profile: PROFILE },
    PATHS,
  );

  assertEquals(composition.execution, undefined);
  const profile = await composition.profiles.initial();
  assertEquals(profile.isolationPolicy, PROFILE.policy);
  assertEquals(
    profile.runtime.imageDigest.digest,
    "0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8",
  );
  assertEquals(profile.runtimeBackend, {
    ...MICROSANDBOX_LOCAL_RUNTIME_REF,
    imageReference: `docker.io/${PROFILE.imageReference}`,
    imageDigest: profile.runtime.imageDigest,
  });
  assertEquals(profile.runtime.requestedLimits, PROFILE.limits);
});

Deno.test("Build123d runtime composition wires one runner, recovery and publication seam without dispatch", async () => {
  const composition = await createBuild123dExecutionComposition(
    {
      profile: PROFILE,
      runtime: {},
    },
    PATHS,
  );

  assertEquals(typeof composition.execution?.runner.run, "function");
  assertEquals(
    typeof composition.execution?.recovery.destroyByRunId,
    "function",
  );
  assertEquals(
    typeof composition.execution?.publications.resolvePublicationByRunId,
    "function",
  );
  assertStrictEquals(
    composition.execution?.runner,
    composition.execution?.recovery,
  );
});

Deno.test("Build123d composition rejects incomplete or capability-bearing configuration", async () => {
  const cases: readonly [unknown, string][] = [
    [{}, "$build123dExecution.profile is required"],
    [{ profile: PROFILE, provider: "legacy-mcp" }, "unsupported field provider"],
    [{ profile: { ...PROFILE, command: "python" } }, "unsupported field command"],
    [{
      profile: PROFILE,
      runtime: {
        controlPlane: {},
      },
    }, "unsupported field controlPlane"],
    [{
      profile: PROFILE,
      runtime: {
        rootSnapshotId: "legacy-root",
      },
    }, "unsupported field rootSnapshotId"],
    [{ profile: PROFILE, runtime: { network: "bridge" } }, "unsupported field network"],
    [
      { profile: PROFILE, runtime: { credentials: { token: "secret" } } },
      "unsupported field credentials",
    ],
    [{ profile: PROFILE, runtime: { sdk: {} } }, "unsupported field sdk"],
    [{
      profile: { ...PROFILE, rootSnapshotSha256: "a".repeat(64) },
    }, "unsupported field rootSnapshotSha256"],
    [{
      profile: {
        ...PROFILE,
        imageReference: "ghcr.io/casys-ai/build123d-runtime:latest",
      },
    }, "digest"],
    [{
      profile: {
        ...PROFILE,
        limits: {
          ...PROFILE.limits,
          maxMemoryBytes: PROFILE.limits.maxMemoryBytes + 1,
        },
      },
    }, "whole MiB"],
  ];

  for (const [value, message] of cases) {
    let thrown: unknown;
    try {
      await createBuild123dExecutionComposition(value, PATHS);
    } catch (error) {
      thrown = error;
    }
    assertEquals(thrown instanceof TypeError, true);
    assertEquals((thrown as Error).message.includes(message), true);
  }

  await assertRejects(
    () =>
      createBuild123dExecutionComposition(
        { profile: PROFILE },
        { ...PATHS, repository: "/repo" },
      ),
    TypeError,
    "unsupported field repository",
  );
});
