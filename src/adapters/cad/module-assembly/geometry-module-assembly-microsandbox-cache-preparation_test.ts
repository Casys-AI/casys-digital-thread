import { assertEquals, assertThrows } from "@std/assert";
import type { MicrosandboxImageInspection } from "../../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
} from "../../control-plane/first-party-capability-runtime-identities.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";
import { createLocalGeometryModuleAssemblyServerOptions } from "./first-party-geometry-module-assembly.ts";
import {
  assertAllowedGeometryModuleAssemblyCacheTempPath,
  assertExactCachedGeometryModuleAssemblyRuntimeImage,
  assertExactDockerGeometryModuleAssemblySourceImage,
  assertNoCallerSelectedGeometryModuleAssemblyCacheArguments,
  expectedGeometryModuleAssemblyRuntimeImage,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_DIGEST,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_DIGEST,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS,
  parseDockerGeometryModuleAssemblySourceInspection,
} from "./geometry-module-assembly-microsandbox-cache-preparation.ts";

const WORKER = GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT;
const ENTRYPOINT = Object.freeze([WORKER.executable, ...WORKER.args]);
const EXPECTED = expectedGeometryModuleAssemblyRuntimeImage();

Deno.test("geometry-module cache operator pins the exact worker manifest", () => {
  assertEquals(
    EXPECTED.reference,
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  );
  assertEquals(
    EXPECTED.manifestDigest,
    `sha256:${LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_DIGEST}`,
  );
  assertEquals(EXPECTED.os, "linux");
  assertEquals(EXPECTED.architecture, "arm64");
  assertEquals(EXPECTED.user, "65532:65532");
  assertEquals(EXPECTED.entrypoint, ENTRYPOINT);
  assertEquals(
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
    "casys/build123d-module-assembler-worker@sha256:40accee586603416f573386df29d881ffd682730bb8bd0e2df53ce1454ede5a2",
  );
  assertEquals(
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
    "docker.io/casys/build123d-module-assembler-worker@sha256:5aa833e19f1956a001013661e726c19c4566677a75f58493a6534456b99b6707",
  );
  assertEquals(
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_DIGEST,
    "40accee586603416f573386df29d881ffd682730bb8bd0e2df53ce1454ede5a2",
  );
});

Deno.test("geometry-module profile uses the Microsandbox builder key", async () => {
  const profile = await createLocalGeometryModuleAssemblyServerOptions();
  assertEquals(profile.profile.imageReference, EXPECTED.reference);
  assertEquals(profile.profile.imageReference.startsWith("docker.io/"), true);
});

Deno.test("geometry-module cache operator rejects caller-selected arguments and paths", () => {
  assertNoCallerSelectedGeometryModuleAssemblyCacheArguments([]);
  assertThrows(
    () => assertNoCallerSelectedGeometryModuleAssemblyCacheArguments(["--image=x"]),
    TypeError,
    "no caller-selected image, path, or arguments",
  );
  assertEquals(
    assertAllowedGeometryModuleAssemblyCacheTempPath("/tmp/casys-geometry/a.tar"),
    "/tmp/casys-geometry/a.tar",
  );
  assertThrows(
    () => assertAllowedGeometryModuleAssemblyCacheTempPath("/var/tmp/a.tar"),
    Error,
    "must stay under /tmp",
  );
});

Deno.test("geometry-module Docker source requires exact digest contract and source labels", () => {
  assertExactDockerGeometryModuleAssemblySourceImage(
    parseDockerGeometryModuleAssemblySourceInspection(dockerInspection()),
  );
  assertExactDockerGeometryModuleAssemblySourceImage(
    parseDockerGeometryModuleAssemblySourceInspection({
      ...dockerInspection(),
      RepoDigests: [
        `docker.io/${LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE}`,
      ],
    }),
  );
  assertThrows(
    () =>
      assertExactDockerGeometryModuleAssemblySourceImage(
        parseDockerGeometryModuleAssemblySourceInspection({
          ...dockerInspection(),
          RepoDigests: ["casys/other@sha256:deadbeef"],
        }),
      ),
    Error,
    "reviewed linux/arm64 worker",
  );
  assertThrows(
    () =>
      assertExactDockerGeometryModuleAssemblySourceImage(
        parseDockerGeometryModuleAssemblySourceInspection({
          ...dockerInspection(),
          Config: {
            ...dockerInspection().Config,
            Labels: {
              ...LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS,
              "io.casys.wrapper.sha256": "0".repeat(64),
            },
          },
        }),
      ),
    Error,
    "reviewed linux/arm64 worker",
  );
});

Deno.test("geometry-module cached image must be the exact runtime manifest", () => {
  assertExactCachedGeometryModuleAssemblyRuntimeImage(runtimeInspection());
  assertThrows(
    () =>
      assertExactCachedGeometryModuleAssemblyRuntimeImage({
        ...runtimeInspection(),
        architecture: "amd64",
      }),
    Error,
    "reviewed runtime manifest",
  );
});

function runtimeInspection(): MicrosandboxImageInspection {
  return Object.freeze({
    reference: EXPECTED.reference,
    manifestDigest: EXPECTED.manifestDigest,
    architecture: "arm64",
    os: "linux",
    user: WORKER.expectedImageUser,
    entrypoint: ENTRYPOINT,
    command: null,
    environment: Object.freeze({}),
    labels: Object.freeze({}),
  });
}

function dockerInspection(): {
  readonly Architecture: string;
  readonly Os: string;
  readonly RepoDigests: readonly string[];
  readonly Config: {
    readonly User: string;
    readonly Entrypoint: readonly string[];
    readonly Labels: Readonly<Record<string, string>>;
  };
} {
  return {
    Architecture: "arm64",
    Os: "linux",
    RepoDigests: [LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE],
    Config: {
      User: WORKER.expectedImageUser,
      Entrypoint: ENTRYPOINT,
      Labels: LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS,
    },
  };
}
