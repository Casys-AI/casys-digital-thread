import type { ProjectBriefRevision } from "../../../../../../domain/project/project-brief.ts";
import type { EngineeringCaseCatalog } from "../../../../thread/types.ts";
import type { ThreadViewerSession } from "../../../../thread/viewer-sessions-client.ts";
import type { OverviewHeroNode } from "../../../overview-thread-hero-model.ts";
import type { OverviewViewerOpenTarget } from "../../../overview-thread-viewer-discovery.ts";
import type { OverviewHullContent } from "../types.ts";

export interface OverviewCurrentEngineeringCasesInput {
  readonly catalog?: EngineeringCaseCatalog;
  readonly sessions?: readonly ThreadViewerSession[];
  readonly viewerAliases?: ReadonlyMap<
    string,
    readonly OverviewViewerOpenTarget[]
  >;
}

/**
 * Shared post-pass context. Domain payloads stay named and optional; an
 * adapter ignores fields it does not own.
 */
export interface OverviewHullAdapterContext {
  readonly nodes: readonly OverviewHeroNode[];
  readonly engineeringCases?: OverviewCurrentEngineeringCasesInput;
  /** Approved current Brief snapshot. Brief adapter only. */
  readonly currentBrief?: ProjectBriefRevision;
}

export interface OverviewHullAdapter {
  readonly id: string;
  apply(
    contents: ReadonlyMap<string, OverviewHullContent>,
    context: OverviewHullAdapterContext,
  ): ReadonlyMap<string, OverviewHullContent>;
}
