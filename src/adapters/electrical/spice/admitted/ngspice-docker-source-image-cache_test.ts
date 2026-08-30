import { assertEquals, assertRejects } from "@std/assert";
import {
  LocalNgspiceDockerSourceImageCache,
} from "./ngspice-docker-source-image-cache.ts";
import {
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
} from "./local-image-references.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const DIGEST = LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE.slice(
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE.lastIndexOf("@sha256:") + 8,
);
const MATERIAL = Object.freeze({
  unitId: "casys.spice-worker",
  materialId: "ngspice-docker-source-image",
  imageDigest: DIGEST,
});

Deno.test("ngspice Docker source cache observes only the exact inspected worker", async () => {
  const inspected: string[] = [];
  const cache = new LocalNgspiceDockerSourceImageCache({
    inspect: (reference) => {
      inspected.push(reference);
      return Promise.resolve(dockerInspection());
    },
  });

  await cache.ensureExactCached({
    material: MATERIAL,
    imageReference: LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
  });
  assertEquals(inspected, [LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE]);
  assertEquals(
    await cache.observe([MATERIAL]),
    new Map([[
      "casys.spice-worker\u0000ngspice-docker-source-image",
      { material: "installed", runtime: "inactive" },
    ]]),
  );
});

Deno.test("ngspice Docker source cache fails closed without an acquisition path", async () => {
  const cache = new LocalNgspiceDockerSourceImageCache({
    inspect: () => Promise.resolve({ ...dockerInspection(), Architecture: "amd64" }),
  });

  await assertRejects(
    () =>
      cache.ensureExactCached({
        material: MATERIAL,
        imageReference: LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
      }),
    Error,
    "unavailable or does not attest",
  );
  assertEquals(
    await cache.observe([MATERIAL]),
    new Map([[
      "casys.spice-worker\u0000ngspice-docker-source-image",
      { material: "absent", runtime: "inactive" },
    ]]),
  );
});

function dockerInspection(): Record<string, unknown> {
  const worker = NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;
  return {
    RepoDigests: [LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE],
    Os: "linux",
    Architecture: "arm64",
    Config: {
      User: worker.expectedImageUser,
      Entrypoint: [worker.executable, ...worker.args],
    },
  };
}
