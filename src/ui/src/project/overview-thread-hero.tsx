import { SECTION_LABEL } from "../ui/cockpit.tsx";
import { cn } from "../lib/utils.ts";
import type {
  CSSProperties,
  JSX,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { EngineeringPhaseStatus } from "../../../domain/project/engineering-project.ts";
import {
  buildOverviewThreadHero,
  OVERVIEW_LANES,
  type OverviewActivityHeroNode,
  type OverviewHeroEdge,
  type OverviewHeroNode,
  type OverviewRecordedHeroNode,
} from "./overview-thread-hero-model.ts";
import { buildOverviewThreadD3Layout } from "./overview-thread-d3-layout.ts";
import {
  flowGroupCaption,
  OverviewThreadD3Flow,
  type OverviewThreadD3FlowMoveDirection,
  type OverviewThreadStageSummary,
} from "./overview-thread-d3-flow.tsx";
import {
  buildOverviewThreadD3FlowLayout,
  overviewThreadD3FlowGroupIdentity,
  type OverviewThreadD3FlowGroupLayout,
  type OverviewThreadD3FlowGroupPlacement,
  type OverviewThreadD3FlowNodePlacement,
  type OverviewThreadD3FlowRoutingState,
} from "./overview-thread-d3-flow-layout.ts";
import type { ProjectPathActivityView } from "./model.ts";
import { recordStatusVariant } from "./record-status.ts";
import type {
  ThreadArtifact,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import { GltfAssetCanvas } from "../thread/gltf-asset-canvas.tsx";
import { ToolInspectorPanel } from "../thread/tool-inspectors.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuContextTrigger,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "../ui/dropdown-menu.tsx";
import { resolveOverviewThreadViewerCapabilities } from "./overview-thread-viewer-model.ts";
import {
  loadOverviewThreadWhiteboardPresentation,
  type OverviewThreadWhiteboardPresentationReconciliation,
  type OverviewThreadWhiteboardPresentationState,
  overviewThreadWhiteboardPresentationStorageKey,
  type OverviewThreadWhiteboardPresentationViewer,
  type OverviewThreadWhiteboardViewerCapability,
  saveOverviewThreadWhiteboardPresentation,
} from "./overview-thread-whiteboard-persistence.ts";
import {
  overviewThreadNodeContextValue,
  parseOverviewThreadContextTarget,
} from "./overview-thread-context-target.ts";
import {
  fitOverviewThreadWhiteboardTransform,
  normalizeOverviewThreadWhiteboardTransform,
  type OverviewThreadWhiteboardBounds,
  overviewThreadWhiteboardContentBounds,
  type OverviewThreadWhiteboardTransform,
  panOverviewThreadWhiteboard,
  resetOverviewThreadWhiteboardTransform,
  zoomOverviewThreadWhiteboardAt,
  zoomOverviewThreadWhiteboardByWheel,
} from "./overview-thread-whiteboard-transform.ts";
import {
  buildOverviewThreadViewerConnectorGeometry,
  normalizeOverviewThreadViewerGeometry,
  type OverviewThreadViewerGeometry,
  overviewThreadViewerScreenDeltaToWorld,
  overviewThreadViewerScreenPointToWorld,
  resizeOverviewThreadViewerByScreenDelta,
} from "./overview-thread-viewer-geometry.ts";

const OVERVIEW_SELECTION_ID = "overview-thread-selection";
const OVERVIEW_GRAPH_TITLE_ID = "overview-thread-graph-title";
const OVERVIEW_GRAPH_DESCRIPTION_ID = "overview-thread-graph-description";

type OverviewD3Node = ReturnType<
  typeof buildOverviewThreadD3Layout
>["nodes"][number];
type OverviewFlowNode = ReturnType<
  typeof buildOverviewThreadD3FlowLayout
>["nodes"][number];
type OverviewLayoutMode = "hierarchy" | "radial";
type OverviewReactWheelEvent = Parameters<
  NonNullable<JSX.IntrinsicElements["div"]["onWheel"]>
>[0];

type OverviewNodeContextAction =
  | {
    readonly kind: "inspect-record";
    readonly nodeKey: string;
    readonly label: string;
  }
  | {
    readonly kind: "open-cad";
    readonly nodeKey: string;
    readonly assetId: string;
    readonly label: string;
  }
  | {
    readonly kind: "open-evidence";
    readonly reference: ThreadGraphRef;
    readonly label: string;
  }
  | {
    readonly kind: "inspect-activity";
    readonly nodeKey: string;
    readonly label: string;
  }
  | {
    readonly kind: "open-activity";
    readonly label: string;
  };

type OverviewViewerState =
  | OverviewRecordViewerState
  | OverviewCadViewerState
  | OverviewActivityViewerState;

interface OverviewViewerBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly restoreGeometry?: OverviewThreadViewerGeometry;
}

interface OverviewRecordViewerState extends OverviewViewerBase {
  readonly kind: "record";
  readonly nodeKey: string;
}

interface OverviewCadViewerState extends OverviewViewerBase {
  readonly kind: "cad";
  readonly nodeKey: string;
  readonly assetId: string;
}

interface OverviewActivityViewerState extends OverviewViewerBase {
  readonly kind: "activity";
  readonly nodeKey: string;
}

interface OverviewViewerDragState {
  readonly viewerId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originX: number;
  readonly originY: number;
}

interface OverviewViewerResizeState {
  readonly viewerId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originWidth: number;
  readonly originHeight: number;
}

interface OverviewCanvasPanState {
  readonly pointerId: number;
  lastClientX: number;
  lastClientY: number;
}

interface OverviewWhiteboardPersistenceHydration {
  readonly projectId: string | null;
  readonly restored: boolean;
}

interface OverviewWhiteboardPendingPersistence {
  readonly projectId: string;
  readonly state: OverviewThreadWhiteboardPresentationState;
  readonly reconciliation: OverviewThreadWhiteboardPresentationReconciliation;
}

const OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM = {
  x: 0,
  y: 0,
  k: 1,
} as const satisfies OverviewThreadWhiteboardTransform;
const OVERVIEW_VIEWER_PADDING = 8;
const OVERVIEW_VIEWER_DEFAULT_WIDTH = 340;
const OVERVIEW_VIEWER_DEFAULT_HEIGHT = 280;
const OVERVIEW_VIEWER_MIN_WIDTH = 260;
const OVERVIEW_VIEWER_MIN_HEIGHT = 210;
const OVERVIEW_SELECTION_CARD_WIDTH = 276;
const OVERVIEW_SELECTION_CARD_HEIGHT = 188;
const OVERVIEW_WHITEBOARD_SAVE_DELAY_MS = 240;

export function OverviewThreadHero({
  thread,
  projectId,
  activities = [],
  stages = [],
  immersive = false,
  onOpenEvidence,
  onOpenActivity,
}: {
  readonly thread: ThreadWorkbenchSnapshot;
  readonly projectId?: string;
  readonly activities?: readonly ProjectPathActivityView[];
  readonly stages?: readonly OverviewThreadStageSummary[];
  readonly immersive?: boolean;
  readonly onOpenEvidence: (reference: ThreadGraphRef) => void;
  readonly onOpenActivity: () => void;
}): JSX.Element {
  const view = useMemo(
    () => buildOverviewThreadHero(thread, activities),
    [thread, activities],
  );
  const [groupPlacements, setGroupPlacements] = useState<
    Readonly<Record<string, OverviewThreadD3FlowGroupPlacement>>
  >({});
  const [nodePlacements, setNodePlacements] = useState<
    Readonly<Record<string, OverviewThreadD3FlowNodePlacement>>
  >({});
  const [whiteboardTransform, setWhiteboardTransform] = useState<
    OverviewThreadWhiteboardTransform
  >(OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM);
  const [whiteboardWorldSize, setWhiteboardWorldSize] = useState({
    width: 1000,
    height: 560,
  });
  // Magnetic corridor membership is transient visual state. It stabilises
  // capture/release across drag frames, but is intentionally excluded from
  // the persisted whiteboard and every Thread authority contract.
  const flowRoutingStateRef = useRef<OverviewThreadD3FlowRoutingState>();
  const radialLayout = useMemo(
    () =>
      buildOverviewThreadD3Layout(
        view.nodes.map(({ key, lane, groupKey, label }) => ({
          key,
          lane,
          groupKey,
          label,
        })),
        view.edges,
        overviewD3LayoutOptions(view.nodes.length),
      ),
    [view.edges, view.nodes],
  );
  const flowLayout = useMemo(
    () =>
      buildOverviewThreadD3FlowLayout(
        view.nodes.map((item) => ({
          key: item.key,
          lane: item.lane,
          groupKey: item.groupKey,
          label: item.label,
          ...(item.kind === "recorded" && item.node.recordedAt
            ? { recordedAt: item.node.recordedAt }
            : {}),
          ...(item.kind === "recorded" && item.parentKey
            ? { parentKey: item.parentKey }
            : {}),
        })),
        view.edges,
        immersive
          ? {
            minHeight: 560,
            topInset: 64,
            bottomInset: 104,
            groupPlacements,
            nodePlacements,
            previousRoutingState: flowRoutingStateRef.current,
          }
          : {
            groupPlacements,
            nodePlacements,
            previousRoutingState: flowRoutingStateRef.current,
          },
      ),
    [groupPlacements, immersive, nodePlacements, view.edges, view.nodes],
  );
  const flowLayoutRef = useRef(flowLayout);
  flowLayoutRef.current = flowLayout;
  useEffect(() => {
    flowRoutingStateRef.current = flowLayout.nextRoutingState;
  }, [flowLayout.nextRoutingState]);
  const nodesByKey = useMemo(
    () => new Map(view.nodes.map((item) => [item.key, item])),
    [view.nodes],
  );
  const persistenceProjectId = projectId &&
      overviewThreadWhiteboardPresentationStorageKey(projectId)
    ? projectId
    : undefined;
  const persistenceGroupKeys = useMemo(
    () => [
      ...new Set(
        view.nodes.map((item) =>
          overviewThreadD3FlowGroupIdentity(item.lane, item.groupKey)
        ),
      ),
    ],
    [view.nodes],
  );
  const persistenceNodeKeys = useMemo(
    () => view.nodes.map((item) => item.key),
    [view.nodes],
  );
  const persistenceViewerCapabilities = useMemo(() => {
    const result = Object.create(null) as Record<
      string,
      OverviewThreadWhiteboardViewerCapability
    >;
    for (const item of view.nodes) {
      if (item.kind === "activity") {
        result[item.key] = { activity: true };
        continue;
      }
      const capabilities = resolveOverviewThreadViewerCapabilities(
        thread,
        item.node,
      );
      result[item.key] = {
        record: capabilities.inspectRecord,
        cadAssetIds: capabilities.cadAssets.map((asset) => asset.id),
      };
    }
    return result;
  }, [thread, view.nodes]);
  const persistenceReconciliation = useMemo<
    OverviewThreadWhiteboardPresentationReconciliation
  >(() => ({
    groupKeys: persistenceGroupKeys,
    nodeKeys: persistenceNodeKeys,
    viewerCapabilities: persistenceViewerCapabilities,
  }), [
    persistenceGroupKeys,
    persistenceNodeKeys,
    persistenceViewerCapabilities,
  ]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [hoveredKey, setHoveredKey] = useState<string>();
  const [focusedKey, setFocusedKey] = useState<string>();
  const [contextTriggerValue, setContextTriggerValue] = useState<
    string | null
  >(null);
  const [layoutMode, setLayoutMode] = useState<OverviewLayoutMode>("hierarchy");
  const [viewers, setViewers] = useState<readonly OverviewViewerState[]>([]);
  const [persistenceHydration, setPersistenceHydration] = useState<
    OverviewWhiteboardPersistenceHydration
  >();
  const heroRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<OverviewViewerDragState>();
  const resizeRef = useRef<OverviewViewerResizeState>();
  const canvasPanRef = useRef<OverviewCanvasPanState>();
  const whiteboardTouchedRef = useRef(false);
  const skipNextAutoFitRef = useRef(false);
  const persistenceReconciliationRef = useRef(persistenceReconciliation);
  const persistenceTimerRef = useRef<number>();
  const pendingPersistenceRef = useRef<
    OverviewWhiteboardPendingPersistence
  >();
  const flushPersistenceRef = useRef<() => void>(() => undefined);
  const nodeRefs = useRef(
    new Map<string, HTMLButtonElement | SVGGElement>(),
  );
  const viewerRefs = useRef(new Map<string, HTMLElement>());
  persistenceReconciliationRef.current = persistenceReconciliation;
  flushPersistenceRef.current = () => {
    if (persistenceTimerRef.current !== undefined) {
      clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = undefined;
    }
    const pending = pendingPersistenceRef.current;
    pendingPersistenceRef.current = undefined;
    const storage = overviewWhiteboardBrowserStorage();
    if (!pending || !storage) return;
    saveOverviewThreadWhiteboardPresentation(
      storage,
      pending.projectId,
      pending.state,
      pending.reconciliation,
    );
  };
  useEffect(() => {
    flushPersistenceRef.current();
    const storage = overviewWhiteboardBrowserStorage();
    const restored = persistenceProjectId && storage
      ? loadOverviewThreadWhiteboardPresentation(
        storage,
        persistenceProjectId,
        persistenceReconciliationRef.current,
      )
      : undefined;
    if (restored) {
      setLayoutMode(restored.layoutMode);
      setGroupPlacements(restored.groupPlacements);
      setNodePlacements(restored.nodePlacements);
      setWhiteboardTransform(restored.transform);
      setViewers(restored.viewers.map(overviewViewerFromPresentation));
    } else {
      setLayoutMode("hierarchy");
      setGroupPlacements({});
      setNodePlacements({});
      setWhiteboardTransform(OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM);
      setViewers([]);
    }
    whiteboardTouchedRef.current = restored !== undefined;
    skipNextAutoFitRef.current = restored !== undefined;
    setPersistenceHydration({
      projectId: persistenceProjectId ?? null,
      restored: restored !== undefined,
    });
  }, [persistenceProjectId]);
  useEffect(() => {
    const visibleKeys = new Set(view.nodes.map((item) => item.key));
    setSelectedKey((current) =>
      current && !visibleKeys.has(current) ? undefined : current
    );
    setHoveredKey((current) =>
      current && !visibleKeys.has(current) ? undefined : current
    );
    const firstKey = layoutMode === "hierarchy"
      ? flowLayout.nodes[0]?.key
      : radialLayout.nodes[0]?.key;
    setFocusedKey((current) =>
      current && visibleKeys.has(current) ? current : firstKey
    );
    setViewers((current) =>
      current.filter((viewer) => visibleKeys.has(viewer.nodeKey))
    );
  }, [
    flowLayout.nodes,
    layoutMode,
    radialLayout.nodes,
    view.nodes,
  ]);
  useEffect(() => {
    if (
      persistenceHydration?.projectId !== (persistenceProjectId ?? null)
    ) return;
    if (skipNextAutoFitRef.current) {
      skipNextAutoFitRef.current = false;
      return;
    }
    if (whiteboardTouchedRef.current) return;
    whiteboardTouchedRef.current = false;
    const frame = requestAnimationFrame(() => {
      const bounds = readOverviewWhiteboardBounds(
        viewportRef.current,
        worldRef.current,
        [],
        layoutMode === "hierarchy" ? flowLayoutRef.current : undefined,
      );
      setWhiteboardTransform(
        bounds
          ? fitOverviewThreadWhiteboardTransform(bounds)
          : OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [
    immersive,
    layoutMode,
    persistenceHydration?.projectId,
    persistenceHydration?.restored,
    persistenceProjectId,
    radialLayout.viewBox[2],
    radialLayout.viewBox[3],
    view.nodes.length,
  ]);
  useEffect(() => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const bounds = readOverviewWhiteboardBounds(
        viewport,
        world,
        [],
        layoutMode === "hierarchy" ? flowLayoutRef.current : undefined,
      );
      if (!bounds) return;
      setWhiteboardWorldSize((current) => {
        const next = {
          width: world.offsetWidth,
          height: world.offsetHeight,
        };
        return current.width === next.width && current.height === next.height
          ? current
          : next;
      });
      setWhiteboardTransform((current) =>
        whiteboardTouchedRef.current
          ? normalizeOverviewThreadWhiteboardTransform(current, bounds)
          : fitOverviewThreadWhiteboardTransform(bounds)
      );
    });
    observer.observe(viewport);
    observer.observe(world);
    return () => observer.disconnect();
  }, [immersive, layoutMode]);
  useEffect(() => {
    if (
      !persistenceProjectId ||
      persistenceHydration?.projectId !== persistenceProjectId
    ) return;
    pendingPersistenceRef.current = {
      projectId: persistenceProjectId,
      state: overviewPresentationState(
        layoutMode,
        groupPlacements,
        nodePlacements,
        whiteboardTransform,
        viewers,
      ),
      reconciliation: persistenceReconciliation,
    };
    if (persistenceTimerRef.current !== undefined) {
      clearTimeout(persistenceTimerRef.current);
    }
    persistenceTimerRef.current = window.setTimeout(
      () => flushPersistenceRef.current(),
      OVERVIEW_WHITEBOARD_SAVE_DELAY_MS,
    );
    return () => {
      if (persistenceTimerRef.current !== undefined) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = undefined;
      }
    };
  }, [
    groupPlacements,
    layoutMode,
    nodePlacements,
    persistenceHydration?.projectId,
    persistenceProjectId,
    persistenceReconciliation,
    viewers,
    whiteboardTransform,
  ]);
  useEffect(() => {
    const flush = () => flushPersistenceRef.current();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  const selected = view.nodes.find((item) => item.key === selectedKey);
  const activeKey = selectedKey ?? hoveredKey;
  const relatedKeys = useMemo(
    () => overviewRelatedNodeKeys(view.edges, activeKey),
    [view.edges, activeKey],
  );
  const toggleSelection = (item: OverviewHeroNode) => {
    setSelectedKey((current) => nextOverviewHeroSelection(current, item.key));
  };
  const selectNode = (key: string) => {
    if (!nodesByKey.has(key)) return;
    setSelectedKey(key);
    setHoveredKey(undefined);
    setFocusedKey(key);
    requestAnimationFrame(() => nodeRefs.current.get(key)?.focus());
  };
  const bringViewerFront = (viewerId: string) => {
    setViewers((current) => {
      const top = Math.max(0, ...current.map((viewer) => viewer.z)) + 1;
      return current.map((viewer) =>
        viewer.id === viewerId ? { ...viewer, z: top } : viewer
      );
    });
  };
  const openViewer = (
    request:
      | { readonly kind: "record"; readonly nodeKey: string }
      | {
        readonly kind: "cad";
        readonly nodeKey: string;
        readonly assetId: string;
      }
      | { readonly kind: "activity"; readonly nodeKey: string },
  ) => {
    const id = overviewViewerId(request);
    setViewers((current) => {
      const top = Math.max(0, ...current.map((viewer) => viewer.z)) + 1;
      if (current.some((viewer) => viewer.id === id)) {
        return current.map((viewer) =>
          viewer.id === id ? { ...viewer, z: top } : viewer
        );
      }
      const world = worldRef.current;
      const viewport = viewportRef.current;
      const anchor = nodeRefs.current.get(request.nodeKey);
      const viewportBounds = viewport?.getBoundingClientRect();
      const anchorBounds = anchor?.getBoundingClientRect();
      const worldWidth = world?.offsetWidth ?? whiteboardWorldSize.width;
      const worldHeight = world?.offsetHeight ?? whiteboardWorldSize.height;
      const anchorPoint = viewportBounds && anchorBounds
        ? overviewThreadViewerScreenPointToWorld(
          {
            x: anchorBounds.left + anchorBounds.width / 2 -
              viewportBounds.left,
            y: anchorBounds.top + anchorBounds.height / 2 -
              viewportBounds.top,
          },
          whiteboardTransform,
        )
        : { x: worldWidth / 2, y: worldHeight / 2 };
      const cascade = current.length % 6;
      const width = Math.min(
        OVERVIEW_VIEWER_DEFAULT_WIDTH,
        Math.max(180, worldWidth - OVERVIEW_VIEWER_PADDING * 2),
      );
      const height = Math.min(
        OVERVIEW_VIEWER_DEFAULT_HEIGHT,
        Math.max(160, worldHeight - OVERVIEW_VIEWER_PADDING * 2),
      );
      const geometry = normalizeOverviewThreadViewerGeometry(
        initialOverviewViewerGeometry(
          anchorPoint,
          { width, height },
          { width: worldWidth, height: worldHeight },
          cascade,
        ),
        overviewViewerGeometryConstraints(),
      );
      return [...current, {
        ...request,
        id,
        ...geometry,
        z: top,
      } as OverviewViewerState];
    });
    setSelectedKey(undefined);
    setHoveredKey(undefined);
    setFocusedKey(undefined);
    requestAnimationFrame(() => viewerRefs.current.get(id)?.focus());
  };
  const runContextAction = (action: OverviewNodeContextAction) => {
    if (action.kind === "inspect-record") {
      openViewer({ kind: "record", nodeKey: action.nodeKey });
      return;
    }
    if (action.kind === "open-cad") {
      openViewer({
        kind: "cad",
        nodeKey: action.nodeKey,
        assetId: action.assetId,
      });
      return;
    }
    if (action.kind === "inspect-activity") {
      openViewer({ kind: "activity", nodeKey: action.nodeKey });
      return;
    }
    if (action.kind === "open-evidence") {
      onOpenEvidence(action.reference);
      return;
    }
    onOpenActivity();
  };
  const closeViewer = (viewerId: string) => {
    const viewer = viewers.find((candidate) => candidate.id === viewerId);
    setViewers((current) => current.filter((viewer) => viewer.id !== viewerId));
    if (viewer) {
      setFocusedKey(viewer.nodeKey);
      requestAnimationFrame(() =>
        nodeRefs.current.get(viewer.nodeKey)?.focus()
      );
    }
  };
  const beginViewerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    viewer: OverviewViewerState,
  ) => {
    if (
      event.button !== 0 || viewer.restoreGeometry ||
      (event.target as Element).closest("button")
    ) return;
    event.stopPropagation();
    dragRef.current = {
      viewerId: viewer.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: viewer.x,
      originY: viewer.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    bringViewerFront(viewer.id);
  };
  const moveViewer = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setViewers((current) =>
      current.map((viewer) => {
        if (viewer.id !== drag.viewerId) return viewer;
        const delta = overviewThreadViewerScreenDeltaToWorld(
          {
            x: event.clientX - drag.startClientX,
            y: event.clientY - drag.startClientY,
          },
          whiteboardTransform,
        );
        const geometry = normalizeOverviewThreadViewerGeometry(
          {
            ...viewer,
            x: drag.originX + delta.x,
            y: drag.originY + delta.y,
          },
          overviewViewerGeometryConstraints(),
        );
        return { ...viewer, ...geometry };
      })
    );
  };
  const endViewerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const beginViewerResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    viewer: OverviewViewerState,
  ) => {
    if (viewer.restoreGeometry || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      viewerId: viewer.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originWidth: viewer.width,
      originHeight: viewer.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    bringViewerFront(viewer.id);
  };
  const moveViewerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setViewers((current) =>
      current.map((viewer) => {
        if (viewer.id !== resize.viewerId) return viewer;
        const geometry = resizeOverviewThreadViewerByScreenDelta(
          {
            ...viewer,
            width: resize.originWidth,
            height: resize.originHeight,
          },
          {
            x: event.clientX - resize.startClientX,
            y: event.clientY - resize.startClientY,
          },
          whiteboardTransform,
          overviewViewerGeometryConstraints(),
        );
        return { ...viewer, ...geometry };
      })
    );
  };
  const endViewerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const toggleViewerExpanded = (viewerId: string) => {
    const viewport = viewportRef.current;
    const visibleTopLeft = viewport
      ? overviewThreadViewerScreenPointToWorld(
        { x: OVERVIEW_VIEWER_PADDING, y: OVERVIEW_VIEWER_PADDING },
        whiteboardTransform,
      )
      : { x: OVERVIEW_VIEWER_PADDING, y: OVERVIEW_VIEWER_PADDING };
    const visibleBottomRight = viewport
      ? overviewThreadViewerScreenPointToWorld(
        {
          x: viewport.clientWidth - OVERVIEW_VIEWER_PADDING,
          y: viewport.clientHeight - OVERVIEW_VIEWER_PADDING,
        },
        whiteboardTransform,
      )
      : {
        x: whiteboardWorldSize.width - OVERVIEW_VIEWER_PADDING,
        y: whiteboardWorldSize.height - OVERVIEW_VIEWER_PADDING,
      };
    setViewers((current) =>
      current.map((viewer) => {
        if (viewer.id !== viewerId) return viewer;
        if (viewer.restoreGeometry) {
          return {
            ...viewer,
            ...viewer.restoreGeometry,
            restoreGeometry: undefined,
          };
        }
        const restoreGeometry = overviewViewerGeometry(viewer);
        return {
          ...viewer,
          x: visibleTopLeft.x,
          y: visibleTopLeft.y,
          width: Math.max(
            OVERVIEW_VIEWER_MIN_WIDTH,
            visibleBottomRight.x - visibleTopLeft.x,
          ),
          height: Math.max(
            OVERVIEW_VIEWER_MIN_HEIGHT,
            visibleBottomRight.y - visibleTopLeft.y,
          ),
          restoreGeometry,
        };
      })
    );
    bringViewerFront(viewerId);
  };
  const moveViewerByKeyboard = (
    viewerId: string,
    direction: OverviewThreadD3FlowMoveDirection,
  ) => {
    const delta = overviewThreadViewerScreenDeltaToWorld(
      overviewDirectionDelta(direction, 18),
      whiteboardTransform,
    );
    setViewers((current) =>
      current.map((viewer) =>
        viewer.id === viewerId && !viewer.restoreGeometry
          ? {
            ...viewer,
            ...normalizeOverviewThreadViewerGeometry(
              {
                ...viewer,
                x: viewer.x + delta.x,
                y: viewer.y + delta.y,
              },
              overviewViewerGeometryConstraints(),
            ),
          }
          : viewer
      )
    );
  };
  const resizeViewerByKeyboard = (
    viewerId: string,
    direction: OverviewThreadD3FlowMoveDirection,
  ) => {
    const delta = overviewThreadViewerScreenDeltaToWorld(
      overviewDirectionDelta(direction, 18),
      whiteboardTransform,
    );
    setViewers((current) =>
      current.map((viewer) =>
        viewer.id === viewerId && !viewer.restoreGeometry
          ? {
            ...viewer,
            ...normalizeOverviewThreadViewerGeometry(
              {
                ...viewer,
                width: viewer.width + delta.x,
                height: viewer.height + delta.y,
              },
              overviewViewerGeometryConstraints(),
            ),
          }
          : viewer
      )
    );
  };
  const fitWhiteboard = () => {
    const bounds = readOverviewWhiteboardBounds(
      viewportRef.current,
      worldRef.current,
      viewers,
      layoutMode === "hierarchy" ? flowLayout : undefined,
    );
    if (!bounds) return;
    whiteboardTouchedRef.current = false;
    setWhiteboardTransform(fitOverviewThreadWhiteboardTransform(bounds));
  };
  const changeLayoutMode = (next: OverviewLayoutMode) => {
    if (next === layoutMode) return;
    whiteboardTouchedRef.current = false;
    setLayoutMode(next);
  };
  const zoomWhiteboard = (factor: number) => {
    const viewport = viewportRef.current;
    const bounds = readOverviewWhiteboardBounds(viewport, worldRef.current);
    if (!viewport || !bounds) return;
    whiteboardTouchedRef.current = true;
    setWhiteboardTransform((current) =>
      zoomOverviewThreadWhiteboardAt(
        current,
        { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
        current.k * factor,
        bounds,
      )
    );
  };
  const resetWhiteboard = () => {
    setGroupPlacements({});
    setNodePlacements({});
    whiteboardTouchedRef.current = false;
    const bounds = readOverviewWhiteboardBounds(
      viewportRef.current,
      worldRef.current,
    );
    setWhiteboardTransform(
      bounds
        ? resetOverviewThreadWhiteboardTransform(bounds)
        : OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM,
    );
    requestAnimationFrame(fitWhiteboard);
  };
  const handleWhiteboardWheel = (
    event: OverviewReactWheelEvent,
  ) => {
    if (
      (event.target as Element).closest(
        ".overview-thread-viewer, .overview-thread-selection-card",
      )
    ) return;
    const viewport = viewportRef.current;
    const bounds = readOverviewWhiteboardBounds(viewport, worldRef.current);
    if (!viewport || !bounds) return;
    event.preventDefault();
    const viewportBounds = viewport.getBoundingClientRect();
    const deltaMultiplier = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
      ? viewport.clientHeight
      : 1;
    whiteboardTouchedRef.current = true;
    setWhiteboardTransform((current) =>
      zoomOverviewThreadWhiteboardByWheel(
        current,
        {
          x: event.clientX - viewportBounds.left,
          y: event.clientY - viewportBounds.top,
        },
        event.deltaY * deltaMultiplier,
        { minScale: bounds.minScale, maxScale: bounds.maxScale },
      )
    );
  };
  const beginCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (
      target.closest(
        "button, [role='button'], .overview-thread-viewer, .overview-thread-selection-card",
      )
    ) return;
    whiteboardTouchedRef.current = true;
    canvasPanRef.current = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const delta = {
      x: event.clientX - pan.lastClientX,
      y: event.clientY - pan.lastClientY,
    };
    pan.lastClientX = event.clientX;
    pan.lastClientY = event.clientY;
    event.preventDefault();
    setWhiteboardTransform((current) =>
      panOverviewThreadWhiteboard(current, delta)
    );
  };
  const endCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    canvasPanRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const moveFocus = (key: string) => {
    setFocusedKey(key);
    requestAnimationFrame(() => nodeRefs.current.get(key)?.focus());
  };
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] =
    radialLayout.viewBox;
  const unroutedEdgeCount = layoutMode === "hierarchy"
    ? flowLayout.unroutedEdgeKeys.length
    : radialLayout.unroutedEdgeKeys.length;
  const contextTarget = parseOverviewThreadContextTarget(contextTriggerValue);
  const contextNode = contextTarget?.kind === "node"
    ? nodesByKey.get(contextTarget.key)
    : undefined;
  const contextGroup = contextTarget?.kind === "group"
    ? flowLayout.groups.find((group) => group.key === contextTarget.key)
    : undefined;
  const contextActions = contextNode
    ? overviewNodeContextActions(thread, contextNode)
    : [];
  const commitContextTargetBeforeOpen = (value: string | null | undefined) => {
    if (!parseOverviewThreadContextTarget(value)) return;
    flushSync(() => setContextTriggerValue(value!));
  };
  const selectedAnchor = selected
    ? overviewViewerAnchorPoint(
      selected.key,
      layoutMode,
      flowLayout,
      radialLayout,
      whiteboardWorldSize,
    )
    : undefined;
  const selectedCard = selectedAnchor
    ? overviewSelectionCardGeometry(selectedAnchor, whiteboardWorldSize)
    : undefined;
  const selectedCardConnector = selectedAnchor && selectedCard
    ? buildOverviewThreadViewerConnectorGeometry(selectedAnchor, selectedCard)
    : undefined;
  return (
    <DropdownMenu
      triggerValue={contextTriggerValue}
      onTriggerValueChange={(details) => {
        if (parseOverviewThreadContextTarget(details.value)) {
          setContextTriggerValue(details.value);
        }
      }}
    >
      <div
        ref={heroRef}
        className={cn(
          "overview-thread-hero",
          immersive && "overview-thread-hero-immersive",
        )}
        data-immersive={immersive ? "true" : undefined}
        onContextMenuCapture={(event) => {
          const target = (event.target as Element).closest(
            "[data-overview-context-target]",
          );
          const value = target?.getAttribute("data-overview-context-target");
          commitContextTargetBeforeOpen(value);
        }}
        onPointerDownCapture={(event) => {
          const target = event.target as Element;
          const contextValue = target.closest(
            "[data-overview-context-target]",
          )?.getAttribute("data-overview-context-target");
          if (contextValue) setContextTriggerValue(contextValue);
          if (
            !target.closest(
              ".overview-thread-flow-node, .overview-thread-node, .overview-thread-viewer, .overview-thread-layout-switch, #overview-thread-selection, [data-part='context-trigger'], button",
            )
          ) {
            setSelectedKey(undefined);
            setHoveredKey(undefined);
          }
        }}
      >
        <div
          className="overview-thread-layout-switch"
          role="group"
          aria-label="Whiteboard controls"
        >
          <button
            type="button"
            aria-pressed={layoutMode === "hierarchy"}
            onClick={() => changeLayoutMode("hierarchy")}
          >
            Hierarchy
          </button>
          <button
            type="button"
            aria-pressed={layoutMode === "radial"}
            onClick={() => changeLayoutMode("radial")}
          >
            Radial
          </button>
          <span className="overview-thread-layout-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={() => zoomWhiteboard(0.82)}
          >
            Zoom out
          </button>
          <button type="button" onClick={fitWhiteboard}>
            Fit
          </button>
          <button
            type="button"
            onClick={() => zoomWhiteboard(1.22)}
          >
            Zoom in
          </button>
          <span
            className="overview-thread-layout-scale"
            aria-label={`Zoom ${
              Math.round(whiteboardTransform.k * 100)
            } percent`}
          >
            {Math.round(whiteboardTransform.k * 100)}%
          </span>
          <button type="button" onClick={resetWhiteboard}>
            Reset layout
          </button>
        </div>
        <div
          ref={viewportRef}
          className="overview-thread-viewport"
          data-whiteboard-grid="true"
          aria-label="Digital thread whiteboard"
          style={overviewWhiteboardViewportStyle(whiteboardTransform)}
          onWheel={handleWhiteboardWheel}
          onPointerDown={beginCanvasPan}
          onPointerMove={moveCanvasPan}
          onPointerUp={endCanvasPan}
          onPointerCancel={endCanvasPan}
        >
          <div
            ref={worldRef}
            className="overview-thread-whiteboard-world"
            style={{
              transform:
                `translate3d(${whiteboardTransform.x}px, ${whiteboardTransform.y}px, 0) scale(${whiteboardTransform.k})`,
            }}
          >
            {layoutMode === "hierarchy"
              ? (
                <OverviewThreadD3Flow
                  layout={flowLayout}
                  nodesByKey={nodesByKey}
                  stages={stages}
                  showLaneStrip={!immersive}
                  activeKey={activeKey}
                  selectedKey={selectedKey}
                  focusedKey={focusedKey}
                  onHover={setHoveredKey}
                  onFocus={(key) => {
                    setFocusedKey(key);
                    setHoveredKey(key);
                  }}
                  onToggle={(key) => {
                    const item = nodesByKey.get(key);
                    if (item) toggleSelection(item);
                  }}
                  onMoveGroup={(key, position) => {
                    setGroupPlacements((current) => ({
                      ...current,
                      [key]: { ...current[key], ...position },
                    }));
                  }}
                  onResizeGroup={(key, size) => {
                    setGroupPlacements((current) => ({
                      ...current,
                      [key]: { ...current[key], ...size },
                    }));
                  }}
                  onSetGroupView={(key, view) => {
                    setGroupPlacements((current) => ({
                      ...current,
                      [key]: { ...current[key], view },
                    }));
                  }}
                  onCycleGroupSort={(key) => {
                    setGroupPlacements((current) => {
                      const order = current[key]?.sort ?? "recorded";
                      const next = order === "recorded"
                        ? "recent"
                        : order === "recent"
                        ? "name"
                        : "recorded";
                      return {
                        ...current,
                        [key]: { ...current[key], sort: next },
                      };
                    });
                  }}
                  onScrollGroup={(key, rows) => {
                    setGroupPlacements((current) => ({
                      ...current,
                      [key]: {
                        ...current[key],
                        scrollRow: Math.max(
                          0,
                          (current[key]?.scrollRow ?? 0) + rows,
                        ),
                      },
                    }));
                  }}
                  onToggleGroupFold={(key) => {
                    setGroupPlacements((current) => ({
                      ...current,
                      [key]: {
                        ...current[key],
                        collapsed: !current[key]?.collapsed,
                      },
                    }));
                  }}
                  boardScale={whiteboardTransform.k}
                  onMove={(key, direction) => {
                    const current = flowLayout.nodes.find((node) =>
                      node.key === key
                    );
                    if (!current) return;
                    const next = directionalOverviewFlowNode(
                      flowLayout.nodes,
                      current,
                      direction,
                    );
                    if (next) moveFocus(next.key);
                  }}
                  refNode={(key, node) => {
                    if (node) nodeRefs.current.set(key, node);
                    else nodeRefs.current.delete(key);
                  }}
                />
              )
              : (
                <div className="overview-thread-map">
                  <svg
                    viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`}
                    width={viewBoxWidth}
                    height={viewBoxHeight}
                    className="overview-thread-svg"
                    role="group"
                    aria-labelledby={`${OVERVIEW_GRAPH_TITLE_ID} ${OVERVIEW_GRAPH_DESCRIPTION_ID}`}
                  >
                    <title id={OVERVIEW_GRAPH_TITLE_ID}>
                      Project digital thread
                    </title>
                    <desc id={OVERVIEW_GRAPH_DESCRIPTION_ID}>
                      A static D3 hierarchical edge-bundling view of recorded
                      requirements, system model, geometry, physics and
                      verdicts. Use the arrow keys to move between records, then
                      Enter to inspect one.
                    </desc>
                    <g aria-hidden="true" className="overview-thread-lane-arcs">
                      {radialLayout.lanes.map((lane) => (
                        <path
                          key={lane.lane}
                          d={lane.arcD}
                          fill="none"
                          stroke={lane.color}
                          className="overview-thread-lane-arc"
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </g>
                    <g aria-hidden="true" className="overview-thread-cables">
                      {radialLayout.edges.map((edge) => {
                        const state = overviewEdgeState(edge, activeKey);
                        return (
                          <path
                            key={edge.key}
                            d={edge.d}
                            fill="none"
                            className="overview-thread-cable"
                            data-state={state}
                            strokeWidth={overviewCableWidth(edge.pathCount)}
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      })}
                    </g>
                    {radialLayout.lanes.map((lane) => {
                      const point = overviewLaneLabelPoint(
                        radialLayout.nodes,
                        lane.labelAngle,
                      );
                      return (
                        <text
                          key={`label:${lane.lane}`}
                          x={point.x}
                          y={point.y}
                          className="overview-thread-lane-label"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={lane.color}
                          aria-hidden="true"
                        >
                          {lane.title}
                        </text>
                      );
                    })}
                    {radialLayout.nodes.map((position) => {
                      const item = nodesByKey.get(position.key);
                      if (!item) return null;
                      return (
                        <HeroNode
                          key={item.key}
                          refNode={(node) => {
                            if (node) nodeRefs.current.set(item.key, node);
                            else nodeRefs.current.delete(item.key);
                          }}
                          item={item}
                          position={position}
                          tabIndex={item.key === focusedKey ? 0 : -1}
                          selected={item.key === selectedKey}
                          related={activeKey === undefined ||
                            relatedKeys.has(item.key)}
                          onHoverChange={(hovered) =>
                            setHoveredKey(hovered ? item.key : undefined)}
                          onFocus={() => {
                            setFocusedKey(item.key);
                            setHoveredKey(item.key);
                          }}
                          onToggle={() => toggleSelection(item)}
                          onMove={(key) => {
                            const next = directionalOverviewNode(
                              radialLayout.nodes,
                              position,
                              key,
                            );
                            if (next) moveFocus(next.key);
                          }}
                        />
                      );
                    })}
                  </svg>
                </div>
              )}
          </div>
          {(viewers.length > 0 || (selected && selectedCard)) && (
            <div
              className="overview-thread-viewer-layer"
              aria-label="Whiteboard selection and open spatial viewers"
              style={{
                width: whiteboardWorldSize.width,
                height: whiteboardWorldSize.height,
                transform:
                  `translate3d(${whiteboardTransform.x}px, ${whiteboardTransform.y}px, 0) scale(${whiteboardTransform.k})`,
              }}
            >
              <svg
                className="overview-thread-viewer-connectors"
                viewBox={`0 0 ${whiteboardWorldSize.width} ${whiteboardWorldSize.height}`}
                width="100%"
                height="100%"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                {selectedCardConnector && (
                  <g data-selection-node={selected?.key}>
                    <path
                      className="overview-thread-selection-connector"
                      d={selectedCardConnector.d}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      className="overview-thread-selection-anchor"
                      cx={selectedAnchor?.x}
                      cy={selectedAnchor?.y}
                      r="3.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )}
                {viewers.map((viewer) => {
                  const anchor = overviewViewerAnchorPoint(
                    viewer.nodeKey,
                    layoutMode,
                    flowLayout,
                    radialLayout,
                    whiteboardWorldSize,
                  );
                  if (!anchor) return null;
                  const connector = buildOverviewThreadViewerConnectorGeometry(
                    anchor,
                    viewer,
                  );
                  return (
                    <g key={viewer.id} data-viewer-id={viewer.id}>
                      <path
                        className="overview-thread-viewer-connector"
                        d={connector.d}
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        className="overview-thread-viewer-anchor"
                        cx={anchor.x}
                        cy={anchor.y}
                        r="3.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              </svg>
              {selected && selectedCard && (
                <OverviewNodeSelectionCard
                  item={selected}
                  thread={thread}
                  geometry={selectedCard}
                  onAction={runContextAction}
                  onDismiss={() => {
                    setSelectedKey(undefined);
                    setHoveredKey(undefined);
                    setFocusedKey(selected.key);
                    requestAnimationFrame(() =>
                      nodeRefs.current.get(selected.key)?.focus()
                    );
                  }}
                />
              )}
              {viewers.map((viewer) => {
                const item = nodesByKey.get(viewer.nodeKey);
                if (!item) return null;
                const cadAsset = viewer.kind === "cad" &&
                    item?.kind === "recorded"
                  ? resolveOverviewThreadViewerCapabilities(thread, item.node)
                    .cadAssets.find((asset) => asset.id === viewer.assetId)
                  : undefined;
                return (
                  <OverviewFloatingViewer
                    key={viewer.id}
                    refViewer={(node) => {
                      if (node) viewerRefs.current.set(viewer.id, node);
                      else viewerRefs.current.delete(viewer.id);
                    }}
                    viewer={viewer}
                    item={item}
                    thread={thread}
                    cadAsset={cadAsset}
                    onBringFront={() => bringViewerFront(viewer.id)}
                    onClose={() => closeViewer(viewer.id)}
                    onToggleExpanded={() => toggleViewerExpanded(viewer.id)}
                    onMoveByKeyboard={(direction) =>
                      moveViewerByKeyboard(viewer.id, direction)}
                    onResizeByKeyboard={(direction) =>
                      resizeViewerByKeyboard(viewer.id, direction)}
                    onDragStart={(event) => beginViewerDrag(event, viewer)}
                    onDrag={moveViewer}
                    onDragEnd={endViewerDrag}
                    onResizeStart={(event) => beginViewerResize(event, viewer)}
                    onResize={moveViewerResize}
                    onResizeEnd={endViewerResize}
                  />
                );
              })}
            </div>
          )}
        </div>
        {unroutedEdgeCount > 0 && (
          <p className="m-0 border-t border-border px-4 py-2 text-xs text-warning">
            {unroutedEdgeCount}{" "}
            graph connections unavailable in this projection.
          </p>
        )}
      </div>
      <OverviewThreadContextMenu
        node={contextNode}
        group={contextGroup}
        nodesByKey={nodesByKey}
        actions={contextActions}
        onAction={runContextAction}
        onSelectNode={selectNode}
      />
    </DropdownMenu>
  );
}

function overviewPresentationState(
  layoutMode: OverviewLayoutMode,
  groupPlacements: Readonly<
    Record<string, OverviewThreadD3FlowGroupPlacement>
  >,
  nodePlacements: Readonly<
    Record<string, OverviewThreadD3FlowNodePlacement>
  >,
  transform: OverviewThreadWhiteboardTransform,
  viewers: readonly OverviewViewerState[],
): OverviewThreadWhiteboardPresentationState {
  return {
    layoutMode,
    groupPlacements,
    nodePlacements,
    transform,
    viewers: viewers.map(overviewViewerToPresentation),
  };
}

function overviewViewerToPresentation(
  viewer: OverviewViewerState,
): OverviewThreadWhiteboardPresentationViewer {
  const spatial = {
    id: viewer.id,
    nodeKey: viewer.nodeKey,
    geometry: overviewViewerGeometry(viewer),
    z: viewer.z,
    expanded: viewer.restoreGeometry !== undefined,
    ...(viewer.restoreGeometry
      ? { restoreGeometry: viewer.restoreGeometry }
      : {}),
  };
  return viewer.kind === "cad"
    ? { ...spatial, kind: "cad", assetId: viewer.assetId }
    : { ...spatial, kind: viewer.kind };
}

function overviewViewerFromPresentation(
  viewer: OverviewThreadWhiteboardPresentationViewer,
): OverviewViewerState {
  const spatial = {
    id: viewer.id,
    nodeKey: viewer.nodeKey,
    ...viewer.geometry,
    z: viewer.z,
    ...(viewer.expanded && viewer.restoreGeometry
      ? { restoreGeometry: viewer.restoreGeometry }
      : {}),
  };
  return viewer.kind === "cad"
    ? { ...spatial, kind: "cad", assetId: viewer.assetId }
    : { ...spatial, kind: viewer.kind };
}

function overviewWhiteboardBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function nextOverviewHeroSelection(
  current: string | undefined,
  requested: string,
): string | undefined {
  return current === requested ? undefined : requested;
}

function overviewDirectionDelta(
  direction: OverviewThreadD3FlowMoveDirection,
  step: number,
): { readonly x: number; readonly y: number } {
  if (direction === "ArrowLeft") return { x: -step, y: 0 };
  if (direction === "ArrowRight") return { x: step, y: 0 };
  if (direction === "ArrowUp") return { x: 0, y: -step };
  return { x: 0, y: step };
}

function isOverviewMoveDirection(
  key: string,
): key is OverviewThreadD3FlowMoveDirection {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" ||
    key === "ArrowDown";
}

function readOverviewWhiteboardBounds(
  viewport: HTMLDivElement | null,
  world: HTMLDivElement | null,
  viewers: readonly OverviewViewerState[] = [],
  flowLayout?: Pick<
    ReturnType<typeof buildOverviewThreadD3FlowLayout>,
    "viewBox" | "groups"
  >,
): OverviewThreadWhiteboardBounds | undefined {
  if (!viewport || !world) return undefined;
  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  const worldWidth = world.offsetWidth;
  const worldHeight = world.offsetHeight;
  if (
    viewportWidth <= 0 || viewportHeight <= 0 || worldWidth <= 0 ||
    worldHeight <= 0
  ) return undefined;
  const content = overviewThreadWhiteboardContentBounds(
    { width: worldWidth, height: worldHeight },
    [
      ...overviewThreadFlowSceneRects(flowLayout, {
        width: worldWidth,
        height: worldHeight,
      }),
      ...viewers.map((viewer) =>
        viewer.restoreGeometry ?? overviewViewerGeometry(viewer)
      ),
    ],
  );
  if (!content) return undefined;
  return {
    viewport: { width: viewportWidth, height: viewportHeight },
    content,
    padding: Math.min(36, viewportWidth * 0.045, viewportHeight * 0.045),
    minScale: 0.4,
    maxScale: 3,
  };
}

function overviewThreadFlowSceneRects(
  layout:
    | Pick<
      ReturnType<typeof buildOverviewThreadD3FlowLayout>,
      "viewBox" | "groups"
    >
    | undefined,
  world: { readonly width: number; readonly height: number },
): readonly OverviewThreadViewerGeometry[] {
  if (!layout) return [];
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = layout.viewBox;
  if (viewBoxWidth <= 0 || viewBoxHeight <= 0) return [];
  const scaleX = world.width / viewBoxWidth;
  const scaleY = world.height / viewBoxHeight;
  return layout.groups.map((group) => ({
    x: (group.x - 7 - viewBoxX) * scaleX,
    y: (group.y - 10 - viewBoxY) * scaleY,
    width: (group.width + 14) * scaleX,
    height: (group.height + 17) * scaleY,
  }));
}

function overviewViewerGeometry(
  viewer: OverviewViewerState,
): OverviewThreadViewerGeometry {
  return {
    x: viewer.x,
    y: viewer.y,
    width: viewer.width,
    height: viewer.height,
  };
}

function initialOverviewViewerGeometry(
  anchor: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  world: { readonly width: number; readonly height: number },
  cascade: number,
): OverviewThreadViewerGeometry {
  const gap = 34 + cascade * 18;
  const rightX = anchor.x + gap;
  const leftX = anchor.x - gap - size.width;
  const rightSpace = world.width - OVERVIEW_VIEWER_PADDING - rightX;
  const leftSpace = leftX - OVERVIEW_VIEWER_PADDING;
  const x = rightSpace >= size.width
    ? rightX
    : leftSpace >= 0
    ? leftX
    : anchor.x - size.width / 2;

  return {
    x,
    y: anchor.y - size.height / 2 + cascade * 12,
    width: size.width,
    height: size.height,
  };
}

function overviewViewerGeometryConstraints(): {
  readonly minWidth: number;
  readonly minHeight: number;
} {
  return {
    minWidth: OVERVIEW_VIEWER_MIN_WIDTH,
    minHeight: OVERVIEW_VIEWER_MIN_HEIGHT,
  };
}

function overviewWhiteboardViewportStyle(
  transform: OverviewThreadWhiteboardTransform,
): CSSProperties {
  const minor = 28 * transform.k;
  const major = minor * 5;
  return {
    "--overview-whiteboard-grid-minor-size": `${minor}px`,
    "--overview-whiteboard-grid-major-size": `${major}px`,
    "--overview-whiteboard-grid-x": `${transform.x}px`,
    "--overview-whiteboard-grid-y": `${transform.y}px`,
  } as CSSProperties;
}

function overviewViewerAnchorPoint(
  nodeKey: string,
  layoutMode: OverviewLayoutMode,
  flowLayout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  radialLayout: ReturnType<typeof buildOverviewThreadD3Layout>,
  world: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } | undefined {
  if (layoutMode === "hierarchy") {
    const node = flowLayout.nodes.find((candidate) =>
      candidate.key === nodeKey
    );
    if (!node) return undefined;
    const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] =
      flowLayout.viewBox;
    return {
      x: (node.centerX - viewBoxX) / viewBoxWidth * world.width,
      y: (node.centerY - viewBoxY) / viewBoxHeight * world.height,
    };
  }
  const node = radialLayout.nodes.find((candidate) =>
    candidate.key === nodeKey
  );
  if (!node) return undefined;
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] =
    radialLayout.viewBox;
  return {
    x: (node.anchorX - viewBoxX) / viewBoxWidth * world.width,
    y: (node.anchorY - viewBoxY) / viewBoxHeight * world.height,
  };
}

function overviewRelatedNodeKeys(
  edges: readonly OverviewHeroEdge[],
  activeKey: string | undefined,
): ReadonlySet<string> {
  if (!activeKey) return new Set();
  const keys = new Set([activeKey]);
  for (const edge of edges) {
    if (edge.fromKey === activeKey) keys.add(edge.toKey);
    if (edge.toKey === activeKey) keys.add(edge.fromKey);
  }
  return keys;
}

function overviewCableWidth(pathCount: number): number {
  return 0.75 + Math.min(1.35, Math.log2(pathCount + 1) * 0.42);
}

function overviewEdgeState(
  edge: Pick<OverviewHeroEdge, "fromKey" | "toKey" | "emphasis">,
  activeKey: string | undefined,
): "default" | "emphasis" | "incoming" | "outgoing" | "muted" {
  if (!activeKey) return edge.emphasis ? "emphasis" : "default";
  if (edge.fromKey === activeKey) return "outgoing";
  if (edge.toKey === activeKey) return "incoming";
  return "muted";
}

function overviewD3LayoutOptions(nodeCount: number): {
  readonly innerRadius: number;
  readonly labelColumnX: number;
  readonly height: number;
  readonly labelGap: number;
  readonly bundleBeta: number;
} {
  const innerRadius = clamp(184 + nodeCount * 1.65, 222, 342);
  const rowsPerSide = Math.ceil(nodeCount / 2);
  return {
    innerRadius,
    labelColumnX: innerRadius + 52,
    height: clamp(360 + rowsPerSide * 17, 580, 980),
    labelGap: 17,
    bundleBeta: 0.84,
  };
}

function overviewLaneLabelPoint(
  nodes: readonly OverviewD3Node[],
  angle: number,
): { readonly x: number; readonly y: number } {
  const leafRadius = Math.max(220, ...nodes.map((node) => node.radius));
  const radius = Math.max(96, leafRadius - 54);
  return {
    x: Math.sin(angle) * radius,
    y: -Math.cos(angle) * radius,
  };
}

function directionalOverviewNode(
  nodes: readonly OverviewD3Node[],
  current: OverviewD3Node,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
): OverviewD3Node | undefined {
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const candidates = nodes.flatMap((candidate) => {
    if (candidate.key === current.key) return [];
    const primary = horizontal
      ? (candidate.labelX - current.labelX) * direction
      : (candidate.labelY - current.labelY) * direction;
    if (primary <= 1) return [];
    const secondary = horizontal
      ? Math.abs(candidate.labelY - current.labelY)
      : Math.abs(candidate.labelX - current.labelX);
    return [{ candidate, score: primary + secondary * 2.5 }];
  }).sort((left, right) =>
    left.score - right.score ||
    left.candidate.key.localeCompare(right.candidate.key)
  );
  if (candidates[0]) return candidates[0].candidate;
  const index = nodes.findIndex((node) => node.key === current.key);
  if (index < 0 || nodes.length < 2) return undefined;
  return nodes[(index + direction + nodes.length) % nodes.length];
}

function directionalOverviewFlowNode(
  nodes: readonly OverviewFlowNode[],
  current: OverviewFlowNode,
  direction: OverviewThreadD3FlowMoveDirection,
): OverviewFlowNode | undefined {
  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
  const axisDirection = direction === "ArrowLeft" || direction === "ArrowUp"
    ? -1
    : 1;
  const candidates = nodes.flatMap((candidate) => {
    if (candidate.key === current.key) return [];
    const primary = (horizontal
      ? candidate.centerX - current.centerX
      : candidate.centerY - current.centerY) * axisDirection;
    if (primary <= 0.5) {
      return [];
    }
    const secondary = Math.abs(
      horizontal
        ? candidate.centerY - current.centerY
        : candidate.centerX - current.centerX,
    );
    const distance = Math.hypot(primary, secondary);
    return [{
      candidate,
      primary,
      secondary,
      score: distance + secondary * 1.25,
    }];
  }).sort((left, right) =>
    left.score - right.score ||
    left.secondary - right.secondary ||
    left.primary - right.primary ||
    left.candidate.key.localeCompare(right.candidate.key)
  );
  return candidates[0]?.candidate;
}

function HeroNode({
  item,
  position,
  tabIndex,
  selected,
  related,
  refNode,
  onHoverChange,
  onFocus,
  onToggle,
  onMove,
}: {
  item: OverviewHeroNode;
  position: OverviewD3Node;
  tabIndex: number;
  selected: boolean;
  related: boolean;
  refNode: (node: SVGGElement | null) => void;
  onHoverChange: (hovered: boolean) => void;
  onFocus: () => void;
  onToggle: () => void;
  onMove: (
    key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  ) => void;
}): JSX.Element {
  const title = item.kind === "activity"
    ? `Project activity · ${item.activity.title} · ${
      activityStatusCaption(item.activity.status)
    }`
    : `${item.node.label} · ${item.node.ref.id} · ${item.node.summary}`;
  const ariaLabel = item.kind === "activity"
    ? `Project activity ${item.activity.title}, ${
      activityStatusCaption(item.activity.status)
    }`
    : `Inspect ${item.node.label}, ${item.node.freshness}, ${item.node.ref.id}`;
  const hitX = position.textAnchor === "start"
    ? position.labelX - 8
    : position.labelX - 208;
  const markerColor = item.kind === "recorded"
    ? item.color
    : activityMarkerColor(item.activity.status);
  return (
    <DropdownMenuContextTrigger
      value={overviewThreadNodeContextValue(item.key)}
      asChild
    >
      <g
        ref={refNode}
        role="button"
        tabIndex={tabIndex}
        aria-label={ariaLabel}
        aria-controls={selected ? OVERVIEW_SELECTION_ID : undefined}
        aria-expanded={selected}
        className="overview-thread-node cursor-pointer"
        data-state={selected ? "selected" : related ? "related" : "muted"}
        data-kind={item.kind}
        data-overview-context-target={overviewThreadNodeContextValue(item.key)}
        onClick={onToggle}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onFocus={onFocus}
        onBlur={() => onHoverChange(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
            return;
          }
          if (
            event.key === "ArrowUp" || event.key === "ArrowDown" ||
            event.key === "ArrowLeft" || event.key === "ArrowRight"
          ) {
            event.preventDefault();
            onMove(event.key);
          }
        }}
      >
        <title>{title}</title>
        <rect
          x={hitX}
          y={position.labelY - 10}
          width="216"
          height="20"
          fill="transparent"
        />
        <path
          d={position.leaderD}
          fill="none"
          className="overview-thread-node-leader"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={position.anchorX}
          cy={position.anchorY}
          r="8"
          fill="transparent"
          className="overview-thread-node-focus-ring"
          stroke={markerColor}
          vectorEffect="non-scaling-stroke"
        />
        {item.kind === "activity"
          ? (
            <ActivityMarker
              item={item}
              x={position.anchorX}
              y={position.anchorY}
            />
          )
          : (
            <RecordedMarker
              item={item}
              x={position.anchorX}
              y={position.anchorY}
            />
          )}
        <text
          x={position.labelX}
          y={position.labelY}
          textAnchor={position.textAnchor}
          dominantBaseline="middle"
          className="overview-thread-node-label"
        >
          {item.label}
        </text>
      </g>
    </DropdownMenuContextTrigger>
  );
}

function RecordedMarker(
  { item, x, y }: { item: OverviewRecordedHeroNode; x: number; y: number },
): JSX.Element {
  return (
    <circle
      cx={x}
      cy={y}
      r={item.emphasis ? 5 : 4}
      fill={item.color}
      stroke="#ffffff"
      strokeWidth={item.emphasis ? 2.5 : 1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function ActivityMarker(
  { item, x, y }: { item: OverviewActivityHeroNode; x: number; y: number },
): JSX.Element {
  const status = item.activity.status;
  return (
    <rect
      x={x - 4}
      y={y - 4}
      width="8"
      height="8"
      rx="1.5"
      fill="#ffffff"
      stroke={activityMarkerColor(status)}
      strokeWidth="2"
      strokeDasharray={status === "planned" ? "2 1.5" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function activityMarkerColor(status: EngineeringPhaseStatus): string {
  if (status === "blocked") return "var(--ui-destructive)";
  if (status === "active") return "var(--ui-success)";
  return "var(--thread-muted)";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function overviewNodeContextActions(
  snapshot: ThreadWorkbenchSnapshot,
  item: OverviewHeroNode,
): readonly OverviewNodeContextAction[] {
  if (item.kind === "activity") {
    return [
      {
        kind: "inspect-activity",
        nodeKey: item.key,
        label: "Inspect activity",
      },
      { kind: "open-activity", label: "Open Activity" },
    ];
  }

  const capabilities = resolveOverviewThreadViewerCapabilities(
    snapshot,
    item.node,
  );
  const actions: OverviewNodeContextAction[] = [];
  if (capabilities.inspectRecord) {
    actions.push({
      kind: "inspect-record",
      nodeKey: item.key,
      label: "Inspect record",
    });
  }
  for (const asset of capabilities.cadAssets) {
    actions.push({
      kind: "open-cad",
      nodeKey: item.key,
      assetId: asset.id,
      label: `Open CAD · ${asset.label}`,
    });
  }
  if (capabilities.openVerification) {
    actions.push({
      kind: "open-evidence",
      reference: item.node.ref,
      label: "Open in Verification",
    });
  }
  return actions;
}

function overviewContextActionValue(
  action: OverviewNodeContextAction,
  index: number,
): string {
  if (action.kind === "open-cad") {
    return `${action.kind}:${action.nodeKey}:${action.assetId}`;
  }
  if (action.kind === "open-evidence") {
    return `${action.kind}:${action.reference.kind}:${action.reference.id}`;
  }
  if ("nodeKey" in action) return `${action.kind}:${action.nodeKey}`;
  return `${action.kind}:${index}`;
}

function overviewNodeContextMeta(item: OverviewHeroNode): string {
  if (item.kind === "activity") {
    return `${
      activityStatusCaption(item.activity.status)
    } · ${item.activity.evidenceCount} evidence`;
  }
  return `${item.node.ref.kind}:${item.node.ref.id} · ${
    item.node.artifactKind ?? item.node.entityKind
  }`;
}

function overviewLaneTitle(lane: OverviewHeroNode["lane"]): string {
  return OVERVIEW_LANES.find((candidate) => candidate.id === lane)?.title ??
    lane;
}

function overviewSelectionCardGeometry(
  anchor: { readonly x: number; readonly y: number },
  world: { readonly width: number; readonly height: number },
): OverviewThreadViewerGeometry {
  const padding = 8;
  const gap = 16;
  const width = Math.min(
    OVERVIEW_SELECTION_CARD_WIDTH,
    Math.max(180, world.width - padding * 2),
  );
  const height = Math.min(
    OVERVIEW_SELECTION_CARD_HEIGHT,
    Math.max(148, world.height - padding * 2),
  );
  const rightX = anchor.x + gap;
  const leftX = anchor.x - gap - width;
  const x = rightX + width <= world.width - padding
    ? rightX
    : leftX >= padding
    ? leftX
    : clamp(anchor.x - width / 2, padding, world.width - width - padding);
  return {
    x,
    y: clamp(
      anchor.y - height / 2,
      padding,
      Math.max(padding, world.height - height - padding),
    ),
    width,
    height,
  };
}

function OverviewThreadContextMenu({
  node,
  group,
  nodesByKey,
  actions,
  onAction,
  onSelectNode,
}: {
  readonly node?: OverviewHeroNode;
  readonly group?: OverviewThreadD3FlowGroupLayout;
  readonly nodesByKey: ReadonlyMap<string, OverviewHeroNode>;
  readonly actions: readonly OverviewNodeContextAction[];
  readonly onAction: (action: OverviewNodeContextAction) => void;
  readonly onSelectNode: (key: string) => void;
}): JSX.Element {
  const members = group?.nodeKeys.flatMap((key) => {
    const member = nodesByKey.get(key);
    return member ? [member] : [];
  }) ?? [];
  const label = node?.label ?? (group ? flowGroupCaption(group) : "Thread");
  return (
    <DropdownMenuContent
      className="overview-thread-context-menu"
      aria-label={`${label} context menu`}
    >
      {node && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuLabel>{node.label}</DropdownMenuLabel>
            {actions.length === 0 && (
              <DropdownMenuItem
                value={`select:${node.key}`}
                onSelect={() => onSelectNode(node.key)}
              >
                Show on whiteboard
              </DropdownMenuItem>
            )}
            {actions.map((action, index) => (
              <DropdownMenuItem
                key={overviewContextActionValue(action, index)}
                value={overviewContextActionValue(action, index)}
                onSelect={() => onAction(action)}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      )}
      {group && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span>{flowGroupCaption(group)}</span>
              <small>
                {overviewLaneTitle(group.lane)} · {members.length} visible{" "}
                {members.length === 1 ? "record" : "records"}
              </small>
            </DropdownMenuLabel>
            <div className="overview-thread-context-members">
              {members.map((member) => (
                <DropdownMenuItem
                  key={member.key}
                  value={`member:${member.key}`}
                  className="overview-thread-context-member"
                  onSelect={() => onSelectNode(member.key)}
                >
                  <span>{member.label}</span>
                  <small>{overviewNodeContextMeta(member)}</small>
                </DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuGroup>
        </>
      )}
    </DropdownMenuContent>
  );
}

function OverviewNodeSelectionCard({
  item,
  thread,
  geometry,
  onAction,
  onDismiss,
}: {
  readonly item: OverviewHeroNode;
  readonly thread: ThreadWorkbenchSnapshot;
  readonly geometry: OverviewThreadViewerGeometry;
  readonly onAction: (action: OverviewNodeContextAction) => void;
  readonly onDismiss: () => void;
}): JSX.Element {
  const actions = overviewNodeContextActions(thread, item);
  const laneLabel = overviewLaneTitle(item.lane);
  const summary = item.kind === "recorded"
    ? item.node.summary
    : `Project activity · ${activityStatusCaption(item.activity.status)}`;
  return (
    <section
      id={OVERVIEW_SELECTION_ID}
      className="overview-thread-selection-card"
      aria-label={`Selected ${
        item.kind === "recorded" ? "thread record" : "project activity"
      }: ${item.label}`}
      aria-live="polite"
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onDismiss();
      }}
    >
      <header>
        <div>
          <p className={cn("m-0", SECTION_LABEL)}>{laneLabel}</p>
          <h4>{item.label}</h4>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Close selection">
          Close
        </button>
      </header>
      <div className="overview-thread-selection-copy">
        {item.kind === "recorded" && (
          <Badge variant={freshnessBadgeVariant(item.node.freshness)}>
            {item.node.freshness}
          </Badge>
        )}
        {item.kind === "activity" && (
          <Badge variant={recordStatusVariant(item.activity.status)}>
            {activityStatusCaption(item.activity.status)}
          </Badge>
        )}
        <p>{summary}</p>
        <code>{overviewNodeContextMeta(item)}</code>
      </div>
      <div className="overview-thread-selection-actions">
        {actions.map((action, index) => (
          <Button
            key={overviewContextActionValue(action, index)}
            variant="outline"
            size="sm"
            onClick={() => onAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

function OverviewFloatingViewer({
  refViewer,
  viewer,
  item,
  thread,
  cadAsset,
  onBringFront,
  onClose,
  onToggleExpanded,
  onMoveByKeyboard,
  onResizeByKeyboard,
  onDragStart,
  onDrag,
  onDragEnd,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  readonly refViewer: (node: HTMLElement | null) => void;
  readonly viewer: OverviewViewerState;
  readonly item?: OverviewHeroNode;
  readonly thread: ThreadWorkbenchSnapshot;
  readonly cadAsset?: ThreadArtifact;
  readonly onBringFront: () => void;
  readonly onClose: () => void;
  readonly onToggleExpanded: () => void;
  readonly onMoveByKeyboard: (
    direction: OverviewThreadD3FlowMoveDirection,
  ) => void;
  readonly onResizeByKeyboard: (
    direction: OverviewThreadD3FlowMoveDirection,
  ) => void;
  readonly onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onResizeEnd: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
}): JSX.Element {
  const title = overviewViewerTitle(viewer, item, cadAsset);
  return (
    <article
      ref={refViewer}
      className="overview-thread-viewer"
      data-viewer-id={viewer.id}
      data-viewer-kind={viewer.kind}
      data-anchor-node={viewer.nodeKey}
      data-expanded={viewer.restoreGeometry ? "true" : "false"}
      style={{
        left: viewer.x,
        top: viewer.y,
        width: viewer.width,
        height: viewer.height,
        zIndex: viewer.z,
      }}
      tabIndex={-1}
      role="region"
      aria-label={title}
      onPointerDown={onBringFront}
      onFocus={onBringFront}
      onWheel={(event) => event.stopPropagation()}
    >
      <header
        className="overview-thread-viewer-handle"
        tabIndex={viewer.restoreGeometry ? -1 : 0}
        aria-label={`Move ${title} with drag or arrow keys`}
        onPointerDown={onDragStart}
        onPointerMove={onDrag}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onLostPointerCapture={onDragEnd}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (!isOverviewMoveDirection(event.key)) return;
          event.preventDefault();
          onMoveByKeyboard(event.key);
        }}
      >
        <span className="overview-thread-viewer-title">{title}</span>
        <span className="overview-thread-viewer-actions">
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-label={`${
              viewer.restoreGeometry ? "Restore" : "Expand"
            } ${title}`}
          >
            {viewer.restoreGeometry ? "Restore" : "Expand"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            Close
          </button>
        </span>
      </header>
      <div className="overview-thread-viewer-body">
        {viewer.kind === "record" && item?.kind === "recorded" && (
          <ToolInspectorPanel
            snapshot={thread}
            node={item.node}
            selection={item.node.selection}
          />
        )}
        {viewer.kind === "cad" && (
          cadAsset?.uri
            ? (
              <>
                <div className="overview-thread-viewer-meta">
                  <span>{cadAsset.label}</span>
                  <code>{cadAsset.fingerprint}</code>
                </div>
                <GltfAssetCanvas
                  url={cadAsset.uri}
                  ariaLabel={`CAD viewer for ${cadAsset.label}`}
                  loadingLabel="Loading exact GLB…"
                  errorLabel="Exact GLB unavailable"
                />
              </>
            )
            : (
              <p className="overview-thread-viewer-unavailable">
                Exact fingerprint-bound GLB unavailable in this snapshot.
              </p>
            )
        )}
        {viewer.kind === "activity" && item?.kind === "activity" && (
          <div className="overview-thread-activity-viewer">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={recordStatusVariant(item.activity.status)}>
                {activityStatusCaption(item.activity.status)}
              </Badge>
              <span>{item.lane}</span>
            </div>
            <h4>{item.activity.title}</h4>
            <dl>
              <div>
                <dt>Evidence</dt>
                <dd>{item.activity.evidenceCount}</dd>
              </div>
              <div>
                <dt>Decisions</dt>
                <dd>
                  {item.activity.approvedDecisions}/
                  {item.activity.requiredDecisions}
                </dd>
              </div>
              <div>
                <dt>Revisions</dt>
                <dd>{item.activity.revisions.length}</dd>
              </div>
            </dl>
            <p>
              Read-only project activity projection from the current snapshot.
            </p>
          </div>
        )}
      </div>
      <button
        type="button"
        className="overview-thread-viewer-resize"
        aria-label={`Resize ${title}`}
        disabled={Boolean(viewer.restoreGeometry)}
        onPointerDown={onResizeStart}
        onPointerMove={onResize}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onLostPointerCapture={onResizeEnd}
        onKeyDown={(event) => {
          if (!isOverviewMoveDirection(event.key)) return;
          event.preventDefault();
          onResizeByKeyboard(event.key);
        }}
      >
        Resize
      </button>
    </article>
  );
}

function overviewViewerTitle(
  viewer: OverviewViewerState,
  item?: OverviewHeroNode,
  cadAsset?: ThreadArtifact,
): string {
  if (viewer.kind === "cad") {
    return cadAsset ? `CAD · ${cadAsset.label}` : "CAD · unavailable";
  }
  if (!item) return "Thread viewer · unavailable";
  if (viewer.kind === "activity") return `Activity · ${item.label}`;
  if (item.kind !== "recorded") return `Thread record · ${item.label}`;
  const owner = item.node.system.trim() || "Thread";
  return `${owner} · ${item.node.entityKind} record`;
}

function overviewViewerId(
  request:
    | { readonly kind: "record"; readonly nodeKey: string }
    | {
      readonly kind: "cad";
      readonly nodeKey: string;
      readonly assetId: string;
    }
    | { readonly kind: "activity"; readonly nodeKey: string },
): string {
  return request.kind === "cad"
    ? `${request.kind}:${request.nodeKey}:${request.assetId}`
    : `${request.kind}:${request.nodeKey}`;
}

function activityStatusCaption(status: EngineeringPhaseStatus): string {
  if (status === "blocked") return "BLOCKED";
  if (status === "active") return "IN PROGRESS";
  if (status === "planned") return "PENDING";
  return "COMPLETED";
}

function freshnessBadgeVariant(
  freshness: ThreadGraphNode["freshness"],
): "success" | "warning" | "info" | "destructive" {
  if (freshness === "failed") return "destructive";
  if (freshness === "stale") return "warning";
  if (freshness === "running") return "info";
  return "success";
}
