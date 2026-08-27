import type { EngineeringWorkbenchBaseSnapshot } from "./evidence.ts";
import type { LiveThreadGraphState } from "./live-overlay.ts";

export interface EngineeringDocumentaryWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "documentary";
  readonly documentary: {
    readonly status: "recorded";
    readonly message: string;
    readonly record: {
      readonly origin: "approved-brief";
      readonly snapshotId: string;
      readonly snapshotRevision: number;
      readonly artifactId: string;
      readonly label: string;
      readonly fingerprint: string;
      readonly uri?: string;
      readonly recordedAt: string;
    };
    readonly technicalEvidence: {
      readonly status: "not-recorded";
      readonly message: string;
    };
    readonly technicalStart?: EngineeringDocumentaryTechnicalStart;
  };
}

export type EngineeringDocumentaryTechnicalStartState =
  | "queued"
  | "running"
  | "publishing"
  | "failed";

export interface EngineeringDocumentaryTechnicalStart {
  readonly kind: "sysml-container-seed";
  readonly state: EngineeringDocumentaryTechnicalStartState;
  readonly message: string;
  readonly activity: {
    readonly version: number;
    readonly steps: readonly EngineeringDocumentaryTechnicalStartStep[];
  };
}

export interface EngineeringDocumentaryTechnicalStartStep {
  readonly id: "project-container" | "sysml-document" | "root-package";
  readonly state: LiveThreadGraphState;
  readonly label: string;
  readonly summary: string;
  readonly recordedAt: string;
  readonly predecessor?: "project-container" | "sysml-document";
}
