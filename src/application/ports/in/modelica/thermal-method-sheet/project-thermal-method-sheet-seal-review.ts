/**
 * Inward port for preparing the human review of one thermal method-sheet seal.
 *
 * The caller names only the project and the content-addressed sheet. Source
 * bytes, SysML handles, provider tools and OMC stay behind server-owned
 * recross. This grants no MRTR, admission or evaluation authority.
 */

import type { ModelicaThermalMethodSheetSealAdmission } from "../../../../../domain/modelica/thermal-method-sheet-proposal.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";

export interface ProjectThermalMethodSheetSealReviewCommand {
  readonly projectId: string;
  readonly sheetFingerprint: ContentFingerprint;
}

export interface ProjectThermalMethodSheetSealReviewResult {
  /** Complete typed identity shown to the human; it grants no dispatch right. */
  readonly admission: ModelicaThermalMethodSheetSealAdmission;
  /** Unique canonical MRTR scalar sequence for `verify.seal-modelica-thermal-method-sheet@1`. */
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectThermalMethodSheetSealReviewUseCase {
  execute(value: unknown): Promise<ProjectThermalMethodSheetSealReviewResult>;
}
