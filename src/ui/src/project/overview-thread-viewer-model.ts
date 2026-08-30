import type {
  ThreadArtifact,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";

export interface OverviewThreadViewerCapabilities {
  /** The exact graph record can always be inspected from the loaded snapshot. */
  readonly inspectRecord: true;
  /** Verification navigation preserves the exact graph reference. */
  readonly openVerification: true;
  /** Zero or more independently identified, fingerprint-bound GLB records. */
  readonly cadAssets: readonly ThreadArtifact[];
}

/**
 * Resolve whiteboard viewer affordances from persisted Thread facts only.
 *
 * CAD is deliberately fail-closed: an artifact must be the selected reference
 * or one endpoint of a direct recorded edge, and its API URI digest must match
 * its sha256 fingerprint. Labels, systems, component names and proximity in
 * the projected layout never create a viewer capability.
 */
export function resolveOverviewThreadViewerCapabilities(
  snapshot: ThreadWorkbenchSnapshot,
  node: ThreadGraphNode,
): OverviewThreadViewerCapabilities {
  const directArtifactIds = new Set<string>();
  if (node.ref.kind === "artifact") directArtifactIds.add(node.ref.id);

  for (const edge of snapshot.graph.edges) {
    if (
      sameThreadGraphRef(edge.from, node.ref) && edge.to.kind === "artifact"
    ) {
      directArtifactIds.add(edge.to.id);
    }
    if (
      sameThreadGraphRef(edge.to, node.ref) && edge.from.kind === "artifact"
    ) {
      directArtifactIds.add(edge.from.id);
    }
  }

  const cadAssets = snapshot.artifacts
    .filter((artifact) =>
      directArtifactIds.has(artifact.id) && isExactOverviewGlbArtifact(artifact)
    )
    .toSorted((left, right) =>
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
    );

  return {
    inspectRecord: true,
    openVerification: true,
    cadAssets,
  };
}

export function isExactOverviewGlbArtifact(
  artifact: ThreadArtifact,
): boolean {
  if (artifact.kind !== "cad-model") return false;
  const fingerprint = /^sha256:([a-f0-9]{64})$/.exec(
    artifact.fingerprint ?? "",
  );
  const uri = /^\/api\/thread\/assets\/([a-f0-9]{64})\.glb$/.exec(
    artifact.uri ?? "",
  );
  return fingerprint?.[1] !== undefined && fingerprint[1] === uri?.[1];
}

function sameThreadGraphRef(
  left: ThreadGraphRef,
  right: ThreadGraphRef,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}
