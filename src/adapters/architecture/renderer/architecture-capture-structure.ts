/**
 * Structural navigability of one exact architecture-capture/4.0.
 *
 * Graphology must not see a cyclic or unreachable definition graph.
 * reopenVerifiedArchitectureCapture does not call this; navigation does.
 */

import type { ExactArchitectureCapture } from "./architecture-capture.ts";

export type ArchitectureCaptureStructureIssue =
  | "missing-root"
  | "inexact-target"
  | "cycle"
  | "unreachable";

export function architectureCaptureIsNavigable(
  capture: ExactArchitectureCapture,
): boolean {
  return inspectArchitectureCaptureStructure(capture) === undefined;
}

export function inspectArchitectureCaptureStructure(
  capture: ExactArchitectureCapture,
): ArchitectureCaptureStructureIssue | undefined {
  const byId = new Map(
    capture.partDefinitions.map((part) => [part.id, part]),
  );
  const root = byId.get(capture.semanticRoot.id);
  if (!root) return "missing-root";
  const reachable = new Set<string>();
  const visit = (
    definitionId: string,
    ancestors: ReadonlySet<string>,
  ): ArchitectureCaptureStructureIssue | undefined => {
    if (ancestors.has(definitionId)) return "cycle";
    if (reachable.has(definitionId)) return undefined;
    const definition = byId.get(definitionId);
    if (!definition) return "inexact-target";
    reachable.add(definitionId);
    const nextAncestors = new Set(ancestors).add(definitionId);
    for (const usage of definition.usages) {
      const target = byId.get(usage.targetId);
      if (!target || target.label !== usage.targetLabel) return "inexact-target";
      if (nextAncestors.has(target.id)) return "cycle";
      const nested = visit(target.id, nextAncestors);
      if (nested) return nested;
    }
    return undefined;
  };
  const issue = visit(root.id, new Set());
  if (issue) return issue;
  if (reachable.size !== capture.partDefinitions.length) return "unreachable";
  return undefined;
}
