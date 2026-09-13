/**
 * Turns one validated local ERP Buy installation profile into catalog material
 * and a persistent Compose launch group. Qualification remains unqualified.
 */

import {
  type AtomicCapabilityRuntimeMaterial,
  type AtomicCapabilityRuntimeUnit,
  fingerprintAtomicCapabilityRuntimeUnit,
  type QualifiedCapabilityRuntimeBinding,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../domain/capability/engineering-capability.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { validateCapabilityRuntimeCatalog } from "./capability-runtime-catalog.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "../../application/control-plane/capability-runtime-launch-group-registry.ts";
import {
  ERPNEXT_BUY_RUNTIME_ADAPTER_ID,
  ERPNEXT_BUY_RUNTIME_ADAPTER_SOURCE,
  ERPNEXT_BUY_RUNTIME_ADAPTER_VERSION,
  ERPNEXT_BUY_RUNTIME_BINDING_ID,
  ERPNEXT_BUY_RUNTIME_BINDING_VERSION,
  imageDigestFromPinnedReference,
  type LocalErpnextBuyInstallationProfile,
} from "./local-erpnext-buy-installation-profile.ts";
import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";

export interface ErpnextBuyRuntimeContribution {
  readonly profile: LocalErpnextBuyInstallationProfile;
  readonly unit: AtomicCapabilityRuntimeUnit;
  readonly binding: QualifiedCapabilityRuntimeBinding;
  readonly launchGroup: CapabilityRuntimeLaunchGroup;
}

export async function createErpnextBuyRuntimeContribution(
  profile: LocalErpnextBuyInstallationProfile,
): Promise<ErpnextBuyRuntimeContribution> {
  const launchGroup = await createErpnextBuyLaunchGroup(profile);
  const unit = await createErpnextBuyUnit(profile, launchGroup);
  return {
    profile,
    unit,
    binding: erpnextBuyBinding(profile, unit),
    launchGroup,
  };
}

export async function catalogWithErpnextBuyRuntime(
  catalog: CapabilityRuntimeCatalog,
  contribution: ErpnextBuyRuntimeContribution,
): Promise<CapabilityRuntimeCatalog> {
  return await validateCapabilityRuntimeCatalog({
    schemaVersion: catalog.schemaVersion,
    productionEligible: catalog.productionEligible,
    units: [...catalog.units, contribution.unit],
    bindings: [...catalog.bindings, contribution.binding],
  });
}

export function launchGroupRegistryWithErpnextBuyRuntime(
  groups: readonly CapabilityRuntimeLaunchGroup[],
  contribution: ErpnextBuyRuntimeContribution,
): FixedCapabilityRuntimeLaunchGroupRegistry {
  return new FixedCapabilityRuntimeLaunchGroupRegistry([
    ...groups,
    contribution.launchGroup,
  ]);
}

async function createErpnextBuyLaunchGroup(
  profile: LocalErpnextBuyInstallationProfile,
): Promise<CapabilityRuntimeLaunchGroup> {
  const image = profile.material.imageReference;
  const serviceName = profile.launchGroup.serviceName;
  const projectName = profile.launchGroup.projectName;
  const composeDocument: Record<string, unknown> = {
    services: {
      [serviceName]: {
        image,
        ports: [
          `127.0.0.1:${profile.launchGroup.loopbackHostPort}:${profile.launchGroup.containerPort}`,
        ],
        ...(profile.launchGroup.volumes.length === 0 ? {} : {
          volumes: profile.launchGroup.volumes.map((volume) =>
            `${volume.id}:${volume.containerPath}${
              volume.access === "read-only" ? ":ro" : ""
            }`
          ),
        }),
      },
    },
    volumes: Object.fromEntries(
      profile.launchGroup.volumes.map((volume) => [volume.id, {}]),
    ),
  };
  const composeContent = deterministicJson(composeDocument);
  const compose = {
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content: composeContent,
    fingerprint: await fingerprintCapabilityRuntimeComposeContent(composeContent),
  };
  const digest = imageDigestFromPinnedReference(image);
  const body = {
    schemaVersion: "capability-runtime-launch-group/2.0" as const,
    id: profile.launchGroup.id,
    version: profile.launchGroup.version,
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName },
    materials: [{
      material: {
        unitId: profile.material.unitId,
        materialId: profile.material.materialId,
        imageDigest: digest,
      },
      serviceName,
      imageReference: image,
      ownership: [
        { key: "com.docker.compose.project", value: projectName },
        { key: "com.docker.compose.service", value: serviceName },
      ],
    }],
    compose,
    readiness: {
      kind: "mcp-tools-list" as const,
      timeoutMs: profile.launchGroup.readiness.timeoutMs,
      attemptTimeoutMs: profile.launchGroup.readiness.attemptTimeoutMs,
      retryIntervalMs: profile.launchGroup.readiness.retryIntervalMs,
    },
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots: profile.launchGroup.secretSlots.map((slot) => slot.id),
    security: profile.launchGroup.security,
  };
  return {
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  };
}

async function createErpnextBuyUnit(
  profile: LocalErpnextBuyInstallationProfile,
  launchGroup: CapabilityRuntimeLaunchGroup,
): Promise<AtomicCapabilityRuntimeUnit> {
  const material: AtomicCapabilityRuntimeMaterial = {
    id: profile.material.materialId,
    kind: "compose-service",
    imageReference: profile.material.imageReference,
    platforms: profile.material.platforms,
    lifecycle: "persistent",
    launchGroup: capabilityRuntimeLaunchGroupReference(launchGroup),
    effects: {
      downloadBytes: null,
      storageBytes: null,
      services: [{ id: profile.launchGroup.serviceName, lifecycle: "persistent" }],
      volumes: profile.launchGroup.volumes.map((volume) => ({
        id: volume.id,
        access: volume.access,
        preservation: volume.preservation,
      })),
      network: "loopback-only",
      loopbackPorts: [profile.launchGroup.loopbackHostPort],
      bindMounts: [],
      privileged: false,
      dockerSocket: false,
      devices: [],
      secretSlots: profile.launchGroup.secretSlots.map((slot) => slot.id),
      licence: {
        status: profile.licence.status,
        reference: profile.licence.reference,
      },
      security: profile.launchGroup.security,
    },
  };
  const id = profile.material.unitId;
  const version = profile.material.unitVersion;
  return {
    id,
    version,
    manifestFingerprint: await fingerprintAtomicCapabilityRuntimeUnit({
      id,
      version,
      materials: [material],
    }),
    materials: [material],
  };
}

function erpnextBuyBinding(
  profile: LocalErpnextBuyInstallationProfile,
  unit: AtomicCapabilityRuntimeUnit,
): QualifiedCapabilityRuntimeBinding {
  const source = ERPNEXT_BUY_RUNTIME_ADAPTER_SOURCE;
  return {
    id: ERPNEXT_BUY_RUNTIME_BINDING_ID,
    version: ERPNEXT_BUY_RUNTIME_BINDING_VERSION,
    capability: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY,
    use: "execution",
    qualification: "unqualified",
    adapter: {
      id: ERPNEXT_BUY_RUNTIME_ADAPTER_ID,
      version: ERPNEXT_BUY_RUNTIME_ADAPTER_VERSION,
      source,
    },
    profile: null,
    unitIds: [unit.id],
    qualificationEvidence: {
      id: `${ERPNEXT_BUY_RUNTIME_BINDING_ID}-qualification`,
      source,
      fingerprint: null,
    },
    runtimeModes: [],
    limitations: [
      "The binding captures exact commercial documents through locked erpnext_buy_capture; it does not create ERP documents, send an RFQ, or purchase anything.",
      "A fleet image tag or tools/list handshake is not qualification.",
      `Installed site ${profile.sourceInstance.siteId} is topology metadata only until an exact recorded qualification exists.`,
    ],
  };
}
