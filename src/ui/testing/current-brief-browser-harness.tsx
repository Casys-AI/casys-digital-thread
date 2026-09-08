import { createRoot } from "react-dom/client";
import { type JSX, useEffect, useRef, useState } from "react";
import { OverviewThreadHero } from "../src/project/overview-thread-hero.tsx";
import "../src/styles.css";
import {
  WHITEBOARD_ALPHA_PROJECT_ID,
  WHITEBOARD_CURRENT_BRIEF,
  whiteboardThreadWithCurrentBrief,
  whiteboardViewerSessionsWithBriefDocument,
} from "./whiteboard-fixture.ts";

interface HarnessConfig {
  readonly viewerSessionsReady: boolean;
  readonly viewerHierarchyPending: boolean;
}

export interface CurrentBriefBoardProof {
  readonly nativeActionRows: number;
  readonly viewers: readonly {
    readonly id: string | null;
    readonly kind: string | null;
    readonly title: string | null;
    readonly anchor: string | null;
  }[];
  readonly documentarySessionViewers: number;
}

interface HarnessApi {
  configure(next: Partial<HarnessConfig>): Promise<void>;
  snapshot(): CurrentBriefBoardProof;
}

declare global {
  var __currentBriefHarness: HarnessApi | undefined;
}

function Harness(): JSX.Element {
  const [config, setConfig] = useState<HarnessConfig>({
    viewerSessionsReady: true,
    viewerHierarchyPending: false,
  });
  const configRef = useRef(config);
  const pendingConfigureRef = useRef<(() => void) | undefined>();
  configRef.current = config;
  const thread = useRef(whiteboardThreadWithCurrentBrief()).current;
  const sessions = useRef(whiteboardViewerSessionsWithBriefDocument()).current;

  useEffect(() => {
    globalThis.__currentBriefHarness = {
      configure(next) {
        return new Promise((resolve) => {
          pendingConfigureRef.current = resolve;
          setConfig((current) => ({
            viewerSessionsReady: next.viewerSessionsReady ??
              current.viewerSessionsReady,
            viewerHierarchyPending: next.viewerHierarchyPending ??
              current.viewerHierarchyPending,
          }));
        });
      },
      snapshot: readBoardProof,
    };
    pendingConfigureRef.current?.();
    pendingConfigureRef.current = undefined;
  }, [config]);

  return (
    <div
      className="project-thread-board"
      data-current-brief-harness="true"
      data-sessions-ready={config.viewerSessionsReady ? "true" : "false"}
    >
      <OverviewThreadHero
        thread={thread}
        currentBrief={WHITEBOARD_CURRENT_BRIEF}
        projectId={WHITEBOARD_ALPHA_PROJECT_ID}
        viewerSessions={config.viewerSessionsReady ? sessions : undefined}
        viewerSessionsReady={config.viewerSessionsReady}
        viewerHierarchyPending={config.viewerHierarchyPending}
        immersive
        onOpenEvidence={() => {}}
        onOpenActivity={() => {}}
      />
    </div>
  );
}

function readBoardProof(): CurrentBriefBoardProof {
  return {
    nativeActionRows: document.querySelectorAll(
      '[data-native-action="open-current-brief"]',
    ).length,
    viewers: [...document.querySelectorAll(".overview-thread-viewer")].map(
      (viewer) => {
        const host = viewer as HTMLElement;
        return {
          id: host.getAttribute("data-viewer-id"),
          kind: host.getAttribute("data-viewer-kind"),
          title: host.getAttribute("aria-label"),
          anchor: host.getAttribute("data-anchor-node"),
        };
      },
    ),
    documentarySessionViewers: document.querySelectorAll(
      '.overview-thread-viewer[data-viewer-kind="session"]',
    ).length,
  };
}

const mount = document.querySelector("#mount");
if (!mount) {
  throw new Error("Current Brief harness mount is missing.");
}
createRoot(mount).render(<Harness />);
