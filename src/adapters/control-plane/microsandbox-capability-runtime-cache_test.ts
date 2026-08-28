import { assertRejects } from "@std/assert";
import { LocalMicrosandboxCapabilityRuntimeCache } from "./microsandbox-capability-runtime-cache.ts";

const DIGEST = "a".repeat(64);
const REFERENCE = `example.test/worker@sha256:${DIGEST}`;

Deno.test("Microsandbox capability cache observes an exact pinned image without pull or start", async () => {
  const cache = new LocalMicrosandboxCapabilityRuntimeCache(
    () => Promise.resolve(sdk(inspection())),
    [expectation()],
  );
  await cache.ensureExactCached({
    material: { unitId: "casys.worker", materialId: "worker", imageDigest: DIGEST },
    imageReference: REFERENCE,
  });
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
      }),
    Error,
    "sealed image contract",
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
      configurationProvenance: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    },
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
