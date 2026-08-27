/**
 * Isolated real brief-source pipeline for baseline executor integration tests.
 *
 * Tests must not fall back to an unanalysed documentary baseline now that a
 * newly executed baseline seals its exact local source analysis. Each caller
 * supplies its own temporary root, keeping these CAS records out of both the
 * shared working tree and unrelated test fixtures.
 */

import { ProjectBriefSourceAnalyzer } from "../adapters/compile/source/project-brief-source-analyzer.ts";
import {
  PROJECT_BRIEF_SOURCE_ANALYZER_ID,
  PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
} from "../adapters/compile/source/project-brief-source-analyzer.ts";
import { BriefSourceAnalysisCaptureService } from "../adapters/compile/captures/brief-source-analysis-capture.ts";
import {
  BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
} from "../adapters/shared/cas/file-capture-store.ts";
import { FixedSourceAnalysisFrontendRegistry } from "../domain/compile/source/source-analysis-frontend-registry.ts";

export function approvedBriefSourceAnalysisFixture(root: string): {
  readonly briefSourceAnalysis: BriefSourceAnalysisCaptureService;
  readonly briefSourceCaptures: FileCaptureStore<"brief-source-capture">;
  readonly sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
  /** Names consumed by ExactInitialBaselineEvidenceValidator. */
  readonly sourceCaptures: FileCaptureStore<"brief-source-capture">;
  readonly analysisCaptures: FileCaptureStore<"source-analysis">;
  /** Exact source parser registry used at all replay boundaries. */
  readonly frontends: FixedSourceAnalysisFrontendRegistry;
  /** Name consumed by ApprovedBriefBaselineRunExecutor. */
  readonly briefSourceAnalysisFrontends: FixedSourceAnalysisFrontendRegistry;
} {
  const briefSourceCaptures = new FileCaptureStore({
    ...BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
    directory: `${root}/brief-source-captures`,
  });
  const sourceAnalysisCaptures = new FileCaptureStore({
    ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
    directory: `${root}/source-analysis-captures`,
  });
  const frontends = new FixedSourceAnalysisFrontendRegistry([{
    analyzer: {
      id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
      version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
    },
    frontend: new ProjectBriefSourceAnalyzer(),
  }]);
  return {
    briefSourceAnalysis: new BriefSourceAnalysisCaptureService({
      sourceCaptures: briefSourceCaptures,
      analysisCaptures: sourceAnalysisCaptures,
      frontends,
      analyzer: {
        id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
        version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
      },
    }),
    briefSourceCaptures,
    sourceAnalysisCaptures,
    sourceCaptures: briefSourceCaptures,
    analysisCaptures: sourceAnalysisCaptures,
    frontends,
    briefSourceAnalysisFrontends: frontends,
  };
}
