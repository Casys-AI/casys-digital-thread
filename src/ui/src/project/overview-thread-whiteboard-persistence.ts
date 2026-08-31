import type {
  OverviewThreadD3FlowGroupPlacement,
  OverviewThreadD3FlowNodePlacement,
} from "./overview-thread-d3-flow-layout.ts";
import type { OverviewThreadViewerGeometry } from "./overview-thread-viewer-geometry.ts";
import {
  OVERVIEW_THREAD_WHITEBOARD_MAX_SCALE,
  OVERVIEW_THREAD_WHITEBOARD_MIN_SCALE,
  type OverviewThreadWhiteboardTransform,
} from "./overview-thread-whiteboard-transform.ts";

/**
 * Local, non-authoritative presentation state only.
 *
 * This schema must never be used as Thread evidence, as a viewer-capability
 * source, or as an input to a provider operation. The current Thread snapshot
 * remains the sole authority for nodes, groups and viewers; persisted entries
 * are admitted only after exact reconciliation with that snapshot.
 */

export const OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION = 1;

const STORAGE_NAMESPACE = "casys.project-whiteboard.presentation";
const PRESENTATION_SCHEMA = "casys-project-whiteboard-presentation";
const MAX_PROJECT_ID_LENGTH = 512;
const MAX_ID_LENGTH = 4_096;
const MAX_PLACEMENT_COUNT = 10_000;
const MAX_VIEWER_COUNT = 1_000;
const MAX_ABSOLUTE_COORDINATE = 10_000_000;
const MAX_Z_INDEX = 1_000_000;

export type OverviewThreadWhiteboardPresentationLayoutMode =
  | "hierarchy"
  | "radial";

export interface OverviewThreadWhiteboardPresentationState {
  readonly layoutMode: OverviewThreadWhiteboardPresentationLayoutMode;
  readonly groupPlacements: Readonly<
    Record<string, OverviewThreadD3FlowGroupPlacement>
  >;
  readonly nodePlacements: Readonly<
    Record<string, OverviewThreadD3FlowNodePlacement>
  >;
  readonly transform: OverviewThreadWhiteboardTransform;
  readonly viewers: readonly OverviewThreadWhiteboardPresentationViewer[];
}

interface OverviewThreadWhiteboardPresentationViewerBase {
  /** Stable identity; it must match the exact kind/node/asset tuple. */
  readonly id: string;
  /** Exact current graph node identity to which the viewer is tethered. */
  readonly nodeKey: string;
  readonly geometry: OverviewThreadViewerGeometry;
  readonly z: number;
  readonly expanded: boolean;
  /** Required while expanded so the integrated viewer can be restored. */
  readonly restoreGeometry?: OverviewThreadViewerGeometry;
}

export interface OverviewThreadWhiteboardRecordPresentationViewer
  extends OverviewThreadWhiteboardPresentationViewerBase {
  readonly kind: "record";
}

export interface OverviewThreadWhiteboardActivityPresentationViewer
  extends OverviewThreadWhiteboardPresentationViewerBase {
  readonly kind: "activity";
}

export interface OverviewThreadWhiteboardCadPresentationViewer
  extends OverviewThreadWhiteboardPresentationViewerBase {
  readonly kind: "cad";
  /** Exact artifact identity admitted by the current node capability. */
  readonly assetId: string;
}

export type OverviewThreadWhiteboardPresentationViewer =
  | OverviewThreadWhiteboardRecordPresentationViewer
  | OverviewThreadWhiteboardActivityPresentationViewer
  | OverviewThreadWhiteboardCadPresentationViewer;

export interface OverviewThreadWhiteboardViewerCapability {
  readonly record?: boolean;
  readonly activity?: boolean;
  readonly cadAssetIds?: readonly string[] | ReadonlySet<string>;
}

export interface OverviewThreadWhiteboardPresentationReconciliation {
  /** Exact identities emitted by the current D3 flow layout. */
  readonly groupKeys: Iterable<string>;
  /** Exact identities emitted by the current overview-node projection. */
  readonly nodeKeys: Iterable<string>;
  /** Capabilities derived from current authoritative Thread facts only. */
  readonly viewerCapabilities: Readonly<
    Record<string, OverviewThreadWhiteboardViewerCapability>
  >;
}

/** Minimal browser Storage surface, kept injectable for SSR and tests. */
export interface OverviewThreadWhiteboardPresentationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface OverviewThreadWhiteboardPresentationEnvelope {
  readonly schema: typeof PRESENTATION_SCHEMA;
  readonly version: typeof OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION;
  readonly projectId: string;
  readonly state: OverviewThreadWhiteboardPresentationState;
}

/** Returns no key for an unsafe project identity, disabling local persistence. */
export function overviewThreadWhiteboardPresentationStorageKey(
  projectId: string,
): string | undefined {
  if (!isSafeId(projectId, MAX_PROJECT_ID_LENGTH)) return undefined;
  try {
    return `${STORAGE_NAMESPACE}:v${OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION}:${
      encodeURIComponent(projectId)
    }`;
  } catch {
    return undefined;
  }
}

/**
 * Strictly serialises a presentation snapshot. Invalid runtime values fail
 * closed instead of being normalised into a plausible-looking layout.
 */
export function serializeOverviewThreadWhiteboardPresentation(
  projectId: string,
  state: OverviewThreadWhiteboardPresentationState,
): string | undefined {
  if (!overviewThreadWhiteboardPresentationStorageKey(projectId)) {
    return undefined;
  }
  let parsedState: OverviewThreadWhiteboardPresentationState | undefined;
  try {
    parsedState = parsePresentationState(state);
  } catch {
    return undefined;
  }
  if (!parsedState) return undefined;

  const envelope: OverviewThreadWhiteboardPresentationEnvelope = {
    schema: PRESENTATION_SCHEMA,
    version: OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION,
    projectId,
    state: parsedState,
  };
  try {
    return JSON.stringify(envelope);
  } catch {
    return undefined;
  }
}

/** Rejects malformed, cross-project and differently versioned entries. */
export function parseOverviewThreadWhiteboardPresentation(
  serialized: string,
  projectId: string,
): OverviewThreadWhiteboardPresentationState | undefined {
  if (!overviewThreadWhiteboardPresentationStorageKey(projectId)) {
    return undefined;
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (
    !isExactRecord(candidate, ["schema", "version", "projectId", "state"]) ||
    candidate.schema !== PRESENTATION_SCHEMA ||
    candidate.version !== OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION ||
    candidate.projectId !== projectId
  ) {
    return undefined;
  }
  return parsePresentationState(candidate.state);
}

/**
 * Drops stale placements and viewers unless their exact current identity and
 * viewer capability still exist. It never infers a relationship from labels,
 * proximity, a previous session, or the persisted viewer kind.
 */
export function reconcileOverviewThreadWhiteboardPresentation(
  state: OverviewThreadWhiteboardPresentationState,
  current: OverviewThreadWhiteboardPresentationReconciliation,
): OverviewThreadWhiteboardPresentationState {
  const groupKeys = new Set(current.groupKeys);
  const nodeKeys = new Set(current.nodeKeys);
  const groupPlacements = nullRecord<OverviewThreadD3FlowGroupPlacement>();
  const nodePlacements = nullRecord<OverviewThreadD3FlowNodePlacement>();

  for (const [key, placement] of Object.entries(state.groupPlacements)) {
    if (groupKeys.has(key)) groupPlacements[key] = placement;
  }
  for (const [key, placement] of Object.entries(state.nodePlacements)) {
    if (nodeKeys.has(key)) nodePlacements[key] = placement;
  }

  const viewers = state.viewers.filter((viewer) => {
    if (!nodeKeys.has(viewer.nodeKey)) return false;
    const capability = ownValue(current.viewerCapabilities, viewer.nodeKey);
    if (!capability) return false;
    if (viewer.kind === "record") return capability.record === true;
    if (viewer.kind === "activity") return capability.activity === true;
    return hasExactAssetId(capability.cadAssetIds, viewer.assetId);
  });

  return {
    layoutMode: state.layoutMode,
    groupPlacements,
    nodePlacements,
    transform: state.transform,
    viewers,
  };
}

/** Reads, validates and reconciles one project-scoped local snapshot. */
export function loadOverviewThreadWhiteboardPresentation(
  storage: OverviewThreadWhiteboardPresentationStorage,
  projectId: string,
  current: OverviewThreadWhiteboardPresentationReconciliation,
): OverviewThreadWhiteboardPresentationState | undefined {
  const key = overviewThreadWhiteboardPresentationStorageKey(projectId);
  if (!key) return undefined;
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (serialized === null) return undefined;
  const parsed = parseOverviewThreadWhiteboardPresentation(
    serialized,
    projectId,
  );
  return parsed
    ? reconcileOverviewThreadWhiteboardPresentation(parsed, current)
    : undefined;
}

/**
 * Reconciles then writes local presentation state. `false` covers invalid
 * state, unavailable storage and quota/security failures; no backend is used.
 */
export function saveOverviewThreadWhiteboardPresentation(
  storage: OverviewThreadWhiteboardPresentationStorage,
  projectId: string,
  state: OverviewThreadWhiteboardPresentationState,
  current: OverviewThreadWhiteboardPresentationReconciliation,
): boolean {
  const key = overviewThreadWhiteboardPresentationStorageKey(projectId);
  if (!key) return false;
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    projectId,
    reconcileOverviewThreadWhiteboardPresentation(state, current),
  );
  if (!serialized) return false;
  try {
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

function parsePresentationState(
  candidate: unknown,
): OverviewThreadWhiteboardPresentationState | undefined {
  if (
    !isExactRecord(candidate, [
      "layoutMode",
      "groupPlacements",
      "nodePlacements",
      "transform",
      "viewers",
    ]) ||
    (candidate.layoutMode !== "hierarchy" && candidate.layoutMode !== "radial")
  ) {
    return undefined;
  }
  const groupPlacements = parseGroupPlacements(candidate.groupPlacements);
  const nodePlacements = parseNodePlacements(candidate.nodePlacements);
  const transform = parseTransform(candidate.transform);
  const viewers = parseViewers(candidate.viewers);
  if (!groupPlacements || !nodePlacements || !transform || !viewers) {
    return undefined;
  }
  return {
    layoutMode: candidate.layoutMode,
    groupPlacements,
    nodePlacements,
    transform,
    viewers,
  };
}

function parseGroupPlacements(
  candidate: unknown,
): Readonly<Record<string, OverviewThreadD3FlowGroupPlacement>> | undefined {
  if (!isRecord(candidate)) return undefined;
  const entries = Object.entries(candidate);
  if (entries.length > MAX_PLACEMENT_COUNT) return undefined;
  const result = nullRecord<OverviewThreadD3FlowGroupPlacement>();
  for (const [key, value] of entries) {
    if (
      !isSafeId(key) || !isPlacement(value, ["x", "y", "offsetX", "offsetY"])
    ) {
      return undefined;
    }
    result[key] = copyDefinedCoordinates(value, [
      "x",
      "y",
      "offsetX",
      "offsetY",
    ]);
  }
  return result;
}

function parseNodePlacements(
  candidate: unknown,
): Readonly<Record<string, OverviewThreadD3FlowNodePlacement>> | undefined {
  if (!isRecord(candidate)) return undefined;
  const entries = Object.entries(candidate);
  if (entries.length > MAX_PLACEMENT_COUNT) return undefined;
  const result = nullRecord<OverviewThreadD3FlowNodePlacement>();
  for (const [key, value] of entries) {
    if (!isSafeId(key) || !isPlacement(value, ["offsetX", "offsetY"])) {
      return undefined;
    }
    result[key] = copyDefinedCoordinates(value, ["offsetX", "offsetY"]);
  }
  return result;
}

function parseTransform(
  candidate: unknown,
): OverviewThreadWhiteboardTransform | undefined {
  if (
    !isExactRecord(candidate, ["x", "y", "k"]) ||
    !isCoordinate(candidate.x) ||
    !isCoordinate(candidate.y) ||
    !isFiniteNumber(candidate.k) ||
    candidate.k < OVERVIEW_THREAD_WHITEBOARD_MIN_SCALE ||
    candidate.k > OVERVIEW_THREAD_WHITEBOARD_MAX_SCALE
  ) {
    return undefined;
  }
  return { x: candidate.x, y: candidate.y, k: candidate.k };
}

function parseViewers(
  candidate: unknown,
): readonly OverviewThreadWhiteboardPresentationViewer[] | undefined {
  if (!Array.isArray(candidate) || candidate.length > MAX_VIEWER_COUNT) {
    return undefined;
  }
  const viewers: OverviewThreadWhiteboardPresentationViewer[] = [];
  const seenIds = new Set<string>();
  for (const value of candidate) {
    const viewer = parseViewer(value);
    if (!viewer || seenIds.has(viewer.id)) return undefined;
    seenIds.add(viewer.id);
    viewers.push(viewer);
  }
  return viewers;
}

function parseViewer(
  candidate: unknown,
): OverviewThreadWhiteboardPresentationViewer | undefined {
  if (!isRecord(candidate)) return undefined;
  const isCad = candidate.kind === "cad";
  const hasRestoreGeometry = Object.hasOwn(candidate, "restoreGeometry");
  const keys = isCad
    ? [
      "kind",
      "id",
      "nodeKey",
      "assetId",
      "geometry",
      "z",
      "expanded",
      ...(hasRestoreGeometry ? ["restoreGeometry"] : []),
    ]
    : [
      "kind",
      "id",
      "nodeKey",
      "geometry",
      "z",
      "expanded",
      ...(hasRestoreGeometry ? ["restoreGeometry"] : []),
    ];
  if (
    (candidate.kind !== "record" && candidate.kind !== "activity" && !isCad) ||
    !isExactRecord(candidate, keys) ||
    !isSafeId(candidate.id) ||
    !isSafeId(candidate.nodeKey) ||
    typeof candidate.expanded !== "boolean" ||
    (candidate.expanded && !hasRestoreGeometry) ||
    (!candidate.expanded && hasRestoreGeometry &&
      candidate.restoreGeometry !== undefined) ||
    !Number.isSafeInteger(candidate.z) ||
    (candidate.z as number) < 0 ||
    (candidate.z as number) > MAX_Z_INDEX
  ) {
    return undefined;
  }
  const geometry = parseViewerGeometry(candidate.geometry);
  const restoreGeometry = candidate.expanded
    ? parseViewerGeometry(candidate.restoreGeometry)
    : undefined;
  if (!geometry || (candidate.expanded && !restoreGeometry)) return undefined;

  if (isCad) {
    if (!isSafeId(candidate.assetId)) return undefined;
    const viewer: OverviewThreadWhiteboardCadPresentationViewer = {
      kind: "cad",
      id: candidate.id,
      nodeKey: candidate.nodeKey,
      assetId: candidate.assetId,
      geometry,
      z: candidate.z as number,
      expanded: candidate.expanded,
      ...(restoreGeometry ? { restoreGeometry } : {}),
    };
    return viewer.id === expectedViewerId(viewer) ? viewer : undefined;
  }

  const viewer:
    | OverviewThreadWhiteboardRecordPresentationViewer
    | OverviewThreadWhiteboardActivityPresentationViewer = {
      kind: candidate.kind === "record" ? "record" : "activity",
      id: candidate.id,
      nodeKey: candidate.nodeKey,
      geometry,
      z: candidate.z as number,
      expanded: candidate.expanded,
      ...(restoreGeometry ? { restoreGeometry } : {}),
    };
  return viewer.id === expectedViewerId(viewer) ? viewer : undefined;
}

function parseViewerGeometry(
  candidate: unknown,
): OverviewThreadViewerGeometry | undefined {
  if (
    !isExactRecord(candidate, ["x", "y", "width", "height"]) ||
    !isCoordinate(candidate.x) ||
    !isCoordinate(candidate.y) ||
    !isPositiveDimension(candidate.width) ||
    !isPositiveDimension(candidate.height)
  ) {
    return undefined;
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
}

function expectedViewerId(
  viewer: OverviewThreadWhiteboardPresentationViewer,
): string {
  return viewer.kind === "cad"
    ? `cad:${viewer.nodeKey}:${viewer.assetId}`
    : `${viewer.kind}:${viewer.nodeKey}`;
}

function isPlacement(
  candidate: unknown,
  keys: readonly string[],
): candidate is Record<string, number> {
  if (!isRecord(candidate)) return false;
  const ownKeys = Object.keys(candidate);
  return ownKeys.length > 0 && ownKeys.every((key) => keys.includes(key)) &&
    ownKeys.every((key) => isCoordinate(candidate[key]));
}

function copyDefinedCoordinates<T>(
  source: Record<string, number>,
  keys: readonly string[],
): T {
  const result = nullRecord<number>();
  for (const key of keys) {
    const value = source[key];
    if (Object.hasOwn(source, key) && value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

function hasExactAssetId(
  assetIds: readonly string[] | ReadonlySet<string> | undefined,
  assetId: string,
): boolean {
  return assetIds instanceof Set
    ? assetIds.has(assetId)
    : Array.isArray(assetIds) && assetIds.includes(assetId);
}

function ownValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length &&
    ownKeys.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown, maxLength = MAX_ID_LENGTH): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maxLength && value.trim() === value &&
    !hasControlCharacter(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= MAX_ABSOLUTE_COORDINATE;
}

function isPositiveDimension(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 &&
    value <= MAX_ABSOLUTE_COORDINATE;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
