/**
 * Exact Thread projection fragments for generic requirements captures.
 *
 * Writer and recapture emit different uses rationales. Readers must
 * discriminate by the sealed capture operation instead of assuming one text.
 */

import type { ThreadProvenanceLink } from "../../../domain/thread/thread-snapshot.ts";
import {
  type ExactRequirementsCapture,
  isRecaptureRequirementsCapture,
} from "./requirements-capture.ts";

export type RequirementsProjectionKind = "write" | "recapture";

export function requirementsProjectionKind(
  capture: ExactRequirementsCapture,
): RequirementsProjectionKind {
  return isRecaptureRequirementsCapture(capture) ? "recapture" : "write";
}

export function architectureUsesRationale(
  kind: RequirementsProjectionKind,
): string {
  return kind === "recapture"
    ? "The recapture executor read the exact current architecture capture to resolve the target element."
    : "The executor read the exact architecture capture to resolve the target element.";
}

export function predecessorUsesRationale(
  kind: RequirementsProjectionKind,
): string {
  return kind === "recapture"
    ? "The recapture executor read the exact prior requirements capture to prove unchanged native identities."
    : "The executor read the exact prior requirements capture to plan the enrichment.";
}

export function expectedRequirementsUsesProvenance(input: {
  readonly kind: RequirementsProjectionKind;
  readonly artifactId: string;
  readonly architectureId: string;
  readonly predecessorId?: string;
  readonly digest: string;
}): readonly ThreadProvenanceLink[] {
  const uses: ThreadProvenanceLink[] = [{
    id: `uses-consume-${input.architectureId}-by-${input.artifactId}`,
    relation: "uses",
    from: {
      kind: "consumption",
      id: `consume-${input.architectureId}-by-${input.artifactId}`,
    },
    to: { kind: "artifact", id: input.architectureId },
    rationale: architectureUsesRationale(input.kind),
  }];
  if (input.predecessorId !== undefined) {
    uses.push({
      id: `uses-consume-prior-requirements-${input.digest}`,
      relation: "uses",
      from: {
        kind: "consumption",
        id: `consume-${input.predecessorId}-by-${input.artifactId}`,
      },
      to: { kind: "artifact", id: input.predecessorId },
      rationale: predecessorUsesRationale(input.kind),
    });
  }
  return uses;
}

export function expectedRequirementTraceLink(input: {
  readonly requirementId: string;
  readonly architectureId: string;
  readonly targetLabel: string;
  readonly targetElementId: string;
}): ThreadProvenanceLink {
  return {
    id: `traces-to-target-${input.requirementId}`,
    relation: "traces_to",
    from: { kind: "requirement", id: input.requirementId },
    to: { kind: "artifact", id: input.architectureId },
    rationale: `The requirement constrains PartDefinition "${input.targetLabel}" ` +
      `(${input.targetElementId}) inside this architecture artifact.`,
  };
}
