import { createRoot } from "react-dom/client";
import { type JSX, useEffect, useRef, useState } from "react";
import { OverviewThreadHero } from "../src/project/overview-thread-hero.tsx";
import "../src/styles.css";
import {
  WHITEBOARD_ALPHA_PROJECT_ID,
  WHITEBOARD_THREAD_FIXTURE,
  WHITEBOARD_VIEWER_SESSIONS,
} from "./whiteboard-fixture.ts";

interface HarnessConfig {
  readonly projectId: string;
  readonly viewerSessionsReady: boolean;
  readonly viewerHierarchyPending: boolean;
}

export interface WhiteboardNodeProof {
  readonly target: string | null;
  readonly pressed: string | null;
  readonly state: string | null;
  readonly raw: boolean;
  readonly structured: boolean;
}

export interface WhiteboardViewerProof {
  readonly id: string | null;
  readonly kind: string | null;
  readonly anchor: string | null;
  readonly left: number;
  readonly top: number;
}

export interface WhiteboardGroupProof {
  readonly groupKey: string | null;
  readonly lane: string | null;
  readonly x: number;
  readonly y: number;
}

export interface WhiteboardBoxProof {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface WhiteboardBoardProof {
  readonly projectId: string;
  readonly viewerSessionsReady: boolean;
  readonly hierarchySkeletonVisible: boolean;
  readonly pendingHulls: number;
  readonly pendingRows: number;
  readonly pendingMarkerBackground: string | null;
  readonly flowCanvasVisible: boolean;
  readonly flowItems: number;
  readonly rawNodes: number;
  readonly controlsVisible: boolean;
  readonly nodes: readonly WhiteboardNodeProof[];
  readonly viewers: readonly WhiteboardViewerProof[];
  readonly groups: readonly WhiteboardGroupProof[];
  readonly selectionNote: string | null;
  readonly selectionPinned: boolean;
  readonly selectionNoteRect: WhiteboardBoxProof | null;
  readonly selectedNodeRect: WhiteboardBoxProof | null;
  readonly openViewerControl: boolean;
  readonly evidenceOpens: number;
  readonly activityOpens: number;
  readonly storageKeys: readonly string[];
}

interface WhiteboardHarnessApi {
  configure(next: Partial<HarnessConfig>): Promise<void>;
  snapshot(): WhiteboardBoardProof;
}

declare global {
  var __whiteboardHarness: WhiteboardHarnessApi | undefined;
}

function Harness(): JSX.Element {
  const [config, setConfig] = useState<HarnessConfig>({
    projectId: WHITEBOARD_ALPHA_PROJECT_ID,
    viewerSessionsReady: false,
    viewerHierarchyPending: false,
  });
  const [evidenceOpens, setEvidenceOpens] = useState(0);
  const [activityOpens, setActivityOpens] = useState(0);
  const configRef = useRef(config);
  const evidenceOpensRef = useRef(evidenceOpens);
  const activityOpensRef = useRef(activityOpens);
  const pendingConfigureRef = useRef<(() => void) | undefined>();
  configRef.current = config;
  evidenceOpensRef.current = evidenceOpens;
  activityOpensRef.current = activityOpens;

  useEffect(() => {
    globalThis.__whiteboardHarness = {
      configure(next) {
        return new Promise((resolve) => {
          pendingConfigureRef.current = resolve;
          setConfig((current) => ({
            projectId: next.projectId ?? current.projectId,
            viewerSessionsReady: next.viewerSessionsReady ??
              current.viewerSessionsReady,
            viewerHierarchyPending: next.viewerHierarchyPending ??
              current.viewerHierarchyPending,
          }));
        });
      },
      snapshot: () =>
        readBoardProof(
          configRef.current,
          evidenceOpensRef.current,
          activityOpensRef.current,
        ),
    };
    pendingConfigureRef.current?.();
    pendingConfigureRef.current = undefined;
  }, [config]);

  return (
    <div
      className="project-thread-board"
      data-whiteboard-harness="true"
      data-project-id={config.projectId}
      data-sessions-ready={config.viewerSessionsReady ? "true" : "false"}
      data-hierarchy-pending={config.viewerHierarchyPending ? "true" : "false"}
    >
      <OverviewThreadHero
        thread={WHITEBOARD_THREAD_FIXTURE}
        projectId={config.projectId}
        viewerSessions={config.viewerSessionsReady
          ? WHITEBOARD_VIEWER_SESSIONS
          : undefined}
        viewerSessionsReady={config.viewerSessionsReady}
        viewerHierarchyPending={config.viewerHierarchyPending}
        immersive
        onOpenEvidence={() => setEvidenceOpens((count) => count + 1)}
        onOpenActivity={() => setActivityOpens((count) => count + 1)}
      />
    </div>
  );
}

function readBoardProof(
  config: HarnessConfig,
  evidenceOpens: number,
  activityOpens: number,
): WhiteboardBoardProof {
  return {
    projectId: config.projectId,
    viewerSessionsReady: config.viewerSessionsReady,
    hierarchySkeletonVisible: document.querySelector(
          ".overview-thread-hierarchy-skeleton",
        ) !== null ||
      document.querySelector(
          '[role="status"][aria-label="Loading whiteboard hierarchy"]',
        ) !== null,
    pendingHulls: document.querySelectorAll(
      "[data-whiteboard-flow-pending='true']",
    ).length,
    pendingRows: document.querySelectorAll(
      ".overview-thread-flow-structure-row-pending",
    ).length,
    pendingMarkerBackground: pendingMarkerBackground(),
    flowCanvasVisible:
      document.querySelector(".overview-thread-flow-canvas") !==
        null,
    flowItems: document.querySelectorAll(
      '[data-whiteboard-flow-item="true"]',
    ).length,
    rawNodes: document.querySelectorAll(".overview-thread-flow-node").length,
    controlsVisible:
      document.querySelector(".overview-thread-layout-switch") !==
        null &&
      document.querySelectorAll(".overview-thread-flow-group-band").length >= 2,
    nodes: [...document.querySelectorAll(
      '[data-whiteboard-flow-item="true"]',
    )].map(
      (node) => ({
        target: node.getAttribute("data-overview-context-target"),
        pressed: node.getAttribute("aria-pressed"),
        state: node.getAttribute("data-state"),
        raw: node.classList.contains("overview-thread-flow-node"),
        structured: node.classList.contains(
          "overview-thread-flow-structure-row",
        ),
      }),
    ),
    viewers: [...document.querySelectorAll(".overview-thread-viewer")].map(
      (viewer) => {
        const host = viewer as HTMLElement;
        return {
          id: host.getAttribute("data-viewer-id"),
          kind: host.getAttribute("data-viewer-kind"),
          anchor: host.getAttribute("data-anchor-node"),
          left: Number.parseFloat(host.style.left || "0"),
          top: Number.parseFloat(host.style.top || "0"),
        };
      },
    ),
    groups: [...document.querySelectorAll(
      ".overview-thread-flow-groups rect[data-draggable='true']",
    )].map((group) => ({
      groupKey: group.getAttribute("data-group-key"),
      lane: group.getAttribute("data-lane"),
      x: Number(group.getAttribute("x") ?? "NaN"),
      y: Number(group.getAttribute("y") ?? "NaN"),
    })),
    selectionNote: document.querySelector(".overview-thread-selection-note")
      ?.getAttribute("aria-label") ?? null,
    selectionPinned: document.querySelector(".overview-thread-selection-note")
      ?.getAttribute("data-pinned") === "true",
    selectionNoteRect: readBox(
      document.querySelector(".overview-thread-selection-note"),
    ),
    selectedNodeRect: readBox(
      document.querySelector(
        '[data-whiteboard-flow-item="true"][aria-pressed="true"]',
      ) ??
        document.querySelector(
          '[data-whiteboard-flow-item="true"][data-state="selected"]',
        ),
    ),
    openViewerControl: Boolean(
      document.querySelector(
        ".overview-thread-selection-note button[data-app]",
      ),
    ),
    evidenceOpens,
    activityOpens,
    storageKeys: presentationStorageKeys(),
  };
}

function pendingMarkerBackground(): string | null {
  const marker = document.querySelector(
    ".overview-thread-flow-structure-row-pending .overview-thread-flow-node-dot",
  );
  if (!(marker instanceof HTMLElement)) return null;
  return getComputedStyle(marker).backgroundColor;
}

function readBox(element: Element | null): WhiteboardBoxProof | null {
  if (!(element instanceof HTMLElement)) return null;
  const box = element.getBoundingClientRect();
  return {
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
  };
}

function presentationStorageKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("casys.project-whiteboard.presentation:")) {
      keys.push(key);
    }
  }
  return keys.sort();
}

const mount = document.querySelector("#mount");
if (!mount) {
  throw new Error("Whiteboard harness mount is missing.");
}
createRoot(mount).render(<Harness />);
