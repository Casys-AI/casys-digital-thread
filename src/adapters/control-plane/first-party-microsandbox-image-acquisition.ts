/**
 * Generic first-party Microsandbox image acquisition.
 *
 * Observe the exact target, then on miss inspect or reconstruct a local
 * candidate Docker source, save, and load under the catalogued target
 * reference. A `trusted-dockerfile` rebuild is not bit-reproducible proof:
 * the imported image must still match the exact target digest, or the
 * capability stays unavailable. `oci-digest` is the preferred immutable
 * distribution source when a reviewed digest exists. Callers never supply an
 * image, path, platform, or command.
 */

import { samePinnedRepositoryDigest } from "../shared/docker-pinned-repository-digest.ts";
import {
  assertExactMicrosandboxImageInspection,
  createLocalMicrosandboxSdk,
  loadLocalMicrosandboxImageFromArchive,
  microsandboxHostArchitecture,
  type MicrosandboxImageInspection,
  type MicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import {
  type FirstPartyMicrosandboxImageBootstrapDescriptor,
  type FirstPartyMicrosandboxImageBootstrapSource,
  resolveTrustedFirstPartyBootstrapPath,
} from "./first-party-microsandbox-image-bootstrap.ts";

const ALLOWED_TEMP_PREFIXES = Object.freeze(["/tmp/", "/private/tmp/"] as const);
const PULL_POLICY_NEVER = "never" as const;

export interface FirstPartyMicrosandboxTemporaryArchive {
  readonly directory: string;
  readonly archivePath: string;
  cleanup(): Promise<void>;
}

export interface FirstPartyMicrosandboxImageAcquisitionPorts {
  readonly hostArchitecture: string;
  inspectCachedImage(reference: string): Promise<MicrosandboxImageInspection>;
  isImageNotFound(error: unknown): boolean;
  loadImageFromArchive(archivePath: string, tag: string): Promise<void>;
  /**
   * Exact Microsandbox cached-image removal. No force, prune, or volume.
   * Used only to quarantine a target this acquisition just imported.
   */
  removeExactCachedImage(reference: string): Promise<void>;
  inspectDockerImage(reference: string): Promise<unknown | undefined>;
  buildDockerImage(input: {
    readonly dockerfile: string;
    readonly context: string;
    readonly platform: string;
    readonly tag: string;
  }): Promise<void>;
  pullByDigest(reference: string): Promise<void>;
  saveDockerImage(reference: string, archivePath: string): Promise<void>;
  /** `docker image rm` without `--force` or prune. Never a digest pin. */
  removeBuiltDockerImage(reference: string): Promise<void>;
  createTemporaryArchiveDirectory(): Promise<FirstPartyMicrosandboxTemporaryArchive>;
}

export interface FirstPartyMicrosandboxImageAcquisitionSession {
  readonly loadedTargetReferences: Set<string>;
}

export interface FirstPartyMicrosandboxImageAcquisition {
  readonly status: "already-cached" | "imported";
  readonly builtDockerSource: boolean;
  readonly targetImageReference: string;
  readonly dockerSourceReference: string;
  readonly pullPolicy: typeof PULL_POLICY_NEVER;
}

export interface DockerSourceInspection {
  readonly repoDigests: readonly string[];
  readonly os: string;
  readonly architecture: string;
  readonly user: string;
  readonly entrypoint: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
}

export function createFirstPartyMicrosandboxImageAcquisitionSession(): FirstPartyMicrosandboxImageAcquisitionSession {
  return {
    loadedTargetReferences: new Set<string>(),
  };
}

export function assertNoCallerSelectedFirstPartyBootstrapArguments(
  args: readonly string[],
): void {
  if (args.length !== 0) {
    throw new TypeError(
      "First-party Microsandbox bootstrap accepts no caller-selected image, path, or arguments.",
    );
  }
}

export function assertAllowedFirstPartyBootstrapTempPath(path: string): string {
  if (
    !ALLOWED_TEMP_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    path.includes("\0") || path.includes("\\")
  ) {
    throw new Error(
      "Temporary first-party Microsandbox bootstrap artifacts must stay under /tmp.",
    );
  }
  return path;
}

export function parseDockerSourceInspection(value: unknown): DockerSourceInspection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("docker inspect must return one image object.");
  }
  const root = value as Record<string, unknown>;
  const config = objectRecord(root.Config, "docker inspect Config");
  const labels = optionalStringRecord(config.Labels, "docker inspect Config.Labels");
  const repoDigests = stringArray(root.RepoDigests, "docker inspect RepoDigests", true);
  const entrypoint = stringArray(config.Entrypoint, "docker inspect Entrypoint", false);
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

export function assertExactDockerSourceImage(
  inspection: DockerSourceInspection,
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
  inspectedReference: string,
): DockerSourceInspection {
  const source = descriptor.source;
  const recipe = descriptor.buildRecipe;
  const requirePinnedDigest =
    (source.kind === "oci-digest" && inspectedReference === source.reference) ||
    (source.kind === "trusted-dockerfile" &&
      inspectedReference === source.dockerSourceReference &&
      source.dockerSourceReference.includes("@sha256:"));
  const digestMatches = inspection.repoDigests.some((digest) =>
    samePinnedRepositoryDigest(digest, inspectedReference)
  );
  if (
    inspection.os !== recipe.os ||
    inspection.architecture !== recipe.architecture ||
    inspection.user !== recipe.user ||
    !stringArraysEqual(inspection.entrypoint, recipe.entrypoint) ||
    (requirePinnedDigest && !digestMatches) ||
    (recipe.labels !== undefined &&
      !Object.entries(recipe.labels).every(([name, value]) =>
        inspection.labels[name] === value
      ))
  ) {
    throw new Error(
      "The Docker source image is not the reviewed first-party worker.",
    );
  }
  return inspection;
}

export async function acquireFirstPartyMicrosandboxImage(input: {
  readonly descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor;
  readonly ports: FirstPartyMicrosandboxImageAcquisitionPorts;
  readonly session?: FirstPartyMicrosandboxImageAcquisitionSession;
}): Promise<FirstPartyMicrosandboxImageAcquisition> {
  const descriptor = input.descriptor;
  const ports = input.ports;
  assertHostArchitecture(descriptor, ports.hostArchitecture);
  if (input.session?.loadedTargetReferences.has(descriptor.targetImageReference)) {
    return alreadyCached(descriptor, false);
  }
  const cached = await lookupCachedRuntimeImage(ports, descriptor.target.reference);
  if (cached !== undefined) {
    assertExactMicrosandboxImageInspection(cached, descriptor.target);
    input.session?.loadedTargetReferences.add(descriptor.targetImageReference);
    return alreadyCached(descriptor, false);
  }

  let createdLocalDockerTag: string | undefined;
  try {
    const { saveReference, built, createdLocalDockerTag: createdTag } =
      await ensureDockerSource({
        descriptor,
        ports,
      });
    createdLocalDockerTag = createdTag;
    const temporary = await ports.createTemporaryArchiveDirectory();
    try {
      assertAllowedFirstPartyBootstrapTempPath(temporary.directory);
      const archivePath = assertAllowedFirstPartyBootstrapTempPath(
        temporary.archivePath,
      );
      await ports.saveDockerImage(saveReference, archivePath);
      await ports.loadImageFromArchive(archivePath, descriptor.targetImageReference);
      try {
        const imported = await lookupCachedRuntimeImage(
          ports,
          descriptor.target.reference,
        );
        if (imported === undefined) {
          throw new Error(
            "The cached first-party Microsandbox image is not the reviewed runtime manifest.",
          );
        }
        assertExactMicrosandboxImageInspection(imported, descriptor.target);
      } catch (error) {
        await rethrowAfterExactImportedTargetQuarantine(
          ports,
          descriptor.targetImageReference,
          error,
        );
      }
      input.session?.loadedTargetReferences.add(descriptor.targetImageReference);
      return Object.freeze({
        status: "imported",
        builtDockerSource: built,
        targetImageReference: descriptor.targetImageReference,
        dockerSourceReference: dockerSourceReferenceOf(descriptor.source),
        pullPolicy: PULL_POLICY_NEVER,
      });
    } finally {
      await temporary.cleanup();
    }
  } finally {
    if (createdLocalDockerTag !== undefined) {
      await ports.removeBuiltDockerImage(createdLocalDockerTag);
    }
  }
}

export async function createLocalFirstPartyMicrosandboxImageAcquisitionPorts(
  createSdk: () => Promise<MicrosandboxSdk> = createLocalMicrosandboxSdk,
): Promise<FirstPartyMicrosandboxImageAcquisitionPorts> {
  const sdk = await createSdk();
  sdk.assertLocalBackend();
  return Object.freeze({
    hostArchitecture: microsandboxHostArchitecture(),
    inspectCachedImage: (reference: string) => sdk.inspectImage(reference),
    isImageNotFound: (error: unknown) => sdk.isImageNotFound(error),
    loadImageFromArchive: (archivePath: string, tag: string) =>
      loadLocalMicrosandboxImageFromArchive(archivePath, tag),
    removeExactCachedImage: (reference: string) =>
      sdk.removeExactCachedImage(reference),
    inspectDockerImage,
    buildDockerImage,
    pullByDigest,
    saveDockerImage,
    removeBuiltDockerImage,
    createTemporaryArchiveDirectory: createAllowedBootstrapArchive,
  });
}

async function ensureDockerSource(input: {
  readonly descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor;
  readonly ports: FirstPartyMicrosandboxImageAcquisitionPorts;
}): Promise<{
  readonly saveReference: string;
  readonly built: boolean;
  readonly createdLocalDockerTag: string | undefined;
}> {
  const descriptor = input.descriptor;
  const source = descriptor.source;
  const recipe = descriptor.buildRecipe;
  if (source.kind === "oci-digest") {
    const existing = await inspectExactDockerSource(
      input.ports,
      descriptor,
      source.reference,
    );
    if (existing !== undefined) {
      return {
        saveReference: source.reference,
        built: false,
        createdLocalDockerTag: undefined,
      };
    }
    await input.ports.pullByDigest(source.reference);
    assertExactDockerSourceImage(
      parseDockerSourceInspection(
        await requireDockerInspection(
          input.ports,
          source.reference,
        ),
      ),
      descriptor,
      source.reference,
    );
    return {
      saveReference: source.reference,
      built: false,
      createdLocalDockerTag: undefined,
    };
  }

  const pinned = await inspectExactDockerSource(
    input.ports,
    descriptor,
    source.dockerSourceReference,
  );
  if (pinned !== undefined) {
    return {
      saveReference: source.dockerSourceReference,
      built: false,
      createdLocalDockerTag: undefined,
    };
  }
  if (source.dockerSourceReference !== source.dockerImageName) {
    const existingTag = await input.ports.inspectDockerImage(source.dockerImageName);
    if (existingTag !== undefined) {
      assertExactDockerSourceImage(
        parseDockerSourceInspection(existingTag),
        descriptor,
        source.dockerImageName,
      );
      return {
        saveReference: source.dockerImageName,
        built: false,
        createdLocalDockerTag: undefined,
      };
    }
  }
  await input.ports.buildDockerImage({
    dockerfile: resolveTrustedFirstPartyBootstrapPath(recipe.dockerfile),
    context: resolveTrustedFirstPartyBootstrapPath(recipe.context),
    platform: recipe.platform,
    tag: source.dockerImageName,
  });
  try {
    assertExactDockerSourceImage(
      parseDockerSourceInspection(
        await requireDockerInspection(input.ports, source.dockerImageName),
      ),
      descriptor,
      source.dockerImageName,
    );
  } catch (error) {
    await input.ports.removeBuiltDockerImage(source.dockerImageName);
    throw error;
  }
  return {
    saveReference: source.dockerImageName,
    built: true,
    createdLocalDockerTag: source.dockerImageName,
  };
}

async function inspectExactDockerSource(
  ports: FirstPartyMicrosandboxImageAcquisitionPorts,
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
  reference: string,
): Promise<DockerSourceInspection | undefined> {
  const raw = await ports.inspectDockerImage(reference);
  if (raw === undefined) return undefined;
  return assertExactDockerSourceImage(
    parseDockerSourceInspection(raw),
    descriptor,
    reference,
  );
}

async function requireDockerInspection(
  ports: FirstPartyMicrosandboxImageAcquisitionPorts,
  reference: string,
): Promise<unknown> {
  const raw = await ports.inspectDockerImage(reference);
  if (raw === undefined) {
    throw new Error("The Docker source image is absent after acquisition.");
  }
  return raw;
}

async function lookupCachedRuntimeImage(
  ports: FirstPartyMicrosandboxImageAcquisitionPorts,
  reference: string,
): Promise<MicrosandboxImageInspection | undefined> {
  try {
    return await ports.inspectCachedImage(reference);
  } catch (error) {
    if (ports.isImageNotFound(error)) return undefined;
    throw error;
  }
}

async function rethrowAfterExactImportedTargetQuarantine(
  ports: FirstPartyMicrosandboxImageAcquisitionPorts,
  reference: string,
  primary: unknown,
): Promise<never> {
  try {
    await ports.removeExactCachedImage(reference);
  } catch (quarantineError) {
    throw new AggregateError(
      [primary, quarantineError],
      "First-party Microsandbox import failed and exact cached-image quarantine also failed.",
      { cause: primary },
    );
  }
  throw primary;
}

function alreadyCached(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
  built: boolean,
): FirstPartyMicrosandboxImageAcquisition {
  return Object.freeze({
    status: "already-cached",
    builtDockerSource: built,
    targetImageReference: descriptor.targetImageReference,
    dockerSourceReference: dockerSourceReferenceOf(descriptor.source),
    pullPolicy: PULL_POLICY_NEVER,
  });
}

function dockerSourceReferenceOf(
  source: FirstPartyMicrosandboxImageBootstrapSource,
): string {
  return source.kind === "oci-digest" ? source.reference : source.dockerSourceReference;
}

function assertHostArchitecture(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
  hostArchitecture: string,
): void {
  if (hostArchitecture !== descriptor.buildRecipe.architecture) {
    throw new Error(
      `First-party Microsandbox bootstrap is reviewed only for native ${descriptor.buildRecipe.platform}.`,
    );
  }
}

async function inspectDockerImage(reference: string): Promise<unknown | undefined> {
  const output = await docker([
    "image",
    "inspect",
    "--format",
    "{{json .}}",
    reference,
  ]);
  if (!output.success) return undefined;
  return JSON.parse(decode(output.stdout)) as unknown;
}

async function buildDockerImage(input: {
  readonly dockerfile: string;
  readonly context: string;
  readonly platform: string;
  readonly tag: string;
}): Promise<void> {
  const output = await docker([
    "buildx",
    "build",
    "--load",
    "--platform",
    input.platform,
    "-f",
    input.dockerfile,
    "-t",
    input.tag,
    input.context,
  ]);
  if (!output.success) {
    throw new Error(
      `docker buildx build failed: ${decode(output.stderr).slice(-2_000)}`,
    );
  }
}

async function pullByDigest(reference: string): Promise<void> {
  if (!reference.includes("@sha256:") || reference.endsWith(":latest")) {
    throw new TypeError(
      "First-party OCI pull requires an exact digest-pinned reference.",
    );
  }
  const output = await docker(["pull", reference]);
  if (!output.success) {
    throw new Error(`docker pull failed: ${decode(output.stderr).slice(-2_000)}`);
  }
}

async function saveDockerImage(reference: string, archivePath: string): Promise<void> {
  const output = await docker(["image", "save", "-o", archivePath, reference]);
  if (!output.success) {
    throw new Error(
      `docker image save failed: ${decode(output.stderr).slice(-2_000)}`,
    );
  }
}

async function removeBuiltDockerImage(reference: string): Promise<void> {
  if (reference.includes("@") || reference.endsWith(":latest")) {
    throw new TypeError(
      "First-party bootstrap must not remove a digest-pinned or latest Docker image.",
    );
  }
  const output = await docker(["image", "rm", reference]);
  if (!output.success) {
    throw new Error(
      `docker image rm failed: ${decode(output.stderr).slice(-2_000)}`,
    );
  }
}

async function createAllowedBootstrapArchive(): Promise<
  FirstPartyMicrosandboxTemporaryArchive
> {
  const directory = assertAllowedFirstPartyBootstrapTempPath(
    await Deno.makeTempDir({
      dir: "/tmp",
      prefix: "casys-first-party-microsandbox-cache-",
    }),
  );
  return Object.freeze({
    directory,
    archivePath: `${directory}/worker.tar`,
    cleanup: () => Deno.remove(directory, { recursive: true }),
  });
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

function stringArray(value: unknown, path: string, optional: boolean): string[] {
  if (value === undefined || value === null) {
    if (optional) return [];
    throw new TypeError(`${path} is not a string array.`);
  }
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
