import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  exactMicrosandboxMaterialArchitecture,
  LocalMicrosandboxCapabilityRuntimeCache,
} from "./microsandbox-capability-runtime-cache.ts";

const DIGEST = "a".repeat(64);
const REFERENCE = `example.test/worker@sha256:${DIGEST}`;
const PROFILE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "c".repeat(64),
};
const SECOND_PROFILE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "e".repeat(64),
};

Deno.test("Microsandbox cache architecture is translated from its exact code-owned material platform", () => {
  assertEquals(exactMicrosandboxMaterialArchitecture(["linux/arm64"]), "arm64");
  assertEquals(exactMicrosandboxMaterialArchitecture(["linux/amd64"]), "amd64");
  assertThrows(
    () =>
      exactMicrosandboxMaterialArchitecture([
        "linux/arm64",
        "linux/amd64",
      ]),
    TypeError,
    "exactly one code-owned platform",
  );
});

Deno.test("Microsandbox capability cache observes an exact pinned image without pull or start", async () => {
  const cache = new LocalMicrosandboxCapabilityRuntimeCache(
    () => Promise.resolve(sdk(inspection())),
    [expectation()],
  );
  await cache.ensureExactCached({
    material: { unitId: "casys.worker", materialId: "worker", imageDigest: DIGEST },
    imageReference: REFERENCE,
    executionProfileFingerprint: PROFILE_FINGERPRINT,
  });
  assertEquals(
    await cache.observe([{
      unitId: "casys.worker",
      materialId: "worker",
      imageDigest: DIGEST,
    }]),
    new Map([[
      "casys.worker\u0000worker",
      { material: "installed", runtime: "inactive" },
    ]]),
  );
});

Deno.test("Microsandbox capability cache fails closed on a mismatched inspected digest", async () => {
  const cache = new LocalMicrosandboxCapabilityRuntimeCache(
    () => Promise.resolve(sdk(inspection(`sha256:${"b".repeat(64)}`))),
    [expectation()],
  );
  await assertRejects(
    () =>
      cache.ensureExactCached({
        material: { unitId: "casys.worker", materialId: "worker", imageDigest: DIGEST },
        imageReference: REFERENCE,
        executionProfileFingerprint: PROFILE_FINGERPRINT,
      }),
    Error,
    "does not attest",
  );
});

Deno.test("Microsandbox capability cache refuses an image whose guest configuration drifted before a claim", async () => {
  const cache = new LocalMicrosandboxCapabilityRuntimeCache(
    () => Promise.resolve(sdk({ ...inspection(), user: "0:0" })),
    [expectation()],
  );
  await assertRejects(
    () =>
      cache.ensureExactCached({
        material: { unitId: "casys.worker", materialId: "worker", imageDigest: DIGEST },
        imageReference: REFERENCE,
        executionProfileFingerprint: PROFILE_FINGERPRINT,
      }),
    Error,
    "sealed image contract",
  );
});

Deno.test("Microsandbox capability cache refuses an execution-profile drift before a claim", async () => {
  const cache = new LocalMicrosandboxCapabilityRuntimeCache(
    () => Promise.resolve(sdk(inspection())),
    [expectation()],
  );
  await assertRejects(
    () =>
      cache.ensureExactCached({
        material: { unitId: "casys.worker", materialId: "worker", imageDigest: DIGEST },
        imageReference: REFERENCE,
        executionProfileFingerprint: {
          algorithm: "sha256",
          digest: "d".repeat(64),
        },
      }),
    Error,
    "execution profile does not attest",
  );
});

Deno.test("Microsandbox cache does not treat an unconfigured execution profile as executable", async () => {
  const cache = new LocalMicrosandboxCapabilityRuntimeCache(
    () => Promise.resolve(sdk(inspection())),
    [{ ...expectation(), allowedExecutionProfileFingerprints: [] }],
  );
  await assertRejects(
    () =>
      cache.ensureExactCached({
        material: { unitId: "casys.worker", materialId: "worker", imageDigest: DIGEST },
        imageReference: REFERENCE,
        executionProfileFingerprint: PROFILE_FINGERPRINT,
      }),
    Error,
    "execution profile does not attest",
  );
});

Deno.test("Microsandbox cache requires the current operation fingerprint to be in the closed allowed list", async () => {
  const cache = new LocalMicrosandboxCapabilityRuntimeCache(
    () => Promise.resolve(sdk(inspection())),
    [{
      ...expectation(),
      allowedExecutionProfileFingerprints: [
        PROFILE_FINGERPRINT,
        SECOND_PROFILE_FINGERPRINT,
      ],
    }],
  );
  await cache.ensureExactCached({
    material: { unitId: "casys.worker", materialId: "worker", imageDigest: DIGEST },
    imageReference: REFERENCE,
    executionProfileFingerprint: SECOND_PROFILE_FINGERPRINT,
  });
  await assertRejects(
    () =>
      cache.ensureExactCached({
        material: { unitId: "casys.worker", materialId: "worker", imageDigest: DIGEST },
        imageReference: REFERENCE,
        executionProfileFingerprint: {
          algorithm: "sha256",
          digest: "d".repeat(64),
        },
      }),
    Error,
    "execution profile does not attest",
  );
});

Deno.test("Microsandbox cache refuses duplicate allowed execution-profile fingerprints", () => {
  assertThrows(
    () =>
      new LocalMicrosandboxCapabilityRuntimeCache(
        () => Promise.resolve(sdk(inspection())),
        [{
          ...expectation(),
          allowedExecutionProfileFingerprints: [
            PROFILE_FINGERPRINT,
            PROFILE_FINGERPRINT,
          ],
        }],
      ),
    TypeError,
    "duplicate execution-profile fingerprint",
  );
});

function expectation() {
  return {
    material: { unitId: "casys.worker", materialId: "worker" },
    image: {
      reference: REFERENCE,
      manifestDigest: `sha256:${DIGEST}`,
      os: "linux" as const,
      architecture: "arm64",
      user: "65532:65532",
      entrypoint: ["/usr/local/bin/deno", "run"],
    },
    allowedExecutionProfileFingerprints: [PROFILE_FINGERPRINT],
  };
}

function inspection(manifestDigest = `sha256:${DIGEST}`) {
  return {
    reference: REFERENCE,
    manifestDigest,
    os: "linux",
    architecture: "arm64",
    user: "65532:65532",
    entrypoint: ["/usr/local/bin/deno", "run"],
    command: null,
    environment: {},
    labels: {},
  };
}

function sdk(value: ReturnType<typeof inspection>) {
  return {
    assertLocalBackend: () => undefined,
    inspectImage: () => Promise.resolve(value),
  } as never;
}
