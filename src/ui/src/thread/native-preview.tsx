import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { HttpCockpitFleetClient, HttpThreadWorkbenchClient } from "./client.ts";
import { ThreadWorkbench } from "./workbench.tsx";
import { DesktopChat, desktopChatRuntimeAvailable } from "./desktop-chat.tsx";
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

/**
 * One browser shell over one durable EngineeringProject from first intent.
 * Framing, planning and evidence are surfaces of that same project contract.
 * The product topbar lives inside the workbench (`ProjectCockpitHeader`) —
 * the harness adds no chrome of its own.
 */
function NativeCockpit(): JSX.Element {
  const [projectId, setProjectId] = useState<string>();
  const [chatOpen, setChatOpen] = useState(false);
  useEffect(() => {
    // Browser preview reveals the honest unavailable state after Ark has mounted
    // its content refs. Native Desktop keeps Chat closed until the operator asks.
    if (!desktopChatRuntimeAvailable()) setChatOpen(true);
  }, []);
  const focusProject = useCallback((next: string | undefined) => {
    setProjectId(next);
  }, []);
  return (
    <div
      className="native-preview-shell"
      data-chat-open={chatOpen ? "true" : "false"}
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
      {/* Chaque vue possède son propre <main> : le harnais reste un div. */}
      <div
        id="native-preview-content"
        className="native-preview-content"
        tabIndex={-1}
      >
        <ThreadWorkbench
          client={client}
          fleetClient={fleetClient}
          onProjectFocus={focusProject}
        />
      </div>
      <DesktopChat
        projectId={projectId}
        open={chatOpen}
        onOpenChange={setChatOpen}
      />
    </div>
  );
}

createRoot(root).render(<NativeCockpit />);
