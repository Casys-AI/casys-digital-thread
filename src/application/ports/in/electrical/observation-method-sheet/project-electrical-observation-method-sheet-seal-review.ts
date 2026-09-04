/**
 * Inward port for preparing the human review of one electrical observation
 * method-sheet seal.
 *
 * The caller first names only the project to read the exact current L3
 * authoring basis, then names that project plus one content-addressed sheet for
 * seal review. Provider tools and ngspice stay behind server-owned recross.
 * This grants no MRTR, admission or evaluation authority.
 */

import type { ElectricalObservationMethodSheetSealAdmission } from "../../../../../domain/electrical/observation-method-sheet-proposal.ts";
import type { ElectricalObservationMethodSheet } from "../../../../../domain/electrical/observation-method-sheet.ts";
import type { ElectricalObservationNativeBinding } from "../../../../../domain/electrical/spice/evaluation/expression.ts";
import type { ElectricalObservationMethodSheetBriefGate } from "../../../../../domain/electrical/observation-method-sheet-recross.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";

export interface ProjectElectricalObservationMethodSheetPreparationCommand {
  readonly projectId: string;
}

export interface ProjectElectricalObservationMethodSheetSealCommand
  extends ProjectElectricalObservationMethodSheetPreparationCommand {
  readonly sheetFingerprint: ContentFingerprint;
}

export type ProjectElectricalObservationMethodSheetSealReviewCommand =
  | ProjectElectricalObservationMethodSheetPreparationCommand
  | ProjectElectricalObservationMethodSheetSealCommand;

export interface ProjectElectricalObservationMethodSheetPreparationResult {
  readonly mode: "preparation";
  /** Exact fields the agent must copy into its later method-sheet resource. */
  readonly methodSheet: Pick<
    ElectricalObservationMethodSheet,
    "schemaVersion" | "project" | "subject" | "basis" | "spice"
  >;
  readonly l3: {
    readonly observations: readonly ElectricalObservationNativeBinding[];
    readonly limitations: readonly string[];
  };
  /** Current approved Brief identities eligible for criterion recross. */
  readonly briefItems: readonly ElectricalObservationMethodSheetBriefGate[];
}

export interface ProjectElectricalObservationMethodSheetSealResolvedResult {
  readonly mode: "review";
  readonly admission: ElectricalObservationMethodSheetSealAdmission;
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export type ProjectElectricalObservationMethodSheetSealReviewResult =
  | ProjectElectricalObservationMethodSheetPreparationResult
  | ProjectElectricalObservationMethodSheetSealResolvedResult;

export interface ProjectElectricalObservationMethodSheetSealReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectElectricalObservationMethodSheetSealReviewResult>;
}
