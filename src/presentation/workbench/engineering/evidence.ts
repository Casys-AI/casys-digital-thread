import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { LiveThreadWorkbenchSnapshot } from "./live-overlay.ts";
import type { ENGINEERING_WORKBENCH_SCHEMA } from "./schema.ts";

export interface EngineeringWorkbenchBaseSnapshot {
  readonly schemaVersion: typeof ENGINEERING_WORKBENCH_SCHEMA;
  readonly project: EngineeringProjectSnapshot;
}

export interface EngineeringEvidenceWorkbenchSnapshot
  extends EngineeringWorkbenchBaseSnapshot {
  readonly surface: "evidence";
  readonly thread: LiveThreadWorkbenchSnapshot;
  readonly alignment: EngineeringWorkbenchAlignment;
  readonly unresolvedEvidenceReferences:
    readonly EngineeringWorkbenchUnresolvedEvidenceReference[];
}

export interface EngineeringWorkbenchUnresolvedEvidenceReference {
  readonly path: string;
  readonly message: string;
}

export interface EngineeringWorkbenchAlignment {
  readonly status: "aligned" | "thread-ahead";
  readonly projectThreadRevision: number;
  readonly currentThreadRevision: number;
}
