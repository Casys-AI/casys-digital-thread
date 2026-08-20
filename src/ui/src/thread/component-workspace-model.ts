import type {
  ThreadArtifact,
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentCatalog,
  ThreadComponentPreview,
  ThreadGraphNode,
  ThreadRequirement,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

export interface CadSurfaceResolution {
  /** Scope is explicit: an assembly surface never proves part-level geometry. */
  readonly scope: "assembly" | "part";
  readonly representation: "presentation-surface" | "authoritative-step";
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
 * A generic geometry seal that has not been projected into component-level
 * CAD bindings. This is an operation result, not a product catalog mutation:
 * callers may inspect it, but must not treat it as proof of child-part CAD.
 */
export interface SealedAssemblyGeometry {
  readonly captureArtifact: ThreadArtifact;
  readonly assemblyAssets: readonly ThreadArtifact[];
  readonly assemblyFormats: readonly string[];
  /** V2-only: server-owned PartDefinition identities with one exact STEP each. */
  readonly independentPartDefinitionGeometryCount: number;
  /** Legacy presentation meshes; never presented as independent part geometry. */
  readonly legacyPartMeshCount: number;
  readonly inspectionBinding: ThreadComponentBinding;
}

/** Select one fingerprint-bound GLB from an already verified assembly family. */
export function sealedAssemblyGlbAsset(
  sealed: SealedAssemblyGeometry,
): ThreadArtifact | undefined {
  const candidates = sealed.assemblyAssets.filter((artifact) => {
    const match = artifact.uri?.match(
      /^\/api\/thread\/assets\/([a-f0-9]{64})\.glb$/,
    );
    return artifact.kind === "cad-model" &&
      match?.[1] === fingerprintDigest(artifact.fingerprint);
  });
  if (candidates.length === 0) return undefined;
  const digests = new Set(
    candidates.map((artifact) => fingerprintDigest(artifact.fingerprint)),
  );
  return digests.size === 1 ? candidates[0] : undefined;
}

/**
 * Collapse a definition GLB only when it renders the same sha256 as the sealed
 * assembly preview. Distinct bytes stay as two blocks.
 */
export function sealedGlbPreviewBlocks(
  assembly: ThreadArtifact | undefined,
  definition: ThreadComponentPreview | undefined,
): {
  readonly assembly: ThreadArtifact | undefined;
  readonly definition: ThreadComponentPreview | undefined;
} {
  if (
    assembly && definition &&
    isDuplicateSealedGlbCopy(
      fingerprintDigest(assembly.fingerprint),
      [definition.sha256],
    )
  ) {
    return { assembly, definition: undefined };
  }
  return { assembly, definition };
}

/** True only when every listed preview digest is the same sealed GLB. */
export function isDuplicateSealedGlbCopy(
  assemblySha256: string | undefined,
  partSha256s: readonly string[],
): boolean {
  return assemblySha256 !== undefined &&
    partSha256s.length > 0 &&
    partSha256s.every((digest) => digest === assemblySha256);
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
 * asset is recovered only when its SHA-256 and media shape exactly match the
 * declared preview. Neither rule creates links for assembly children.
 */
export function resolveCadSurface(
  snapshot: ThreadWorkbenchSnapshot,
  component: ThreadComponent,
): CadSurfaceResolution | undefined {
  const binding = component.bindings.find((candidate) =>
    candidate.provider === "build123d"
  );
  if (!binding) return resolveAuthoritativeStepSurface(snapshot, component);
  // A shared assembly STEP does not prove an independently addressable child.
  if (binding.kind === "assembly-child") {
    return resolveAuthoritativeStepSurface(snapshot, component);
  }

  const evidenceArtifact = snapshot.artifacts.find((artifact) =>
    artifact.id === binding.evidenceArtifactId && isBuild123dArtifact(artifact)
  );
  const exactUriArtifact = binding.kind === "artifact"
    ? snapshot.artifacts.find((artifact) =>
      artifact.uri === binding.id && isBuild123dArtifact(artifact)
    )
    : undefined;
  const authoritativeArtifact = evidenceArtifact ?? exactUriArtifact;
  if (!authoritativeArtifact) {
    return resolveAuthoritativeStepSurface(snapshot, component);
  }

  const presentationArtifact = component.preview
    ? snapshot.artifacts.find((artifact) =>
      isBuild123dArtifact(artifact) &&
      (artifact.id === component.preview?.artifactId ||
        fingerprintDigest(artifact.fingerprint) ===
          component.preview?.sha256) &&
      (component.preview?.mediaType === "model/stl"
        ? artifact.kind === "mesh" || artifact.uri?.endsWith(".stl")
        : artifact.kind === "cad-model" && artifact.uri?.endsWith(".glb"))
    )
    : undefined;
  const preview = component.preview && presentationArtifact
    ? { ...component.preview, artifactId: presentationArtifact.id }
    : undefined;

  return {
    scope: component.kind,
    representation: "presentation-surface",
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

/**
 * Geometry bundle v2 keeps the capture as the digital-thread evidence owner,
 * while the binding id names the exact STEP produced by build123d-sandbox.
 * Both identities and their explicit trace must resolve; labels never join the
 * records. An optional GLB remains a presentation derivative of that STEP.
 */
function resolveAuthoritativeStepSurface(
  snapshot: ThreadWorkbenchSnapshot,
  component: ThreadComponent,
): CadSurfaceResolution | undefined {
  const sealed = resolveSealedAssemblyGeometry(snapshot);
  if (!sealed) return undefined;
  const captureDigest = geometryCaptureDigest(sealed.captureArtifact);
  if (!captureDigest) return undefined;

  const candidates = component.bindings.flatMap((binding) => {
    if (
      binding.provider !== "digital-thread" || binding.kind !== "artifact" ||
      binding.status !== "verified" ||
      binding.evidenceArtifactId !== sealed.captureArtifact.id
    ) return [];
    const artifact = snapshot.artifacts.find((candidate) =>
      candidate.id === binding.id
    );
    if (!artifact || artifact.system !== "build123d-sandbox") return [];
    const record = classifyGeometryBinary(artifact, captureDigest);
    const exactScope = component.kind === "assembly"
      ? record?.scope === "assembly"
      : record?.scope === "definition";
    if (
      record?.generation !== "v2" || record.format !== "STEP" || !exactScope
    ) return [];
    const traced = snapshot.graph.edges.filter((edge) =>
      edge.relation === "traces_to" && edge.from.kind === "artifact" &&
      edge.from.id === sealed.captureArtifact.id &&
      edge.to.kind === "artifact" && edge.to.id === artifact.id
    );
    return traced.length === 1 ? [{ binding, artifact, record }] : [];
  });
  if (candidates.length !== 1) return undefined;
  const resolved = candidates[0]!;
  const presentation = component.kind === "part" &&
      resolved.record.scope === "definition"
    ? resolveExactPartDefinitionGlb(
      snapshot,
      component.preview,
      sealed.captureArtifact,
      captureDigest,
      resolved.record.definitionIndex,
    )
    : undefined;
  return {
    scope: component.kind,
    representation: "authoritative-step",
    binding: resolved.binding,
    authoritativeArtifact: resolved.artifact,
    ...(presentation
      ? {
        presentationArtifact: presentation.artifact,
        preview: presentation.preview,
      }
      : {}),
    inspectionBinding: {
      ...resolved.binding,
      selection: { kind: "artifact", id: resolved.artifact.id },
    },
  };
}

/**
 * Resolve a Product viewer only when the catalog-declared GLB belongs to the
 * same server-owned v2 PartDefinition slot as the authoritative STEP. The
 * browser rechecks the fingerprint-bound URL and unique capture trace; labels
 * never participate in the join.
 */
function resolveExactPartDefinitionGlb(
  snapshot: ThreadWorkbenchSnapshot,
  preview: ThreadComponentPreview | undefined,
  captureArtifact: ThreadArtifact,
  captureDigest: string,
  definitionIndex: number,
):
  | {
    readonly artifact: ThreadArtifact;
    readonly preview: ThreadComponentPreview;
  }
  | undefined {
  if (!preview || preview.mediaType !== "model/gltf-binary") return undefined;
  const urlMatch = preview.url.match(
    /^\/api\/thread\/assets\/([a-f0-9]{64})\.glb$/,
  );
  if (!urlMatch || urlMatch[1] !== preview.sha256) return undefined;
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.id === preview.artifactId
  );
  if (candidates.length !== 1) return undefined;
  const artifact = candidates[0]!;
  if (
    artifact.system !== "build123d-sandbox" ||
    artifact.uri !== preview.url ||
    fingerprintDigest(artifact.fingerprint) !== preview.sha256
  ) return undefined;
  const record = classifyGeometryBinary(artifact, captureDigest);
  if (
    record?.generation !== "v2" || record.scope !== "definition" ||
    record.definitionIndex !== definitionIndex || record.format !== "GLB"
  ) return undefined;
  const traces = snapshot.graph.edges.filter((edge) =>
    edge.relation === "traces_to" && edge.from.kind === "artifact" &&
    edge.from.id === captureArtifact.id && edge.to.kind === "artifact" &&
    edge.to.id === artifact.id
  );
  return traces.length === 1 ? { artifact, preview } : undefined;
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

/**
 * Resolve the current generic geometry result from immutable graph facts.
 *
 * The operation capture must be the unique active `geometry-capture` tip (or
 * the sole legacy capture). Every returned binary is reached by an exact
 * `traces_to` edge and has a fingerprint matching its asset URI. V2 assembly
 * and PartDefinition files are separated by server-owned identity segments;
 * friendly labels, timestamps, and component names are never used.
 */
export function resolveSealedAssemblyGeometry(
  snapshot: ThreadWorkbenchSnapshot,
): SealedAssemblyGeometry | undefined {
  const captures = snapshot.artifacts.filter((artifact) =>
    geometryCaptureDigest(artifact) !== undefined
  );
  const captureArtifact = selectActiveGeometryCapture(snapshot, captures);
  if (!captureArtifact) return undefined;

  const captureDigest = geometryCaptureDigest(captureArtifact)!;
  // Canonical Thread provenance stores traces_to as binary -> capture. The
  // Workbench projector intentionally reverses it into visual dependency order
  // (capture -> binary), which is the browser contract consumed here.
  const tracedIds = snapshot.graph.edges
    .filter((edge) =>
      edge.relation === "traces_to" &&
      edge.from.kind === "artifact" &&
      edge.from.id === captureArtifact.id &&
      edge.to.kind === "artifact"
    )
    .map((edge) => edge.to.id);
  if (tracedIds.length === 0 || new Set(tracedIds).size !== tracedIds.length) {
    return undefined;
  }

  const tracedArtifacts = tracedIds.map((id) =>
    snapshot.artifacts.find((artifact) => artifact.id === id)
  );
  if (tracedArtifacts.some((artifact) => !artifact)) return undefined;
  const binaries = tracedArtifacts as ThreadArtifact[];
  const records = binaries.map((artifact) =>
    classifyGeometryBinary(artifact, captureDigest)
  );
  if (records.some((record) => !record)) return undefined;
  const exactRecords = records as GeometryBinaryRecord[];
  const hasV2Records = exactRecords.some((record) =>
    record.generation === "v2"
  );
  if (
    hasV2Records && exactRecords.some((record) => record.generation !== "v2")
  ) return undefined;

  const assemblyRecords = exactRecords.filter((record) =>
    record.scope === "assembly"
  )
    .toSorted((left, right) =>
      left.generation === "v2" && right.generation === "v2"
        ? left.formatIndex - right.formatIndex
        : 0
    );
  if (
    hasV2Records &&
    !isContiguousUniqueIndexSet(
      assemblyRecords.flatMap((record) =>
        record.generation === "v2" ? [record.formatIndex] : []
      ),
    )
  ) return undefined;
  const assemblyAssets = assemblyRecords.map((record) => record.artifact);
  const assemblyFormats = assemblyAssets.flatMap(geometryAssetFormat);
  if (
    assemblyFormats.filter((format) => format === "STEP").length !== 1 ||
    new Set(assemblyFormats).size !== assemblyFormats.length
  ) return undefined;

  const definitionRecords = exactRecords.filter((record) =>
    record.scope === "definition"
  );
  const definitionIndexes = new Set(
    definitionRecords.map((record) => record.definitionIndex),
  );
  const orderedDefinitionIndexes = [...definitionIndexes].toSorted((
    left,
    right,
  ) => left - right);
  const definitionFormatSequence = orderedDefinitionIndexes.map(
    (definitionIndex) => {
      const records = definitionRecords.filter((record) =>
        record.definitionIndex === definitionIndex
      ).toSorted((left, right) => left.fileIndex - right.fileIndex);
      return {
        fileIndexes: records.map((record) => record.fileIndex),
        formats: records.map((record) => record.format),
      };
    },
  );
  const expectedDefinitionFormats = definitionFormatSequence[0]?.formats;
  if (
    hasV2Records &&
    (definitionIndexes.size === 0 ||
      !isContiguousUniqueIndexSet(orderedDefinitionIndexes) ||
      definitionFormatSequence.some(({ fileIndexes, formats }) =>
        !isContiguousUniqueIndexSet(fileIndexes) ||
        formats.filter((format) => format === "STEP").length !== 1 ||
        new Set(formats).size !== formats.length ||
        !sameStringSequence(formats, expectedDefinitionFormats)
      ))
  ) return undefined;

  // V2 identities are authoritative only after the backend's exact bundle
  // projector has joined every Product component to its signed STEP. The
  // browser must not turn an extra trace or a server-looking artifact id into
  // an independent PartDefinition count on its own.
  const verifiedDefinitionCount = hasV2Records
    ? exactV2CatalogDefinitionCount(
      snapshot,
      captureArtifact.id,
      exactRecords,
    )
    : undefined;
  if (hasV2Records && verifiedDefinitionCount === undefined) return undefined;

  return {
    captureArtifact,
    assemblyAssets,
    assemblyFormats: [...new Set(assemblyFormats)],
    independentPartDefinitionGeometryCount: verifiedDefinitionCount ??
      definitionIndexes.size,
    legacyPartMeshCount:
      exactRecords.filter((record) => record.scope === "legacy-part-mesh")
        .length,
    inspectionBinding: {
      provider: "digital-thread",
      kind: "artifact",
      id: captureArtifact.id,
      label: captureArtifact.label,
      evidenceArtifactId: captureArtifact.id,
      status: "verified",
      selection: { kind: "artifact", id: captureArtifact.id },
    },
  };
}

function exactV2CatalogDefinitionCount(
  snapshot: ThreadWorkbenchSnapshot,
  captureArtifactId: string,
  records: readonly GeometryBinaryRecord[],
): number | undefined {
  if (
    records.some((record) =>
      record.generation !== "v2" ||
      record.artifact.system !== "build123d-sandbox"
    )
  ) return undefined;

  const recordById = new Map(
    records.map((record) => [record.artifact.id, record] as const),
  );
  const exactStepBinding = (component: ThreadComponent) => {
    const matches = component.bindings.filter((binding) =>
      binding.provider === "digital-thread" && binding.kind === "artifact" &&
      binding.status === "verified" &&
      binding.evidenceArtifactId === captureArtifactId
    );
    if (matches.length !== 1) return undefined;
    const record = recordById.get(matches[0]!.id);
    return record?.format === "STEP" ? record : undefined;
  };

  const assemblies = snapshot.components.components.filter((component) =>
    component.kind === "assembly"
  );
  if (assemblies.length !== 1) return undefined;
  const assembly = exactStepBinding(assemblies[0]!);
  if (assembly?.scope !== "assembly") return undefined;

  const parts = snapshot.components.components.filter((component) =>
    component.kind === "part"
  );
  const definitionSteps = records.filter((record) =>
    record.scope === "definition" && record.format === "STEP"
  );
  if (parts.length === 0) {
    // A system-only catalog has no PartUsage. The unique definition STEP is
    // the system PartDefinition; Product must not invent a child occurrence.
    if (definitionSteps.length !== 1) return undefined;
    return 1;
  }
  const boundDefinitionStepIds = new Set<string>();
  for (const part of parts) {
    const record = exactStepBinding(part);
    if (record?.scope !== "definition") return undefined;
    boundDefinitionStepIds.add(record.artifact.id);
  }

  const expectedDefinitionStepIds = new Set(
    records.flatMap((record) =>
      record.scope === "definition" && record.format === "STEP"
        ? [record.artifact.id]
        : []
    ),
  );
  if (
    expectedDefinitionStepIds.size !== boundDefinitionStepIds.size ||
    [...expectedDefinitionStepIds].some((id) => !boundDefinitionStepIds.has(id))
  ) return undefined;
  return boundDefinitionStepIds.size;
}

/**
 * Explain the only ambiguity this read model refuses to resolve. The browser
 * never guesses a winner from timestamps or array order.
 */
export function sealedAssemblyGeometryBlocker(
  snapshot: ThreadWorkbenchSnapshot,
): string | undefined {
  const captures = snapshot.artifacts.filter((artifact) =>
    geometryCaptureDigest(artifact) !== undefined
  );
  if (captures.length === 0) return undefined;
  if (!selectActiveGeometryCapture(snapshot, captures)) {
    return "Multiple active geometry captures are present without one exact supersession tip. Product cannot choose an authoritative assembly result.";
  }
  return resolveSealedAssemblyGeometry(snapshot) === undefined
    ? "The active geometry capture does not project a complete, exactly linked assembly STEP and asset set. Product will not infer a result from labels or timestamps."
    : undefined;
}

function isBuild123dArtifact(artifact: ThreadArtifact): boolean {
  return artifact.system === "build123d" ||
    artifact.system === "build123d-sandbox";
}

function fingerprintDigest(value: string | undefined): string | undefined {
  return value?.startsWith("sha256:") ? value.slice("sha256:".length) : value;
}

const GEOMETRY_CAPTURE_URI = "casys://geometry-capture/sha256/";

function geometryCaptureDigest(artifact: ThreadArtifact): string | undefined {
  if (
    artifact.kind !== "cad-model" || artifact.system !== "digital-thread" ||
    artifact.freshness !== "fresh" ||
    !artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI)
  ) return undefined;
  const digest = artifact.uri.slice(GEOMETRY_CAPTURE_URI.length);
  if (!/^[a-f0-9]{64}$/.test(digest)) return undefined;
  if (artifact.fingerprint !== `sha256:${digest}`) return undefined;
  return digest;
}

function selectActiveGeometryCapture(
  snapshot: ThreadWorkbenchSnapshot,
  captures: readonly ThreadArtifact[],
): ThreadArtifact | undefined {
  if (captures.length === 1) return captures[0];
  if (captures.length === 0) return undefined;

  // The Workbench graph reverses canonical `supersedes` into historical ->
  // successor. The single active tip is therefore the only capture without an
  // outgoing supersession edge, and every other candidate must reach it.
  const ids = new Set(captures.map((artifact) => artifact.id));
  const successors = new Map<string, Set<string>>();
  for (const edge of snapshot.graph.edges) {
    if (
      edge.relation !== "supersedes" || edge.from.kind !== "artifact" ||
      edge.to.kind !== "artifact" || !ids.has(edge.from.id) ||
      !ids.has(edge.to.id)
    ) continue;
    const targets = successors.get(edge.from.id) ?? new Set<string>();
    targets.add(edge.to.id);
    successors.set(edge.from.id, targets);
  }
  const tips = captures.filter((artifact) =>
    (successors.get(artifact.id)?.size ?? 0) === 0
  );
  if (tips.length !== 1) return undefined;
  const tip = tips[0]!;
  if (
    captures.some((artifact) =>
      artifact.id !== tip.id && !reachesTip(artifact.id, tip.id, successors)
    )
  ) return undefined;
  return tip;
}

function reachesTip(
  start: string,
  tip: string,
  successors: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === tip) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(successors.get(current) ?? []));
  }
  return false;
}

type GeometryBinaryRecord =
  & {
    readonly artifact: ThreadArtifact;
    readonly generation: "legacy" | "v2";
    readonly format: string;
  }
  & (
    | {
      readonly scope: "assembly";
      readonly formatIndex: number;
      readonly generation: "v2";
    }
    | {
      readonly scope: "assembly";
      readonly generation: "legacy";
    }
    | { readonly scope: "legacy-part-mesh" }
    | {
      readonly scope: "definition";
      readonly definitionIndex: number;
      readonly fileIndex: number;
    }
  );

function classifyGeometryBinary(
  artifact: ThreadArtifact,
  captureDigest: string,
): GeometryBinaryRecord | undefined {
  if (
    artifact.freshness !== "fresh" || !isBuild123dArtifact(artifact)
  ) return undefined;
  const assetDigest = fingerprintDigest(artifact.fingerprint);
  if (
    !assetDigest || !/^[a-f0-9]{64}$/.test(assetDigest) ||
    artifact.uri !== expectedGeometryAssetUri(assetDigest, artifact)
  ) return undefined;
  const format = geometryAssetFormat(artifact)[0];
  if (!format) return undefined;

  const assemblyV2 = artifact.id.match(
    new RegExp(
      `^cad-asset-${captureDigest}-assembly-(\\d+)-(${assetDigest})$`,
    ),
  );
  if (assemblyV2) {
    if (!artifactKindMatchesFormat(artifact, format, "assembly")) {
      return undefined;
    }
    return {
      artifact,
      generation: "v2",
      scope: "assembly",
      formatIndex: Number(assemblyV2[1]),
      format,
    };
  }
  const definitionV2 = artifact.id.match(
    new RegExp(
      `^cad-asset-${captureDigest}-definition-(\\d+)-(\\d+)-(${assetDigest})$`,
    ),
  );
  if (definitionV2) {
    if (!artifactKindMatchesFormat(artifact, format, "definition")) {
      return undefined;
    }
    return {
      artifact,
      generation: "v2",
      scope: "definition",
      definitionIndex: Number(definitionV2[1]),
      fileIndex: Number(definitionV2[2]),
      format,
    };
  }
  if (artifact.id === `cad-asset-${captureDigest}-${assetDigest}`) {
    if (!artifactKindMatchesFormat(artifact, format, "assembly")) {
      return undefined;
    }
    return { artifact, generation: "legacy", scope: "assembly", format };
  }
  if (
    artifact.id === `mesh-${captureDigest}-${assetDigest}` &&
    artifact.kind === "mesh" && format === "STL"
  ) {
    return {
      artifact,
      generation: "legacy",
      scope: "legacy-part-mesh",
      format,
    };
  }
  return undefined;
}

function isContiguousUniqueIndexSet(indexes: readonly number[]): boolean {
  return indexes.length > 0 && new Set(indexes).size === indexes.length &&
    indexes.toSorted((left, right) => left - right).every((value, ordinal) =>
      Number.isSafeInteger(value) && value === ordinal
    );
}

function sameStringSequence(
  actual: readonly string[],
  expected: readonly string[] | undefined,
): boolean {
  return expected !== undefined && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function artifactKindMatchesFormat(
  artifact: ThreadArtifact,
  format: string,
  scope: "assembly" | "definition",
): boolean {
  if (format === "STEP") return artifact.kind === "step";
  if (format === "GLB" || format === "GLTF") {
    return artifact.kind === "cad-model";
  }
  return format === "STL" &&
    artifact.kind === (scope === "definition" ? "mesh" : "cad-model");
}

function geometryAssetFormat(artifact: ThreadArtifact): readonly string[] {
  const uri = artifact.uri?.toLowerCase() ?? "";
  if (artifact.kind === "step" && uri.endsWith(".step")) return ["STEP"];
  if (uri.endsWith(".glb")) return ["GLB"];
  if (uri.endsWith(".gltf")) return ["GLTF"];
  if (uri.endsWith(".stl")) return ["STL"];
  return [];
}

function expectedGeometryAssetUri(
  assetDigest: string,
  artifact: ThreadArtifact,
): string | undefined {
  const format = geometryAssetFormat(artifact)[0];
  if (!format) return undefined;
  const extension = format === "STEP" ? "step" : format.toLowerCase();
  return `/api/thread/assets/${assetDigest}.${extension}`;
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

/** One qualified local-sensitivity assertion projected for the SysML facet. */
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
 * model remains testable without React.
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
   * Qualified local-sensitivity assertions bound to this exact component.
   * Empty until the graph carries independently evidenced binding semantics.
   */
  readonly sensitivityRecords: readonly SysmlSensitivityRecord[];
}

/**
 * Build the SysML sub-tree read model for the selected component.
 *
 * Sources: snapshot components, requirements, and qualified analysis edges.
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

  // Only the dedicated structured source identity anchors a requirement.
  // Display provenance remains for people; it never participates in joins.
  const anchoredRequirements: SysmlAnchoredRequirement[] = sysonElementId
    ? snapshot.requirements
      .filter((req) => req.sourceElementId === sysonElementId)
      .map(toAnchoredRequirement)
    : [];

  // A finite-difference case identifies its driver and responses, but does not
  // prove that the driver is bound to this exact product component. Keep the
  // canonical relation visible in the global evidence graph; the component
  // facet remains empty until an architecture/source binding is itself
  // captured and verified. Labels are never used as a substitute identity.
  const sensitivityRecords: SysmlSensitivityRecord[] = [];

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

/**
 * Un nœud de l'arbre de structure produit.
 *
 * L'imbrication vient de `parentId`, déclaré dans le catalogue — jamais d'un
 * nom ni d'un préfixe de libellé. Un composant dont le parent n'est pas dans
 * le catalogue remonte à la racine plutôt que de disparaître : un catalogue
 * incomplet doit se voir, pas se taire.
 */
export interface ComponentTreeNode {
  readonly id: string;
  readonly label: string;
  readonly kind: ThreadComponent["kind"];
  readonly quantity: number;
  readonly verified: boolean;
  readonly children: readonly ComponentTreeNode[];
}

/**
 * Projette le catalogue en arbre. L'ordre des enfants suit celui du catalogue :
 * c'est un ordre enregistré, il ne se retrie pas à l'affichage.
 */
export function buildComponentTree(
  catalog: ThreadComponentCatalog,
): readonly ComponentTreeNode[] {
  const components = catalog.components;
  const known = new Set(components.map((component) => component.id));
  const childrenByParent = new Map<string, ThreadComponent[]>();
  const roots: ThreadComponent[] = [];
  for (const component of components) {
    const parentId = component.parentId;
    if (parentId === undefined || !known.has(parentId)) {
      roots.push(component);
      continue;
    }
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(component);
    childrenByParent.set(parentId, siblings);
  }
  // `seen` coupe un parentId cyclique : le catalogue est déclaratif et rien
  // n'interdit structurellement une boucle, qui ferait tourner le rendu.
  const project = (
    component: ThreadComponent,
    seen: ReadonlySet<string>,
  ): ComponentTreeNode => ({
    id: component.id,
    label: component.label,
    kind: component.kind,
    quantity: component.quantity,
    verified: component.bindings.some(
      (binding) =>
        binding.provider === "syson" && binding.status === "verified",
    ),
    children: seen.has(component.id)
      ? []
      : (childrenByParent.get(component.id) ??
        []).map((child) => project(child, new Set([...seen, component.id]))),
  });
  return roots.map((root) => project(root, new Set()));
}
