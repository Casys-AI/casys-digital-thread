/**
 * Production Buy ERP runtime composition.
 *
 * Missing installation metadata stays unresolved and emits zero MCP calls.
 * A future exact profile plus recorded qualification is sufficient without
 * editing this factory.
 */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  sameAuthorizedBindingIdentity,
  sameMaterialSet,
} from "../../application/control-plane/capability-runtime-binding-identity.ts";
import type { BuyQualifiedErpBindingResolver } from "../../application/ports/out/buy/buy-qualified-erp-binding.ts";
import type {
  BuyQualifiedErpBindingResolution,
  BuyQualifiedErpBindingResolveInput,
} from "../../application/ports/out/buy/buy-qualified-erp-binding.ts";
import type { ProjectCapabilityRuntimeContextReader } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeLeaseStore } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeLaunchGroupRegistry } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeSecretSnapshotResolver } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeLaunchGroup } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { CapabilityRuntimeBoundMcpClient } from "../../application/ports/out/capability/capability-runtime-connection.ts";
import { createLocalFixedCapabilityRuntimeConnection } from "../control-plane/local-fixed-capability-runtime-connection.ts";
import { UnavailableBuyQualifiedErpBindingResolver } from "./unavailable-buy-erp-binding.ts";
import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../domain/capability/engineering-capability.ts";
import {
  ERPNEXT_BUY_RUNTIME_BINDING_ID,
  type LocalErpnextBuyInstallationProfile,
} from "../control-plane/local-erpnext-buy-installation-profile.ts";
import type { ErpnextBuyRuntimeContribution } from "../control-plane/local-erpnext-buy-runtime-contribution.ts";
import { capabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";

export interface BuyErpRuntimeComposition {
  readonly bindings: BuyQualifiedErpBindingResolver;
  readonly capabilityRuntimeConnection: CapabilityRuntimeBoundMcpClient | undefined;
  readonly installation: LocalErpnextBuyInstallationProfile | undefined;
  readonly launchGroup: CapabilityRuntimeLaunchGroup | undefined;
  readonly secrets:
    | Pick<CapabilityRuntimeSecretSnapshotResolver, "beginSnapshot">
    | undefined;
}

export async function createBuyErpRuntimeComposition(options: {
  readonly contribution: ErpnextBuyRuntimeContribution | undefined;
  readonly contexts: ProjectCapabilityRuntimeContextReader;
  readonly launchGroups: CapabilityRuntimeLaunchGroupRegistry;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly secrets?: Pick<CapabilityRuntimeSecretSnapshotResolver, "beginSnapshot">;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}): Promise<BuyErpRuntimeComposition> {
  const fallback = new UnavailableBuyQualifiedErpBindingResolver();
  if (!options.contribution) {
    return {
      bindings: fallback,
      capabilityRuntimeConnection: undefined,
      installation: undefined,
      launchGroup: undefined,
      secrets: undefined,
    };
  }
  const launchGroup = await options.launchGroups.require(
    capabilityRuntimeLaunchGroupReference(options.contribution.launchGroup),
  );
  const connection = await createLocalFixedCapabilityRuntimeConnection({
    leases: options.leases,
    binding: {
      id: ERPNEXT_BUY_RUNTIME_BINDING_ID,
      version: options.contribution.binding.version,
    },
    launchGroup,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    bindings: new CapabilityRuntimeBuyQualifiedErpBindingResolver({
      contribution: options.contribution,
      contexts: options.contexts,
      fallback,
    }),
    capabilityRuntimeConnection: connection.boundClient(),
    installation: options.contribution.profile,
    launchGroup,
    secrets: options.secrets,
  };
}

export class CapabilityRuntimeBuyQualifiedErpBindingResolver
  implements BuyQualifiedErpBindingResolver {
  constructor(
    private readonly options: {
      readonly contribution: ErpnextBuyRuntimeContribution;
      readonly contexts: ProjectCapabilityRuntimeContextReader;
      readonly fallback: BuyQualifiedErpBindingResolver;
    },
  ) {}

  async resolve(
    input?: BuyQualifiedErpBindingResolveInput,
  ): Promise<BuyQualifiedErpBindingResolution> {
    if (!input?.project) {
      return {
        status: "unresolved",
        reason:
          "ERP Buy capture requires the current project to resolve authorization and the exact qualified binding.",
      };
    }
    const context = await this.options.contexts.read(input.project);
    const matches = context.catalog.bindings.filter((binding) =>
      binding.id === ERPNEXT_BUY_RUNTIME_BINDING_ID &&
      binding.capability.id === COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.id &&
      binding.capability.version ===
        COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.version &&
      binding.use === "execution"
    );
    if (matches.length !== 1) {
      return this.options.fallback.resolve();
    }
    const catalogBinding = matches[0]!;
    const expected = this.options.contribution.binding;
    const expectedUnit = this.options.contribution.unit;
    const units = context.catalog.units.filter((unit) => unit.id === expectedUnit.id);
    if (
      catalogBinding.id !== expected.id ||
      catalogBinding.version !== expected.version ||
      deterministicJson(catalogBinding.adapter) !==
        deterministicJson(expected.adapter) ||
      deterministicJson(catalogBinding.profile) !==
        deterministicJson(expected.profile) ||
      deterministicJson([...catalogBinding.unitIds].sort()) !==
        deterministicJson([...expected.unitIds].sort()) ||
      units.length !== 1 || units[0]!.version !== expectedUnit.version ||
      deterministicJson(units[0]!.manifestFingerprint) !==
        deterministicJson(expectedUnit.manifestFingerprint)
    ) {
      return {
        status: "unresolved",
        reason:
          "The qualified ERP Buy catalog binding does not match the exact installed contribution.",
      };
    }

    if (catalogBinding.qualification !== "qualified") {
      return {
        status: "unresolved",
        reason:
          `No qualified binding is registered for ${COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.id}@${COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.version}. ` +
          "A legacy fleet image tag or source version is not qualification. Capture remains unresolved and will not dispatch.",
      };
    }
    if (
      context.authorization?.status !== "authorized" ||
      context.authorization.projectId !== input.project.project.id
    ) {
      return {
        status: "unresolved",
        reason:
          "The current project is not authorized for the qualified ERP Buy runtime binding.",
      };
    }
    const capabilities = context.authorization.allowedCapabilities.filter((
      capability,
    ) =>
      capability.id === catalogBinding.capability.id &&
      capability.version === catalogBinding.capability.version &&
      capability.use === catalogBinding.use
    );
    if (capabilities.length !== 1 || capabilities[0]!.qualification !== "qualified") {
      return {
        status: "unresolved",
        reason:
          "The project capability authorization does not cover qualified ERP Buy execution.",
      };
    }
    const allowed = context.authorization.allowedBindings.filter((binding) =>
      binding.capability.id === catalogBinding.capability.id &&
      binding.capability.version === catalogBinding.capability.version &&
      binding.capability.use === catalogBinding.use
    );
    const authorizedUnits = context.authorization.allowedUnits.filter((unit) =>
      unit.id === expectedUnit.id
    );
    if (
      allowed.length !== 1 ||
      !sameAuthorizedBindingIdentity(allowed[0]!, {
        capability: {
          ...catalogBinding.capability,
          use: catalogBinding.use,
          minimumQualification: "qualified",
        },
        binding: { id: catalogBinding.id, version: catalogBinding.version },
        adapter: catalogBinding.adapter,
        profile: catalogBinding.profile,
      }) ||
      deterministicJson([...allowed[0]!.unitIds].sort()) !==
        deterministicJson([...expected.unitIds].sort()) ||
      !sameMaterialSet(
        allowed[0]!.materials,
        this.options.contribution.launchGroup.materials.map((member) =>
          member.material
        ),
      ) ||
      authorizedUnits.length !== 1 ||
      authorizedUnits[0]!.version !== expectedUnit.version ||
      deterministicJson(authorizedUnits[0]!.manifestFingerprint) !==
        deterministicJson(expectedUnit.manifestFingerprint)
    ) {
      return {
        status: "unresolved",
        reason:
          "The current project authorization does not include the exact qualified ERP Buy binding, units and material digests.",
      };
    }
    return {
      status: "qualified",
      binding: {
        capability: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY,
        qualification: "qualified",
        sourceInstance: this.options.contribution.profile.sourceInstance,
        adapter: {
          id: catalogBinding.adapter.id,
          version: catalogBinding.adapter.version,
        },
      },
    };
  }
}
