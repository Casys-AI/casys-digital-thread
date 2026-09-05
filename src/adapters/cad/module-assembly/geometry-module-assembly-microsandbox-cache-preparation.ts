/**
 * Exact Docker-source and Microsandbox contracts for the geometry-module
 * assembler. Acquisition lives in the generic first-party bootstrap.
 */

import { samePinnedRepositoryDigest } from "../../shared/docker-pinned-repository-digest.ts";
import type { MicrosandboxImageInspection } from "../../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS,
} from "../../control-plane/first-party-capability-runtime-identities.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_DIGEST = digestOfPinnedReference(
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
);
export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_DIGEST =
  digestOfPinnedReference(
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  );

export { LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS };

const ALLOWED_TEMP_PREFIXES = Object.freeze(["/tmp/", "/private/tmp/"] as const);
const EXPECTED_OS = "linux" as const;
const EXPECTED_ARCHITECTURE = "arm64" as const;
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
      samePinnedRepositoryDigest(
        digest,
        LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
      )
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
