/**
 * Admitted SPICE operating-point capability plus project contributions.
 *
 * Distinct from mcp-spice and from the LED-driver human fiche. Construction
 * does not execute ngspice or load a provider.
 */

import type { EngineeringProjectRevisionStore } from "../../../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandService } from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import { PrepareProjectAdmittedSpiceRunReview } from "../../../../application/use-cases/electrical/spice/admitted/prepare-run-review.ts";
import { ResolveProjectAdmittedSpiceRunReview } from "../../../../application/use-cases/electrical/spice/admitted/resolve-run-review.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import type { CaptureBackedTechnicalCompilationAdmissionReader } from "../../../compile/admission/capture-backed-technical-compilation-admission-reader.ts";
import { FileByteStore } from "../../../shared/cas/file-byte-store.ts";
import type { EngineeringProjectRunLease } from "../../../shared/stores/file-engineering-project-run-lease.ts";
import {
  type AdmittedSpiceExecutionComposition,
  type AdmittedSpiceExecutionServerOptions,
  createAdmittedSpiceExecutionComposition,
} from "./execution-composition.ts";
import { FileAdmittedSpiceExecutionAttemptStore } from "./file-execution-attempt-store.ts";
import {
  type AdmittedSpiceExecutionCaptureStore,
  SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  SimulateRunAdmittedSpiceRunExecutor,
} from "./run-executor.ts";

export { SIMULATE_RUN_ADMITTED_SPICE_OPERATION };

export interface AdmittedSpiceCapabilityOptions {
  readonly admittedSpiceExecution?: AdmittedSpiceExecutionServerOptions;
  readonly recordedAnalysisDirectory: string;
}

export interface AdmittedSpiceCapability {
  readonly execution: AdmittedSpiceExecutionComposition | undefined;
  readonly captures: AdmittedSpiceExecutionCaptureStore;
}

export interface AdmittedSpiceProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly lease: EngineeringProjectRunLease;
  readonly recordedAnalysisDirectory: string;
  readonly admissions: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly admitted: AdmittedSpiceCapability;
}

export interface AdmittedSpiceProject {
  readonly admittedSpiceRunReview:
    | ResolveProjectAdmittedSpiceRunReview
    | undefined;
  readonly simulateRunAdmittedSpice:
    | SimulateRunAdmittedSpiceRunExecutor
    | undefined;
}

export async function createAdmittedSpiceCapability(
  options: AdmittedSpiceCapabilityOptions,
): Promise<AdmittedSpiceCapability> {
  const execution = options.admittedSpiceExecution === undefined
    ? undefined
    : await createAdmittedSpiceExecutionComposition(
      options.admittedSpiceExecution,
      {
        outputCasDirectory:
          `${options.recordedAnalysisDirectory}/electrical/spice/admitted/outputs`,
      },
    );
  const captureBytes = new FileByteStore({
    kind: "spice-admitted-execution-capture",
    directory:
      `${options.recordedAnalysisDirectory}/electrical/spice/admitted/captures`,
    uriNamespace: "spice-admitted-execution-capture",
    label: "Admitted SPICE execution capture",
  });
  const captures: AdmittedSpiceExecutionCaptureStore = {
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

export function createAdmittedSpiceProject(
  options: AdmittedSpiceProjectOptions,
): AdmittedSpiceProject {
  const exactAdmittedSpiceRunReview = options.admitted.execution === undefined
    ? undefined
    : new PrepareProjectAdmittedSpiceRunReview({
      admissions: options.admissions,
      profiles: options.admitted.execution.profiles,
    });
  const admittedSpiceRunReview = exactAdmittedSpiceRunReview === undefined
    ? undefined
    : new ResolveProjectAdmittedSpiceRunReview({
      projects: options.projects,
      snapshots: options.snapshots,
      admissions: options.admissions,
      exactReview: exactAdmittedSpiceRunReview,
    });
  const simulateRunAdmittedSpice =
    options.admitted.execution?.execution === undefined ||
      admittedSpiceRunReview === undefined
      ? undefined
      : new SimulateRunAdmittedSpiceRunExecutor({
        projects: options.projects,
        commands: options.commands,
        snapshots: options.snapshots,
        admissions: options.admissions,
        profiles: options.admitted.execution.profiles,
        runner: options.admitted.execution.execution.runner,
        recovery: options.admitted.execution.execution.recovery,
        publications: options.admitted.execution.execution.publications,
        attempts: new FileAdmittedSpiceExecutionAttemptStore(
          `${options.recordedAnalysisDirectory}/electrical/spice/admitted/attempts`,
        ),
        captures: options.admitted.captures,
        lease: options.lease,
      });
  return {
    admittedSpiceRunReview,
    simulateRunAdmittedSpice,
  };
}
