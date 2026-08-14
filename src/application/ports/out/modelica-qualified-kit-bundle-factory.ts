/** Outward seam that reopens the one code-owned qualified Modelica kit. */

import type {
  PreparedModelicaIsolatedInputBundle,
} from "../../../domain/analysis/modelica-isolated-execution.ts";
import type {
  ModelicaMicrosandboxQualificationReference,
} from "../../../domain/analysis/modelica-microsandbox-qualification.ts";
import type {
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  ModelicaIsolatedExecutionProfile,
} from "./modelica-isolated-execution-profile.ts";

export interface ModelicaQualifiedKitBundlePreparationRequest {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly profile: ModelicaIsolatedExecutionProfile;
  readonly runtimeQualification: ModelicaMicrosandboxQualificationReference;
}

export interface ModelicaQualifiedKitBundleFactory {
  prepare(
    request: ModelicaQualifiedKitBundlePreparationRequest,
  ): Promise<PreparedModelicaIsolatedInputBundle>;
}
