import type {
  TechnicalCompilationDraftReference,
} from "./technical-compilation-draft-store.ts";
import type { TechnicalCompilationDocument } from "../../../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
  type TechnicalCompilationAdmission,
} from "../../../../../domain/compile/admission/technical-compilation-proposal.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";

/** Exact Thread identity of one sealed compilation-admission artefact. */
export interface TechnicalCompilationAdmissionReadRequest {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

/**
 * Adapter-neutral shape of the immutable admission capture.
 *
 * Storage locators and host paths deliberately do not cross this port. The
 * returned value is the validated evidence document itself.
 */
export interface ReopenedTechnicalCompilationAdmission {
  readonly schemaVersion: typeof TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA;
  readonly operation: typeof COMPILE_SEAL_ADMISSION_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly draftReference: TechnicalCompilationDraftReference;
  readonly admission: TechnicalCompilationAdmission;
  readonly document: TechnicalCompilationDocument;
}

/** Reopens one exact, fresh, capture-backed Thread admission. */
export interface TechnicalCompilationAdmissionReader {
  read(
    request: TechnicalCompilationAdmissionReadRequest,
  ): Promise<ReopenedTechnicalCompilationAdmission | undefined>;
}
