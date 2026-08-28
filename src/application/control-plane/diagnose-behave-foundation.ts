import {
  BEHAVE_FOUNDATION_DOCTOR_SCHEMA_VERSION,
  type BehaveFoundationDoctorReport,
  type BehaveFoundationHostObservation,
} from "./read-model/behave-foundation-doctor.ts";
import type { BehaveFoundationCapabilityCensus } from "./read-model/behave-foundation-census.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import { planCapabilityPackInstallation } from "./plan-capability-pack-installation.ts";

/** Join reviewed repository intent with fresh host observations without mutation. */
export function diagnoseBehaveFoundation(
  census: BehaveFoundationCapabilityCensus,
  host: BehaveFoundationHostObservation,
): BehaveFoundationDoctorReport {
  const installationPlan = census.candidateManifest !== null && host.platform !== null
    ? planCapabilityPackInstallation(census.candidateManifest, {
      platform: host.platform,
      images: host.images,
    })
    : null;
  const status = census.status === "blocked" || host.blockers.length > 0 ||
      installationPlan === null
    ? "blocked" as const
    : installationPlan.status;
  const evidenceLevel = census.status === "candidate-ready" &&
      installationPlan?.status === "ready" &&
      hasExactCachedMaterialSet(census, host)
    ? "cached-exact" as const
    : "declared" as const;
  return deepFreeze({
    schemaVersion: BEHAVE_FOUNDATION_DOCTOR_SCHEMA_VERSION,
    mutatesRuntime: false,
    status,
    evidenceLevel,
    verticalQualification: "not-observed" as const,
    census,
    host,
    installationPlan,
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
