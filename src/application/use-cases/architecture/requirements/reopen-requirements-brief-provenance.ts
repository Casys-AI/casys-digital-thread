/**
 * Reopen exact reviewed brief provenance from a stored Project revision.
 *
 * The signed `EngineeringApprovedBriefBasis` names the immutable Project
 * revision. This reader proves that stored human-approval receipt equals every
 * signed basis field, then rebuilds provenance from that snapshot's
 * `currentBrief`. It never derives a replacement basis from later framing and
 * writes nothing.
 */

import {
  buildRequirementsBriefProvenance,
  type RequirementsBriefProvenance,
} from "../../../../domain/architecture/requirements/requirements-brief-provenance.ts";
import type { TracedRequirementsProposal } from "../../../../domain/architecture/requirements/requirements-traced-proposal.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import { safeId } from "../../../../domain/kernel/case-validation.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import { approvedBriefBasisForProject } from "../../project/commands/project-planning-transitions.ts";

export async function reopenRequirementsBriefProvenance(input: {
  projects: Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  projectId: string;
  proposal: TracedRequirementsProposal;
  mode: "current" | "historical";
}): Promise<RequirementsBriefProvenance> {
  if (input.mode !== "current" && input.mode !== "historical") {
    throw new TypeError('mode must be "current" or "historical".');
  }
  const projectId = safeId(input.projectId, "projectId");
  const signedBasis = input.proposal.briefSource.basis;
  if (projectId !== signedBasis.projectId) {
    throw new TypeError(
      "The request project does not match the signed approved brief basis project.",
    );
  }

  const snapshot = await input.projects.getRevision(
    projectId,
    signedBasis.projectRevision,
  );
  if (!snapshot) {
    throw new TypeError(
      `The signed project revision ${signedBasis.projectRevision} is unavailable.`,
    );
  }
  if (
    snapshot.project.id !== projectId ||
    snapshot.project.id !== signedBasis.projectId ||
    snapshot.id !== signedBasis.projectSnapshotId ||
    snapshot.revision !== signedBasis.projectRevision
  ) {
    throw new TypeError(
      "The stored project snapshot does not match the signed project identity.",
    );
  }

  const storedBasis = requireStoredApprovedBriefBasis(snapshot);
  if (deterministicJson(storedBasis) !== deterministicJson(signedBasis)) {
    throw new TypeError(
      "The stored approval receipt does not equal the signed approved brief basis.",
    );
  }

  if (input.mode === "current") {
    const current = await input.projects.get(projectId);
    if (!current) {
      throw new TypeError("The current engineering project is unavailable.");
    }
    if (current.project.id !== projectId) {
      throw new TypeError(
        "The current project does not match the signed project identity.",
      );
    }
    const currentBasis = requireStoredApprovedBriefBasis(current);
    if (deterministicJson(currentBasis) !== deterministicJson(signedBasis)) {
      throw new TypeError(
        "The current project no longer carries the signed approved brief.",
      );
    }
  }

  const brief = snapshot.framing?.currentBrief;
  if (!brief) {
    throw new TypeError("The stored project revision has no canonical brief.");
  }
  return await buildRequirementsBriefProvenance({
    brief,
    basis: signedBasis,
    proposal: input.proposal,
  });
}

function requireStoredApprovedBriefBasis(
  snapshot: EngineeringProjectSnapshot,
): ReturnType<typeof approvedBriefBasisForProject> {
  try {
    return approvedBriefBasisForProject(snapshot);
  } catch (error) {
    throw new TypeError(
      "The stored project revision has no exact human-approved brief matching the signed basis.",
      { cause: error },
    );
  }
}
