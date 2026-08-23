import { createRoot } from "react-dom/client";
import { useCallback, useState } from "react";
import type { JSX } from "react";
import { HttpCockpitFleetClient, HttpThreadWorkbenchClient } from "./client.ts";
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

/**
 * One browser shell over one durable EngineeringProject from first intent.
 * Framing, planning and evidence are surfaces of that same project contract.
 * The product topbar lives inside the workbench (`ProjectCockpitHeader`) —
 * the harness adds no chrome of its own.
 */
function NativeCockpit(): JSX.Element {
  const [projectId, setProjectId] = useState<string>();
  const focusProject = useCallback((next: string | undefined) => {
    setProjectId(next);
  }, []);
  return (
    <div className="native-preview-shell">
      {/* Chaque vue possède son propre <main> : le harnais reste un div. */}
      <div className="native-preview-content">
        <ThreadWorkbench
          client={client}
          fleetClient={fleetClient}
          onProjectFocus={focusProject}
        />
      </div>
      <DesktopChat projectId={projectId} />
    </div>
  );
}

createRoot(root).render(<NativeCockpit />);
