import type { ThreadWorkbenchSnapshot } from "./types.ts";

/**
 * Build a direct mapping from artifact id to product component id using the
 * reviewed catalog's evidenceArtifactId bindings.
 *
 * The mapping is derivation-free: no ID-prefix inference, no label matching,
 * no kind guessing.  An artifact is anchored when exactly one component
 * declares it as evidence through a binding.
 *
 * The catalog invariant (validated upstream by validateThreadComponentCatalog)
 * ensures each provider:kind:id triple is unique per component.  Because the
 * evidence artifact id names the exact immutable thread artifact, two
 * components referencing the same artifact id would name the same fact —
 * a structural impossibility that the catalog validator would have rejected.
 *
 * Consumers: graph renderers that want to colour or group artifact nodes by
 * product component.  This function does not walk provenance or structural
 * edges — change and consumption node inheritance is the caller's concern.
 */
export function buildCatalogArtifactAnchorMap(
  snapshot: ThreadWorkbenchSnapshot,
): ReadonlyMap<string, string> {
  const byArtifactId = new Map<string, string>();
  for (const component of snapshot.components.components) {
    for (const binding of component.bindings) {
      // Last writer wins when two bindings share an evidenceArtifactId, which
      // cannot happen in a validated catalog — so this is safe in practice.
      byArtifactId.set(binding.evidenceArtifactId, component.id);
    }
  }
  return byArtifactId;
}
