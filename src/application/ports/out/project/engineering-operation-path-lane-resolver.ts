import type { EngineeringOperationRef } from "../../../../domain/project/engineering-project.ts";
import type { EngineeringPathLaneId } from "../../../../domain/project/engineering-path-lane.ts";

export type EngineeringOperationPathLaneDeclaration =
  | {
    readonly kind: "fixed";
    readonly lane: EngineeringPathLaneId;
  }
  | {
    /**
     * A generic source operation acquires its column from the next exact
     * registered operation. The closed allow-list prevents it from crossing
     * into an unrelated presentation lane.
     */
    readonly kind: "contextual";
    readonly allowedNext: readonly EngineeringPathLaneId[];
    readonly fallback: EngineeringPathLaneId;
  };

/** Server-owned lookup over exact registered operation id and version. */
export interface EngineeringOperationPathLaneResolver {
  resolve(
    reference: Pick<EngineeringOperationRef, "id" | "version">,
  ): EngineeringOperationPathLaneDeclaration | undefined;
}
