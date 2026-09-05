/**
 * Exact Docker-source and Microsandbox contracts for the ngspice worker image.
 * Acquisition lives in the generic first-party Microsandbox bootstrap.
 */

import { samePinnedRepositoryDigest } from "../../../shared/docker-pinned-repository-digest.ts";
import type { MicrosandboxImageInspection } from "../../../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { pinnedOciImageReference } from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";
import {
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
} from "./local-image-references.ts";

const ALLOWED_TEMP_PREFIXES = Object.freeze(["/tmp/", "/private/tmp/"] as const);
const DOCKER_LINUX = "linux";
const DOCKER_ARM64 = "arm64";

const WORKER = NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;
const EXPECTED_ENTRYPOINT = Object.freeze([
  WORKER.executable,
  ...WORKER.args,
]);

export const LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_DIGEST = digestOfPinnedReference(
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
);
export const LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_DIGEST = digestOfPinnedReference(
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
);

export interface DockerNgspiceSourceInspection {
  readonly repoDigests: readonly string[];
  readonly os: string;
  readonly architecture: string;
  readonly user: string;
  readonly entrypoint: readonly string[];
}

export interface ExpectedNgspiceRuntimeImage {
  readonly reference: string;
  readonly manifestDigest: string;
  readonly os: "linux";
  readonly architecture: string;
  readonly user: string;
  readonly entrypoint: readonly string[];
}

export function expectedNgspiceRuntimeImage(
  hostArchitecture: string,
): ExpectedNgspiceRuntimeImage {
  const reference = pinnedOciImageReference(
    LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
    "$admittedSpice.runtimeImageReference",
  );
  return Object.freeze({
    reference,
    manifestDigest: `sha256:${LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_DIGEST}`,
    os: "linux",
    architecture: hostArchitecture,
    user: WORKER.expectedImageUser,
    entrypoint: EXPECTED_ENTRYPOINT,
  });
}

export function isCachedMicrosandboxImageAbsent(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const record = error as { readonly code?: unknown; readonly name?: unknown };
  return record.code === "imageNotFound" || record.name === "ImageNotFoundError";
}

export function assertNoCallerSelectedNgspiceCacheArguments(
  args: readonly string[],
): void {
  if (args.length !== 0) {
    throw new TypeError(
      "The ngspice Microsandbox cache operator accepts no caller-selected image, path, or arguments.",
    );
  }
}

export function assertAllowedNgspiceCacheTempPath(path: string): string {
  if (
    !ALLOWED_TEMP_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    path.includes("\0") || path.includes("\\")
  ) {
    throw new Error(
      "Temporary ngspice Microsandbox cache artifacts must stay under /tmp.",
    );
  }
  return path;
}

export function parseDockerNgspiceSourceInspection(
  value: unknown,
): DockerNgspiceSourceInspection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("docker inspect must return one image object.");
  }
  const root = value as Record<string, unknown>;
  const config = root.Config === null || root.Config === undefined ? {} : root.Config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new TypeError("docker inspect Config must be an object.");
  }
  const configRecord = config as Record<string, unknown>;
  const repoDigests = Array.isArray(root.RepoDigests)
    ? root.RepoDigests.map((item, index) => {
      if (typeof item !== "string" || item === "") {
        throw new TypeError(`docker inspect RepoDigests[${index}] is not a digest.`);
      }
      return item;
    })
    : [];
  if (typeof root.Os !== "string" || root.Os === "") {
    throw new TypeError("docker inspect Os is missing.");
  }
  if (typeof root.Architecture !== "string" || root.Architecture === "") {
    throw new TypeError("docker inspect Architecture is missing.");
  }
  const entrypoint = configRecord.Entrypoint;
  if (
    !Array.isArray(entrypoint) || entrypoint.some((item) => typeof item !== "string")
  ) {
    throw new TypeError("docker inspect Entrypoint is not a string array.");
  }
  return Object.freeze({
    repoDigests: Object.freeze([...repoDigests]),
    os: root.Os,
    architecture: root.Architecture,
    user: typeof configRecord.User === "string" ? configRecord.User : "",
    entrypoint: Object.freeze([...entrypoint] as string[]),
  });
}

export function assertExactDockerNgspiceSourceImage(
  inspection: DockerNgspiceSourceInspection,
): DockerNgspiceSourceInspection {
  const source = LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE;
  if (
    !inspection.repoDigests.some((digest) => samePinnedRepositoryDigest(digest, source))
  ) {
    throw new Error(
      "The Docker ngspice source image is not the reviewed linux/arm64 worker.",
    );
  }
  if (
    inspection.os !== DOCKER_LINUX || inspection.architecture !== DOCKER_ARM64 ||
    inspection.user !== WORKER.expectedImageUser ||
    !stringArraysEqual(inspection.entrypoint, EXPECTED_ENTRYPOINT)
  ) {
    throw new Error(
      "The Docker ngspice source image is not the reviewed linux/arm64 worker.",
    );
  }
  return inspection;
}

export function assertExactCachedNgspiceRuntimeImage(
  inspection: MicrosandboxImageInspection,
  expected: ExpectedNgspiceRuntimeImage,
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
      "The cached ngspice Microsandbox image is not the reviewed runtime manifest.",
    );
  }
  return inspection;
}

function digestOfPinnedReference(reference: string): string {
  return reference.slice(reference.lastIndexOf("@sha256:") + 8);
}

function stringArraysEqual(
  left: readonly string[] | null,
  right: readonly string[],
): boolean {
  return left !== null && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
