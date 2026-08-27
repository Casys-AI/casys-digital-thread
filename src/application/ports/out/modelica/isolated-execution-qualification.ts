/** Trusted readback seam for activating one exact local Modelica profile. */

import type { ModelicaMicrosandboxQualificationReference } from "../../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import type { ModelicaIsolatedExecutionProfile } from "./isolated-execution-profile.ts";

/**
 * Implementations must reopen the canonical qualification capture, its exact
 * CAS publication receipt, and both output objects; validate the result again
 * outside the MicroVM; require proven destruction; and bind all of that to the
 * supplied profile fingerprint. `undefined` means no qualifying capture exists.
 *
 * No implementation is registered until the real Microsandbox/OMC smoke has
 * produced that durable evidence.
 */
export interface ModelicaIsolatedExecutionQualificationAuthority {
  reopenQualified(
    profile: ModelicaIsolatedExecutionProfile,
  ): Promise<ModelicaMicrosandboxQualificationReference | undefined>;
}
