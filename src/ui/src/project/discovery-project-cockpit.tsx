/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { ProjectDiscoverySnapshot } from "../../../domain/project-discovery.ts";
import { buildProjectDiscoveryView } from "./discovery-model.ts";
import { DiscoveryWorkbench } from "./discovery-workbench.tsx";
import { ProjectNavigation, type ProjectWorkspaceView } from "./navigation.tsx";

const PRETECHNICAL_DISABLED_VIEWS: readonly ProjectWorkspaceView[] = [
  "work",
  "product",
  "verification",
  "operations",
];

/**
 * The pre-approval state of the canonical Project tab.
 *
 * ProjectDiscovery remains its own durable aggregate: this shell only makes
 * clear that the person has not left the project cockpit while the agent and
 * human are still agreeing its starting point.
 */
export function DiscoveryProjectCockpit({
  discovery,
  streamLabel,
}: {
  discovery: ProjectDiscoverySnapshot;
  streamLabel: string;
}): JSX.Element {
  const view = buildProjectDiscoveryView(discovery);
  const currentQuestion = view.activeQuestion?.prompt ??
    "No question is waiting in the shared record";

  return (
    <div class="thread-workbench mcp-view-surface discovery-project-cockpit">
      <header class="thread-cockpit-header">
        <div class="thread-cockpit-identity">
          <div class="thread-kicker">
            <span class="thread-coordinate">ENGINEERING PROJECT COCKPIT</span>
          </div>
          <div class="thread-subject-heading">
            <span class="thread-subject-mark" aria-hidden="true">DT</span>
            <div>
              <p class="thread-program">
                PROJECT {discovery.discoveryId} · BRIEF REVISION{" "}
                {discovery.revision}
              </p>
              <h2>Project brief</h2>
              <span class="thread-subject-context">
                Framing in progress · {discovery.id}
              </span>
            </div>
          </div>
        </div>
        <div class="thread-session-panel">
          <div
            class="thread-session-state"
            data-state={streamLabel === "Live" ? "live" : "connecting"}
            aria-live="polite"
          >
            <i aria-hidden="true" />
            <div>
              <small>PROJECT RECORD</small>
              <strong>{streamLabel}</strong>
            </div>
          </div>
          <div class="thread-session-change">
            <small>AGENT NOW</small>
            <strong>{currentQuestion}</strong>
          </div>
          <dl class="thread-session-facts">
            <div>
              <dt>Project</dt>
              <dd data-project-tone={view.statusTone}>{view.statusLabel}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTime(discovery.generatedAt)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <ProjectNavigation
        activeView="overview"
        onChange={() => {}}
        disabledViews={PRETECHNICAL_DISABLED_VIEWS}
      />

      <DiscoveryWorkbench discovery={discovery} embedded />
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
