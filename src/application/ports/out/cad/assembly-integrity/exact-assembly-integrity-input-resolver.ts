/**
 * Narrow port that reopens one immutable geometry-module basis into the closed
 * binary bundle accepted by `AssemblyIntegrityObserver`.
 *
 * It deliberately accepts an exact Thread snapshot identity, not a project id
 * or a moving tip. Storage, asset paths, and provider details remain adapter
 * concerns.
 */

import type {
  AssemblyIntegrityGeometryModuleReference,
  AssemblyIntegrityInputBundle,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import type { GeometryModuleCapture } from "../../../../../domain/cad/canonical/geometry-module-capture.ts";
import type {
  AssemblyIntegrityObserverProfile,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import type { AssemblyIntegrityObserverProfileSelection } from "./assembly-integrity-observer.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../../domain/thread/thread-snapshot.ts";

export interface ExactAssemblyIntegrityThreadBasis {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}

export interface ExactAssemblyIntegrityInputRequest {
  readonly basis: ExactAssemblyIntegrityThreadBasis;
  readonly snapshot: ThreadSnapshot;
  readonly geometryModule: AssemblyIntegrityGeometryModuleReference;
  /**
   * Internal executor-selected/signed profile identity. This is not a public
   * tool argument; the resolver reopens it through the closed catalogue.
   */
  readonly observerProfile: AssemblyIntegrityObserverProfileSelection;
}

export interface ResolvedAssemblyIntegrityInput {
  readonly basis: ExactAssemblyIntegrityThreadBasis;
  readonly geometryModule: AssemblyIntegrityGeometryModuleReference;
  readonly primary: ThreadArtifact;
  readonly assemblyStep: ThreadArtifact;
  readonly capture: GeometryModuleCapture;
  readonly profile: AssemblyIntegrityObserverProfile;
  readonly observerProfile: AssemblyIntegrityObserverProfileSelection;
  readonly inputBundle: AssemblyIntegrityInputBundle;
}

export interface AssemblyIntegrityInputResolver {
  resolve(
    request: ExactAssemblyIntegrityInputRequest,
  ): Promise<ResolvedAssemblyIntegrityInput>;
}
