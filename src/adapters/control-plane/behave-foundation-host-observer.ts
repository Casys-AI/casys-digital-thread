import {
  BEHAVE_FOUNDATION_HOST_OBSERVATION_SCHEMA_VERSION,
  type BehaveFoundationHostObservation,
  type BehaveFoundationHostPrerequisiteObservation,
} from "../../application/control-plane/read-model/behave-foundation-doctor.ts";
import type { BehaveFoundationCapabilityCensus } from "../../application/control-plane/read-model/behave-foundation-census.ts";
import type {
  ObservedCapabilityImage,
  RuntimePlatform,
} from "../../application/control-plane/read-model/capability-pack.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
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

/** Observe exact local material only. Never pull, import, start or dispatch. */
export async function observeBehaveFoundationHost(
  census: BehaveFoundationCapabilityCensus,
  ports: BehaveFoundationHostObservationPorts,
): Promise<BehaveFoundationHostObservation> {
  const blockers = ports.platformBlocker === undefined ? [] : [ports.platformBlocker];
  const images: ObservedCapabilityImage[] = [];
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
        "{{.Size}}",
        material.image,
      ]);
      if (!inspection.success) continue;
      const sizeBytes = Number(inspection.stdout.trim());
      images.push({
        reference: material.image,
        sizeBytes: Number.isSafeInteger(sizeBytes) && sizeBytes >= 0
          ? sizeBytes
          : undefined,
      });
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
    }
  } catch (error) {
    microsandbox = prerequisite(
      "microsandbox-local",
      false,
      null,
      `Microsandbox is unavailable: ${errorMessage(error)}`,
    );
    blockers.push(microsandbox.detail);
  }

  return deepFreeze({
    schemaVersion: BEHAVE_FOUNDATION_HOST_OBSERVATION_SCHEMA_VERSION,
    mutatesRuntime: false,
    platform: ports.platform,
    prerequisites: [docker, microsandbox],
    images,
    blockers,
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
