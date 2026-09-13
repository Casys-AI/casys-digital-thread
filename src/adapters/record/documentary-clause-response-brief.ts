/** Historical or current reopen of one signed approved brief. */
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  approvedBriefBasisForProject,
  EngineeringProjectCommandError,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
} from "../../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../../domain/project/project-brief.ts";
import { parseApprovedBriefBasis } from "../../domain/record/documentary-clause-response.ts";

export async function reopenSignedApprovedBrief(input: {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  readonly projectId: string;
  readonly signedBasis: EngineeringApprovedBriefBasis;
  readonly mode: "current" | "historical";
}): Promise<{
  readonly basis: EngineeringApprovedBriefBasis;
  readonly items: readonly ProjectBriefItem[];
}> {
  const signedBasis = parseApprovedBriefBasis(input.signedBasis, "$briefBasis");
  if (input.projectId !== signedBasis.projectId) {
    reject(
      "The request project does not match the signed approved brief basis project.",
    );
  }
  const snapshot = await input.projects.getRevision(
    input.projectId,
    signedBasis.projectRevision,
  );
  if (!snapshot) {
    reject(
      `The signed project revision ${signedBasis.projectRevision} is unavailable.`,
    );
  }
  if (
    snapshot.project.id !== input.projectId ||
    snapshot.id !== signedBasis.projectSnapshotId ||
    snapshot.revision !== signedBasis.projectRevision
  ) {
    reject("The stored project snapshot does not match the signed project identity.");
  }
  const storedBasis = requireStoredApprovedBriefBasis(snapshot);
  if (deterministicJson(storedBasis) !== deterministicJson(signedBasis)) {
    reject(
      "The stored approval receipt does not equal the signed approved brief basis.",
    );
  }
  if (input.mode === "current") {
    const current = await input.projects.get(input.projectId);
    if (!current) reject("The current engineering project is unavailable.");
    const currentBasis = requireStoredApprovedBriefBasis(current);
    if (deterministicJson(currentBasis) !== deterministicJson(signedBasis)) {
      reject("The current project no longer carries the signed approved brief.");
    }
  }
  const items = snapshot.framing?.currentBrief?.items;
  if (!items) reject("The signed approved brief has no items.");
  return { basis: storedBasis, items };
}

function requireStoredApprovedBriefBasis(
  project: EngineeringProjectSnapshot,
): EngineeringApprovedBriefBasis {
  try {
    return approvedBriefBasisForProject(project);
  } catch (error) {
    reject(
      error instanceof Error
        ? error.message
        : "The project has no exact human-approved canonical brief.",
    );
  }
}

function reject(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}
