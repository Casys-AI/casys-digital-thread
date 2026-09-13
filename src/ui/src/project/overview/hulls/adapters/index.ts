import type { OverviewHullContent } from "../types.ts";
import { currentBriefAdapter } from "../current-brief.ts";
import { currentEngineeringCasesAdapter } from "./from-current-engineering-cases.ts";
import { currentDfmCasesAdapter } from "./from-current-dfm-cases.ts";
import type {
  OverviewHullAdapter,
  OverviewHullAdapterContext,
} from "./types.ts";

export type {
  OverviewHullAdapter,
  OverviewHullAdapterContext,
} from "./types.ts";
export {
  currentBriefAdapter,
  OVERVIEW_CURRENT_BRIEF_ADAPTER_ID,
} from "../current-brief.ts";
export {
  buildOverviewCurrentEngineeringCasesContent,
  currentEngineeringCasesAdapter,
  OVERVIEW_CURRENT_ENGINEERING_CASES_ADAPTER_ID,
  withOverviewCurrentEngineeringCases,
} from "./from-current-engineering-cases.ts";
export {
  buildOverviewCurrentDfmCasesContent,
  currentDfmCasesAdapter,
  OVERVIEW_CURRENT_DFM_CASES_ADAPTER_ID,
  withOverviewCurrentDfmCases,
} from "./from-current-dfm-cases.ts";
export type { OverviewCurrentEngineeringCasesInput } from "./from-current-engineering-cases.ts";

/**
 * Registered post-passes over `buildOverviewHullContents`. Current Brief,
 * current Engineering Cases, and current DFM cases emit the same generic
 * `OverviewHullContent`.
 */
export const OVERVIEW_HULL_ADAPTERS: readonly OverviewHullAdapter[] = [
  currentBriefAdapter,
  currentEngineeringCasesAdapter,
  currentDfmCasesAdapter,
];

export function applyOverviewHullAdapters(
  contents: ReadonlyMap<string, OverviewHullContent>,
  context: OverviewHullAdapterContext,
): ReadonlyMap<string, OverviewHullContent> {
  let result = contents;
  for (const adapter of OVERVIEW_HULL_ADAPTERS) {
    result = adapter.apply(result, context);
  }
  return result;
}
