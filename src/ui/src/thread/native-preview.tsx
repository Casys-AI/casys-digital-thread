import { createRoot } from "react-dom/client";
import { useCallback, useState } from "react";
import type { JSX } from "react";
import { HttpCockpitFleetClient, HttpThreadWorkbenchClient } from "./client.ts";
import { HttpProductAuthoringSourceClient } from "./product-authoring-sources.ts";
import { ThreadWorkbench } from "./workbench.tsx";
import { DesktopChat } from "./desktop-chat.tsx";
import "../styles.css";

const root = document.querySelector<HTMLElement>("#native-preview");
if (!root) throw new Error("Missing #native-preview mount point");

const client = new HttpThreadWorkbenchClient(
  "/api/thread/workbench",
  globalThis.fetch.bind(globalThis),
  "/api/thread/workbench/events",
);
const fleetClient = new HttpCockpitFleetClient(
  "/api/fleet",
  globalThis.fetch.bind(globalThis),
);
const authoringSourceClient = new HttpProductAuthoringSourceClient(
  "/api/thread/product-navigation",
  globalThis.fetch.bind(globalThis),
);

/**
 * One browser shell over one durable EngineeringProject from first intent.
 * Framing, planning and evidence are surfaces of that same project contract.
 * Project navigation owns the single application header; this harness adds no
 * competing chrome.
 */
function NativeCockpit(): JSX.Element {
  const [projectId, setProjectId] = useState<string>();
  const [chatOpen, setChatOpen] = useState(false);
  const focusProject = useCallback((next: string | undefined) => {
    setProjectId(next);
  }, []);
  const projectChatAvailable = typeof projectId === "string" &&
    projectId.length > 0;
  return (
    <div
      className="native-preview-shell"
      data-chat-open={chatOpen ? "true" : "false"}
      data-project-chat-panel={projectChatAvailable ? "true" : "false"}
    >
      <a
        className="skip-link"
        href="#project-workspace-panel"
        onClick={(event) => {
          event.preventDefault();
          const workspace = globalThis.document?.getElementById(
            "project-workspace-panel",
          ) ?? globalThis.document?.getElementById("native-preview-content");
          workspace?.focus();
        }}
      >
        Skip to project workspace
      </a>
      <DesktopChat
        projectId={projectId}
        open={chatOpen}
        onOpenChange={setChatOpen}
      />
      {/* Chaque vue possède son propre <main> : le harnais reste un div. */}
      <div
        id="native-preview-content"
        className="native-preview-content"
        tabIndex={-1}
      >
        <ThreadWorkbench
          client={client}
          fleetClient={fleetClient}
          authoringSourceClient={authoringSourceClient}
          onProjectFocus={focusProject}
        />
      </div>
    </div>
  );
}

createRoot(root).render(<NativeCockpit />);
