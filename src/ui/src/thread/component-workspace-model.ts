import type {
  ThreadArtifact,
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentPreview,
  ThreadGraphNode,
  ThreadObservation,
  ThreadRequirement,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

export interface CadSurfaceResolution {
  /** Scope is explicit: an assembly surface never proves part-level geometry. */
  readonly scope: "assembly" | "part";
  readonly binding: ThreadComponentBinding;
  readonly authoritativeArtifact: ThreadArtifact;
  readonly presentationArtifact?: ThreadArtifact;
  readonly preview?: ThreadComponentPreview;
  readonly inspectionBinding: ThreadComponentBinding;
}

export interface CadSurfaceCoverage {
  readonly assemblySurfaces: number;
  readonly partSurfaces: number;
  readonly totalComponents: number;
}

/**
 * Explicit correction anchors are the only route from a component to its
 * lifecycle. Friendly labels and provider-side names are intentionally not
 * used as a fallback.
 */
export function correctionNodesForComponent(
  snapshot: ThreadWorkbenchSnapshot,
  component: ThreadComponent,
): readonly ThreadGraphNode[] {
  return snapshot.graph.nodes.filter((node) =>
    node.entityKind === "change" &&
    node.affectedComponentId === component.id
  ).toSorted((left, right) =>
    (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "") ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Resolve a viewable CAD surface from exact identities already in the snapshot.
 *
 * A catalog evidence id can become stale when a run is recaptured. For an
 * assembly-level `artifact` binding, an exact URI match to a current build123d
 * artifact is sufficient to recover the authoritative record. A presentation
 * mesh is recovered only when its SHA-256 exactly matches the declared preview.
 * Neither rule creates links for assembly children.
 */
export function resolveCadSurface(
  snapshot: ThreadWorkbenchSnapshot,
  component: ThreadComponent,
): CadSurfaceResolution | undefined {
  const binding = component.bindings.find((candidate) =>
    candidate.provider === "build123d"
  );
  if (!binding) return undefined;
  // A shared assembly STEP does not prove an independently addressable child.
  if (binding.kind === "assembly-child") return undefined;

  const evidenceArtifact = snapshot.artifacts.find((artifact) =>
    artifact.id === binding.evidenceArtifactId && isBuild123dArtifact(artifact)
  );
  const exactUriArtifact = binding.kind === "artifact"
    ? snapshot.artifacts.find((artifact) =>
      artifact.uri === binding.id && isBuild123dArtifact(artifact)
    )
    : undefined;
  const authoritativeArtifact = evidenceArtifact ?? exactUriArtifact;
  if (!authoritativeArtifact) return undefined;

  const presentationArtifact = component.preview
    ? snapshot.artifacts.find((artifact) =>
      isBuild123dArtifact(artifact) &&
      (artifact.id === component.preview?.artifactId ||
        fingerprintDigest(artifact.fingerprint) ===
          component.preview?.sha256) &&
      (artifact.kind === "mesh" || artifact.uri?.endsWith(".stl"))
    )
    : undefined;
  const preview = component.preview && presentationArtifact
    ? { ...component.preview, artifactId: presentationArtifact.id }
    : undefined;

  return {
    scope: component.kind,
    binding,
    authoritativeArtifact,
    presentationArtifact,
    preview,
    inspectionBinding: {
      ...binding,
      selection: { kind: "artifact", id: authoritativeArtifact.id },
    },
  };
}

export function cadSurfaceCoverage(
  snapshot: ThreadWorkbenchSnapshot,
): CadSurfaceCoverage {
  let assemblySurfaces = 0;
  let partSurfaces = 0;
  for (const component of snapshot.components.components) {
    const surface = resolveCadSurface(snapshot, component);
    if (!surface?.preview) continue;
    if (surface.scope === "assembly") assemblySurfaces += 1;
    else partSurfaces += 1;
  }
  return {
    assemblySurfaces,
    partSurfaces,
    totalComponents: snapshot.components.components.length,
  };
}

function isBuild123dArtifact(artifact: ThreadArtifact): boolean {
  return artifact.system.toLowerCase().includes("build123d");
}

function fingerprintDigest(value: string | undefined): string | undefined {
  return value?.startsWith("sha256:") ? value.slice("sha256:".length) : value;
}

// ── SysML sub-tree model ──────────────────────────────────────────────────────

/**
 * One node in the SysML structure diagram rendered for the selected component.
 * All data arrives from the existing GET/SSE projection — no MCP call, no
 * browser-side inference.
 */
export interface SysmlSubtreeNode {
  /** Catalog component id, used as stable React key. */
  readonly id: string;
  readonly label: string;
  /** SysON element id from the component's syson binding, when available. */
  readonly elementId?: string;
  readonly kind: "assembly" | "part";
  /** Whether this node is the currently selected component. */
  readonly isCurrent: boolean;
}

/**
 * A requirement anchored in the SysON model and traced to the selected
 * component.  Matching is done by comparing the requirement's source field
 * against the component's syson binding id.
 */
export interface SysmlAnchoredRequirement {
  readonly id: string;
  readonly label: string;
  readonly expression: string;
  readonly status: "pass" | "fail" | "unresolved";
}

/**
 * An observation whose label suggests a sensitivity derivative produced by
 * the DripTray sensitivity study.  These are projected directly from the
 * canonical snapshot observations — no engineering inference is applied.
 */
export interface SysmlSensitivityRecord {
  readonly label: string;
  /** Formatted value with unit, e.g. "−0.008 mm/mm". */
  readonly display: string;
}

/**
 * Read model for the native SVG SysML sub-tree facet.
 *
 * The SVG renders:
 *   parent assembly → selected component → (siblings shown flat, not rendered)
 *
 * Non-trivial display logic lives here so the TSX stays declarative and the
 * model remains testable without Preact.
 */
export interface SysmlSubtreeModel {
  /** The root assembly (or the closest ancestor). */
  readonly root: SysmlSubtreeNode;
  /** The component the workspace is currently focused on. */
  readonly selected: SysmlSubtreeNode;
  /**
   * Sibling parts that share the same parent.  For an assembly-level
   * selected component this is empty.
   */
  readonly siblings: readonly SysmlSubtreeNode[];
  /**
   * Requirements whose source field contains the selected component's SysON
   * element id.  An empty array is the contractual state when no requirements
   * are traced to this component.
   */
  readonly anchoredRequirements: readonly SysmlAnchoredRequirement[];
  /**
   * Sensitivity derivative observations linked to this component.
   * Identified by matching the canonical observation labels produced by the
   * sensitivity-study executor.  Empty when no sensitivity study has run.
   */
  readonly sensitivityRecords: readonly SysmlSensitivityRecord[];
}

/**
 * Build the SysML sub-tree read model for the selected component.
 *
 * Sources: snapshot.components.components, snapshot.requirements,
 * snapshot.observations — all from the existing BFF projection.
 * No MCP call, no provider inference, no label-based engineering reasoning.
 */
export function buildSysmlSubtree(
  snapshot: ThreadWorkbenchSnapshot,
  selected: ThreadComponent,
): SysmlSubtreeModel {
  const components = snapshot.components.components;

  // Resolve the assembly root: the parent of the selected part, or the
  // selected component itself if it is the assembly.
  const rootComponent: ThreadComponent = selected.parentId
    ? (components.find((c) => c.id === selected.parentId) ?? selected)
    : selected;

  const root: SysmlSubtreeNode = toSubtreeNode(rootComponent, selected.id);
  const selectedNode: SysmlSubtreeNode = toSubtreeNode(selected, selected.id);

  // Sibling parts that share the same parent (excluding the selected node).
  const siblings: SysmlSubtreeNode[] = selected.parentId
    ? components
      .filter(
        (c) => c.id !== selected.id && c.parentId === selected.parentId,
      )
      .map((c) => toSubtreeNode(c, selected.id))
    : [];

  // The SysON element id for the selected component (from its syson binding).
  const sysonElementId = sysonBindingId(selected);

  // Requirements whose source field references this component's element id.
  // The projector formats source as "{producer} · {elementId}" so we check
  // for the element id as a substring — intentionally not parsing the full
  // source string, since the element id is the immutable anchor.
  const anchoredRequirements: SysmlAnchoredRequirement[] = sysonElementId
    ? snapshot.requirements
      .filter((req) => req.source.includes(sysonElementId))
      .map(toAnchoredRequirement)
    : [];

  // Sensitivity derivative observations are identified by their server-fixed
  // canonical label prefix.  The executor always uses the pattern
  // "DripTray {metric} sensitivity (size-z)".
  const sensitivityRecords: SysmlSensitivityRecord[] = snapshot.observations
    .filter(isSensitivityObservation)
    .map(toSensitivityRecord);

  return {
    root,
    selected: selectedNode,
    siblings,
    anchoredRequirements,
    sensitivityRecords,
  };
}

function toSubtreeNode(
  component: ThreadComponent,
  selectedId: string,
): SysmlSubtreeNode {
  return {
    id: component.id,
    label: component.label,
    elementId: sysonBindingId(component),
    kind: component.kind,
    isCurrent: component.id === selectedId,
  };
}

function sysonBindingId(component: ThreadComponent): string | undefined {
  return component.bindings.find((b) => b.provider === "syson")?.id;
}

function toAnchoredRequirement(
  req: ThreadRequirement,
): SysmlAnchoredRequirement {
  return {
    id: req.id,
    label: req.label,
    expression: req.expression,
    status: req.status,
  };
}

/**
 * A sensitivity observation has a canonical label produced by the
 * sensitivity-study executor:  "DripTray {metric} sensitivity (size-z)".
 * No other label pattern is treated as a sensitivity record.
 */
function isSensitivityObservation(obs: ThreadObservation): boolean {
  return (
    obs.label.startsWith("DripTray ") &&
    obs.label.includes("sensitivity") &&
    obs.label.endsWith(")")
  );
}

function toSensitivityRecord(
  obs: ThreadObservation,
): SysmlSensitivityRecord {
  return { label: obs.label, display: obs.display };
}

// ── CAD mesh explicit state ───────────────────────────────────────────────────

/**
 * The three contractual states of the build123d surface for one component:
 *
 * - "preview-ready"   : a fresh mesh artifact exists and the STL viewer can
 *                       render it immediately.
 * - "not-exported"    : a build123d binding is declared but no preview is
 *                       resolved — the @3 export has not been executed yet.
 * - "no-binding"      : no build123d identity is declared at all for this
 *                       component.
 *
 * The UI renders these three states distinctly so the user can always tell
 * the difference between "not yet" and "not applicable".
 */
export type CadMeshStatus = "preview-ready" | "not-exported" | "no-binding";

/**
 * Determine the CAD mesh state for the selected component without resolving
 * the full CadSurfaceResolution (which requires snapshot artifact lookups).
 *
 * Callers use this to choose the correct empty-state label before falling
 * back to resolveCadSurface for the full rendering path.
 */
export function resolveCadMeshStatus(
  snapshot: ThreadWorkbenchSnapshot,
  component: ThreadComponent,
): CadMeshStatus {
  const surface = resolveCadSurface(snapshot, component);
  if (surface?.preview) return "preview-ready";
  const hasBuild123dBinding = component.bindings.some(
    (b) => b.provider === "build123d" && b.kind !== "assembly-child",
  );
  return hasBuild123dBinding ? "not-exported" : "no-binding";
}
