/**
 * Operator-owned cache preparation for the fixed geometry-module assembler.
 *
 * This is deliberately not a product operation or an agent tool: every image,
 * guest contract and temporary path is code-owned. It only makes the already
 * reviewed local Docker image visible to Microsandbox under its immutable
 * manifest reference; it neither builds/pulls an image nor executes CAD.
 */

import type { MicrosandboxImageInspection } from "../../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import {
  createLocalMicrosandboxSdk,
  loadLocalMicrosandboxImageFromArchive,
  microsandboxHostArchitecture,
} from "../../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
} from "../../control-plane/first-party-capability-runtime-identities.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

export const GEOMETRY_MODULE_ASSEMBLY_MICROSANDBOX_CACHE_PREPARATION_SCHEMA =
  "geometry-module-assembly-microsandbox-cache-preparation/1.0" as const;

export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_DIGEST = digestOfPinnedReference(
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
);
export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_DIGEST =
  digestOfPinnedReference(
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  );

/** Hashes asserted by the image Dockerfile before it changes to its worker user. */
export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS = Object.freeze({
  "io.casys.wrapper.sha256":
    "609eaf93f2564b88b9103d5e0d53d1dd3e93fcdf8e54c61cc313b957370bf581",
  "io.casys.bundle-decoder.sha256":
    "79fb3f485581f2e732e18771817d8e2199327281c6090e6f61236b8ade68df76",
  "io.casys.fontconfig.sha256":
    "71f58af72fc487fe6c434dde129fa13dffd1cdc84bb7d1744170f2bd037586aa",
});

const ALLOWED_TEMP_PREFIXES = Object.freeze(["/tmp/", "/private/tmp/"] as const);
const ARCHIVE_BASENAME = "geometry-module-assembler-worker.tar";
const EXPECTED_OS = "linux" as const;
const EXPECTED_ARCHITECTURE = "arm64" as const;
const PULL_POLICY_NEVER = "never" as const;
const WORKER = GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT;
const EXPECTED_ENTRYPOINT = Object.freeze([WORKER.executable, ...WORKER.args]);

export interface DockerGeometryModuleAssemblySourceInspection {
  readonly repoDigests: readonly string[];
  readonly os: string;
  readonly architecture: string;
  readonly user: string;
  readonly entrypoint: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
}

export interface ExpectedGeometryModuleAssemblyRuntimeImage {
  readonly reference: string;
  readonly manifestDigest: string;
  readonly os: "linux";
  readonly architecture: "arm64";
  readonly user: string;
  readonly entrypoint: readonly string[];
}

export interface GeometryModuleAssemblyMicrosandboxTemporaryArchive {
  readonly directory: string;
  readonly archivePath: string;
  cleanup(): Promise<void>;
}

/** Pure seams: production construction is fixed below, while tests have no Docker. */
export interface GeometryModuleAssemblyMicrosandboxCachePorts {
  readonly expectedHostArchitecture: string;
  inspectCachedImage(reference: string): Promise<MicrosandboxImageInspection>;
  loadImageFromArchive(archivePath: string, tag: string): Promise<void>;
  inspectDockerSource(): Promise<unknown>;
  saveDockerSource(archivePath: string): Promise<void>;
  createTemporaryArchiveDirectory(): Promise<
    GeometryModuleAssemblyMicrosandboxTemporaryArchive
  >;
}

export interface GeometryModuleAssemblyMicrosandboxCachePreparation {
  readonly schemaVersion:
    typeof GEOMETRY_MODULE_ASSEMBLY_MICROSANDBOX_CACHE_PREPARATION_SCHEMA;
  readonly status: "already-cached" | "imported";
  readonly sourceImageReference:
    typeof LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE;
  readonly runtimeImageReference: typeof LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE;
  readonly manifestDigest: string;
  readonly os: "linux";
  readonly architecture: "arm64";
  readonly user: string;
  readonly entrypoint: readonly string[];
  readonly pullPolicy: typeof PULL_POLICY_NEVER;
}

export function expectedGeometryModuleAssemblyRuntimeImage(): ExpectedGeometryModuleAssemblyRuntimeImage {
  const reference = pinnedOciImageReference(
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
    "$geometryModuleAssembly.runtimeImageReference",
  );
  return Object.freeze({
    reference,
    manifestDigest: `sha256:${LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_DIGEST}`,
    os: EXPECTED_OS,
    architecture: EXPECTED_ARCHITECTURE,
    user: WORKER.expectedImageUser,
    entrypoint: EXPECTED_ENTRYPOINT,
  });
}

export function assertNoCallerSelectedGeometryModuleAssemblyCacheArguments(
  args: readonly string[],
): void {
  if (args.length !== 0) {
    throw new TypeError(
      "The geometry-module assembler Microsandbox cache operator accepts no caller-selected image, path, or arguments.",
    );
  }
}

export function assertAllowedGeometryModuleAssemblyCacheTempPath(path: string): string {
  if (
    !ALLOWED_TEMP_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    path.includes("\0") || path.includes("\\")
  ) {
    throw new Error(
      "Temporary geometry-module assembler Microsandbox cache artifacts must stay under /tmp.",
    );
  }
  return path;
}

export function isCachedMicrosandboxImageAbsent(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const record = error as { readonly code?: unknown; readonly name?: unknown };
  return record.code === "imageNotFound" || record.name === "ImageNotFoundError";
}

export function parseDockerGeometryModuleAssemblySourceInspection(
  value: unknown,
): DockerGeometryModuleAssemblySourceInspection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("docker inspect must return one image object.");
  }
  const root = value as Record<string, unknown>;
  const config = objectRecord(root.Config, "docker inspect Config");
  const labels = optionalStringRecord(config.Labels, "docker inspect Config.Labels");
  const repoDigests = stringArray(root.RepoDigests, "docker inspect RepoDigests");
  const entrypoint = stringArray(config.Entrypoint, "docker inspect Entrypoint");
  if (typeof root.Os !== "string" || root.Os === "") {
    throw new TypeError("docker inspect Os is missing.");
  }
  if (typeof root.Architecture !== "string" || root.Architecture === "") {
    throw new TypeError("docker inspect Architecture is missing.");
  }
  return Object.freeze({
    repoDigests: Object.freeze(repoDigests),
    os: root.Os,
    architecture: root.Architecture,
    user: typeof config.User === "string" ? config.User : "",
    entrypoint: Object.freeze(entrypoint),
    labels: Object.freeze(labels),
  });
}

export function assertExactDockerGeometryModuleAssemblySourceImage(
  inspection: DockerGeometryModuleAssemblySourceInspection,
): DockerGeometryModuleAssemblySourceInspection {
  if (
    !inspection.repoDigests.some((digest) =>
      digest === LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE ||
      digest ===
        `docker.io/${LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE}`
    ) || inspection.os !== EXPECTED_OS ||
    inspection.architecture !== EXPECTED_ARCHITECTURE ||
    inspection.user !== WORKER.expectedImageUser ||
    !stringArraysEqual(inspection.entrypoint, EXPECTED_ENTRYPOINT) ||
    !Object.entries(LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS).every(
      ([name, value]) => inspection.labels[name] === value,
    )
  ) {
    throw new Error(
      "The Docker geometry-module assembler source image is not the reviewed linux/arm64 worker.",
    );
  }
  return inspection;
}

export function assertExactCachedGeometryModuleAssemblyRuntimeImage(
  inspection: MicrosandboxImageInspection,
  expected = expectedGeometryModuleAssemblyRuntimeImage(),
): MicrosandboxImageInspection {
  if (
    inspection.reference !== expected.reference ||
    inspection.manifestDigest !== expected.manifestDigest ||
    inspection.os !== expected.os ||
    inspection.architecture !== expected.architecture ||
    inspection.user !== expected.user ||
    !stringArraysEqual(inspection.entrypoint, expected.entrypoint)
  ) {
    throw new Error(
      "The cached geometry-module assembler Microsandbox image is not the reviewed runtime manifest.",
    );
  }
  return inspection;
}

export async function prepareGeometryModuleAssemblyMicrosandboxCache(
  ports: GeometryModuleAssemblyMicrosandboxCachePorts,
): Promise<GeometryModuleAssemblyMicrosandboxCachePreparation> {
  if (ports.expectedHostArchitecture !== EXPECTED_ARCHITECTURE) {
    throw new Error(
      "The geometry-module assembler cache worker is reviewed only for a native linux/arm64 host.",
    );
  }
  const expected = expectedGeometryModuleAssemblyRuntimeImage();
  const cached = await lookupCachedRuntimeImage(ports, expected.reference);
  if (cached !== undefined) {
    return preparation(
      "already-cached",
      assertExactCachedGeometryModuleAssemblyRuntimeImage(cached, expected),
    );
  }

  assertExactDockerGeometryModuleAssemblySourceImage(
    parseDockerGeometryModuleAssemblySourceInspection(
      await ports.inspectDockerSource(),
    ),
  );
  const temporary = await ports.createTemporaryArchiveDirectory();
  try {
    assertAllowedGeometryModuleAssemblyCacheTempPath(temporary.directory);
    const archivePath = assertAllowedGeometryModuleAssemblyCacheTempPath(
      temporary.archivePath,
    );
    await ports.saveDockerSource(archivePath);
    await ports.loadImageFromArchive(archivePath, expected.reference);
    const imported = await lookupCachedRuntimeImage(ports, expected.reference);
    if (imported === undefined) {
      throw new Error(
        "The cached geometry-module assembler Microsandbox image is not the reviewed runtime manifest.",
      );
    }
    return preparation(
      "imported",
      assertExactCachedGeometryModuleAssemblyRuntimeImage(imported, expected),
    );
  } finally {
    await temporary.cleanup();
  }
}

export async function createLocalGeometryModuleAssemblyMicrosandboxCachePorts(): Promise<
  GeometryModuleAssemblyMicrosandboxCachePorts
> {
  const sdk = await createLocalMicrosandboxSdk();
  sdk.assertLocalBackend();
  return Object.freeze({
    expectedHostArchitecture: microsandboxHostArchitecture(),
    inspectCachedImage: (reference: string) => sdk.inspectImage(reference),
    loadImageFromArchive: (archivePath: string, tag: string) =>
      loadLocalMicrosandboxImageFromArchive(archivePath, tag),
    inspectDockerSource: inspectDockerGeometryModuleAssemblySource,
    saveDockerSource: saveDockerGeometryModuleAssemblySource,
    createTemporaryArchiveDirectory: createAllowedGeometryModuleAssemblyCacheArchive,
  });
}

async function lookupCachedRuntimeImage(
  ports: GeometryModuleAssemblyMicrosandboxCachePorts,
  reference: string,
): Promise<MicrosandboxImageInspection | undefined> {
  try {
    return await ports.inspectCachedImage(reference);
  } catch (error) {
    if (isCachedMicrosandboxImageAbsent(error)) return undefined;
    throw error;
  }
}

function preparation(
  status: GeometryModuleAssemblyMicrosandboxCachePreparation["status"],
  inspection: MicrosandboxImageInspection,
): GeometryModuleAssemblyMicrosandboxCachePreparation {
  return Object.freeze({
    schemaVersion: GEOMETRY_MODULE_ASSEMBLY_MICROSANDBOX_CACHE_PREPARATION_SCHEMA,
    status,
    sourceImageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
    runtimeImageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
    manifestDigest: inspection.manifestDigest,
    os: EXPECTED_OS,
    architecture: EXPECTED_ARCHITECTURE,
    user: inspection.user ?? WORKER.expectedImageUser,
    entrypoint: Object.freeze([...(inspection.entrypoint ?? EXPECTED_ENTRYPOINT)]),
    pullPolicy: PULL_POLICY_NEVER,
  });
}

async function inspectDockerGeometryModuleAssemblySource(): Promise<unknown> {
  const output = await docker([
    "image",
    "inspect",
    "--format",
    "{{json .}}",
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  ]);
  if (!output.success) {
    throw new Error(`docker inspect failed: ${decode(output.stderr).slice(-2_000)}`);
  }
  return JSON.parse(decode(output.stdout)) as unknown;
}

async function saveDockerGeometryModuleAssemblySource(
  archivePath: string,
): Promise<void> {
  const output = await docker([
    "image",
    "save",
    "-o",
    archivePath,
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  ]);
  if (!output.success) {
    throw new Error(
      `docker image save failed: ${decode(output.stderr).slice(-2_000)}`,
    );
  }
}

async function createAllowedGeometryModuleAssemblyCacheArchive(): Promise<
  GeometryModuleAssemblyMicrosandboxTemporaryArchive
> {
  const directory = assertAllowedGeometryModuleAssemblyCacheTempPath(
    await Deno.makeTempDir({
      dir: "/tmp",
      prefix: "casys-geometry-module-assembler-microsandbox-cache-",
    }),
  );
  return Object.freeze({
    directory,
    archivePath: `${directory}/${ARCHIVE_BASENAME}`,
    cleanup: () => Deno.remove(directory, { recursive: true }),
  });
}

function digestOfPinnedReference(reference: string): string {
  return reference.slice(reference.lastIndexOf("@sha256:") + 8);
}

function objectRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalStringRecord(value: unknown, path: string): Record<string, string> {
  if (value === undefined || value === null) return {};
  const record = objectRecord(value, path);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") {
      throw new TypeError(`${path}.${key} must be a string.`);
    }
    result[key] = item;
  }
  return result;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${path} is not a string array.`);
  }
  return [...value];
}

function stringArraysEqual(
  left: readonly string[] | null,
  right: readonly string[],
): boolean {
  return left !== null && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

async function docker(args: readonly string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("docker", {
    args: [...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
