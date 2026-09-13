/**
 * Exact launch-group-owned STEP staging for measured mcp-dfm checks.
 *
 * The host export-volume stager is not an authority for `casys-mcp-dfm`.
 * `/exports` stays the sealed read-only named volume. This adapter copies the
 * canonical STEP into the unique lease-owned exact-image container at the
 * server-derived ephemeral `/tmp/dfm-<sha256>.step`, then independently reads
 * it back (SHA-256 and byte count). It never writes `/exports`.
 */

import type {
  CapabilitySessionGeometryExportStagerFactory,
  GeometryExportStager,
} from "../../../application/ports/out/make/geometry-export-stager.ts";
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
import { IsolatedStepSolverStager } from "../../assets/isolated-step-solver-stager.ts";
import {
  defaultOwnedContainerCommandRunner,
  defaultOwnedContainerHostFileReader,
  OwnedLaunchGroupContainerAssetStager,
} from "../../assets/owned-launch-group-container-stager.ts";

const DFM_GROUP_ID = "casys-mcp-dfm";
const DFM_SERVICE_NAME = "mcp-dfm";
const DFM_TMP_DIRECTORY = "/tmp";
const DFM_EXPORTS_DIRECTORY = "/exports";
const DFM_EXPORTS_VOLUME = "dfm-exports";
const STAGED_STEP_FILE = /^dfm-([a-f0-9]{64})\.step$/;

export interface CapabilityRuntimeDfmGeometryExportStagerFactoryOptions {
  readonly groups: CapabilityRuntimeLaunchGroupRegistry;
  readonly hostCacheDirectory: string;
  readonly commandRunner?: ContainerCommandRunner;
  readonly hostFileReader?: (path: string) => Promise<Uint8Array | undefined>;
}

/**
 * Fixed factory for the `casys.mcp-dfm` launch group. The capability session
 * itself owns activation; this factory merely binds post-lease asset exchange
 * to its exact group and material identity.
 */
export class CapabilityRuntimeDfmGeometryExportStagerFactory
  implements CapabilitySessionGeometryExportStagerFactory {
  readonly #run: ContainerCommandRunner;
  readonly #readHost: (path: string) => Promise<Uint8Array | undefined>;

  constructor(
    private readonly options: CapabilityRuntimeDfmGeometryExportStagerFactoryOptions,
  ) {
    this.#run = options.commandRunner ?? defaultOwnedContainerCommandRunner;
    this.#readHost = options.hostFileReader ?? defaultOwnedContainerHostFileReader;
  }

  async forActiveCapabilitySession(input: {
    readonly lease: CapabilityRuntimeLease;
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
    readonly material: CapabilityRuntimeMaterialIdentity;
  }): Promise<GeometryExportStager> {
    if (
      !input.lease.launchGroups.some((candidate) =>
        sameCapabilityRuntimeLaunchGroupReference(candidate, input.launchGroup)
      )
    ) {
      throw new TypeError(
        "DFM geometry staging lease does not cover the exact launch group.",
      );
    }
    if (
      !input.lease.materialKeys.includes(capabilityRuntimeMaterialKey(input.material))
    ) {
      throw new TypeError(
        "DFM geometry staging lease does not cover the exact material.",
      );
    }
    const group = await this.options.groups.require(input.launchGroup);
    if (
      group.id !== DFM_GROUP_ID ||
      !sameCapabilityRuntimeLaunchGroupReference(
        capabilityRuntimeLaunchGroupReference(group),
        input.launchGroup,
      )
    ) {
      throw new TypeError(
        "DFM geometry staging launch group is not the exact sealed mcp-dfm group.",
      );
    }
    const member = exactDfmMember(group, input.material);
    const inner = new IsolatedStepSolverStager(
      this.options.hostCacheDirectory,
      new OwnedLaunchGroupContainerAssetStager({
        group,
        member,
        containerDirectory: DFM_TMP_DIRECTORY,
        assertFileName: requireStagedStepFileName,
        mountsAreExact: hasExactDfmVolumeMounts,
        preexisting: "reuse-or-reject",
        authority: "DFM",
        run: this.#run,
        readHost: this.#readHost,
      }),
      (path, bytes) => Deno.writeFile(path, bytes),
      (path) => Deno.readFile(path),
      dfmStagedFileName,
    );
    return {
      stage: async (request) => {
        if (request.bytes.byteLength <= 0) {
          throw new TypeError(
            "DFM staged geometry byte count must be a positive safe integer.",
          );
        }
        const staged = await inner.stage({
          bytes: request.bytes,
          fingerprint: { algorithm: "sha256", digest: request.digest },
          byteCount: request.bytes.byteLength,
        });
        return {
          path: staged.stagedAsset.location,
          sha256: request.digest,
          byteCount: request.bytes.byteLength,
        };
      },
    };
  }
}

function exactDfmMember(
  group: CapabilityRuntimeLaunchGroup,
  material: CapabilityRuntimeMaterialIdentity,
): CapabilityRuntimeLaunchGroupMaterial {
  const matches = group.materials.filter((member) =>
    member.serviceName === DFM_SERVICE_NAME &&
    member.material.unitId === material.unitId &&
    member.material.materialId === material.materialId &&
    member.material.imageDigest === material.imageDigest
  );
  if (matches.length !== 1 || group.materials.length !== 1) {
    throw new TypeError(
      "DFM geometry staging requires exactly one sealed mcp-dfm service material.",
    );
  }
  return matches[0]!;
}

/**
 * The sealed single-service group keeps the named `dfm-exports` volume mounted
 * read-only at `/exports`. Extra binds, a writable exports mount, or a renamed
 * volume are foreign topology and must not receive the canonical STEP.
 */
function hasExactDfmVolumeMounts(
  value: unknown,
  group: CapabilityRuntimeLaunchGroup,
): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const mount = value[0];
  if (!mount || typeof mount !== "object" || Array.isArray(mount)) return false;
  const record = mount as Record<string, unknown>;
  return record.Type === "volume" &&
    record.RW === false &&
    record.Destination === DFM_EXPORTS_DIRECTORY &&
    record.Name === `${group.acquisition.projectName}_${DFM_EXPORTS_VOLUME}`;
}

function dfmStagedFileName(digest: string): string {
  return `dfm-${digest}.step`;
}

function requireStagedStepFileName(value: string, expectedDigest?: string): void {
  const match = STAGED_STEP_FILE.exec(value);
  if (!match || (expectedDigest !== undefined && match[1] !== expectedDigest)) {
    throw new TypeError(
      "DFM staging filename must be the exact code-owned dfm-<sha256>.step basename.",
    );
  }
}
