/**
 * Read-only assembly navigation over the current Product catalog, joining
 * already-projected viewer sessions to exact geometry primaries.
 *
 * Historical child captures stay "as assembled" by the signed parent module
 * table. This projector never treats them as current-architecture CAD, never
 * invents an App, and never inspects provider payloads.
 */

import {
  type GenericArchitectureCaptureReader,
  reopenVerifiedArchitectureCapture,
  resolveGenericProductStructureCatalog,
} from "../architecture/renderer/product-structure-catalog.ts";
import type { SysmlSourceAnalysisReader } from "../architecture/renderer/sysml-source-analysis-capture.ts";
import {
  exactGeometryBinaryNavigationArtifacts,
  type GenericGeometryCaptureReader,
} from "../cad/canonical/geometry-bundle-product-catalog.ts";
import {
  GEOMETRY_MODULE_CHILD_DERIVATION_RATIONALE,
  GEOMETRY_MODULE_CHILD_USE_RATIONALE,
} from "../cad/canonical/design-write-geometry-module-seal.ts";
import {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  type GeometryModuleCapture,
  type GeometryModuleChild,
  parseGeometryModuleCapture,
} from "../../domain/cad/canonical/geometry-module-evidence.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type {
  ThreadComponentCatalog,
  ThreadComponentDefinition,
} from "../../domain/thread/thread-component-catalog.ts";
import {
  THREAD_VIEWER_HIERARCHY_SCHEMA,
  type ThreadViewerHierarchyNode,
  type ThreadViewerHierarchyProjection,
  validateThreadViewerHierarchyProjection,
} from "../../presentation/workbench/thread/viewer-hierarchy.ts";
import {
  isDenseUnadornedArray,
  type ThreadViewerSession,
  type ThreadViewerSessionsBasis,
} from "../../presentation/workbench/thread/viewer-sessions.ts";

export interface ThreadViewerHierarchyRequest {
  readonly snapshot: ThreadSnapshot;
  readonly basis: ThreadViewerSessionsBasis;
  readonly sessions: readonly ThreadViewerSession[];
  readonly architectureCaptures: GenericArchitectureCaptureReader;
  readonly geometryCaptures: GenericGeometryCaptureReader;
  readonly sysmlSourceAnalysis?: SysmlSourceAnalysisReader;
}

export async function projectThreadViewerHierarchy(
  request: ThreadViewerHierarchyRequest,
): Promise<ThreadViewerHierarchyProjection> {
  try {
    // One immutable capture read per fingerprint within this projection only.
    // A later GET/SSE projection reopens bytes again, so missing/tampered
    // captures never become a durable positive navigation cache.
    const reads = new Map<string, Promise<string | undefined>>();
    return await projectHierarchy({
      ...request,
      geometryCaptures: {
        read: (fingerprint) => {
          const key = `${fingerprint.algorithm}:${fingerprint.digest}`;
          let read = reads.get(key);
          if (!read) {
            read = request.geometryCaptures.read(fingerprint);
            reads.set(key, read);
          }
          return read;
        },
      },
    });
  } catch (error) {
    const reason = error instanceof Error && error.message.trim() !== ""
      ? error.message
      : "The assembly hierarchy could not be verified for this snapshot.";
    return unavailable(reason);
  }
}

async function projectHierarchy(
  request: ThreadViewerHierarchyRequest,
): Promise<ThreadViewerHierarchyProjection> {
  if (!isDenseUnadornedArray(request.sessions)) {
    return unavailable(
      "Thread viewer hierarchy sessions must be a dense, unadorned array.",
    );
  }
  const snapshot = request.snapshot;
  if (
    request.basis.subjectId !== snapshot.subject.id ||
    request.basis.thread === undefined ||
    request.basis.thread.id !== snapshot.id ||
    request.basis.thread.revision !== snapshot.revision
  ) {
    return unavailable(
      "Thread viewer hierarchy requires the exact canonical Thread identity.",
    );
  }

  const catalog = await resolveGenericProductStructureCatalog(
    snapshot,
    request.architectureCaptures,
    request.geometryCaptures,
    request.sysmlSourceAnalysis,
  );
  if (!catalog) {
    return unavailable(
      "No architecture product structure is available for this snapshot.",
    );
  }
  if (catalog.components.length === 0) {
    return unavailable(catalog.rationale);
  }

  const geometryByNode = new Map<string, string>();
  const childrenByParent = new Map<string, ThreadComponentDefinition[]>();
  for (const component of catalog.components) {
    const primary = uniqueCadPrimary(component);
    if (primary) geometryByNode.set(component.id, primary);
    if (component.parentId === undefined) continue;
    const siblings = childrenByParent.get(component.parentId) ?? [];
    siblings.push(component);
    childrenByParent.set(component.parentId, siblings);
  }

  const walking = new Set<string>();
  for (const component of catalog.components) {
    const primaryId = geometryByNode.get(component.id);
    if (!primaryId) continue;
    await walkAssembledModule(
      snapshot,
      request.geometryCaptures,
      component.id,
      primaryId,
      geometryByNode,
      childrenByParent,
      walking,
    );
  }

  const sessionsByPrimary = indexExactArtifactSessions(request.sessions);
  const currentSessionIds = new Set(
    request.sessions.map((session) => session.id),
  );
  const nodes: ThreadViewerHierarchyNode[] = [];
  for (const component of catalog.components) {
    const definition = uniqueSysonBinding(component, "part-definition");
    if (definition === undefined) {
      return unavailable(
        "The product catalog is missing a unique SysON PartDefinition binding.",
      );
    }
    const usage = uniqueSysonPartUsage(component);
    const geometryArtifactId = geometryByNode.get(component.id);
    const sessionIds = geometryArtifactId
      ? [...sessionsByPrimary.get(geometryArtifactId) ?? []].toSorted((
        left,
        right,
      ) => left.localeCompare(right))
      : [];
    const artifactIds = geometryArtifactId
      ? await navigationArtifactIds(
        snapshot,
        geometryArtifactId,
        request.geometryCaptures,
      )
      : undefined;
    nodes.push({
      id: component.id,
      ...(component.parentId === undefined ? {} : { parentId: component.parentId }),
      label: component.label,
      partDefinitionElementId: definition,
      ...(usage === undefined ? {} : { usageId: usage.id, usageLabel: usage.label }),
      ...(geometryArtifactId === undefined ? {} : { geometryArtifactId }),
      ...(artifactIds === undefined ? {} : { artifactIds }),
      sessionIds,
    });
  }
  const rootIds = nodes.filter((node) => node.parentId === undefined).map((
    node,
  ) => node.id);
  const architectureArtifactId = await uniqueCurrentArchitectureArtifactId(
    snapshot,
    catalog,
    request.architectureCaptures,
    request.sysmlSourceAnalysis,
  );
  return validateThreadViewerHierarchyProjection({
    schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
    status: "available",
    ...(architectureArtifactId === undefined ? {} : { architectureArtifactId }),
    nodes,
    rootIds,
  }, currentSessionIds);
}

async function walkAssembledModule(
  snapshot: ThreadSnapshot,
  geometryCaptures: GenericGeometryCaptureReader,
  nodeId: string,
  primaryId: string,
  geometryByNode: Map<string, string>,
  childrenByParent: Map<string, ThreadComponentDefinition[]>,
  walking: Set<string>,
): Promise<void> {
  if (walking.has(primaryId)) return;
  walking.add(primaryId);
  try {
    const capture = await reopenExactModuleCapture(
      snapshot,
      geometryCaptures,
      primaryId,
    );
    if (!capture) return;
    const named = snapshot.artifacts.filter((artifact) => artifact.id === primaryId);
    if (named.length !== 1) return;
    const parent = named[0]!;
    const occurrences = childrenByParent.get(nodeId) ?? [];
    const claimed = new Set<string>();
    for (const child of capture.children) {
      if (walking.has(child.childGeometry.artifactId)) continue;
      const matches = occurrences.filter((occurrence) =>
        uniqueSysonBinding(occurrence, "part-usage") === child.usageElementId &&
        uniqueSysonBinding(occurrence, "part-definition") ===
          child.partDefinitionElementId
      );
      if (matches.length !== 1) continue;
      const occurrence = matches[0]!;
      if (claimed.has(occurrence.id)) continue;
      claimed.add(occurrence.id);
      if (
        !await exactAssembledChild(
          snapshot,
          geometryCaptures,
          parent,
          child,
          capture.sealedAt,
        )
      ) {
        continue;
      }
      const existing = geometryByNode.get(occurrence.id);
      if (
        existing !== undefined && existing !== child.childGeometry.artifactId
      ) {
        continue;
      }
      geometryByNode.set(occurrence.id, child.childGeometry.artifactId);
      if (
        child.childGeometry.schemaVersion !== GEOMETRY_MODULE_CAPTURE_SCHEMA
      ) {
        continue;
      }
      await walkAssembledModule(
        snapshot,
        geometryCaptures,
        occurrence.id,
        child.childGeometry.artifactId,
        geometryByNode,
        childrenByParent,
        walking,
      );
    }
  } finally {
    walking.delete(primaryId);
  }
}

async function reopenExactModuleCapture(
  snapshot: ThreadSnapshot,
  geometryCaptures: GenericGeometryCaptureReader,
  primaryId: string,
): Promise<GeometryModuleCapture | undefined> {
  const archived = archivedRefKeys(snapshot);
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === primaryId);
  if (matches.length !== 1 || archived.has(`artifact:${primaryId}`)) {
    return undefined;
  }
  const primary = matches[0]!;
  if (!isCanonicalGeometryPrimary(primary)) return undefined;
  const text = await geometryCaptures.read(primary.fingerprint);
  if (!text) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const observed = await sha256Fingerprint(raw);
  if (!fingerprintsEqual(observed, primary.fingerprint)) return undefined;
  let parsed: GeometryModuleCapture;
  try {
    parsed = await parseGeometryModuleCapture(raw);
  } catch {
    return undefined;
  }
  const canonical = await sha256Fingerprint(parsed);
  if (!fingerprintsEqual(canonical, primary.fingerprint)) return undefined;
  return parsed;
}

async function exactAssembledChild(
  snapshot: ThreadSnapshot,
  geometryCaptures: GenericGeometryCaptureReader,
  primary: ThreadArtifact,
  child: GeometryModuleChild,
  sealedAt: string,
): Promise<boolean> {
  const archived = archivedRefKeys(snapshot);
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id === child.childGeometry.artifactId &&
    fingerprintsEqual(artifact.fingerprint, child.childGeometry.fingerprint)
  );
  if (
    matches.length !== 1 ||
    archived.has(`artifact:${child.childGeometry.artifactId}`)
  ) {
    return false;
  }
  const artifact = matches[0]!;
  if (
    !isCanonicalGeometryPrimary(artifact) ||
    !primary.inputArtifactIds.includes(artifact.id)
  ) {
    return false;
  }
  if (!hasExactChildAttestation(snapshot, primary, artifact, sealedAt)) {
    return false;
  }
  const text = await geometryCaptures.read(artifact.fingerprint);
  if (text === undefined) return false;
  try {
    const raw = JSON.parse(text) as unknown;
    const observed = await sha256Fingerprint(raw);
    return fingerprintsEqual(observed, artifact.fingerprint);
  } catch {
    return false;
  }
}

function hasExactChildAttestation(
  snapshot: ThreadSnapshot,
  primary: ThreadArtifact,
  child: ThreadArtifact,
  sealedAt: string,
): boolean {
  const consumptionId = `consume-child-${child.id}-by-${primary.id}`;
  const consumption = snapshot.consumptions.filter((item) =>
    item.id === consumptionId && item.artifactId === child.id &&
    deterministicJson(item.consumer) === deterministicJson(primary.producer) &&
    fingerprintsEqual(item.observedFingerprint, child.fingerprint) &&
    item.status === "verified" && item.verifiedAt === sealedAt
  );
  const derived = snapshot.provenance.filter((link) =>
    link.id ===
      `derived-from-child-${primary.fingerprint.digest}-${child.fingerprint.digest}` &&
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === primary.id && link.to.kind === "artifact" &&
    link.to.id === child.id &&
    link.rationale === GEOMETRY_MODULE_CHILD_DERIVATION_RATIONALE
  );
  const uses = snapshot.provenance.filter((link) =>
    link.id === `uses-${consumptionId}` && link.relation === "uses" &&
    link.from.kind === "consumption" && link.from.id === consumptionId &&
    link.to.kind === "artifact" && link.to.id === child.id &&
    link.rationale === GEOMETRY_MODULE_CHILD_USE_RATIONALE
  );
  return consumption.length === 1 && derived.length === 1 && uses.length === 1;
}

function uniqueCadPrimary(
  component: ThreadComponentDefinition,
): string | undefined {
  const primaries = new Set(
    component.bindings
      .filter((binding) =>
        binding.provider === "digital-thread" && binding.kind === "artifact"
      )
      .map((binding) => binding.evidenceArtifactId),
  );
  return primaries.size === 1 ? [...primaries][0] : undefined;
}

function uniqueSysonBinding(
  component: ThreadComponentDefinition,
  kind: "part-definition" | "part-usage",
): string | undefined {
  return uniqueSysonBindingRecord(component, kind)?.id;
}

function uniqueSysonPartUsage(
  component: ThreadComponentDefinition,
): { readonly id: string; readonly label: string } | undefined {
  return uniqueSysonBindingRecord(component, "part-usage");
}

function uniqueSysonBindingRecord(
  component: ThreadComponentDefinition,
  kind: "part-definition" | "part-usage",
): { readonly id: string; readonly label: string } | undefined {
  const matches = component.bindings.filter((binding) =>
    binding.provider === "syson" && binding.kind === kind
  );
  return matches.length === 1
    ? { id: matches[0]!.id, label: matches[0]!.label }
    : undefined;
}

async function uniqueCurrentArchitectureArtifactId(
  snapshot: ThreadSnapshot,
  catalog: ThreadComponentCatalog,
  architectureCaptures: GenericArchitectureCaptureReader,
  sysmlSourceAnalysis: SysmlSourceAnalysisReader | undefined,
): Promise<string | undefined> {
  const fromCatalog = uniqueCatalogSysonEvidenceId(catalog);
  if (fromCatalog !== undefined) {
    return uniqueUnarchivedArtifact(snapshot, fromCatalog) ? fromCatalog : undefined;
  }
  const verified = await reopenVerifiedArchitectureCapture(
    snapshot,
    architectureCaptures,
    sysmlSourceAnalysis,
  );
  if (verified.kind !== "one") return undefined;
  return uniqueUnarchivedArtifact(snapshot, verified.artifact.id)
    ? verified.artifact.id
    : undefined;
}

function uniqueCatalogSysonEvidenceId(
  catalog: ThreadComponentCatalog,
): string | undefined {
  const evidenceIds = new Set(
    catalog.components.flatMap((component) =>
      component.bindings
        .filter((binding) => binding.provider === "syson")
        .map((binding) => binding.evidenceArtifactId)
    ),
  );
  return evidenceIds.size === 1 ? [...evidenceIds][0] : undefined;
}

async function navigationArtifactIds(
  snapshot: ThreadSnapshot,
  primaryId: string,
  captures: GenericGeometryCaptureReader,
): Promise<readonly string[] | undefined> {
  const primary = uniqueUnarchivedArtifact(snapshot, primaryId);
  if (!primary) return undefined;
  const binaries = await exactGeometryBinaryNavigationArtifacts(
    snapshot,
    primary,
    captures,
  );
  return [primary.id, ...binaries.map((artifact) => artifact.id).toSorted()];
}

function uniqueUnarchivedArtifact(
  snapshot: ThreadSnapshot,
  artifactId: string,
): ThreadArtifact | undefined {
  if (archivedRefKeys(snapshot).has(`artifact:${artifactId}`)) return undefined;
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === artifactId);
  return matches.length === 1 ? matches[0] : undefined;
}

function isCanonicalGeometryPrimary(artifact: ThreadArtifact): boolean {
  return artifact.kind === "cad-model" &&
    artifact.id === `geometry-${artifact.fingerprint.digest}`;
}

function indexExactArtifactSessions(
  sessions: readonly ThreadViewerSession[],
): Map<string, readonly string[]> {
  const byPrimary = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.anchor.kind !== "artifact") continue;
    const list = byPrimary.get(session.anchor.id) ?? [];
    if (!list.includes(session.id)) list.push(session.id);
    byPrimary.set(session.anchor.id, list);
  }
  return byPrimary;
}

function unavailable(reason: string): ThreadViewerHierarchyProjection {
  const text = reason.trim() === ""
    ? "The assembly hierarchy could not be verified for this snapshot."
    : reason;
  return validateThreadViewerHierarchyProjection({
    schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
    status: "unavailable",
    reason: text.length > 1024 ? text.slice(0, 1024) : text,
    nodes: [],
    rootIds: [],
  });
}
