/**
 * Exact launch-group-owned STEP staging for recorded mcp-calculix sensitivity.
 *
 * The legacy Compose service stager targets the repository's default Compose
 * project and is therefore not an authority for `casys-mcp-calculix`. This
 * adapter is constructed only by server composition, after a JIT session has
 * acquired the exact sealed group lease. It resolves one owned running
 * container from immutable Compose labels, verifies the exact image digest,
 * then performs `docker cp` and an independent byte readback.
 */

import type {
  CapabilitySessionSolverInputStagerFactory,
  SolverInputStager,
} from "../../../application/ports/out/solver-input-stager.ts";
import type {
  CapabilityRuntimeLaunchGroupRegistry,
} from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../../domain/capability/runtime/capability-runtime-material.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  type CapabilityRuntimeLaunchGroupMaterial,
  type CapabilityRuntimeLaunchGroupReference,
  capabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  type ContainerAssetStager,
  ContainerAssetStagingError,
  type ContainerCommandRunner,
  type StagedContainerAsset,
} from "../../assets/container-asset-stager.ts";
import { IsolatedStepSolverStager } from "../../assets/isolated-step-solver-stager.ts";

const CALCULIX_GROUP_ID = "casys-mcp-calculix";
const CALCULIX_SERVICE_NAME = "mcp-calculix";
const INPUT_DIRECTORY = "/inputs";
const RUNS_DIRECTORY = "/var/lib/mcp-calculix-runs";
const INPUT_VOLUME = "calculix-inputs";
const RUNS_VOLUME = "calculix-runs";
const CONTAINER_ID = /^[a-f0-9]{12,64}$/;
const STAGED_STEP_FILE = /^fea-([a-f0-9]{64})\.step$/;

export interface CapabilityRuntimeCalculixInputStagerFactoryOptions {
  readonly groups: CapabilityRuntimeLaunchGroupRegistry;
  readonly hostCacheDirectory: string;
  readonly commandRunner?: ContainerCommandRunner;
  readonly hostFileReader?: (path: string) => Promise<Uint8Array | undefined>;
}

/**
 * Fixed factory for the `casys.mcp-calculix` launch group. The capability
 * session itself owns activation; this factory merely binds post-lease asset
 * exchange to its exact group and material identity.
 */
export class CapabilityRuntimeCalculixInputStagerFactory
  implements CapabilitySessionSolverInputStagerFactory {
  readonly #run: ContainerCommandRunner;
  readonly #readHost: (path: string) => Promise<Uint8Array | undefined>;

  constructor(
    private readonly options: CapabilityRuntimeCalculixInputStagerFactoryOptions,
  ) {
    this.#run = options.commandRunner ?? defaultCommandRunner;
    this.#readHost = options.hostFileReader ?? defaultHostFileReader;
  }

  async forActiveCapabilitySession(input: {
    readonly lease: CapabilityRuntimeLease;
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
    readonly material: CapabilityRuntimeMaterialIdentity;
  }): Promise<SolverInputStager> {
    if (
      !input.lease.launchGroups.some((candidate) =>
        sameCapabilityRuntimeLaunchGroupReference(candidate, input.launchGroup)
      )
    ) {
      throw new TypeError(
        "CalculiX input staging lease does not cover the exact launch group.",
      );
    }
    if (
      !input.lease.materialKeys.includes(capabilityRuntimeMaterialKey(input.material))
    ) {
      throw new TypeError(
        "CalculiX input staging lease does not cover the exact material.",
      );
    }
    const group = await this.options.groups.require(input.launchGroup);
    if (
      group.id !== CALCULIX_GROUP_ID ||
      !sameCapabilityRuntimeLaunchGroupReference(
        capabilityRuntimeLaunchGroupReference(group),
        input.launchGroup,
      )
    ) {
      throw new TypeError(
        "CalculiX input staging launch group is not the exact sealed mcp-calculix group.",
      );
    }
    const member = exactCalculixMember(group, input.material);
    return new IsolatedStepSolverStager(
      this.options.hostCacheDirectory,
      new OwnedLaunchGroupContainerAssetStager({
        group,
        member,
        run: this.#run,
        readHost: this.#readHost,
      }),
    );
  }
}

interface OwnedLaunchGroupContainerAssetStagerOptions {
  readonly group: CapabilityRuntimeLaunchGroup;
  readonly member: CapabilityRuntimeLaunchGroupMaterial;
  readonly run: ContainerCommandRunner;
  readonly readHost: (path: string) => Promise<Uint8Array | undefined>;
}

class OwnedLaunchGroupContainerAssetStager implements ContainerAssetStager {
  constructor(private readonly options: OwnedLaunchGroupContainerAssetStagerOptions) {}

  resolveTarget(input: { readonly containerFileName: string }): StagedContainerAsset {
    requireStagedStepFileName(input.containerFileName);
    return Object.freeze({
      containerPath: `${INPUT_DIRECTORY}/${input.containerFileName}`,
    });
  }

  async stage(input: {
    readonly sourcePath: string;
    readonly expectedDigest: string;
    readonly expectedBytes: number;
    readonly containerFileName: string;
  }): Promise<StagedContainerAsset> {
    requireDigest(input.expectedDigest);
    requireStagedStepFileName(input.containerFileName, input.expectedDigest);
    if (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes <= 0) {
      throw new TypeError(
        "CalculiX staged input byte count must be a positive safe integer.",
      );
    }
    const target = this.resolveTarget(input);
    const source = await this.options.readHost(input.sourcePath);
    if (
      !source || source.byteLength !== input.expectedBytes ||
      await sha256(source) !== input.expectedDigest
    ) {
      throw new ContainerAssetStagingError(
        "pre_verify_failed",
        { sourcePath: input.sourcePath, containerFileName: input.containerFileName },
        "Server-owned CalculiX staging cache bytes do not match the exact STEP identity.",
      );
    }
    const containerId = await this.#ownedRunningContainer();
    if (
      await this.#hasExactBytes(containerId, target.containerPath, input.expectedDigest)
    ) {
      return target;
    }
    const copy = await this.options.run("docker", [
      "cp",
      input.sourcePath,
      `${containerId}:${target.containerPath}`,
    ]);
    if (!copy.success) {
      throw stagingError("copy_failed", copy, input.containerFileName);
    }
    const readback = await this.options.run("docker", [
      "exec",
      containerId,
      "cat",
      target.containerPath,
    ]);
    if (!readback.success) {
      throw stagingError("post_read_failed", readback, input.containerFileName);
    }
    if (await sha256(readback.stdout) !== input.expectedDigest) {
      throw new ContainerAssetStagingError(
        "sha256_mismatch",
        { containerFileName: input.containerFileName, expected: input.expectedDigest },
        "Launch-group-owned CalculiX input readback has a different SHA-256.",
      );
    }
    return target;
  }

  async #hasExactBytes(
    containerId: string,
    path: string,
    expectedDigest: string,
  ): Promise<boolean> {
    const result = await this.options.run("docker", ["exec", containerId, "cat", path]);
    return result.success && await sha256(result.stdout) === expectedDigest;
  }

  async #ownedRunningContainer(): Promise<string> {
    const labels = this.options.member.ownership;
    const args = [
      "container",
      "ls",
      "--all",
      ...labels.flatMap((label) => ["--filter", `label=${label.key}=${label.value}`]),
      "--format",
      "{{.ID}}",
    ];
    const listed = await this.options.run("docker", args);
    if (!listed.success) {
      throw new ContainerAssetStagingError(
        "post_read_failed",
        { service: this.options.member.serviceName },
        "Cannot inspect the exact owned CalculiX launch-group container.",
      );
    }
    const ids = new TextDecoder().decode(listed.stdout).split(/\r?\n/)
      .map((value) => value.trim()).filter((value) => value.length > 0);
    if (ids.length !== 1 || !CONTAINER_ID.test(ids[0]!)) {
      throw new ContainerAssetStagingError(
        "post_read_failed",
        { service: this.options.member.serviceName, count: String(ids.length) },
        "Exact CalculiX launch-group ownership is absent or ambiguous.",
      );
    }
    const id = ids[0]!;
    const inspected = await this.options.run("docker", ["inspect", id]);
    const actual = parseOwnedContainer(
      inspected.stdout,
      id,
      this.options.member,
      this.options.group,
    );
    if (!inspected.success || !actual || actual.status !== "running") {
      throw new ContainerAssetStagingError(
        "post_read_failed",
        { service: this.options.member.serviceName, containerId: id },
        "Exact CalculiX launch-group container is not a running owned digest-pinned service with its two sealed volume mounts.",
      );
    }
    const image = await this.options.run("docker", ["image", "inspect", actual.image]);
    if (
      !image.success || !hasExactImage(image.stdout, this.options.member.imageReference)
    ) {
      throw new ContainerAssetStagingError(
        "post_read_failed",
        { service: this.options.member.serviceName, containerId: id },
        "Exact CalculiX launch-group container image does not match the sealed digest.",
      );
    }
    return id;
  }
}

function exactCalculixMember(
  group: CapabilityRuntimeLaunchGroup,
  material: CapabilityRuntimeMaterialIdentity,
): CapabilityRuntimeLaunchGroupMaterial {
  const matches = group.materials.filter((member) =>
    member.serviceName === CALCULIX_SERVICE_NAME &&
    member.material.unitId === material.unitId &&
    member.material.materialId === material.materialId &&
    member.material.imageDigest === material.imageDigest
  );
  if (matches.length !== 1 || group.materials.length !== 1) {
    throw new TypeError(
      "CalculiX input staging requires exactly one sealed mcp-calculix service material.",
    );
  }
  return matches[0]!;
}

function parseOwnedContainer(
  value: Uint8Array,
  requestedId: string,
  member: CapabilityRuntimeLaunchGroupMaterial,
  group: CapabilityRuntimeLaunchGroup,
): { readonly image: string; readonly status: string } | undefined {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(value));
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!root || typeof root !== "object" || Array.isArray(root)) return undefined;
    const record = root as Record<string, unknown>;
    const config = record.Config;
    const state = record.State;
    if (
      !config || typeof config !== "object" || Array.isArray(config) ||
      !state || typeof state !== "object" || Array.isArray(state) ||
      typeof record.Id !== "string" || typeof record.Image !== "string"
    ) return undefined;
    if (!(record.Id as string).startsWith(requestedId)) return undefined;
    const labels = (config as Record<string, unknown>).Labels;
    if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
      return undefined;
    }
    if (
      !member.ownership.every((label) =>
        (labels as Record<string, unknown>)[label.key] === label.value
      )
    ) return undefined;
    if (!hasExactCalculixVolumeMounts(record.Mounts, group)) return undefined;
    const status = (state as Record<string, unknown>).Status;
    return typeof status === "string" ? { image: record.Image, status } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Docker ownership is not established by labels alone: a same-name service
 * could otherwise stage input into a bind or unrelated volume. The sealed
 * single-service group has exactly these retained named volumes and nothing
 * else; reject before any `docker cp` mutation when inspection differs.
 */
function hasExactCalculixVolumeMounts(
  value: unknown,
  group: CapabilityRuntimeLaunchGroup,
): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const expected = new Map([
    [INPUT_DIRECTORY, `${group.acquisition.projectName}_${INPUT_VOLUME}`],
    [RUNS_DIRECTORY, `${group.acquisition.projectName}_${RUNS_VOLUME}`],
  ]);
  const seen = new Set<string>();
  for (const mount of value) {
    if (!mount || typeof mount !== "object" || Array.isArray(mount)) return false;
    const record = mount as Record<string, unknown>;
    if (
      record.Type !== "volume" || record.RW !== true ||
      typeof record.Name !== "string" || typeof record.Destination !== "string" ||
      expected.get(record.Destination) !== record.Name || seen.has(record.Destination)
    ) {
      return false;
    }
    seen.add(record.Destination);
  }
  return seen.size === expected.size;
}

function hasExactImage(value: Uint8Array, reference: string): boolean {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(value));
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    return !!root && typeof root === "object" && !Array.isArray(root) &&
      Array.isArray((root as Record<string, unknown>).RepoDigests) &&
      ((root as Record<string, unknown>).RepoDigests as unknown[]).includes(reference);
  } catch {
    return false;
  }
}

function stagingError(
  code: "copy_failed" | "post_read_failed",
  result: Awaited<ReturnType<ContainerCommandRunner>>,
  fileName: string,
): ContainerAssetStagingError {
  return new ContainerAssetStagingError(
    code,
    { containerFileName: fileName, exitCode: String(result.code) },
    `Launch-group-owned CalculiX staging ${code} for ${fileName}.`,
  );
}

function requireStagedStepFileName(value: string, expectedDigest?: string): void {
  const match = STAGED_STEP_FILE.exec(value);
  if (!match || (expectedDigest !== undefined && match[1] !== expectedDigest)) {
    throw new TypeError(
      "CalculiX staging filename must be the exact code-owned fea-<sha256>.step basename.",
    );
  }
}

function requireDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(
      "CalculiX staging digest must be a lowercase SHA-256 hex value.",
    );
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function defaultHostFileReader(path: string): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

const defaultCommandRunner: ContainerCommandRunner = async (exe, args) => {
  const output = await new Deno.Command(exe, { args, stdout: "piped", stderr: "piped" })
    .output();
  return {
    success: output.success,
    code: output.code,
    stdout: output.stdout,
    stderr: output.stderr,
  };
};
