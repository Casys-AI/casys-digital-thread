/**
 * ROP resolver and capture-backed sealer composition.
 *
 * The proof, requirements, and catalog-offer stores are injected so the
 * composition root can keep one historical CAS instance for seal, isolated
 * @3, sensitivity, and plan inspection. This module never constructs a
 * second proof or requirements store.
 */

import type { CalculixIsolatedExecutionProfile } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import { FileCanonicalAssetReader } from "../../assets/canonical-asset-reader.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { RecordedAnalysisCasReader } from "./recorded-analysis-cas-reader.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { CaptureBackedTechnicalCompilationAdmissionReader } from "../admission/capture-backed-technical-compilation-admission-reader.ts";
import type { ExactThreadSnapshotReader } from "../../shared/stores/engineering-thread-snapshot-resolver.ts";
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
  readonly admissions: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly calculixLocalProfile?: CalculixIsolatedExecutionProfile;
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
    ],
  });
  const recordedPlanResolver = new ResolvedOperationPlanResolver({
    snapshots: options.snapshots,
    artifacts: recordedAnalysisCas,
    admissions: options.admissions,
    stepAssets: new FileCanonicalAssetReader({
      directory: options.canonicalAssetDirectory,
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
