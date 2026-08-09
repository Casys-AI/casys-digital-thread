/** @jsxImportSource preact */

import { render } from "preact";
import type { JSX } from "preact";
import { installMcpViewTheme } from "../mcp-view-primitives.ts";
import { HttpProjectReviewIntentClient } from "../project/review-intent-client.ts";
import { HttpThreadWorkbenchClient } from "./client.ts";
import { ThreadWorkbench } from "./workbench.tsx";
import "../styles.css";

const root = document.querySelector<HTMLElement>("#native-preview");
if (!root) throw new Error("Missing #native-preview mount point");

installMcpViewTheme(document);

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
 */
function NativeCockpit(): JSX.Element {
  return (
    <div class="native-preview-shell">
      <header class="native-preview-header">
        <div class="native-preview-brand">
          <span>DT</span>
        </div>
        <div>
          <small>CASYS / INDUSTRIAL PROJECT</small>
          <h1>Project evidence cockpit</h1>
        </div>
        <p>
          The agent records the work · you inspect the project · evidence stays
          traceable
        </p>
      </header>
      <main>
        <ThreadWorkbench
          client={client}
          reviewIntentClient={reviewIntentClient}
        />
      </main>
    </div>
  );
}

render(
  <NativeCockpit />,
  root,
);
