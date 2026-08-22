/**
 * Inward port for preparing the human review of one electrical observation
 * method-sheet seal.
 *
 * The caller names only the project and the content-addressed sheet. Native
 * names, brief gates, provider tools and ngspice stay behind server-owned
 * recross. This grants no MRTR, admission or evaluation authority.
 */

import type { ElectricalObservationMethodSheetSealAdmission } from "../../../../../domain/electrical/observation-method-sheet-proposal.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";

export interface ProjectElectricalObservationMethodSheetSealReviewCommand {
  readonly projectId: string;
  readonly sheetFingerprint: ContentFingerprint;
}

export interface ProjectElectricalObservationMethodSheetSealReviewResult {
  readonly admission: ElectricalObservationMethodSheetSealAdmission;
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectElectricalObservationMethodSheetSealReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectElectricalObservationMethodSheetSealReviewResult>;
}
