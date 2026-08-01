import type {
  ThreadArtifact,
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentPreview,
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
