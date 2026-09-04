import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import type { MicrosandboxImageInspection } from "../../../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";
import {
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
} from "./local-image-references.ts";
import {
  assertAllowedNgspiceCacheTempPath,
  assertExactCachedNgspiceRuntimeImage,
  assertExactDockerNgspiceSourceImage,
  assertNoCallerSelectedNgspiceCacheArguments,
  expectedNgspiceRuntimeImage,
  isCachedMicrosandboxImageAbsent,
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_DIGEST,
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_DIGEST,
  parseDockerNgspiceSourceInspection,
} from "./microsandbox-cache-preparation.ts";

const WORKER = NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;
const ENTRYPOINT = Object.freeze([
  WORKER.executable,
  ...WORKER.args,
]);
const HOST_ARCH = "arm64";
const EXPECTED = expectedNgspiceRuntimeImage(HOST_ARCH);

Deno.test("ngspice Docker source digest and Microsandbox runtime digest stay distinct", () => {
  assertEquals(
    LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
    "casys/ngspice-microsandbox-worker@sha256:62748f195c86751c5fc565ea8e0ac5ab6bd283ddcae2426918d697b25ce6d392",
  );
  assertEquals(
    LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
    "casys/ngspice-microsandbox-worker@sha256:3350527ceba0dbe8f2e31e435e834f962978e800134b83d6ee8f4875b7ffb79a",
  );
  assertEquals(
    LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_DIGEST,
    "62748f195c86751c5fc565ea8e0ac5ab6bd283ddcae2426918d697b25ce6d392",
  );
  assertEquals(
    LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_DIGEST,
    "3350527ceba0dbe8f2e31e435e834f962978e800134b83d6ee8f4875b7ffb79a",
  );
  assertNotEquals(
    LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
    LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
  );
  assertEquals(EXPECTED.os, "linux");
  assertEquals(EXPECTED.architecture, HOST_ARCH);
  assertEquals(EXPECTED.user, "65532:65532");
  assertEquals(EXPECTED.entrypoint, ENTRYPOINT);
  assertEquals(
    EXPECTED.manifestDigest,
    `sha256:${LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_DIGEST}`,
  );
});

Deno.test("ngspice cache operator refuses caller-selected image path or arguments", () => {
  assertNoCallerSelectedNgspiceCacheArguments([]);
  assertThrows(
    () => assertNoCallerSelectedNgspiceCacheArguments(["--image=caller"]),
    TypeError,
    "no caller-selected image, path, or arguments",
  );
  assertThrows(
    () => assertNoCallerSelectedNgspiceCacheArguments(["--run"]),
    TypeError,
    "no caller-selected image, path, or arguments",
  );
});

Deno.test("ngspice cache temp paths stay under allowed temp", () => {
  assertEquals(
    assertAllowedNgspiceCacheTempPath("/tmp/casys-ngspice-microsandbox-cache-a"),
    "/tmp/casys-ngspice-microsandbox-cache-a",
  );
  assertEquals(
    assertAllowedNgspiceCacheTempPath(
      "/private/tmp/casys-ngspice-microsandbox-cache-b/ngspice-worker.tar",
    ),
    "/private/tmp/casys-ngspice-microsandbox-cache-b/ngspice-worker.tar",
  );
  assertThrows(
    () => assertAllowedNgspiceCacheTempPath("/var/tmp/caller-selected"),
    Error,
    "must stay under /tmp",
  );
});

Deno.test("docker inspect parser accepts the exact source digest and linux/arm64 worker", () => {
  const parsed = parseDockerNgspiceSourceInspection(dockerInspectJson());
  assertExactDockerNgspiceSourceImage(parsed);
  assertEquals(parsed.architecture, "arm64");
  assertEquals(parsed.os, "linux");
  assertExactDockerNgspiceSourceImage(
    parseDockerNgspiceSourceInspection({
      ...dockerInspectJson(),
      RepoDigests: [
        `docker.io/${LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE}`,
      ],
    }),
  );
});

Deno.test("docker inspect parser rejects a missing source digest or drifted worker", () => {
  assertThrows(
    () =>
      assertExactDockerNgspiceSourceImage(
        parseDockerNgspiceSourceInspection({
          ...dockerInspectJson(),
          RepoDigests: [
            LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
          ],
        }),
      ),
    Error,
    "reviewed linux/arm64 worker",
  );
  assertThrows(
    () =>
      assertExactDockerNgspiceSourceImage(
        parseDockerNgspiceSourceInspection({
          ...dockerInspectJson(),
          Architecture: "amd64",
        }),
      ),
    Error,
    "reviewed linux/arm64 worker",
  );
  assertThrows(
    () =>
      assertExactDockerNgspiceSourceImage(
        parseDockerNgspiceSourceInspection({
          ...dockerInspectJson(),
          Config: { ...dockerInspectJson().Config, User: "0:0" },
        }),
      ),
    Error,
    "reviewed linux/arm64 worker",
  );
  assertThrows(
    () => parseDockerNgspiceSourceInspection({ Architecture: "arm64" }),
    TypeError,
  );
});

Deno.test("cached runtime assertion requires the exact Microsandbox manifest", () => {
  const exact = runtimeInspection();
  assertExactCachedNgspiceRuntimeImage(exact, EXPECTED);
  assertThrows(
    () =>
      assertExactCachedNgspiceRuntimeImage({
        ...exact,
        manifestDigest: `sha256:${LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_DIGEST}`,
      }, EXPECTED),
    Error,
    "reviewed runtime manifest",
  );
  assertThrows(
    () =>
      assertExactCachedNgspiceRuntimeImage({
        ...exact,
        architecture: "amd64",
      }, EXPECTED),
    Error,
    "reviewed runtime manifest",
  );
});

Deno.test("absent Microsandbox image lookup is classified without swallowing other errors", () => {
  assertEquals(
    isCachedMicrosandboxImageAbsent(
      Object.assign(new Error("missing"), {
        code: "imageNotFound",
        name: "ImageNotFoundError",
      }),
    ),
    true,
  );
  assertEquals(
    isCachedMicrosandboxImageAbsent(
      new Error("The cached local OCI image does not match the reviewed image."),
    ),
    false,
  );
});

Deno.test("expected host architecture is taken from the shared helper seam", () => {
  const amd64 = expectedNgspiceRuntimeImage("amd64");
  assertEquals(amd64.architecture, "amd64");
  assertEquals(amd64.reference, LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE);
  assertThrows(
    () => assertExactCachedNgspiceRuntimeImage(runtimeInspection(), amd64),
    Error,
    "reviewed runtime manifest",
  );
});

function runtimeInspection(): MicrosandboxImageInspection {
  return Object.freeze({
    reference: LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
    manifestDigest: `sha256:${LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_DIGEST}`,
    architecture: HOST_ARCH,
    os: "linux",
    user: WORKER.expectedImageUser,
    entrypoint: ENTRYPOINT,
    command: null,
    environment: Object.freeze({}),
    labels: Object.freeze({}),
  });
}

function dockerInspectJson(): {
  readonly Architecture: string;
  readonly Os: string;
  readonly RepoDigests: readonly string[];
  readonly Config: { readonly User: string; readonly Entrypoint: readonly string[] };
} {
  return {
    Architecture: "arm64",
    Os: "linux",
    RepoDigests: [LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE],
    Config: {
      User: WORKER.expectedImageUser,
      Entrypoint: ENTRYPOINT,
    },
  };
}
