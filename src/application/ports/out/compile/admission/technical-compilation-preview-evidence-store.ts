import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { ProjectTechnicalCompilationPreviewResult } from "../../../in/compile/admission/project-technical-compilation-preview.ts";

export const TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA =
  "technical-compilation-preview-evidence-reference/1.0" as const;
export interface TechnicalCompilationPreviewEvidenceReference {
  readonly schemaVersion:
    typeof TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA;
  readonly projectId: string;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
}
export interface TechnicalCompilationPreviewEvidence {
  readonly schemaVersion: "technical-compilation-preview-evidence/1.0";
  readonly projectId: string;
  readonly result: ProjectTechnicalCompilationPreviewResult;
}
export interface TechnicalCompilationPreviewEvidenceStore {
  save(
    evidence: TechnicalCompilationPreviewEvidence,
  ): Promise<TechnicalCompilationPreviewEvidenceReference>;
  read(
    reference: TechnicalCompilationPreviewEvidenceReference,
  ): Promise<TechnicalCompilationPreviewEvidence | undefined>;
  saveCursor(
    value: {
      readonly projectId: string;
      readonly fingerprint: string;
      readonly section: string;
      readonly offset: number;
    },
  ): Promise<string>;
  readCursor(
    cursor: string,
  ): Promise<
    {
      readonly projectId: string;
      readonly fingerprint: string;
      readonly section: string;
      readonly offset: number;
    } | undefined
  >;
}
