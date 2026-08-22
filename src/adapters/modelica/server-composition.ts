/**
 * Qualified-kit and admitted Modelica capabilities plus project contributions.
 *
 * The kit and admitted paths stay distinct: different options, output roots,
 * captures, reviews, and executors. L4 evaluation requires an explicit SysON
 * URL. Construction does not execute OMC or load a provider.
 */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { PrepareProjectAdmittedModelicaRunReview } from "../../application/use-cases/modelica/admitted/prepare-run-review.ts";
import { ResolveProjectAdmittedModelicaRunReview } from "../../application/use-cases/modelica/admitted/resolve-run-review.ts";
import { PrepareProjectAdmittedModelicaEvaluationReview } from "../../application/use-cases/modelica/evaluation/prepare-project-admitted-modelica-evaluation-review.ts";
import { PrepareProjectAdmittedModelicaEvaluationCloseoutReview } from "./evaluation/prepare-project-admitted-modelica-evaluation-closeout-review.ts";
import { PrepareProjectModelicaQualifiedKitRunReview } from "../../application/use-cases/modelica/qualified-kit/prepare-run-review.ts";
import { ExecuteIsolatedModelicaRun } from "../../application/use-cases/modelica/qualified-kit/execute-isolated-run.ts";
import { PrepareProjectThermalMethodSheetSealReview } from "../../application/use-cases/modelica/thermal-method-sheet/prepare-project-thermal-method-sheet-seal-review.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import type { CaptureBackedTechnicalCompilationAdmissionReader } from "../compile/admission/capture-backed-technical-compilation-admission-reader.ts";
import type { CaptureBackedTechnicalCompilationBasisResolver } from "../compile/captures/technical-compilation-basis-resolver.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";
import {
  ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR,
  ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR,
} from "../shared/cas/file-capture-store.ts";
import {
  FileIsolatedOutputCas,
  isolatedOutputCasObjectStore,
} from "../shared/cas/file-isolated-output-cas.ts";
import { HttpMcpToolClient } from "../shared/mcp/http-mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import {
  type AdmittedModelicaExecutionComposition,
  type AdmittedModelicaExecutionServerOptions,
  createAdmittedModelicaExecutionComposition,
} from "./admitted/execution-composition.ts";
import { FileAdmittedModelicaExecutionAttemptStore } from "./admitted/file-execution-attempt-store.ts";
import {
  type AdmittedModelicaExecutionCaptureStore,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  SimulateRunAdmittedModelicaRunExecutor,
} from "./admitted/run-executor.ts";
import { FileAdmittedObservationEvidenceReader } from "./evaluation/file-admitted-observation-evidence-reader.ts";
import { FileAdmittedObservationEvaluationAttemptStore } from "./evaluation/file-admitted-observation-evaluation-attempt-store.ts";
import { FileAdmittedObservationEvaluationCaptureStore } from "./evaluation/file-admitted-observation-evaluation-capture-store.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DecideAdmittedModelicaEvaluationRunExecutor,
} from "./evaluation/decide-admitted-modelica-evaluation-run-executor.ts";
import {
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
  VerifyEvaluateAdmittedModelicaObservationsRunExecutor,
} from "./evaluation/verify-evaluate-admitted-modelica-observations-run-executor.ts";
import type { ModelicaIsolatedExecutionServerOptions } from "./qualified-kit/execution-composition.ts";
import type { ModelicaIsolatedExecutionComposition } from "./qualified-kit/execution-composition.ts";
import { CodeOwnedModelicaQualifiedKitBundleFactory } from "./qualified-kit/bundle-factory.ts";
import { FileModelicaIsolatedExecutionAttemptStore } from "./qualified-kit/attempt-store.ts";
import { FileModelicaIsolatedExecutionCaptureStore } from "./qualified-kit/isolated-execution-evidence.ts";
import {
  FileModelicaMicrosandboxQualificationStore,
  PublicationBackedModelicaMicrosandboxQualificationAuthority,
} from "./qualified-kit/microsandbox-qualification.ts";
import { ProjectThreadModelicaQualifiedKitReviewBasisAuthority } from "./qualified-kit/review-basis-authority.ts";
import {
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  SimulateRunQualifiedModelicaKitRunExecutor,
} from "./qualified-kit/run-executor.ts";
import { CaptureBackedThermalMethodSheetCompilationJoin } from "./thermal-method-sheet/capture-backed-thermal-method-sheet-compilation-join.ts";
import { FileThermalMethodSheetSourceCaptureReader } from "./thermal-method-sheet/file-thermal-method-sheet-source-capture-reader.ts";
import { FileThermalMethodSheetStore } from "./thermal-method-sheet/file-thermal-method-sheet-store.ts";
import {
  type ThermalMethodSheetSealCaptureStore,
  VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
  VerifySealModelicaThermalMethodSheetRunExecutor,
} from "./thermal-method-sheet/verify-seal-modelica-thermal-method-sheet-run-executor.ts";

export {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
  VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
};

export interface QualifiedModelicaCapabilityOptions {
  readonly modelicaIsolatedExecution?: ModelicaIsolatedExecutionServerOptions;
  readonly recordedAnalysisDirectory: string;
  readonly qualificationRoot: string;
  readonly qualificationCaptureFingerprint: ContentFingerprint;
}

export interface QualifiedModelicaCapability {
  readonly isolatedExecution: ModelicaIsolatedExecutionComposition | undefined;
  readonly qualificationAuthority:
    | PublicationBackedModelicaMicrosandboxQualificationAuthority
    | undefined;
  readonly executionCaptures: FileModelicaIsolatedExecutionCaptureStore | undefined;
}

export interface AdmittedModelicaCapabilityOptions {
  readonly admittedModelicaExecution?: AdmittedModelicaExecutionServerOptions;
  readonly recordedAnalysisDirectory: string;
}

export interface AdmittedModelicaCapability {
  readonly execution: AdmittedModelicaExecutionComposition | undefined;
  readonly captures: AdmittedModelicaExecutionCaptureStore;
}

export interface ModelicaThermalMethodSheetJoinOptions {
  readonly recordedAnalysisDirectory: string;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
}

export interface ModelicaThermalMethodSheetJoin {
  readonly thermalMethodSheets: FileThermalMethodSheetStore;
  readonly thermalMethodSheetSeals: ThermalMethodSheetSealCaptureStore;
  readonly thermalMethodSheetCompilationJoin:
    CaptureBackedThermalMethodSheetCompilationJoin;
}

export interface ModelicaProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly executionSnapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly planSnapshots: Pick<ThreadSnapshotStore, "get">;
  readonly lease: EngineeringProjectRunLease;
  readonly recordedAnalysisDirectory: string;
  readonly sysonMcpUrl?: string;
  readonly admissions: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly basisResolver: CaptureBackedTechnicalCompilationBasisResolver;
  readonly technicalSourceAnalysisCaptures: FileByteStore<
    "technical-source-analysis"
  >;
  readonly thermal: ModelicaThermalMethodSheetJoin;
  readonly qualified: QualifiedModelicaCapability;
  readonly admitted: AdmittedModelicaCapability;
}

export interface ModelicaProject {
  readonly thermalMethodSheetSealReview: PrepareProjectThermalMethodSheetSealReview;
  readonly verifySealModelicaThermalMethodSheet:
    VerifySealModelicaThermalMethodSheetRunExecutor;
  readonly admittedModelicaEvaluationReview:
    PrepareProjectAdmittedModelicaEvaluationReview;
  readonly admittedModelicaEvaluationCloseoutReview:
    PrepareProjectAdmittedModelicaEvaluationCloseoutReview;
  readonly verifyEvaluateAdmittedModelicaObservations:
    | VerifyEvaluateAdmittedModelicaObservationsRunExecutor
    | undefined;
  readonly decideAdmittedModelicaEvaluation:
    DecideAdmittedModelicaEvaluationRunExecutor;
  readonly modelicaQualifiedKitRunReview:
    | PrepareProjectModelicaQualifiedKitRunReview
    | undefined;
  readonly simulateRunQualifiedModelicaKit:
    | SimulateRunQualifiedModelicaKitRunExecutor
    | undefined;
  readonly admittedModelicaRunReview:
    | ResolveProjectAdmittedModelicaRunReview
    | undefined;
  readonly simulateRunAdmittedModelica:
    | SimulateRunAdmittedModelicaRunExecutor
    | undefined;
}

export async function createQualifiedModelicaCapability(
  options: QualifiedModelicaCapabilityOptions,
): Promise<QualifiedModelicaCapability> {
  const isolatedExecution = options.modelicaIsolatedExecution === undefined
    ? undefined
    : await (await import(
      "./qualified-kit/execution-composition.ts"
    )).createModelicaIsolatedExecutionComposition(
      options.modelicaIsolatedExecution,
      {
        outputCasDirectory:
          `${options.recordedAnalysisDirectory}/modelica/isolated-execution/outputs`,
      },
    );
  const qualificationAuthority = isolatedExecution === undefined
    ? undefined
    : new PublicationBackedModelicaMicrosandboxQualificationAuthority({
      store: new FileModelicaMicrosandboxQualificationStore(
        `${options.qualificationRoot}/captures`,
      ),
      publications: new FileIsolatedOutputCas(
        `${options.qualificationRoot}/outputs`,
      ),
      pinnedCaptureFingerprint: options.qualificationCaptureFingerprint,
    });
  const executionCaptures = isolatedExecution === undefined
    ? undefined
    : new FileModelicaIsolatedExecutionCaptureStore(
      `${options.recordedAnalysisDirectory}/modelica/isolated-execution/captures`,
    );
  return { isolatedExecution, qualificationAuthority, executionCaptures };
}

export async function createAdmittedModelicaCapability(
  options: AdmittedModelicaCapabilityOptions,
): Promise<AdmittedModelicaCapability> {
  const execution = options.admittedModelicaExecution === undefined
    ? undefined
    : await createAdmittedModelicaExecutionComposition(
      options.admittedModelicaExecution,
      {
        outputCasDirectory:
          `${options.recordedAnalysisDirectory}/modelica/admitted/outputs`,
      },
    );
  const captureBytes = new FileByteStore({
    kind: "modelica-admitted-execution-capture",
    directory: `${options.recordedAnalysisDirectory}/modelica/admitted/captures`,
    uriNamespace: "modelica-admitted-execution-capture",
    label: "Admitted Modelica execution capture",
  });
  const captures: AdmittedModelicaExecutionCaptureStore = {
    save: async (fingerprint, canonicalText) => {
      const stored = await captureBytes.save(
        fingerprint,
        new TextEncoder().encode(canonicalText),
      );
      return { uri: stored.uri, fingerprint: stored.fingerprint };
    },
    read: async (fingerprint) => {
      const stored = await captureBytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
    uriFor: (fingerprint) => captureBytes.uriFor(fingerprint),
  };
  return { execution, captures };
}

export function createModelicaThermalMethodSheetJoin(
  options: ModelicaThermalMethodSheetJoinOptions,
): ModelicaThermalMethodSheetJoin {
  const thermalMethodSheets = new FileThermalMethodSheetStore(
    new FileCaptureStore({
      ...THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR,
      directory:
        `${options.recordedAnalysisDirectory}/modelica/thermal-method-sheet-captures`,
    }),
  );
  const sealBytes = new FileByteStore({
    kind: "modelica-thermal-method-sheet-seal-capture",
    directory:
      `${options.recordedAnalysisDirectory}/modelica/thermal-method-sheet-seals`,
    uriNamespace: "modelica-thermal-method-sheet-seal-capture",
    label: "Sealed Modelica thermal method sheet",
  });
  const thermalMethodSheetSeals = fileTextCaptureStore(sealBytes);
  const thermalMethodSheetCompilationJoin =
    new CaptureBackedThermalMethodSheetCompilationJoin({
      snapshots: options.snapshots,
      captures: thermalMethodSheetSeals,
      sheets: thermalMethodSheets,
    });
  return {
    thermalMethodSheets,
    thermalMethodSheetSeals,
    thermalMethodSheetCompilationJoin,
  };
}

export function createAdmittedObservationEvidenceReader(
  recordedAnalysisDirectory: string,
): FileAdmittedObservationEvidenceReader {
  return new FileAdmittedObservationEvidenceReader(
    isolatedOutputCasObjectStore(
      `${recordedAnalysisDirectory}/modelica/admitted/outputs`,
    ),
  );
}

export function createModelicaProject(
  options: ModelicaProjectOptions,
): ModelicaProject {
  const sourceCaptures = new FileThermalMethodSheetSourceCaptureReader(
    options.technicalSourceAnalysisCaptures,
  );
  const thermalMethodSheetSealReview = new PrepareProjectThermalMethodSheetSealReview({
    sheets: options.thermal.thermalMethodSheets,
    sourceCaptures,
    basisResolver: options.basisResolver,
  });
  const verifySealModelicaThermalMethodSheet =
    new VerifySealModelicaThermalMethodSheetRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      sheets: options.thermal.thermalMethodSheets,
      sourceCaptures,
      basisResolver: options.basisResolver,
      captures: options.thermal.thermalMethodSheetSeals,
      lease: options.lease,
    });
  const admittedObservationEvidence = createAdmittedObservationEvidenceReader(
    options.recordedAnalysisDirectory,
  );
  const admittedObservationEvaluationCaptures =
    new FileAdmittedObservationEvaluationCaptureStore(
      new FileCaptureStore({
        ...ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR,
        directory:
          `${options.recordedAnalysisDirectory}/modelica/admitted-observation-evaluation-captures`,
      }),
    );
  const admittedModelicaEvaluationReview =
    new PrepareProjectAdmittedModelicaEvaluationReview({
      projects: options.projects,
      snapshots: options.snapshots,
      methodSheets: options.thermal.thermalMethodSheetCompilationJoin,
      evidence: admittedObservationEvidence,
      sourceCaptures,
    });
  const admittedModelicaEvaluationCloseoutReview =
    new PrepareProjectAdmittedModelicaEvaluationCloseoutReview({
      projects: options.projects,
      snapshots: options.snapshots,
      sheets: options.thermal.thermalMethodSheets,
      evaluationCaptures: admittedObservationEvaluationCaptures,
      sheetCaptures: options.thermal.thermalMethodSheetSeals,
    });
  const verifyEvaluateAdmittedModelicaObservations = options.sysonMcpUrl
    ? new VerifyEvaluateAdmittedModelicaObservationsRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      sheets: options.thermal.thermalMethodSheets,
      evidence: admittedObservationEvidence,
      sourceCaptures,
      captures: admittedObservationEvaluationCaptures,
      sheetCaptures: options.thermal.thermalMethodSheetSeals,
      attempts: new FileAdmittedObservationEvaluationAttemptStore(
        `${options.recordedAnalysisDirectory}/modelica/admitted-observation-evaluation-attempts`,
      ),
      syson: new HttpMcpToolClient({
        mcpUrl: options.sysonMcpUrl,
        timeoutMs: 30_000,
      }),
      lease: options.lease,
    })
    : undefined;
  const decideAdmittedModelicaEvaluation =
    new DecideAdmittedModelicaEvaluationRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      sheets: options.thermal.thermalMethodSheets,
      evaluationCaptures: admittedObservationEvaluationCaptures,
      sheetCaptures: options.thermal.thermalMethodSheetSeals,
      closeoutCaptures: new FileCaptureStore({
        ...ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
        directory:
          `${options.recordedAnalysisDirectory}/modelica/admitted-observation-evaluation-closeout-captures`,
      }),
      lease: options.lease,
    });
  const modelicaQualifiedKitRunReview =
    options.qualified.isolatedExecution === undefined ||
      options.qualified.qualificationAuthority === undefined
      ? undefined
      : new PrepareProjectModelicaQualifiedKitRunReview({
        basisAuthority: new ProjectThreadModelicaQualifiedKitReviewBasisAuthority(
          {
            projects: options.projects,
            snapshots: options.planSnapshots,
          },
        ),
        profiles: options.qualified.isolatedExecution.profiles,
        qualifications: options.qualified.qualificationAuthority,
        bundleFactory: new CodeOwnedModelicaQualifiedKitBundleFactory(),
      });
  const simulateRunQualifiedModelicaKit =
    options.qualified.isolatedExecution?.execution === undefined ||
      options.qualified.qualificationAuthority === undefined ||
      options.qualified.executionCaptures === undefined ||
      modelicaQualifiedKitRunReview === undefined
      ? undefined
      : new SimulateRunQualifiedModelicaKitRunExecutor({
        projects: options.projects,
        commands: options.commands,
        snapshots: options.executionSnapshots,
        review: modelicaQualifiedKitRunReview,
        execution: new ExecuteIsolatedModelicaRun({
          profiles: options.qualified.isolatedExecution.profiles,
          qualifications: options.qualified.qualificationAuthority,
          lease: options.lease,
          runner: options.qualified.isolatedExecution.execution.runner,
          recovery: options.qualified.isolatedExecution.execution.recovery,
          publications: options.qualified.isolatedExecution.execution.publications,
          attempts: new FileModelicaIsolatedExecutionAttemptStore(
            `${options.recordedAnalysisDirectory}/modelica/isolated-execution/attempts`,
          ),
          captures: options.qualified.executionCaptures,
        }),
        captures: options.qualified.executionCaptures,
        lease: options.lease,
      });
  const exactAdmittedModelicaRunReview = options.admitted.execution === undefined
    ? undefined
    : new PrepareProjectAdmittedModelicaRunReview({
      admissions: options.admissions,
      profiles: options.admitted.execution.profiles,
    });
  const admittedModelicaRunReview = exactAdmittedModelicaRunReview === undefined
    ? undefined
    : new ResolveProjectAdmittedModelicaRunReview({
      projects: options.projects,
      snapshots: options.executionSnapshots,
      admissions: options.admissions,
      exactReview: exactAdmittedModelicaRunReview,
    });
  const simulateRunAdmittedModelica =
    options.admitted.execution?.execution === undefined ||
      admittedModelicaRunReview === undefined
      ? undefined
      : new SimulateRunAdmittedModelicaRunExecutor({
        projects: options.projects,
        commands: options.commands,
        snapshots: options.executionSnapshots,
        admissions: options.admissions,
        profiles: options.admitted.execution.profiles,
        runner: options.admitted.execution.execution.runner,
        recovery: options.admitted.execution.execution.recovery,
        publications: options.admitted.execution.execution.publications,
        attempts: new FileAdmittedModelicaExecutionAttemptStore(
          `${options.recordedAnalysisDirectory}/modelica/admitted/attempts`,
        ),
        captures: options.admitted.captures,
        lease: options.lease,
      });
  return {
    thermalMethodSheetSealReview,
    verifySealModelicaThermalMethodSheet,
    admittedModelicaEvaluationReview,
    admittedModelicaEvaluationCloseoutReview,
    verifyEvaluateAdmittedModelicaObservations,
    decideAdmittedModelicaEvaluation,
    modelicaQualifiedKitRunReview,
    simulateRunQualifiedModelicaKit,
    admittedModelicaRunReview,
    simulateRunAdmittedModelica,
  };
}
