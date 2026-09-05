import { assertEquals, assertThrows } from "@std/assert";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  pinnedOciImageReference,
  validateMicrosandboxLocalRuntimeIdentity,
} from "./local-isolation-runtime.ts";

const DIGEST = "a".repeat(64);
const IMAGE = `ghcr.io/casys-ai/build123d-runtime@sha256:${DIGEST}`;
const LIMITS = Object.freeze({
  maxWallTimeMs: 30_000,
  maxCpuTimeMs: 20_000,
  maxMemoryBytes: 768 * 1_048_576,
  maxProcesses: 32,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 65_536,
  maxOutputFileBytes: 32 * 1_048_576,
  maxOutputTotalBytes: 32 * 1_048_576,
});

Deno.test("Microsandbox local runtime identity accepts one exact digest-pinned OCI image", () => {
  assertEquals(
    validateMicrosandboxLocalRuntimeIdentity({
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: IMAGE,
      imageDigest: { algorithm: "sha256", digest: DIGEST },
    }),
    {
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: IMAGE,
      imageDigest: { algorithm: "sha256", digest: DIGEST },
    },
  );
  assertEquals(
    pinnedOciImageReference(
      `localhost:5000/casys/build123d@sha256:${DIGEST}`,
      "$image",
    ),
    `localhost:5000/casys/build123d@sha256:${DIGEST}`,
  );
  assertEquals(
    pinnedOciImageReference(
      `registry:5000/casys/build123d@sha256:${DIGEST}`,
      "$image",
    ),
    `registry:5000/casys/build123d@sha256:${DIGEST}`,
  );
});

Deno.test("pinned OCI image reference canonicalizes omitted Docker Hub registries", () => {
  assertEquals(
    pinnedOciImageReference(`casys/modelica-worker@sha256:${DIGEST}`, "$image"),
    `docker.io/casys/modelica-worker@sha256:${DIGEST}`,
  );
  assertEquals(
    pinnedOciImageReference(`postgres@sha256:${DIGEST}`, "$image"),
    `docker.io/library/postgres@sha256:${DIGEST}`,
  );
  assertEquals(
    pinnedOciImageReference(
      `docker.io/casys/modelica-worker@sha256:${DIGEST}`,
      "$image",
    ),
    `docker.io/casys/modelica-worker@sha256:${DIGEST}`,
  );
  assertEquals(
    pinnedOciImageReference(
      `docker.io/library/postgres@sha256:${DIGEST}`,
      "$image",
    ),
    `docker.io/library/postgres@sha256:${DIGEST}`,
  );
  assertEquals(
    pinnedOciImageReference(
      `docker.io/postgres@sha256:${DIGEST}`,
      "$image",
    ),
    `docker.io/postgres@sha256:${DIGEST}`,
  );
  assertEquals(
    pinnedOciImageReference(IMAGE, "$image"),
    IMAGE,
  );
});

Deno.test("Microsandbox runtime attestation derives image identity and exact assurance matrix", () => {
  assertEquals(
    createMicrosandboxRuntimeAttestation({
      imageReference: IMAGE,
      limits: LIMITS,
    }),
    {
      isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
      imageDigest: { algorithm: "sha256", digest: DIGEST },
      requestedLimits: LIMITS,
      limitAssurance: {
        maxWallTimeMs: "backend-attested",
        maxCpuTimeMs: "unattested",
        maxMemoryBytes: "backend-attested",
        maxProcesses: "unattested",
        maxStdoutBytes: "broker-observed-cap",
        maxStderrBytes: "broker-observed-cap",
        maxOutputFileBytes: "broker-observed-cap",
        maxOutputTotalBytes: "broker-observed-cap",
      },
    },
  );
  assertThrows(
    () =>
      createMicrosandboxRuntimeAttestation({
        imageReference: IMAGE,
        limits: { ...LIMITS, maxWallTimeMs: 30_001 },
      }),
    TypeError,
    "whole second",
  );
  assertThrows(
    () =>
      createMicrosandboxRuntimeAttestation({
        imageReference: IMAGE,
        limits: { ...LIMITS, maxMemoryBytes: LIMITS.maxMemoryBytes + 1 },
      }),
    TypeError,
    "whole MiB",
  );
});

Deno.test("Microsandbox local runtime identity rejects paths schemes tags mutable and divergent digests", () => {
  const invalid = [
    `../build123d@sha256:${DIGEST}`,
    `./build123d@sha256:${DIGEST}`,
    `/build123d@sha256:${DIGEST}`,
    `file:///tmp/build123d@sha256:${DIGEST}`,
    `https://ghcr.io/casys/build123d@sha256:${DIGEST}`,
    `ghcr.io\\casys\\build123d@sha256:${DIGEST}`,
    `ghcr.io/Casys/build123d@sha256:${DIGEST}`,
    `ghcr.io/casys/build123d:latest@sha256:${DIGEST}`,
    `ghcr.io/casys/build123d@sha256:${"A".repeat(64)}`,
    `ghcr.io:70000/casys/build123d@sha256:${DIGEST}`,
    `ghcr..io/casys/build123d@sha256:${DIGEST}`,
    `-ghcr.io/casys/build123d@sha256:${DIGEST}`,
    `ghcr-.io/casys/build123d@sha256:${DIGEST}`,
    "ghcr.io/casys/build123d:latest",
  ];
  for (const value of invalid) {
    assertThrows(
      () => pinnedOciImageReference(value, "$image"),
      TypeError,
      "digest",
    );
  }

  assertThrows(
    () =>
      validateMicrosandboxLocalRuntimeIdentity({
        ...MICROSANDBOX_LOCAL_RUNTIME_REF,
        imageReference: IMAGE,
        imageDigest: { algorithm: "sha256", digest: "b".repeat(64) },
      }),
    TypeError,
    "must equal",
  );
  assertThrows(
    () =>
      validateMicrosandboxLocalRuntimeIdentity({
        ...MICROSANDBOX_LOCAL_RUNTIME_REF,
        network: "bridge",
        imageReference: IMAGE,
        imageDigest: { algorithm: "sha256", digest: DIGEST },
      }),
    TypeError,
    "network",
  );
});
