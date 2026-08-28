import {
  BEHAVE_FOUNDATION_HOST_OBSERVATION_SCHEMA_VERSION,
  type BehaveFoundationCachedMaterialObservation,
  type BehaveFoundationHostObservation,
  type BehaveFoundationHostPrerequisiteObservation,
} from "../../application/control-plane/read-model/behave-foundation-doctor.ts";
import type { BehaveFoundationCapabilityCensus } from "../../application/control-plane/read-model/behave-foundation-census.ts";
import type {
  ObservedCapabilityImage,
  RuntimePlatform,
} from "../../application/control-plane/read-model/capability-pack.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  createLocalMicrosandboxSdk,
  type MicrosandboxImageInspection,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";

export interface BehaveFoundationCommandResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface BehaveFoundationHostObservationPorts {
  readonly platform: RuntimePlatform | null;
  readonly platformBlocker?: string;
  runDocker(args: readonly string[]): Promise<BehaveFoundationCommandResult>;
  inspectMicrosandboxImage(
    reference: string,
  ): Promise<MicrosandboxImageInspection | undefined>;
}

interface DockerImageInspection {
  readonly repoDigests: readonly string[];
  readonly os: string;
  readonly architecture: string;
  readonly sizeBytes: number | undefined;
}

interface ExactDockerImageInspection extends DockerImageInspection {
  /** The exact RepoDigest whose normalized repository and digest matched. */
  readonly matchedRepoDigest: string;
}

/** Observe exact local material only. Never pull, import, start or dispatch. */
export async function observeBehaveFoundationHost(
  census: BehaveFoundationCapabilityCensus,
  ports: BehaveFoundationHostObservationPorts,
): Promise<BehaveFoundationHostObservation> {
  const blockers = ports.platformBlocker === undefined ? [] : [ports.platformBlocker];
  const images: ObservedCapabilityImage[] = [];
  const cachedExactMaterialIds: string[] = [];
  const materialObservations: BehaveFoundationCachedMaterialObservation[] = [];
  const composeVersion = await safeDocker(ports, ["compose", "version", "--short"]);
  const engineVersion = composeVersion.success
    ? await safeDocker(ports, ["version", "--format", "{{.Server.Version}}"])
    : { success: false, stdout: "", stderr: "Docker Compose is unavailable." };
  const dockerAvailable = composeVersion.success && engineVersion.success;
  const docker = prerequisite(
    "docker-compose-local",
    dockerAvailable,
    dockerAvailable ? composeVersion.stdout.trim() || null : null,
    dockerAvailable
      ? `Docker Compose is available with engine ${engineVersion.stdout.trim()}.`
      : conciseDockerFailure(composeVersion, engineVersion),
  );
  if (!dockerAvailable) blockers.push(docker.detail);

  if (dockerAvailable) {
    for (const material of census.materials) {
      if (material.kind !== "compose-service") continue;
      const inspection = await safeDocker(ports, [
        "image",
        "inspect",
        "--format",
        "{{json .}}",
        material.image,
      ]);
      if (!inspection.success) {
        materialObservations.push(
          materialUnavailable(material.id, material.image, inspection),
        );
        continue;
      }
      try {
        const cached = assertExactDockerImage(
          parseDockerImageInspection(inspection.stdout),
          material.image,
          ports.platform,
        );
        images.push({ reference: material.image, sizeBytes: cached.sizeBytes });
        cachedExactMaterialIds.push(material.id);
        materialObservations.push(deepFreeze({
          materialId: material.id,
          expectedReference: material.image,
          status: "cached-exact" as const,
          matchedRepoDigest: cached.matchedRepoDigest,
          observedReference: cached.matchedRepoDigest,
          detail: "The local OCI cache matches the reviewed digest and platform.",
        }));
      } catch (error) {
        materialObservations.push(deepFreeze({
          materialId: material.id,
          expectedReference: material.image,
          status: "mismatch" as const,
          matchedRepoDigest: null,
          observedReference: null,
          detail: `Local OCI cache does not match the reviewed identity: ${
            errorMessage(error)
          }`,
        }));
      }
    }
  } else {
    for (const material of census.materials) {
      if (material.kind === "compose-service") {
        materialObservations.push(deepFreeze({
          materialId: material.id,
          expectedReference: material.image,
          status: "unavailable" as const,
          matchedRepoDigest: null,
          observedReference: null,
          detail:
            "Docker Compose is unavailable; the local OCI cache was not observed.",
        }));
      }
    }
  }

  let microsandbox: BehaveFoundationHostPrerequisiteObservation;
  const microvm = census.materials.find((material) =>
    material.kind === "microvm-image"
  );
  try {
    const inspection = microvm === undefined
      ? undefined
      : await ports.inspectMicrosandboxImage(microvm.image);
    microsandbox = prerequisite(
      "microsandbox-local",
      true,
      microvm?.runner.version ?? null,
      "The code-owned local Microsandbox backend is available.",
    );
    if (inspection !== undefined && microvm !== undefined) {
      assertExactMicrosandboxImage(inspection, microvm.image, ports.platform);
      images.push({ reference: microvm.image });
      cachedExactMaterialIds.push(microvm.id);
      materialObservations.push(deepFreeze({
        materialId: microvm.id,
        expectedReference: microvm.image,
        status: "cached-exact" as const,
        matchedRepoDigest: null,
        observedReference: inspection.reference,
        detail:
          "The local Microsandbox cache matches the reviewed digest and platform.",
      }));
    } else if (microvm !== undefined) {
      materialObservations.push(deepFreeze({
        materialId: microvm.id,
        expectedReference: microvm.image,
        status: "unavailable" as const,
        matchedRepoDigest: null,
        observedReference: null,
        detail: "The reviewed Microsandbox image is not cached locally.",
      }));
    }
  } catch (error) {
    microsandbox = prerequisite(
      "microsandbox-local",
      false,
      null,
      `Microsandbox is unavailable: ${errorMessage(error)}`,
    );
    blockers.push(microsandbox.detail);
    if (microvm !== undefined) {
      materialObservations.push(deepFreeze({
        materialId: microvm.id,
        expectedReference: microvm.image,
        status: "unavailable" as const,
        matchedRepoDigest: null,
        observedReference: null,
        detail: microsandbox.detail,
      }));
    }
  }

  return deepFreeze({
    schemaVersion: BEHAVE_FOUNDATION_HOST_OBSERVATION_SCHEMA_VERSION,
    mutatesRuntime: false,
    platform: ports.platform,
    prerequisites: [docker, microsandbox],
    images,
    cachedExactMaterialIds,
    materialObservations,
    blockers,
  });
}

function materialUnavailable(
  materialId: string,
  expectedReference: string,
  inspection: BehaveFoundationCommandResult,
): BehaveFoundationCachedMaterialObservation {
  const detail = inspection.stderr.trim() || inspection.stdout.trim() ||
    "docker image inspect failed";
  return deepFreeze({
    materialId,
    expectedReference,
    status: "unavailable" as const,
    matchedRepoDigest: null,
    observedReference: null,
    detail: `The reviewed OCI image is not locally inspectable: ${
      detail.slice(0, 300)
    }`,
  });
}

export function localBehaveFoundationHostObservationPorts(): BehaveFoundationHostObservationPorts {
  const platform = localRuntimePlatform();
  return Object.freeze({
    platform: platform.value,
    platformBlocker: platform.blocker,
    runDocker: runDocker,
    inspectMicrosandboxImage: inspectLocalMicrosandboxImage,
  });
}

function localRuntimePlatform(): {
  readonly value: RuntimePlatform | null;
  readonly blocker?: string;
} {
  if (Deno.build.os !== "darwin" && Deno.build.os !== "linux") {
    return {
      value: null,
      blocker: `Unsupported local runtime host ${Deno.build.os}/${Deno.build.arch}.`,
    };
  }
  if (Deno.build.arch === "aarch64") return { value: "linux/arm64" };
  if (Deno.build.arch === "x86_64") return { value: "linux/amd64" };
  return {
    value: null,
    blocker: `Unsupported local runtime host ${Deno.build.os}/${Deno.build.arch}.`,
  };
}

async function runDocker(
  args: readonly string[],
): Promise<BehaveFoundationCommandResult> {
  const output = await new Deno.Command("docker", {
    args: [...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: output.success,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function safeDocker(
  ports: BehaveFoundationHostObservationPorts,
  args: readonly string[],
): Promise<BehaveFoundationCommandResult> {
  try {
    return await ports.runDocker(args);
  } catch (error) {
    return { success: false, stdout: "", stderr: errorMessage(error) };
  }
}

async function inspectLocalMicrosandboxImage(
  reference: string,
): Promise<MicrosandboxImageInspection | undefined> {
  const sdk = await createLocalMicrosandboxSdk();
  sdk.assertLocalBackend();
  try {
    return await sdk.inspectImage(reference);
  } catch (error) {
    if (isImageNotFound(error)) return undefined;
    throw error;
  }
}

function isImageNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const record = error as { readonly code?: unknown; readonly name?: unknown };
  return record.code === "imageNotFound" || record.name === "ImageNotFoundError";
}

function assertExactMicrosandboxImage(
  inspection: MicrosandboxImageInspection,
  reference: string,
  platform: RuntimePlatform | null,
): void {
  const digest = reference.slice(reference.lastIndexOf("@sha256:") + 1);
  const architecture = platform?.split("/")[1] ?? null;
  if (
    inspection.reference !== reference || inspection.manifestDigest !== digest ||
    inspection.os !== "linux" || inspection.architecture !== architecture
  ) {
    throw new Error("the cached CalculiX image does not match the reviewed identity");
  }
}

function parseDockerImageInspection(source: string): DockerImageInspection {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new TypeError("docker image inspect did not return JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("docker image inspect did not return one image object");
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.RepoDigests) ||
    record.RepoDigests.some((item) => typeof item !== "string" || item === "")
  ) {
    throw new TypeError("docker image inspect is missing RepoDigests");
  }
  if (typeof record.Os !== "string" || typeof record.Architecture !== "string") {
    throw new TypeError("docker image inspect is missing platform identity");
  }
  const sizeBytes = typeof record.Size === "number" &&
      Number.isSafeInteger(record.Size) && record.Size >= 0
    ? record.Size
    : undefined;
  return deepFreeze({
    repoDigests: [...record.RepoDigests] as string[],
    os: record.Os,
    architecture: record.Architecture,
    sizeBytes,
  });
}

function assertExactDockerImage(
  inspection: DockerImageInspection,
  reference: string,
  platform: RuntimePlatform | null,
): ExactDockerImageInspection {
  const architecture = platform?.split("/")[1] ?? null;
  const matchedRepoDigest = inspection.repoDigests.find((digest) =>
    sameOciRepositoryDigest(digest, reference)
  );
  if (
    architecture === null || inspection.os !== "linux" ||
    inspection.architecture !== architecture ||
    matchedRepoDigest === undefined
  ) {
    throw new Error("the cached OCI image does not match the reviewed identity");
  }
  return deepFreeze({ ...inspection, matchedRepoDigest });
}

function sameOciRepositoryDigest(left: string, right: string): boolean {
  const normalizedLeft = normalizeOciRepositoryDigest(left);
  const normalizedRight = normalizeOciRepositoryDigest(right);
  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}

function normalizeOciRepositoryDigest(reference: string): string | null {
  let validated: string;
  try {
    validated = pinnedOciImageReference(reference, "$docker.image.inspect.RepoDigests");
  } catch {
    return null;
  }
  const at = validated.lastIndexOf("@sha256:");
  if (at <= 0) return null;
  const digest = validated.slice(at + 1);
  const nameWithTag = validated.slice(0, at);
  const slash = nameWithTag.lastIndexOf("/");
  const colon = nameWithTag.lastIndexOf(":");
  const name = colon > slash ? nameWithTag.slice(0, colon) : nameWithTag;
  const parts = name.split("/");
  const normalizedName = parts.length === 1
    ? `docker.io/library/${name}`
    : !parts[0]!.includes(".") && !parts[0]!.includes(":") && parts[0] !== "localhost"
    ? `docker.io/${name}`
    : name;
  return `${normalizedName}@${digest}`;
}

function prerequisite(
  id: BehaveFoundationHostPrerequisiteObservation["id"],
  available: boolean,
  version: string | null,
  detail: string,
): BehaveFoundationHostPrerequisiteObservation {
  return deepFreeze({
    id,
    status: available ? "available" : "unavailable",
    version,
    detail,
  });
}

function conciseDockerFailure(
  compose: BehaveFoundationCommandResult,
  engine: BehaveFoundationCommandResult,
): string {
  const failed = compose.success ? engine : compose;
  const detail = failed.stderr.trim() || failed.stdout.trim() || "command failed";
  return `Docker Compose is unavailable: ${detail.slice(0, 300)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
