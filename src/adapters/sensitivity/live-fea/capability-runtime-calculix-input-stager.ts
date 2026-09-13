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
import type { ContainerCommandRunner } from "../../assets/container-asset-stager.ts";
import {
  defaultOwnedContainerCommandRunner,
  defaultOwnedContainerHostFileReader,
  OwnedLaunchGroupContainerAssetStager,
} from "../../assets/owned-launch-group-container-stager.ts";
import { IsolatedStepSolverStager } from "../../assets/isolated-step-solver-stager.ts";

const CALCULIX_GROUP_ID = "casys-mcp-calculix";
const CALCULIX_SERVICE_NAME = "mcp-calculix";
const INPUT_DIRECTORY = "/inputs";
const RUNS_DIRECTORY = "/var/lib/mcp-calculix-runs";
const EXPORTS_DIRECTORY = "/exports";
const INPUT_VOLUME = "calculix-inputs";
const RUNS_VOLUME = "calculix-runs";
const EXPORTS_VOLUME = "calculix-exports";
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
    this.#run = options.commandRunner ?? defaultOwnedContainerCommandRunner;
    this.#readHost = options.hostFileReader ?? defaultOwnedContainerHostFileReader;
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
        containerDirectory: INPUT_DIRECTORY,
        assertFileName: requireStagedStepFileName,
        mountsAreExact: hasExactCalculixVolumeMounts,
        preexisting: "reuse-or-copy",
        authority: "CalculiX",
        run: this.#run,
        readHost: this.#readHost,
      }),
    );
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

/**
 * Docker ownership is not established by labels alone: a same-name service
 * could otherwise stage input into a bind or unrelated volume. The sealed
 * single-service group has exactly these three retained named volumes and nothing
 * else; reject before any `docker cp` mutation when inspection differs.
 */
function hasExactCalculixVolumeMounts(
  value: unknown,
  group: CapabilityRuntimeLaunchGroup,
): boolean {
  if (!Array.isArray(value) || value.length !== 3) return false;
  const expected = new Map([
    [INPUT_DIRECTORY, `${group.acquisition.projectName}_${INPUT_VOLUME}`],
    [RUNS_DIRECTORY, `${group.acquisition.projectName}_${RUNS_VOLUME}`],
    [EXPORTS_DIRECTORY, `${group.acquisition.projectName}_${EXPORTS_VOLUME}`],
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

function requireStagedStepFileName(value: string, expectedDigest?: string): void {
  const match = STAGED_STEP_FILE.exec(value);
  if (!match || (expectedDigest !== undefined && match[1] !== expectedDigest)) {
    throw new TypeError(
      "CalculiX staging filename must be the exact code-owned fea-<sha256>.step basename.",
    );
  }
}
