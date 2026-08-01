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
        <small>CASYS / PRODUCT PROTOTYPE</small>
        <strong>Native Digital Thread Workbench</strong>
      </div>
      <p>
        Validated snapshot stream · explicit human controls when granted · no
        implicit solver execution
      </p>
    </header>
    <ThreadWorkbench client={client} />
  </div>,
  root,
);
