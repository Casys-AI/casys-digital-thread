import { createRoot } from "react-dom/client";
import type { JSX } from "react";
import { HttpProjectReviewIntentClient } from "../project/review-intent-client.ts";
import { HttpThreadWorkbenchClient } from "./client.ts";
import { ThreadWorkbench } from "./workbench.tsx";
import "../styles.css";

const root = document.querySelector<HTMLElement>("#native-preview");
if (!root) throw new Error("Missing #native-preview mount point");

const client = new HttpThreadWorkbenchClient(
  "/api/thread/workbench",
  globalThis.fetch.bind(globalThis),
  "/api/thread/workbench/events",
);
const reviewIntentClient = new HttpProjectReviewIntentClient(
  "/api/review-intents",
  globalThis.fetch.bind(globalThis),
);

/**
 * One browser shell over one durable EngineeringProject from first intent.
 * Framing, planning and evidence are surfaces of that same project contract.
 * The product topbar lives inside the workbench (`ProjectCockpitHeader`) —
 * the harness adds no chrome of its own.
 */
function NativeCockpit(): JSX.Element {
  return (
    <div className="native-preview-shell">
      {/* Chaque vue possède son propre <main> : le harnais reste un div. */}
      <div className="native-preview-content">
        <ThreadWorkbench
          client={client}
          reviewIntentClient={reviewIntentClient}
        />
      </div>
    </div>
  );
}

createRoot(root).render(<NativeCockpit />);
