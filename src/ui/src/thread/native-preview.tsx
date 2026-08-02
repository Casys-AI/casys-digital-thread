/** @jsxImportSource preact */

import { render } from "preact";
import { installMcpViewTheme } from "../mcp-view-primitives.ts";
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

render(
  <div class="native-preview-shell">
    <header class="native-preview-header">
      <div class="native-preview-brand">
        <span>DT</span>
      </div>
      <div>
        <small>CASYS / INDUSTRIAL PROJECT</small>
        <strong>Project review cockpit</strong>
      </div>
      <p>
        The agent prepares the work · you review decisions · evidence stays
        traceable
      </p>
    </header>
    <ThreadWorkbench client={client} />
  </div>,
  root,
);
