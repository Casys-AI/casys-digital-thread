/**
 * Electrical observation method-sheet plus admitted SPICE L4/L5 project
 * contributions. Distinct from mcp-spice and the LED-driver fiche.
 * Construction does not execute ngspice or load a provider.
 */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { PrepareProjectElectricalObservationMethodSheetSealReview } from "../../application/use-cases/electrical/observation-method-sheet/prepare-project-electrical-observation-method-sheet-seal-review.ts";
import { PrepareProjectAdmittedSpiceEvaluationReview } from "../../application/use-cases/electrical/spice/evaluation/prepare-project-admitted-spice-evaluation-review.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
} from "../shared/cas/file-capture-store.ts";
import { isolatedOutputCasObjectStore } from "../shared/cas/file-isolated-output-cas.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileElectricalObservationMethodSheetStore } from "./observation-method-sheet/file-electrical-observation-method-sheet-store.ts";
import { ProjectElectricalObservationMethodSheetBriefGateReader } from "./observation-method-sheet/project-electrical-observation-method-sheet-brief-gate-reader.ts";
import {
  type ElectricalObservationMethodSheetSealCaptureStore,
  VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
  VerifySealElectricalObservationMethodSheetRunExecutor,
} from "./observation-method-sheet/verify-seal-electrical-observation-method-sheet-run-executor.ts";
import { FileAdmittedSpiceObservationEvidenceReader } from "./spice/evaluation/file-admitted-spice-observation-evidence-reader.ts";
import { FileAdmittedSpiceObservationEvaluationCaptureStore } from "./spice/evaluation/file-admitted-spice-observation-evaluation-capture-store.ts";
import { PrepareProjectAdmittedSpiceEvaluationCloseoutReview } from "./spice/evaluation/prepare-project-admitted-spice-evaluation-closeout-review.ts";
import {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DecideAdmittedSpiceEvaluationRunExecutor,
} from "./spice/evaluation/decide-admitted-spice-evaluation-run-executor.ts";
import {
  VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
  VerifyEvaluateAdmittedSpiceObservationsRunExecutor,
} from "./spice/evaluation/verify-evaluate-admitted-spice-observations-run-executor.ts";
import type { AdmittedSpiceExecutionCaptureStore } from "./spice/admitted/run-executor.ts";

export {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
  VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
};

export interface ElectricalMethodSheetJoinOptions {
  readonly recordedAnalysisDirectory: string;
}

export interface ElectricalMethodSheetJoin {
  readonly electricalObservationMethodSheets: FileElectricalObservationMethodSheetStore;
  readonly electricalObservationMethodSheetSeals:
    ElectricalObservationMethodSheetSealCaptureStore;
}

export interface ElectricalProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly lease: EngineeringProjectRunLease;
  readonly recordedAnalysisDirectory: string;
  readonly methodSheets: ElectricalMethodSheetJoin;
  readonly spiceCaptures?: AdmittedSpiceExecutionCaptureStore;
}

export interface ElectricalProject {
  readonly electricalObservationMethodSheetSealReview:
    PrepareProjectElectricalObservationMethodSheetSealReview;
  readonly verifySealElectricalObservationMethodSheet:
    VerifySealElectricalObservationMethodSheetRunExecutor;
  readonly admittedSpiceEvaluationReview: PrepareProjectAdmittedSpiceEvaluationReview;
  readonly admittedSpiceEvaluationCloseoutReview:
    PrepareProjectAdmittedSpiceEvaluationCloseoutReview;
  readonly verifyEvaluateAdmittedSpiceObservations:
    VerifyEvaluateAdmittedSpiceObservationsRunExecutor;
  readonly decideAdmittedSpiceEvaluation: DecideAdmittedSpiceEvaluationRunExecutor;
}

export function createElectricalMethodSheetJoin(
  options: ElectricalMethodSheetJoinOptions,
): ElectricalMethodSheetJoin {
  const electricalObservationMethodSheets =
    new FileElectricalObservationMethodSheetStore(
      new FileCaptureStore({
        ...ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR,
        directory:
          `${options.recordedAnalysisDirectory}/electrical/observation-method-sheet-captures`,
      }),
    );
  const sealBytes = new FileByteStore({
    kind: "electrical-observation-method-sheet-seal-capture",
    directory:
      `${options.recordedAnalysisDirectory}/electrical/observation-method-sheet-seals`,
    uriNamespace: "electrical-observation-method-sheet-seal-capture",
    label: "Sealed electrical observation method sheet",
  });
  return {
    electricalObservationMethodSheets,
    electricalObservationMethodSheetSeals: fileTextCaptureStore(sealBytes),
  };
}

export function createAdmittedSpiceObservationEvidenceReader(
  recordedAnalysisDirectory: string,
): FileAdmittedSpiceObservationEvidenceReader {
  return new FileAdmittedSpiceObservationEvidenceReader(
    isolatedOutputCasObjectStore(
      `${recordedAnalysisDirectory}/electrical/spice/admitted/outputs`,
    ),
  );
}

export function createElectricalProject(
  options: ElectricalProjectOptions,
): ElectricalProject {
  const briefGates = new ProjectElectricalObservationMethodSheetBriefGateReader(
    options.projects,
  );
  const electricalObservationMethodSheetSealReview =
    new PrepareProjectElectricalObservationMethodSheetSealReview({
      projects: options.projects,
      snapshots: options.snapshots,
      sheets: options.methodSheets.electricalObservationMethodSheets,
      briefGates,
    });
  const verifySealElectricalObservationMethodSheet =
    new VerifySealElectricalObservationMethodSheetRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      sheets: options.methodSheets.electricalObservationMethodSheets,
      briefGates,
      captures: options.methodSheets.electricalObservationMethodSheetSeals,
      lease: options.lease,
    });
  const evidence = createAdmittedSpiceObservationEvidenceReader(
    options.recordedAnalysisDirectory,
  );
  const evaluationCaptures = new FileAdmittedSpiceObservationEvaluationCaptureStore(
    new FileCaptureStore({
      ...SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR,
      directory:
        `${options.recordedAnalysisDirectory}/electrical/spice/admitted-observation-evaluation-captures`,
    }),
  );
  const closeoutResolver = {
    sheets: options.methodSheets.electricalObservationMethodSheets,
    evaluationCaptures,
    sheetCaptures: options.methodSheets.electricalObservationMethodSheetSeals,
    spiceCaptures: options.spiceCaptures,
    evidence,
  };
  const admittedSpiceEvaluationReview = new PrepareProjectAdmittedSpiceEvaluationReview(
    {
      projects: options.projects,
      snapshots: options.snapshots,
      sheets: options.methodSheets.electricalObservationMethodSheets,
      sheetCaptures: options.methodSheets.electricalObservationMethodSheetSeals,
      evidence,
    },
  );
  const admittedSpiceEvaluationCloseoutReview =
    new PrepareProjectAdmittedSpiceEvaluationCloseoutReview({
      projects: options.projects,
      snapshots: options.snapshots,
      ...closeoutResolver,
    });
  const verifyEvaluateAdmittedSpiceObservations =
    new VerifyEvaluateAdmittedSpiceObservationsRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      sheets: options.methodSheets.electricalObservationMethodSheets,
      sheetCaptures: options.methodSheets.electricalObservationMethodSheetSeals,
      evidence,
      captures: evaluationCaptures,
      lease: options.lease,
    });
  const decideAdmittedSpiceEvaluation = new DecideAdmittedSpiceEvaluationRunExecutor({
    projects: options.projects,
    commands: options.commands,
    snapshots: options.snapshots,
    ...closeoutResolver,
    closeoutCaptures: new FileCaptureStore({
      ...SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
      directory:
        `${options.recordedAnalysisDirectory}/electrical/spice/admitted-observation-evaluation-closeout-captures`,
    }),
    lease: options.lease,
  });
  return {
    electricalObservationMethodSheetSealReview,
    verifySealElectricalObservationMethodSheet,
    admittedSpiceEvaluationReview,
    admittedSpiceEvaluationCloseoutReview,
    verifyEvaluateAdmittedSpiceObservations,
    decideAdmittedSpiceEvaluation,
  };
}
