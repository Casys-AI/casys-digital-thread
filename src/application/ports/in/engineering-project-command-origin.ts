import type { EngineeringCommandOriginKind } from "../../../domain/project/engineering-project.ts";

/** Authenticated actor identity supplied by the transport command boundary. */
export interface EngineeringProjectCommandOrigin {
  readonly kind: EngineeringCommandOriginKind;
  readonly actorId: string;
}
