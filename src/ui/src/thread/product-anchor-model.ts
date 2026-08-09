import type {
  ThreadComponentProvider,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

export type ProductStructureAvailability =
  | {
    readonly status: "available";
    readonly assemblyRootCount: number;
    readonly partOccurrenceCount: number;
  }
  | {
    readonly status: "unavailable";
    readonly title: string;
    readonly detail: string;
    readonly guidance: string;
  };

/**
 * Product counts are shown only when a compatible reviewed catalog exists.
 * An empty projection may represent a legacy architecture vocabulary, missing
 * evidence, or a rejected capture; it must never be rendered as zero parts.
 */
export function productStructureAvailability(
  snapshot: ThreadWorkbenchSnapshot,
): ProductStructureAvailability {
  const components = snapshot.components.components;
  if (components.length === 0) {
    return {
      status: "unavailable",
      title: "Product structure unavailable",
      detail: snapshot.components.rationale,
      guidance:
        "The current thread does not expose a reviewed product catalog compatible with this view. No zero-component count is inferred; inspect the exact architecture evidence or migrate it through the reviewed architecture operation.",
    };
  }
  return {
    status: "available",
    assemblyRootCount:
      components.filter((component) =>
        component.kind === "assembly" && component.parentId === undefined
      ).length,
    partOccurrenceCount: components.filter((component) =>
      component.kind === "part"
    )
      .reduce((count, component) => count + component.quantity, 0),
  };
}

/** A compact Project-route summary that never turns unavailable into zero. */
export function productDefinitionSummary(
  snapshot: ThreadWorkbenchSnapshot,
): string {
  const structure = productStructureAvailability(snapshot);
  if (structure.status === "unavailable") {
    return `${structure.title}. ${structure.detail}`;
  }
  const labels = [
    ...new Set(
      snapshot.components.components.flatMap((component) =>
        component.bindings.filter((binding) => binding.status === "verified")
          .map((binding) => productProviderLabel(binding.provider))
      ),
    ),
  ];
  const scope = labels.length > 0
    ? joinProductLabels(labels)
    : "recorded source facets";
  return `${snapshot.components.components.length} reviewed component records across ${scope}.`;
}

function productProviderLabel(provider: ThreadComponentProvider): string {
  if (provider === "syson") return "SysON";
  if (provider === "build123d") return "CAD";
  if (provider === "digital-thread") return "Thread";
  return "ERP";
}

function joinProductLabels(labels: readonly string[]): string {
  if (labels.length < 2) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

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
