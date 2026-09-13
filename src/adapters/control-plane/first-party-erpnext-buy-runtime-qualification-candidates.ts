/** Closed ERP Buy qualification candidate joined from catalog, profile and fixture. */

import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../domain/capability/engineering-capability.ts";
import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { CapabilityRuntimeLaunchGroup } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { CapabilityRuntimeAttestableQualificationCandidate } from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { BuySourceInstance } from "../../domain/buy/buy-source-capture.ts";
import type { BuyDocumentRequest } from "../../domain/buy/buy-proposal.ts";
import {
  ERPNEXT_BUY_RUNTIME_ADAPTER_ID,
  ERPNEXT_BUY_RUNTIME_ADAPTER_SOURCE,
  ERPNEXT_BUY_RUNTIME_ADAPTER_VERSION,
  ERPNEXT_BUY_RUNTIME_BINDING_ID,
  ERPNEXT_BUY_RUNTIME_BINDING_VERSION,
  imageDigestFromPinnedReference,
  type LocalErpnextBuyInstallationProfile,
} from "./local-erpnext-buy-installation-profile.ts";
import {
  fingerprintLocalErpnextBuyQualificationFixture,
  type LocalErpnextBuyQualificationFixture,
} from "./local-erpnext-buy-qualification-fixture.ts";

export const ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_ID =
  "erpnext-buy-source-v1" as const;
export const ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA =
  "erpnext-buy-runtime-qualification-candidate/1.0" as const;

export interface ErpnextBuyRuntimeQualificationCandidate
  extends CapabilityRuntimeAttestableQualificationCandidate {
  readonly schemaVersion: typeof ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA;
  readonly kind: "erpnext-buy-source";
  readonly id: typeof ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_ID;
  readonly version: "1";
  readonly installedSourceInstance: BuySourceInstance;
  readonly fixture: {
    readonly id: string;
    readonly documents: readonly BuyDocumentRequest[];
    readonly sourceFingerprint: ContentFingerprint;
  };
}

export async function createErpnextBuyRuntimeQualificationCandidates(input: {
  readonly catalog: CapabilityRuntimeCatalog;
  readonly launchGroup: CapabilityRuntimeLaunchGroup;
  readonly profile: LocalErpnextBuyInstallationProfile;
  readonly fixture: LocalErpnextBuyQualificationFixture;
}): Promise<readonly ErpnextBuyRuntimeQualificationCandidate[]> {
  const binding = exactlyOne(
    input.catalog.bindings.filter((value) =>
      value.id === ERPNEXT_BUY_RUNTIME_BINDING_ID
    ),
    "ERP Buy runtime binding",
  );
  const unit = exactlyOne(
    input.catalog.units.filter((value) => value.id === input.profile.material.unitId),
    "ERP Buy runtime unit",
  );
  const material = exactlyOne(unit.materials, "ERP Buy runtime material");
  const expectedDigest = imageDigestFromPinnedReference(
    input.profile.material.imageReference,
  );
  const launchGroup = capabilityRuntimeLaunchGroupReference(input.launchGroup);
  if (
    binding.version !== ERPNEXT_BUY_RUNTIME_BINDING_VERSION ||
    binding.capability.id !== COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.id ||
    binding.capability.version !==
      COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.version ||
    binding.use !== "execution" ||
    binding.qualification !== "unqualified" ||
    binding.adapter.id !== ERPNEXT_BUY_RUNTIME_ADAPTER_ID ||
    binding.adapter.version !== ERPNEXT_BUY_RUNTIME_ADAPTER_VERSION ||
    binding.adapter.source !== ERPNEXT_BUY_RUNTIME_ADAPTER_SOURCE ||
    binding.profile !== null ||
    binding.unitIds.length !== 1 || binding.unitIds[0] !== unit.id ||
    unit.version !== input.profile.material.unitVersion ||
    material.id !== input.profile.material.materialId ||
    material.imageReference !== input.profile.material.imageReference ||
    launchGroup.id !== input.profile.launchGroup.id ||
    launchGroup.version !== input.profile.launchGroup.version
  ) {
    throw new TypeError("The ERP Buy qualification candidate drifted.");
  }
  const sourceFingerprint = await fingerprintLocalErpnextBuyQualificationFixture(
    input.fixture,
  );
  const body = {
    schemaVersion: ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA,
    kind: "erpnext-buy-source" as const,
    id: ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_ID,
    version: "1" as const,
    binding: { id: binding.id, version: binding.version } as const,
    selector: {
      capability: {
        id: binding.capability.id,
        version: binding.capability.version,
      },
      use: binding.use,
    } as const,
    contract: binding.adapter,
    profile: null,
    unit: {
      id: unit.id,
      version: unit.version,
      manifestFingerprint: unit.manifestFingerprint,
    } as const,
    material: {
      unitId: unit.id,
      materialId: material.id,
      imageDigest: expectedDigest,
    } as const,
    launchGroup,
    observedHostPlatform: input.profile.qualificationHost.observedHostPlatform,
    targetPlatform: input.profile.qualificationHost.targetPlatform,
    mode: input.profile.qualificationHost.mode,
    installedSourceInstance: input.profile.sourceInstance,
    fixture: {
      id: input.fixture.id,
      documents: input.fixture.documents,
      sourceFingerprint,
    },
  };
  return Object.freeze([
    deepFreeze({
      ...body,
      fingerprint: await sha256Fingerprint(body),
    }) as ErpnextBuyRuntimeQualificationCandidate,
  ]);
}

export function validateErpnextBuyRuntimeQualificationCandidate(
  value: unknown,
  expected: ErpnextBuyRuntimeQualificationCandidate,
): ErpnextBuyRuntimeQualificationCandidate {
  if (deterministicJson(value) !== deterministicJson(expected)) {
    throw new TypeError("ERP Buy runtime qualification candidate is not canonical.");
  }
  return expected;
}

function exactlyOne<T>(values: readonly T[], label: string): T {
  if (values.length !== 1 || values[0] === undefined) {
    throw new TypeError(`${label} must resolve exactly once.`);
  }
  return values[0];
}
