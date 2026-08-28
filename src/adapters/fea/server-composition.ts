/**
 * FEA foundation and project contributions.
 *
 * The historical proof CAS stays on its descriptor path. Moving it under
 * recorded-analysis/calculix/proof-cases would hide already sealed artifacts
 * from the isolated executor. Product `@3` is composed only when SysON and
 * the CalculiX runtime are both present.
 */

import type { CalculixIsolatedExecutionProfile } from "../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeExecutionSessionCoordinator } from "../../application/control-plane/capability-runtime-execution-session.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { PrepareProjectFeaIsolatedRunReview } from "../../application/use-cases/fea/isolated-v3/prepare-project-fea-isolated-run-review.ts";
import { PrepareProjectFeaProofSealReview } from "../../application/use-cases/fea/seal-case/prepare-project-fea-proof-seal-review.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { FileCanonicalAssetReader } from "../assets/canonical-asset-reader.ts";
import type { CaptureBackedTechnicalCompilationAdmissionReader } from "../compile/admission/capture-backed-technical-compilation-admission-reader.ts";
import type { CaptureBackedRunPlanSealer } from "../compile/plans/capture-backed-run-plan-sealer.ts";
import type { ResolvedOperationPlanResolver } from "../compile/plans/resolved-operation-plan-resolver.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import {
  EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  SENSITIVITY_CATALOG_OFFER_CAPTURE_DESCRIPTOR,
} from "../shared/cas/file-capture-store.ts";
import type { RecordedAnalysisCasReader } from "../compile/plans/recorded-analysis-cas-reader.ts";
import { HttpMcpToolClient } from "../shared/mcp/http-mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import type { CalculixIsolatedExecutionServerOptions } from "./isolated-v3/calculix-isolated-execution-composition.ts";
import type { CalculixIsolatedExecutionComposition } from "./isolated-v3/calculix-isolated-execution-composition.ts";
import { FileCalculixIsolatedProductAttemptStore } from "./isolated-v3/file-calculix-isolated-product-attempt-store.ts";
import { VerifyRunFeaStaticProofV3RunExecutor } from "./isolated-v3/verify-run-fea-static-proof-v3-run-executor.ts";
import { FileCalculixIsolatedExecutionEvidenceStore } from "./isolated-v3/calculix-isolated-execution-evidence.ts";
import { PrepareProjectEvaluationCloseoutReview } from "./evaluation-closeout/prepare-project-evaluation-closeout-review.ts";
import { DecideStaticMechanicalEvaluationCloseoutRunExecutor } from "./evaluation-closeout/decide-static-mechanical-evaluation-closeout-run-executor.ts";
import { CaptureBackedFeaProofSealRequirementsReviewer } from "./seal-case/capture-backed-fea-proof-seal-requirements-reviewer.ts";
import { FeaProofCaseSourceCaptureService } from "./seal-case/fea-proof-case-source-capture.ts";
import { PrepareProjectFeaProofCaseCapture } from "../../application/use-cases/fea/seal-case/prepare-project-fea-proof-case-capture.ts";
import type { ReopenAgentResource } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import {
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  VerifySealProofCaseRunExecutor,
} from "./seal-case/verify-seal-proof-case-run-executor.ts";

export { VERIFY_SEAL_PROOF_CASE_OPERATION };

export interface CalculixCapabilityOptions {
  readonly calculixIsolatedExecution?: CalculixIsolatedExecutionServerOptions;
  readonly recordedAnalysisDirectory: string;
}

export interface CalculixCapability {
  readonly isolatedExecution: CalculixIsolatedExecutionComposition | undefined;
  readonly localProfile: CalculixIsolatedExecutionProfile | undefined;
}

export interface FeaFoundation {
  readonly feaProofCaptures: FileCaptureStore<"fea-proof-case">;
  readonly sensitivityCatalogOfferCaptures: FileCaptureStore<
    "sensitivity-catalog-offer"
  >;
}

export interface FeaProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  readonly foundation: FeaFoundation;
  readonly requirementsCaptures: FileCaptureStore<"requirements-capture">;
  readonly seedCaptures: FileCaptureStore<"syson-model-seed">;
  readonly admissions: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly recordedPlanResolver: ResolvedOperationPlanResolver;
  readonly recordedRunPlans: CaptureBackedRunPlanSealer;
  readonly recordedAnalysisCas: RecordedAnalysisCasReader;
  readonly calculix: CalculixCapability;
  readonly sysonMcpUrl?: string;
  readonly recordedAnalysisDirectory: string;
  readonly canonicalAssetDirectory: string;
  readonly resources: ReopenAgentResource;
  /** Optional until the local capability supervisor is composed in Lot 4B. */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
}

export interface FeaProject {
  readonly feaProofCaseCapture: PrepareProjectFeaProofCaseCapture;
  readonly feaProofSealReview: PrepareProjectFeaProofSealReview;
  readonly feaIsolatedRunReview: PrepareProjectFeaIsolatedRunReview;
  readonly genericVerifySealProofCase: VerifySealProofCaseRunExecutor;
  readonly isolatedCalculixRun: VerifyRunFeaStaticProofV3RunExecutor | undefined;
  /** Provider-free human L5 review; it only reopens existing @3 evidence. */
  readonly staticMechanicalEvaluationCloseoutReview:
    PrepareProjectEvaluationCloseoutReview;
  /** Provider-free human L5 documentary Thread writer. */
  readonly decideStaticMechanicalEvaluationCloseout:
    DecideStaticMechanicalEvaluationCloseoutRunExecutor;
}

export async function createCalculixCapability(
  options: CalculixCapabilityOptions,
): Promise<CalculixCapability> {
  const isolatedExecution = options.calculixIsolatedExecution === undefined
    ? undefined
    : await (await import(
      "./isolated-v3/calculix-isolated-execution-composition.ts"
    )).createCalculixIsolatedExecutionComposition(
      options.calculixIsolatedExecution,
      {
        outputCasDirectory:
          `${options.recordedAnalysisDirectory}/calculix/isolated-execution/outputs`,
        attemptDirectory:
          `${options.recordedAnalysisDirectory}/calculix/isolated-execution/attempts`,
        evidenceDirectory:
          `${options.recordedAnalysisDirectory}/calculix/isolated-execution/evidence`,
        leaseDirectory:
          `${options.recordedAnalysisDirectory}/calculix/isolated-execution/leases`,
        durabilitySyncBoundary: options.recordedAnalysisDirectory,
      },
    );
  const localProfile = isolatedExecution === undefined
    ? undefined
    : await isolatedExecution.profiles.initial();
  return { isolatedExecution, localProfile };
}

export function createFeaFoundation(): FeaFoundation {
  // One historical proof CAS instance is deliberately shared by the seal,
  // isolated @3 run and ROP2 reader. Its descriptor owns the pre-existing
  // on-disk location; moving it beneath the recorded-analysis root would make
  // already sealed proof artifacts invisible to the isolated executor.
  const feaProofCaptures = new FileCaptureStore(
    FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  );
  // The ROP authority audit reopens this optional sidecar from the same
  // immutable store used by the proof-seal executor.
  const sensitivityCatalogOfferCaptures = new FileCaptureStore(
    SENSITIVITY_CATALOG_OFFER_CAPTURE_DESCRIPTOR,
  );
  return { feaProofCaptures, sensitivityCatalogOfferCaptures };
}

export function createFeaProject(options: FeaProjectOptions): FeaProject {
  const geometryCaptures = new FileCaptureStore(GEOMETRY_CAPTURE_DESCRIPTOR);
  const proofCaseSources = new FeaProofCaseSourceCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "fea-proof-case-source",
      directory: `${options.recordedAnalysisDirectory}/fea/proof-case-source`,
      uriNamespace: "fea-proof-case-source",
      label: "Captured mechanical proof-case source",
    }),
  });
  const proofSealRequirementsReviewer =
    new CaptureBackedFeaProofSealRequirementsReviewer({
      requirementsCaptures: options.requirementsCaptures,
      seedCaptures: options.seedCaptures,
    });
  const feaProofStepAssets = new FileCanonicalAssetReader({
    directory: options.canonicalAssetDirectory,
  });
  // These stores reopen existing FEA @3 evidence. They are composed even when
  // no CalculiX/SysON runtime is configured because human closeout itself is
  // provider-free and must never turn configuration absence into a new
  // authority path.
  const closeoutExecutionEvidence = new FileCalculixIsolatedExecutionEvidenceStore(
    `${options.recordedAnalysisDirectory}/calculix/isolated-execution/evidence`,
    options.recordedAnalysisDirectory,
  );
  const sysonEvaluationCaptures = new FileByteStore({
    kind: "calculix-isolated-syson-evaluation",
    directory:
      `${options.recordedAnalysisDirectory}/calculix/isolated-execution/syson-evaluations`,
    uriNamespace: "calculix-isolated-syson-evaluation",
    label: "Isolated CalculiX SysON evaluation",
  });
  const closeoutCaptures = new FileCaptureStore({
    ...EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
    directory:
      `${options.recordedAnalysisDirectory}/calculix/evaluation-closeout-captures`,
    syncBoundary: options.recordedAnalysisDirectory,
  });
  const feaProofCaseCapture = new PrepareProjectFeaProofCaseCapture({
    captures: proofCaseSources,
    resources: options.resources,
  });
  const feaProofSealReview = new PrepareProjectFeaProofSealReview({
    snapshots: options.snapshots,
    projects: options.projects,
    proofCaseSources,
    requirementsReviewer: proofSealRequirementsReviewer,
    geometryCaptures,
    stepAssets: feaProofStepAssets,
    admissions: options.admissions,
  });
  const feaIsolatedRunReview = new PrepareProjectFeaIsolatedRunReview({
    snapshots: options.snapshots,
    admissionReviewer: options.recordedPlanResolver,
    projects: options.projects,
  });
  const genericVerifySealProofCase = new VerifySealProofCaseRunExecutor({
    projects: options.projects,
    commands: options.commands,
    snapshots: options.snapshots,
    proofCaseCaptures: options.foundation.feaProofCaptures,
    sensitivityCatalogOffers: options.foundation.sensitivityCatalogOfferCaptures,
    admissions: options.admissions,
    geometryCaptures,
    requirementsCaptures: options.requirementsCaptures,
    seedCaptures: options.seedCaptures,
    canonicalAssetReader: feaProofStepAssets,
    proofCaseSources,
    lease: options.lease,
  });
  const staticMechanicalEvaluationCloseoutReview =
    new PrepareProjectEvaluationCloseoutReview({
      projects: options.projects,
      snapshots: options.snapshots,
      artifacts: options.recordedAnalysisCas,
      canonicalAssets: feaProofStepAssets,
      executionEvidence: closeoutExecutionEvidence,
      evaluationCaptures: sysonEvaluationCaptures,
    });
  const decideStaticMechanicalEvaluationCloseout =
    new DecideStaticMechanicalEvaluationCloseoutRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      artifacts: options.recordedAnalysisCas,
      canonicalAssets: feaProofStepAssets,
      executionEvidence: closeoutExecutionEvidence,
      evaluationCaptures: sysonEvaluationCaptures,
      closeoutCaptures,
      lease: options.lease,
    });
  const isolatedCalculixRun = options.sysonMcpUrl &&
      options.calculix.isolatedExecution?.execution
    ? new VerifyRunFeaStaticProofV3RunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      plans: options.recordedRunPlans,
      artifacts: options.recordedAnalysisCas,
      canonicalAssets: new FileCanonicalAssetReader({
        directory: options.canonicalAssetDirectory,
      }),
      profiles: options.calculix.isolatedExecution.profiles,
      executeIsolated: options.calculix.isolatedExecution.execution.execute,
      executionEvidence: options.calculix.isolatedExecution.execution.evidence,
      sysonEvaluationCaptureStore: sysonEvaluationCaptures,
      attempts: new FileCalculixIsolatedProductAttemptStore(
        `${options.recordedAnalysisDirectory}/calculix/isolated-execution/product-attempts`,
        options.recordedAnalysisDirectory,
      ),
      syson: new HttpMcpToolClient({
        mcpUrl: options.sysonMcpUrl,
        timeoutMs: 30_000,
      }),
      lease: options.lease,
      capabilityRuntime: options.capabilityRuntime,
      capabilityRuntimeSession: options.capabilityRuntimeSession,
    })
    : undefined;
  return {
    feaProofCaseCapture,
    feaProofSealReview,
    feaIsolatedRunReview,
    genericVerifySealProofCase,
    isolatedCalculixRun,
    staticMechanicalEvaluationCloseoutReview,
    decideStaticMechanicalEvaluationCloseout,
  };
}
