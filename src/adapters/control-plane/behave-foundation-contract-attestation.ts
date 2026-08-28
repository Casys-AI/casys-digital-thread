import type {
  BehaveFoundationCapabilityCensus,
  BehaveFoundationEvidenceLevel,
} from "../../application/control-plane/read-model/behave-foundation-census.ts";
import type { BehaveFoundationHostObservation } from "../../application/control-plane/read-model/behave-foundation-doctor.ts";
import type { FleetManifest } from "../../application/control-plane/read-model/fleet-manifest.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  attestReadOnlyMcpContract,
  type ReadOnlyMcpContractAttestation,
  type ReadOnlyMcpContractAttestorOptions,
  type ReadOnlyMcpContractTarget,
} from "../shared/mcp/read-only-mcp-contract-attestation.ts";

export const BEHAVE_FOUNDATION_CONTRACT_ATTESTATION_SCHEMA_VERSION =
  "behave-foundation-contract-attestation/0.3" as const;

const MANDATORY_MCP_FLEET_IDS = ["syson", "build123d-sandbox"] as const;

type MandatoryMcpEndpointIdentity = {
  readonly healthStatus: string;
  readonly server: {
    readonly name: string;
    readonly version: string;
  };
  readonly expectedRuntimeContract?: NonNullable<
    ReadOnlyMcpContractTarget["expectedRuntimeContract"]
  >;
};

const SYSON_RELEASE = {
  image:
    "ghcr.io/casys-ai/mcp-syson@sha256:87eee6e35a636124d5ba6911492a245d69edcdf1ba67575676c22a0e9d7ce65e",
  version: "0.8.3",
  revision: "cf22348d1f91ba7329e0dbc04db814bca32ff17e",
  labels: {
    "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-syson",
    "org.opencontainers.image.revision": "cf22348d1f91ba7329e0dbc04db814bca32ff17e",
    "org.opencontainers.image.version": "0.8.3",
  },
  runtimeContract: {
    schemaVersion: "mcp-syson-runtime-contract/1.0",
    asset: {
      url:
        "https://github.com/Casys-AI/mcp-syson/releases/download/v0.8.3/release-runtime-contract.json",
      fingerprint: {
        algorithm: "sha256" as const,
        digest: "d4dd56a07bb349579d7378733313b867160c77291b4a065095fffcf3a848393a",
      },
    },
    resourceUri: "ui://mcp-syson/model-explorer-viewer",
    fingerprints: {
      serverDiscover: {
        algorithm: "sha256" as const,
        digest: "58d41a8e20f8030701fc07eb02b3f4ab11d7dff9c3b468a01c2201e8b69f9db8",
      },
      toolContracts: {
        algorithm: "sha256" as const,
        digest: "faa2a2615fa7b8152ed8f2f3c654c5f095a8dee9ba0debf34008bcee8dd4400c",
      },
      uiResources: {
        algorithm: "sha256" as const,
        digest: "0621f51beb776e35387349112d4cda6052b298ea39213d8a09d017027cce26b3",
      },
    },
  },
} as const;

const BUILD123D_RELEASE = {
  image:
    "ghcr.io/casys-ai/mcp-build123d@sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d",
  version: "0.6.1",
  revision: "beaeb648a979437cce8676da103a39d9eb312290",
  labels: {
    "org.opencontainers.image.created": "2026-08-28T16:59:19Z",
    "org.opencontainers.image.description": "Qualified Build123d MCP provider",
    "org.opencontainers.image.licenses": "MIT",
    "org.opencontainers.image.revision": "beaeb648a979437cce8676da103a39d9eb312290",
    "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-build123d",
    "org.opencontainers.image.title": "mcp-build123d",
    "org.opencontainers.image.url": "https://github.com/denoland/deno_docker",
    "org.opencontainers.image.version": "0.6.1",
  },
} as const;

/**
 * Fixed endpoint identities, reviewed with the pinned Behave material. Fleet
 * service names describe Compose endpoints; they are not a substitute for
 * `server/discover.serverInfo` (the sandbox runs mcp-build123d).
 */
const MANDATORY_MCP_ENDPOINT_IDENTITIES: Readonly<
  Record<
    typeof MANDATORY_MCP_FLEET_IDS[number],
    MandatoryMcpEndpointIdentity
  >
> = {
  syson: {
    healthStatus: "ok",
    server: { name: "mcp-syson", version: SYSON_RELEASE.version },
    expectedRuntimeContract: {
      resourceUri: SYSON_RELEASE.runtimeContract.resourceUri,
      fingerprints: SYSON_RELEASE.runtimeContract.fingerprints,
    },
  },
  "build123d-sandbox": {
    healthStatus: "ok",
    server: { name: "mcp-build123d", version: BUILD123D_RELEASE.version },
  },
} as const;

export interface BehaveFoundationContractAttestation {
  readonly schemaVersion: typeof BEHAVE_FOUNDATION_CONTRACT_ATTESTATION_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly pack: BehaveFoundationCapabilityCensus["pack"];
  /** At most contract-attested; this probe cannot produce vertical-qualified. */
  readonly evidenceLevel: Exclude<BehaveFoundationEvidenceLevel, "vertical-qualified">;
  readonly verticalQualification: "not-observed";
  readonly sysonRelease: {
    readonly image: string;
    readonly revision: string;
    readonly version: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly observedLabels: Readonly<Record<string, string>> | null;
    readonly labelsMatchExpected: boolean;
    readonly runtimeContract: typeof SYSON_RELEASE.runtimeContract;
  };
  readonly build123dRelease: {
    readonly image: string;
    readonly revision: string;
    readonly version: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly observedLabels: Readonly<Record<string, string>> | null;
    readonly labelsMatchExpected: boolean;
  };
  readonly requiredMcpContracts: readonly ReadOnlyMcpContractAttestation[];
  readonly detail: string;
}

export interface AttestBehaveFoundationContractsOptions {
  readonly census: BehaveFoundationCapabilityCensus;
  readonly host: BehaveFoundationHostObservation;
  readonly fleet: FleetManifest;
  readonly attestor?: ReadOnlyMcpContractAttestorOptions;
}

/**
 * Attest only the two mandatory MCP boundaries declared by the Behave pack.
 * The fleet, endpoints, and expected surface are all repository/server-owned;
 * callers cannot select a provider, tool, or arguments.
 */
export async function attestBehaveFoundationContracts(
  options: AttestBehaveFoundationContractsOptions,
): Promise<BehaveFoundationContractAttestation> {
  const targets = MANDATORY_MCP_FLEET_IDS.map((id) => targetFor(options.fleet, id));
  const requiredMcpContracts = await Promise.all(
    targets.map((target) => attestReadOnlyMcpContract(target, options.attestor)),
  );
  const everyMaterialCached = options.census.status === "candidate-ready" &&
    hasExactCachedMaterialSet(options.census, options.host);
  const observedSysonLabels =
    options.host.materialObservations.find((observation) =>
      observation.materialId === "mcp-syson"
    )?.labels ?? null;
  const sysonLabelsMatchExpected = labelsMatch(
    observedSysonLabels,
    SYSON_RELEASE.labels,
  );
  const observedBuild123dLabels =
    options.host.materialObservations.find((observation) =>
      observation.materialId === "mcp-build123d-sandbox"
    )?.labels ?? null;
  const build123dLabelsMatchExpected = labelsMatch(
    observedBuild123dLabels,
    BUILD123D_RELEASE.labels,
  );
  const everyMcpAttested =
    requiredMcpContracts.every((contract) =>
      contract.evidenceLevel === "contract-attested"
    ) && sysonLabelsMatchExpected && build123dLabelsMatchExpected;
  const evidenceLevel = everyMaterialCached && everyMcpAttested
    ? "contract-attested" as const
    : everyMaterialCached
    ? "cached-exact" as const
    : "declared" as const;
  return deepFreeze({
    schemaVersion: BEHAVE_FOUNDATION_CONTRACT_ATTESTATION_SCHEMA_VERSION,
    mutatesRuntime: false,
    pack: options.census.pack,
    evidenceLevel,
    verticalQualification: "not-observed" as const,
    sysonRelease: {
      image: SYSON_RELEASE.image,
      revision: SYSON_RELEASE.revision,
      version: SYSON_RELEASE.version,
      labels: SYSON_RELEASE.labels,
      observedLabels: observedSysonLabels,
      labelsMatchExpected: sysonLabelsMatchExpected,
      runtimeContract: SYSON_RELEASE.runtimeContract,
    },
    build123dRelease: {
      image: BUILD123D_RELEASE.image,
      revision: BUILD123D_RELEASE.revision,
      version: BUILD123D_RELEASE.version,
      labels: BUILD123D_RELEASE.labels,
      observedLabels: observedBuild123dLabels,
      labelsMatchExpected: build123dLabelsMatchExpected,
    },
    requiredMcpContracts,
    detail: evidenceLevel === "contract-attested"
      ? "Exact local material, the released SysON and Build123d labels, and the mandatory MCP discovery contracts were observed. No provider tool or product vertical was run."
      : "The pack remains below contract-attested until every mandatory material is cached exactly, the released SysON and Build123d labels match, and every mandatory MCP discovery contract is attested.",
  });
}

function targetFor(
  fleet: FleetManifest,
  id: typeof MANDATORY_MCP_FLEET_IDS[number],
): ReadOnlyMcpContractTarget {
  const matches = fleet.servers.filter((server) => server.id === id);
  if (matches.length !== 1) {
    throw new TypeError(
      `Behave contract attestation requires exactly one ${id} fleet server.`,
    );
  }
  const server = matches[0]!;
  const identity = MANDATORY_MCP_ENDPOINT_IDENTITIES[id];
  return deepFreeze({
    id: server.serviceName,
    healthUrl: server.healthUrl,
    mcpUrl: server.mcpUrl,
    expectedHealthStatus: identity.healthStatus,
    expectedServer: identity.server,
    ...(identity.expectedRuntimeContract === undefined
      ? {}
      : { expectedRuntimeContract: identity.expectedRuntimeContract }),
    expectedTools: [...server.expectedTools],
    expectedViews: [...(server.expectedViews ?? [])],
  });
}

function labelsMatch(
  observed: Readonly<Record<string, string>> | null,
  expected: Readonly<Record<string, string>>,
): boolean {
  return observed !== null &&
    Object.entries(expected).every(([key, value]) => observed[key] === value);
}

function hasExactCachedMaterialSet(
  census: BehaveFoundationCapabilityCensus,
  host: BehaveFoundationHostObservation,
): boolean {
  const expected = new Set(census.materials.map((material) => material.id));
  const observed = new Set(host.cachedExactMaterialIds);
  return expected.size === census.materials.length &&
    observed.size === host.cachedExactMaterialIds.length &&
    observed.size === expected.size &&
    [...observed].every((materialId) => expected.has(materialId));
}
