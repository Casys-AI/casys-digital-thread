/**
 * ROP resolver and capture-backed sealer composition.
 *
 * The proof, requirements, and catalog-offer stores are injected so the
 * composition root can keep one historical CAS instance for seal, isolated
 * @3, sensitivity, and plan inspection. This module never constructs a
 * second proof or requirements store.
 */

import type { CalculixIsolatedExecutionProfile } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import type { AdmittedSpiceExecutionProfileCatalog } from "../../../application/ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
import type { AdmittedModelicaExecutionProfileCatalog } from "../../../application/ports/out/modelica/admitted-execution-profile-catalog.ts";
import { FileCanonicalAssetReader } from "../../assets/canonical-asset-reader.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { RecordedAnalysisCasReader } from "./recorded-analysis-cas-reader.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { CaptureBackedTechnicalCompilationAdmissionReader } from "../admission/capture-backed-technical-compilation-admission-reader.ts";
import type { ExactThreadSnapshotReader } from "../../shared/stores/engineering-thread-snapshot-resolver.ts";
import type { PrescribedKinematicsCaptureStore } from "../../../application/ports/out/mechanics/prescribed-kinematics-capture-store.ts";
import {
  CaptureBackedRunPlanSealer,
  RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
} from "./capture-backed-run-plan-sealer.ts";
import { ResolvedOperationPlanResolver } from "./resolved-operation-plan-resolver.ts";

export interface RecordedOperationPlanCompositionOptions {
  readonly snapshots: ExactThreadSnapshotReader;
  readonly feaProofCaptures: FileCaptureStore<"fea-proof-case">;
  readonly sensitivityCatalogOfferCaptures: FileCaptureStore<
    "sensitivity-catalog-offer"
  >;
  readonly requirementsCaptures: FileCaptureStore<"requirements-capture">;
  /** Exact bytes sealed by compile.seal-admission@3; not a document reconstruction. */
  readonly technicalCompilationAdmissionCaptureBytes: FileByteStore<
    "technical-compilation-admission-capture"
  >;
  readonly admissions: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly calculixLocalProfile?: CalculixIsolatedExecutionProfile;
  /** Exact server-composed catalogue for the registered admitted Modelica run. */
  readonly admittedModelicaProfiles?: Pick<
    AdmittedModelicaExecutionProfileCatalog,
    "initial"
  >;
  /** Exact server-composed catalogue for the registered admitted SPICE run. */
  readonly admittedSpiceProfiles?: Pick<
    AdmittedSpiceExecutionProfileCatalog,
    "initial"
  >;
  /** Exact capture lane consumed only by the closed prescribed-kinematics ROP. */
  readonly prescribedKinematicsCaptures?: Pick<
    PrescribedKinematicsCaptureStore,
    "readCase"
  >;
  readonly recordedAnalysisDirectory: string;
  readonly canonicalAssetDirectory: string;
}

export interface RecordedOperationPlanComposition {
  readonly recordedAnalysisCas: RecordedAnalysisCasReader;
  readonly recordedPlanResolver: ResolvedOperationPlanResolver;
  readonly recordedRunPlans: CaptureBackedRunPlanSealer;
}

export function recordedPlanCalculixBinding(
  localProfile: CalculixIsolatedExecutionProfile | undefined,
): {
  readonly calculix?: {
    readonly localProfile: CalculixIsolatedExecutionProfile;
  };
} {
  return localProfile === undefined ? {} : { calculix: { localProfile } };
}

export function createRecordedOperationPlanComposition(
  options: RecordedOperationPlanCompositionOptions,
): RecordedOperationPlanComposition {
  const recordedAnalysisCas = new RecordedAnalysisCasReader({
    stores: [
      {
        namespace: "fea-proof-case-capture",
        storage: "text",
        store: options.feaProofCaptures,
      },
      {
        namespace: "sensitivity-catalog-offer-capture",
        storage: "text",
        store: options.sensitivityCatalogOfferCaptures,
      },
      {
        namespace: "requirements-capture",
        storage: "text",
        store: options.requirementsCaptures,
      },
      {
        namespace: "technical-compilation-admission-capture",
        storage: "bytes",
        store: options.technicalCompilationAdmissionCaptureBytes,
      },
    ],
  });
  const recordedPlanResolver = new ResolvedOperationPlanResolver({
    snapshots: options.snapshots,
    artifacts: recordedAnalysisCas,
    admissions: options.admissions,
    stepAssets: new FileCanonicalAssetReader({
      directory: options.canonicalAssetDirectory,
    }),
    ...(options.prescribedKinematicsCaptures === undefined ? {} : {
      prescribedKinematics: { captures: options.prescribedKinematicsCaptures },
    }),
    ...(options.admittedModelicaProfiles === undefined ? {} : {
      admittedModelica: { profiles: options.admittedModelicaProfiles },
    }),
    ...(options.admittedSpiceProfiles === undefined ? {} : {
      admittedSpice: { profiles: options.admittedSpiceProfiles },
    }),
    ...recordedPlanCalculixBinding(options.calculixLocalProfile),
  });
  const recordedRunPlans = new CaptureBackedRunPlanSealer({
    store: new FileByteStore({
      ...RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
      directory: `${options.recordedAnalysisDirectory}/resolved-operation-plans`,
    }),
    resolver: recordedPlanResolver,
  });
  return { recordedAnalysisCas, recordedPlanResolver, recordedRunPlans };
}
