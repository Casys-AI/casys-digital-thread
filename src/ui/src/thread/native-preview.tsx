/** @jsxImportSource preact */

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { installMcpViewTheme } from "../mcp-view-primitives.ts";
import type { ProjectDiscoverySnapshot } from "../../../domain/project-discovery.ts";
import {
  HttpProjectDiscoveryClient,
  ProjectDiscoveryHttpError,
  type ProjectDiscoveryStreamStatus,
} from "../project/discovery-client.ts";
import { DiscoveryProjectCockpit } from "../project/discovery-project-cockpit.tsx";
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

const discoveryEndpoint = "/api/project-discoveries/active";
const discoveryClient = new HttpProjectDiscoveryClient(
  discoveryEndpoint,
  `${discoveryEndpoint}/events`,
);

type CockpitRoute =
  | { readonly kind: "loading" }
  | { readonly kind: "project" }
  | { readonly kind: "discovery"; readonly snapshot: ProjectDiscoverySnapshot }
  | { readonly kind: "error"; readonly message: string };

/**
 * One browser shell, selected by the durable agent-owned focus. Discovery and
 * EngineeringProject remain separate server aggregates; only their human
 * presentation shares this same canonical cockpit URL.
 */
function NativeCockpit(): JSX.Element {
  const [route, setRoute] = useState<CockpitRoute>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    discoveryClient.load(controller.signal).then((snapshot) => {
      if (!controller.signal.aborted) setRoute({ kind: "discovery", snapshot });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ProjectDiscoveryHttpError && error.status === 409) {
        setRoute({ kind: "project" });
        return;
      }
      setRoute({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "The project cockpit could not resolve its current record.",
      });
    });
    return () => controller.abort();
  }, []);

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
        {route.kind === "loading"
          ? <CockpitLoading />
          : route.kind === "discovery"
          ? <FocusedDiscoveryCockpit initial={route.snapshot} />
          : route.kind === "project"
          ? <ThreadWorkbench client={client} />
          : <CockpitLoadError message={route.message} />}
      </main>
    </div>
  );
}

function FocusedDiscoveryCockpit({ initial }: {
  initial: ProjectDiscoverySnapshot;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState(initial);
  const [streamStatus, setStreamStatus] = useState<
    ProjectDiscoveryStreamStatus
  >(
    "connecting",
  );

  useEffect(() => discoveryClient.subscribe(setSnapshot, setStreamStatus), []);

  return (
    <DiscoveryProjectCockpit
      discovery={snapshot}
      streamLabel={discoveryStreamLabel(streamStatus)}
    />
  );
}

function CockpitLoading(): JSX.Element {
  return (
    <section class="thread-loading" aria-busy="true">
      <span class="thread-loading-mark" aria-hidden="true" />
      <div>
        <strong>Opening the project record</strong>
        <small>No engineering tool is being executed.</small>
      </div>
    </section>
  );
}

function CockpitLoadError({ message }: { message: string }): JSX.Element {
  return (
    <section class="thread-loading" role="alert">
      <div>
        <strong>Project cockpit unavailable</strong>
        <small>{message}</small>
      </div>
    </section>
  );
}

function discoveryStreamLabel(status: ProjectDiscoveryStreamStatus): string {
  if (status === "live") return "Live project record";
  if (status === "reconnecting") return "Restoring project updates";
  return "Connecting to project updates";
}

render(
  <NativeCockpit />,
  root,
);
