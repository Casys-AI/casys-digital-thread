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
  "behave-foundation-contract-attestation/0.2" as const;

const MANDATORY_MCP_FLEET_IDS = ["syson", "build123d-sandbox"] as const;

/**
 * Fixed endpoint identities, reviewed with the pinned Behave material. Fleet
 * service names describe Compose endpoints; they are not a substitute for
 * `server/discover.serverInfo` (the sandbox runs mcp-build123d).
 */
const MANDATORY_MCP_ENDPOINT_IDENTITIES = {
  syson: {
    healthStatus: "ok",
    server: { name: "mcp-syson", version: "0.6.0" },
  },
  "build123d-sandbox": {
    healthStatus: "ok",
    server: { name: "mcp-build123d", version: "0.5.0" },
  },
} as const;

export interface BehaveFoundationContractAttestation {
  readonly schemaVersion: typeof BEHAVE_FOUNDATION_CONTRACT_ATTESTATION_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly pack: BehaveFoundationCapabilityCensus["pack"];
  /** At most contract-attested; this probe cannot produce vertical-qualified. */
  readonly evidenceLevel: Exclude<BehaveFoundationEvidenceLevel, "vertical-qualified">;
  readonly verticalQualification: "not-observed";
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
  const everyMcpAttested = requiredMcpContracts.every((contract) =>
    contract.evidenceLevel === "contract-attested"
  );
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
    requiredMcpContracts,
    detail: evidenceLevel === "contract-attested"
      ? "Exact local material and the mandatory MCP discovery contracts were observed. No provider tool or product vertical was run."
      : "The pack remains below contract-attested until every mandatory material is cached exactly and every mandatory MCP discovery contract is attested.",
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
    expectedTools: [...server.expectedTools],
    expectedViews: [...(server.expectedViews ?? [])],
  });
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
