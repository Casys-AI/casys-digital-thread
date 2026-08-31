/**
 * Minimal common MRTR firewall for the prescribed-kinematics operations.
 * Exact review/executor recross owns the actual sealed identities; this early
 * gate merely prevents an agent from smuggling provider authority into a
 * human proposal before that recross runs.
 */

import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";

const FORBIDDEN =
  /(?:^|[._:-])(provider|image|tool|args?|endpoint|runtime)(?:$|[._:-])/i;

export function assertPrescribedKinematicsProposalParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): void {
  for (const parameter of parameters) {
    if (FORBIDDEN.test(parameter.key)) {
      throw new TypeError(
        "Prescribed-kinematics MRTR parameters cannot name a provider, image, tool, arguments, endpoint, or runtime.",
      );
    }
  }
}
