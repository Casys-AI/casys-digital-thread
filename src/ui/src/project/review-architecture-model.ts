import type {
  ArchitectureComponent,
  ArchitectureProposal,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";

export interface ArchitectureBindingRow {
  readonly component: ArchitectureComponent;
  /** Definition nesting level of the exact parent; the system root is zero. */
  readonly depth: number;
}

/**
 * Projects the reviewed PartDefinition -> PartUsage -> PartDefinition bindings
 * into deterministic nesting levels. Joins use exact SysML identifiers only;
 * labels and declaration order are never treated as identity.
 *
 * A reused PartDefinition may have several incoming usages. Its children keep
 * the minimum reachable definition depth, while every occurrence remains a
 * separate row in the original reviewed order.
 */
export function buildArchitectureBindingRows(
  proposal: ArchitectureProposal,
): readonly ArchitectureBindingRow[] {
  const depthByDefinition = new Map<string, number>([
    [proposal.system.name, 0],
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of proposal.components) {
      const parentDepth = depthByDefinition.get(component.parentName);
      if (parentDepth === undefined) continue;
      const candidate = parentDepth + 1;
      const current = depthByDefinition.get(component.name);
      if (current === undefined || candidate < current) {
        depthByDefinition.set(component.name, candidate);
        changed = true;
      }
    }
  }
  return proposal.components.map((component) => ({
    component,
    depth: depthByDefinition.get(component.parentName) ?? 0,
  }));
}
