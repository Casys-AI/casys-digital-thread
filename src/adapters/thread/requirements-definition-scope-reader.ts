/**
 * Reopen current requirements-capture tips for product-inspect definition scope.
 *
 * Identity is the unique tip URI plus the sealed capture target and
 * RequirementUsage. Producer tool names and PartDefinition labels are not
 * join keys. This is not the Workbench graph enricher.
 */

import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { RecrossedRequirementsCaptureScope } from "../../domain/thread/requirement-definition-scope.ts";
import {
  listRequirementsCaptureContainers,
  REQUIREMENTS_CAPTURE_URI_PREFIX,
  selectRequirementsTip,
} from "../../domain/thread/requirements-tip.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  type ExactRequirementsCapture,
  parseExactRequirementsCapture,
} from "../architecture/requirements/requirements-capture.ts";
import type { RequirementsCaptureReader } from "./requirements-target-workbench-enricher.ts";

export interface RequirementsDefinitionArchitectureBasis {
  readonly artifactId: string;
  readonly fingerprint: string;
}

export async function readRecrossedRequirementsCaptureScopes(
  snapshot: ThreadSnapshot,
  captures: RequirementsCaptureReader,
  architecture: RequirementsDefinitionArchitectureBasis,
): Promise<readonly RecrossedRequirementsCaptureScope[]> {
  const scopes: RecrossedRequirementsCaptureScope[] = [];
  const conflicts = new Set<string>();
  for (const container of listRequirementsCaptureContainers(snapshot)) {
    const selected = selectRequirementsTip(snapshot, container);
    if (selected.kind !== "one") continue;
    const identity = requirementsCaptureIdentity(selected.artifact);
    if (!identity) continue;
    const capture = await reopenRequirementsCapture(identity, captures);
    if (!capture) continue;
    if (capture.containerComponent !== container) continue;
    if (!captureRecrossesArchitecture(capture, architecture, selected.artifact)) {
      continue;
    }
    const scope: RecrossedRequirementsCaptureScope = {
      artifactId: selected.artifact.id,
      requirementUsageId: capture.requirementUsage.id,
      targetElementId: capture.target.elementId,
    };
    const key = `${scope.artifactId}:${scope.requirementUsageId}`;
    const existing = scopes.find((item) =>
      `${item.artifactId}:${item.requirementUsageId}` === key
    );
    if (existing && existing.targetElementId !== scope.targetElementId) {
      conflicts.add(key);
      continue;
    }
    if (!existing) scopes.push(scope);
  }
  return scopes.filter((scope) =>
    !conflicts.has(`${scope.artifactId}:${scope.requirementUsageId}`)
  );
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

function captureRecrossesArchitecture(
  capture: ExactRequirementsCapture,
  architecture: RequirementsDefinitionArchitectureBasis,
  artifact: ThreadArtifact,
): boolean {
  const digest = artifact.fingerprint.digest;
  if (
    artifact.kind !== "sysml-model" ||
    artifact.fingerprint.algorithm !== "sha256" ||
    artifact.uri !==
      `${REQUIREMENTS_CAPTURE_URI_PREFIX}${capture.containerComponent}/sha256/${digest}`
  ) {
    return false;
  }
  return architecture.artifactId === capture.architecture.artifactId &&
    architecture.fingerprint ===
      `${capture.architecture.fingerprint.algorithm}:${capture.architecture.fingerprint.digest}`;
}

function requirementsCaptureIdentity(artifact: ThreadArtifact): {
  readonly fingerprint: ContentFingerprint;
} | undefined {
  if (
    artifact.kind !== "sysml-model" ||
    artifact.fingerprint.algorithm !== "sha256" ||
    typeof artifact.uri !== "string" ||
    !artifact.uri.startsWith(REQUIREMENTS_CAPTURE_URI_PREFIX)
  ) {
    return undefined;
  }
  return { fingerprint: artifact.fingerprint };
}
