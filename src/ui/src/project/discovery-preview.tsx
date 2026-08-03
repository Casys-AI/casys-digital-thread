/** @jsxImportSource preact */

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { ProjectDiscoverySnapshot } from "../../../domain/project-discovery.ts";
import { Button, installMcpViewTheme } from "../mcp-view-primitives.ts";
import {
  HttpProjectDiscoveryClient,
  type ProjectDiscoveryClient,
  type ProjectDiscoveryStreamStatus,
} from "./discovery-client.ts";
import { DiscoveryWorkbench } from "./discovery-workbench.tsx";
import "../styles.css";

export interface DiscoveryPreviewAppProps {
  readonly client: ProjectDiscoveryClient;
  /** The agent-selected active route may move to a different discovery. */
  readonly followsCockpitFocus?: boolean;
}

type DiscoveryTransportState = ProjectDiscoveryStreamStatus | "error";

export function DiscoveryPreviewApp({
  client,
  followsCockpitFocus = false,
}: DiscoveryPreviewAppProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<ProjectDiscoverySnapshot>();
  const [streamStatus, setStreamStatus] = useState<
    ProjectDiscoveryStreamStatus
  >(
    "connecting",
  );
  const [loadingError, setLoadingError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const snapshotRef = useRef<ProjectDiscoverySnapshot>();

  const acceptSnapshot = (incoming: ProjectDiscoverySnapshot): boolean => {
    const current = snapshotRef.current;
    if (
      current &&
      ((!followsCockpitFocus && incoming.discoveryId !== current.discoveryId) ||
        (incoming.discoveryId === current.discoveryId &&
          incoming.revision < current.revision))
    ) {
      return false;
    }
    snapshotRef.current = incoming;
    setSnapshot(incoming);
    return true;
  };

  useEffect(() => {
    const controller = new AbortController();
    let unsubscribe: (() => void) | undefined;
    snapshotRef.current = undefined;
    setSnapshot(undefined);
    setLoadingError(undefined);
    setStreamStatus("connecting");

    client.load(controller.signal).then((initial) => {
      if (controller.signal.aborted) return;
      acceptSnapshot(initial);
      unsubscribe = client.subscribe(acceptSnapshot, setStreamStatus);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setLoadingError(
        reason instanceof Error
          ? reason.message
          : "The project discovery could not be loaded.",
      );
    });

    return () => {
      controller.abort();
      unsubscribe?.();
    };
  }, [client, loadAttempt]);

  return (
    <div class="discovery-preview-shell">
      <header class="discovery-preview-bar">
        <div>
          <span aria-hidden="true">C</span>
          <p>
            <small>CASYS / PROJECT GUIDE</small>
            <strong>Guided project framing</strong>
          </p>
        </div>
        <div
          class="discovery-transport-state"
          data-state={loadingError ? "error" : streamStatus}
          aria-live="polite"
        >
          <i aria-hidden="true" />
          <span>
            {streamStatusLabel(loadingError ? "error" : streamStatus)}
          </span>
        </div>
      </header>

      {loadingError
        ? (
          <section class="discovery-load-state" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>Project framing is temporarily unavailable</strong>
              <p>{loadingError}</p>
              <Button onClick={() => setLoadAttempt((value) => value + 1)}>
                Try again
              </Button>
            </div>
          </section>
        )
        : !snapshot
        ? (
          <section class="discovery-load-state" aria-busy="true">
            <span class="is-loading" aria-hidden="true" />
            <div>
              <strong>Opening your project conversation</strong>
              <p>Reading the latest reviewed context. No tool is being run.</p>
            </div>
          </section>
        )
        : <DiscoveryWorkbench discovery={snapshot} />}
    </div>
  );
}

function streamStatusLabel(status: DiscoveryTransportState): string {
  if (status === "live") return "Live";
  if (status === "reconnecting") return "Restoring live updates";
  if (status === "error") return "Unavailable";
  return "Connecting";
}

const root = document.querySelector<HTMLElement>("#discovery-preview");
if (!root) throw new Error("Missing #discovery-preview mount point");

installMcpViewTheme(document);

const endpoint = "/api/project-discoveries/active";
const client = new HttpProjectDiscoveryClient(
  endpoint,
  `${endpoint}/events`,
);

render(<DiscoveryPreviewApp client={client} followsCockpitFocus />, root);
