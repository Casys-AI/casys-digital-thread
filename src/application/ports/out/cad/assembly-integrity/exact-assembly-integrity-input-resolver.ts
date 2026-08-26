/**
 * Narrow port that reopens one immutable geometry-module basis into the closed
 * binary bundle accepted by `AssemblyIntegrityObserver`.
 *
 * It deliberately accepts an exact Thread snapshot identity, not a project id
 * or a moving tip. Storage, asset paths, and provider details remain adapter
 * concerns.
 */

import type {
  AssemblyIntegrityInputBundle,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import type {
  AssemblyIntegrityObserverProfile,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import type { AssemblyIntegrityObserverProfileSelection } from "./assembly-integrity-observer.ts";
import type {
  ExactStaticAssemblyBasisRequest,
  ExactStaticAssemblyThreadBasis,
  ResolvedStaticAssemblyBasis,
} from "../exact-static-assembly-basis-resolver.ts";

export type ExactAssemblyIntegrityThreadBasis = ExactStaticAssemblyThreadBasis;

export interface ExactAssemblyIntegrityInputRequest
  extends ExactStaticAssemblyBasisRequest {
  /**
   * Internal executor-selected/signed profile identity. This is not a public
   * tool argument; the resolver reopens it through the closed catalogue.
   */
  readonly observerProfile: AssemblyIntegrityObserverProfileSelection;
}

export interface ResolvedAssemblyIntegrityInput extends ResolvedStaticAssemblyBasis {
  readonly profile: AssemblyIntegrityObserverProfile;
  readonly observerProfile: AssemblyIntegrityObserverProfileSelection;
  readonly inputBundle: AssemblyIntegrityInputBundle;
}

export interface AssemblyIntegrityInputResolver {
  resolve(
    request: ExactAssemblyIntegrityInputRequest,
  ): Promise<ResolvedAssemblyIntegrityInput>;
}
