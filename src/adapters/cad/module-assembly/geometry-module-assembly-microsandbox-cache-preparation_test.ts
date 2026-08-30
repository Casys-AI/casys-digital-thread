import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { MicrosandboxImageInspection } from "../../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE } from "../../control-plane/first-party-capability-runtime-identities.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";
import {
  assertAllowedGeometryModuleAssemblyCacheTempPath,
  assertExactCachedGeometryModuleAssemblyRuntimeImage,
  assertExactDockerGeometryModuleAssemblySourceImage,
  assertNoCallerSelectedGeometryModuleAssemblyCacheArguments,
  expectedGeometryModuleAssemblyRuntimeImage,
  type GeometryModuleAssemblyMicrosandboxCachePorts,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_DIGEST,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS,
  parseDockerGeometryModuleAssemblySourceInspection,
  prepareGeometryModuleAssemblyMicrosandboxCache,
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

Deno.test("geometry-module cache preparation uses an existing exact cache without Docker", async () => {
  const ports = fakePorts({ cached: runtimeInspection() });
  const result = await prepareGeometryModuleAssemblyMicrosandboxCache(ports);
  assertEquals(result.status, "already-cached");
  assertEquals(result.pullPolicy, "never");
  assertEquals(ports.dockerInspects, 0);
  assertEquals(ports.saves, []);
  assertEquals(ports.loads, []);
  assertEquals(ports.cleaned, 0);
});

Deno.test("geometry-module cache preparation imports the exact Docker worker tag", async () => {
  const ports = fakePorts({ cached: undefined });
  const result = await prepareGeometryModuleAssemblyMicrosandboxCache(ports);
  assertEquals(result.status, "imported");
  assertEquals(ports.dockerInspects, 1);
  assertEquals(ports.saves, [
    "/tmp/casys-geometry-module-assembler-test/geometry-module-assembler-worker.tar",
  ]);
  assertEquals(ports.loads, [{
    archivePath:
      "/tmp/casys-geometry-module-assembler-test/geometry-module-assembler-worker.tar",
    tag: LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  }]);
  assertEquals(ports.cleaned, 1);
});

Deno.test("geometry-module cache preparation fails closed and cleans temporary archive", async () => {
  const mismatch = fakePorts({
    cached: undefined,
    docker: { ...dockerInspection(), Architecture: "amd64" },
  });
  await assertRejects(
    () => prepareGeometryModuleAssemblyMicrosandboxCache(mismatch),
    Error,
    "reviewed linux/arm64 worker",
  );
  assertEquals(mismatch.saves, []);
  assertEquals(mismatch.cleaned, 0);

  const saveFailure = fakePorts({
    cached: undefined,
    saveError: new Error("save failed"),
  });
  await assertRejects(
    () => prepareGeometryModuleAssemblyMicrosandboxCache(saveFailure),
    Error,
    "save failed",
  );
  assertEquals(saveFailure.cleaned, 1);
});

Deno.test("geometry-module cache preparation does not emulate the arm64-only worker", async () => {
  const ports = fakePorts({ cached: undefined, hostArchitecture: "amd64" });
  await assertRejects(
    () => prepareGeometryModuleAssemblyMicrosandboxCache(ports),
    Error,
    "native linux/arm64 host",
  );
  assertEquals(ports.dockerInspects, 0);
});

interface FakePorts extends GeometryModuleAssemblyMicrosandboxCachePorts {
  readonly inspectReferences: string[];
  dockerInspects: number;
  readonly saves: string[];
  readonly loads: Array<{ archivePath: string; tag: string }>;
  cleaned: number;
}

function fakePorts(options: {
  readonly cached: MicrosandboxImageInspection | undefined;
  readonly imported?: MicrosandboxImageInspection;
  readonly docker?: unknown;
  readonly saveError?: Error;
  readonly hostArchitecture?: string;
}): FakePorts {
  const cache = new Map<string, MicrosandboxImageInspection>();
  if (options.cached !== undefined) cache.set(EXPECTED.reference, options.cached);
  const ports: FakePorts = {
    expectedHostArchitecture: options.hostArchitecture ?? "arm64",
    inspectReferences: [],
    dockerInspects: 0,
    saves: [],
    loads: [],
    cleaned: 0,
    inspectCachedImage(reference) {
      ports.inspectReferences.push(reference);
      const hit = cache.get(reference);
      return hit === undefined
        ? Promise.reject(Object.assign(new Error("image not found"), {
          code: "imageNotFound",
          name: "ImageNotFoundError",
        }))
        : Promise.resolve(hit);
    },
    loadImageFromArchive(archivePath, tag) {
      ports.loads.push({ archivePath, tag });
      cache.set(tag, options.imported ?? runtimeInspection());
      return Promise.resolve();
    },
    inspectDockerSource() {
      ports.dockerInspects += 1;
      return Promise.resolve(options.docker ?? dockerInspection());
    },
    saveDockerSource(path) {
      if (options.saveError) return Promise.reject(options.saveError);
      ports.saves.push(path);
      return Promise.resolve();
    },
    createTemporaryArchiveDirectory() {
      const directory = "/tmp/casys-geometry-module-assembler-test";
      return Promise.resolve({
        directory,
        archivePath: `${directory}/geometry-module-assembler-worker.tar`,
        cleanup: () => {
          ports.cleaned += 1;
          return Promise.resolve();
        },
      });
    },
  };
  return ports;
}

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
    RepoDigests: [LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE],
    Config: {
      User: WORKER.expectedImageUser,
      Entrypoint: ENTRYPOINT,
      Labels: LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS,
    },
  };
}
