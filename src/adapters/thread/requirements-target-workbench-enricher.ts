/**
 * BFF-only reopen of sealed model.write-requirements@1 captures.
 *
 * sourceElementId remains the RequirementUsage identity. The enricher recrosses
 * exact target.elementId from the unique current requirements tip per
 * container. Ambiguous or retired tips apply nothing. Rationale is never parsed.
 */

import type {
  ThreadArtifact,
  ThreadRequirement,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import type { ThreadGraphEdge } from "../../presentation/workbench/thread/graph.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../domain/architecture/requirements/requirements-proposal.ts";
import {
  listRequirementsCaptureContainers,
  REQUIREMENTS_CAPTURE_URI_PREFIX,
  selectRequirementsTip,
} from "../../domain/thread/requirements-tip.ts";
import {
  type ExactRequirementsCapture,
  parseExactRequirementsCapture,
} from "../architecture/requirements/requirements-capture.ts";
import { currentArchitectureArtifact } from "./thread-workbench-architecture-basis.ts";

const PROJECTED_FINGERPRINT = /^sha256:([0-9a-f]{64})$/;
const PRODUCER =
  `${MODEL_WRITE_REQUIREMENTS_OPERATION.id}@${MODEL_WRITE_REQUIREMENTS_OPERATION.version}` as const;

export interface RequirementsCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export async function enrichThreadWorkbenchWithRequirementsTargets(
  snapshot: ThreadWorkbenchSnapshot,
  captures: RequirementsCaptureReader,
  thread: ThreadSnapshot,
): Promise<ThreadWorkbenchSnapshot> {
  const architecture = currentArchitectureArtifact(snapshot);
  const targets = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const container of listRequirementsCaptureContainers(thread)) {
    const selected = selectRequirementsTip(thread, container);
    if (selected.kind !== "one") continue;
    const projected = snapshot.artifacts.find((item) =>
      item.id === selected.artifact.id
    );
    if (!projected) continue;
    const identity = requirementsCaptureIdentity(projected);
    if (!identity) continue;
    const capture = await reopenRequirementsCapture(identity, captures);
    if (!capture) continue;
    if (capture.containerComponent !== container) continue;
    if (!sameArchitecture(capture, architecture, projected)) continue;
    const requirement = snapshot.requirements.find((item) =>
      item.sourceElementId === capture.requirementUsage.id
    );
    if (!requirement) continue;
    const existing = targets.get(requirement.id);
    if (existing !== undefined && existing !== capture.target.elementId) {
      conflicts.add(requirement.id);
      continue;
    }
    targets.set(requirement.id, capture.target.elementId);
  }
  for (const requirementId of conflicts) targets.delete(requirementId);
  if (targets.size === 0) return snapshot;

  const requirements = snapshot.requirements.map((requirement) => {
    const targetElementId = targets.get(requirement.id);
    return targetElementId ? { ...requirement, targetElementId } : requirement;
  });
  const graph = {
    ...snapshot.graph,
    edges: [
      ...snapshot.graph.edges,
      ...projectConstrainedByEdges(snapshot, requirements),
    ].sort((left, right) => left.id.localeCompare(right.id)),
  };
  return { ...snapshot, requirements, graph };
}

async function reopenRequirementsCapture(
  identity: { readonly fingerprint: ContentFingerprint },
  captures: RequirementsCaptureReader,
): Promise<ExactRequirementsCapture | undefined> {
  let text: string | undefined;
  try {
    text = await captures.read(identity.fingerprint);
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;
  try {
    return parseExactRequirementsCapture(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function sameArchitecture(
  capture: ExactRequirementsCapture,
  architecture:
    | { readonly artifactId: string; readonly fingerprint: string }
    | undefined,
  artifact: ThreadArtifact,
): boolean {
  if (!architecture) return false;
  const digest = PROJECTED_FINGERPRINT.exec(artifact.fingerprint ?? "")?.[1];
  if (!digest) return false;
  if (
    artifact.uri !==
      `${REQUIREMENTS_CAPTURE_URI_PREFIX}${capture.containerComponent}/sha256/${digest}`
  ) {
    return false;
  }
  return architecture.artifactId === capture.architecture.artifactId &&
    architecture.fingerprint ===
      `${capture.architecture.fingerprint.algorithm}:${capture.architecture.fingerprint.digest}`;
}

function projectConstrainedByEdges(
  snapshot: ThreadWorkbenchSnapshot,
  requirements: readonly ThreadRequirement[],
): ThreadGraphEdge[] {
  const partIds = new Set(
    snapshot.graph.nodes
      .filter((node) => node.entityKind === "part-definition")
      .map((node) => node.ref.id),
  );
  const requirementIds = new Set(
    snapshot.graph.nodes
      .filter((node) => node.entityKind === "requirement")
      .map((node) => node.ref.id),
  );
  const edges: ThreadGraphEdge[] = [];
  for (const requirement of requirements) {
    const targetElementId = requirement.targetElementId;
    if (
      !targetElementId ||
      !partIds.has(targetElementId) ||
      !requirementIds.has(requirement.id)
    ) continue;
    edges.push({
      id: `structure:constrained-by:${targetElementId}:${requirement.id}`,
      from: { kind: "part-definition", id: targetElementId },
      to: { kind: "requirement", id: requirement.id },
      relation: "constrained_by",
      rationale:
        `PartDefinition ${targetElementId} is the exact requirements-capture ` +
        `target of ${requirement.id}.`,
      origin: "structure",
    });
  }
  return edges;
}

function requirementsCaptureIdentity(artifact: ThreadArtifact): {
  readonly fingerprint: ContentFingerprint;
} | undefined {
  const fingerprintMatch = artifact.fingerprint
    ? PROJECTED_FINGERPRINT.exec(artifact.fingerprint)
    : null;
  if (
    !fingerprintMatch ||
    artifact.kind !== "sysml-model" ||
    artifact.producedBy !== PRODUCER ||
    artifact.uri === undefined ||
    !artifact.uri.startsWith(REQUIREMENTS_CAPTURE_URI_PREFIX)
  ) {
    return undefined;
  }
  return {
    fingerprint: {
      algorithm: "sha256",
      digest: fingerprintMatch[1]!,
    },
  };
}
