import {
  type AppContext,
  type AppHandle,
  createMcpApp,
  defineView,
  type ToolResult,
} from "@casys/mcp-view";
import type {
  Availability,
  ConsoleSnapshot,
  EvidenceArtifact,
  RequirementVerdict,
  RunDetail,
  RunMeasurement,
  RunProvenance,
  RunStage,
  RunStatus,
  ServerRecord,
  VerdictStatus,
  WorkbenchPanel,
} from "../../domain/types.ts";
import { demoRunDetail, makeDemoSnapshot } from "./fixtures.ts";
import "./styles.css";

type Tab = "fleet" | "runs" | "workbench";

interface ViewState {
  initialized: boolean;
}

interface RuntimeState {
  activeTab: Tab;
  snapshot: ConsoleSnapshot;
  selectedRunId?: string;
  hasExplicitRunSelection: boolean;
  runDetails: Map<string, RunDetail>;
  loadingRunId?: string;
  refreshing: boolean;
  connection: "connecting" | "hosted" | "standalone" | "error";
  notice?: { tone: "info" | "error"; message: string };
  ctx?: AppContext<ViewState>;
  handle?: AppHandle<ViewState>;
}

const appRoot = document.querySelector<HTMLElement>("#app")!;
if (!appRoot) throw new Error("Missing #app mount point");

const runtime: RuntimeState = {
  activeTab: "fleet",
  snapshot: makeDemoSnapshot(),
  selectedRunId: demoRunDetail.id,
  hasExplicitRunSelection: false,
  runDetails: new Map([[demoRunDetail.id, demoRunDetail]]),
  refreshing: false,
  connection: globalThis.parent === globalThis.window ? "standalone" : "connecting",
};

appRoot.innerHTML = `
  <main class="boot" aria-busy="true">
    <div class="boot-mark" aria-hidden="true">DT</div>
    <div>
      <p class="eyebrow">CASYS // THREAD CONSOLE</p>
      <p class="boot-copy">Negotiating the engineering control plane…</p>
    </div>
  </main>
`;

function isConsoleSnapshot(value: unknown): value is ConsoleSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConsoleSnapshot>;
  return candidate.schemaVersion === "1.0" &&
    typeof candidate.generatedAt === "string" &&
    !!candidate.fleet &&
    Array.isArray(candidate.fleet.servers) &&
    !!candidate.runs &&
    Array.isArray(candidate.runs.items) &&
    !!candidate.workbench &&
    Array.isArray(candidate.workbench.panels);
}

function isRunDetail(value: unknown): value is RunDetail {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RunDetail>;
  return typeof candidate.id === "string" &&
    Array.isArray(candidate.stages) &&
    Array.isArray(candidate.requirements) &&
    Array.isArray(candidate.evidence);
}

function getToolError(result: ToolResult): string {
  const text = result.content
    ?.filter((
      item,
    ): item is Extract<(typeof result.content)[number], { type: "text" }> =>
      item.type === "text"
    )
    .map((item) => item.text)
    .join(" ");
  return text || "The control-plane tool returned an error.";
}

function snapshotFromResult(result: ToolResult): ConsoleSnapshot {
  if (result.isError) throw new Error(getToolError(result));
  if (!isConsoleSnapshot(result.structuredContent)) {
    throw new Error(
      "console_snapshot returned an unsupported structuredContent contract.",
    );
  }
  return result.structuredContent;
}

function runDetailFromResult(result: ToolResult): RunDetail {
  if (result.isError) throw new Error(getToolError(result));
  if (!isRunDetail(result.structuredContent)) {
    throw new Error(
      "console_run_detail returned an unsupported structuredContent contract.",
    );
  }
  return result.structuredContent;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function compactHash(value?: string): string {
  if (!value) return "unhashed";
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function compactImage(value?: string): string {
  if (!value) return "not observed";
  const digest = value.indexOf("@sha256:");
  if (digest >= 0) {
    return `${value.slice(0, digest)}@${value.slice(digest + 8, digest + 20)}…`;
  }
  return value;
}

function formatClock(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function duration(start?: string, end?: string): string {
  if (!start) return "not recorded";
  if (!end) return "in progress";
  const delta = new Date(end).valueOf() - new Date(start).valueOf();
  if (!Number.isFinite(delta) || delta < 0) return "—";
  const seconds = Math.round(delta / 1000);
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}

function statusTone(
  status:
    | Availability
    | RunStatus
    | RunStage["status"]
    | RequirementVerdict["status"]
    | VerdictStatus,
): string {
  if (["healthy", "succeeded", "passed", "pass"].includes(status)) return "ok";
  if (["degraded", "running", "unresolved"].includes(status)) return "warn";
  if (["failed", "fail", "timed_out", "unavailable", "error"].includes(status)) {
    return "bad";
  }
  return "neutral";
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function icon(
  name: "fleet" | "runs" | "workbench" | "refresh" | "shield" | "cube" | "copy",
): string {
  const common =
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths = {
    fleet:
      `<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="15" width="18" height="5" rx="1"/><path d="M7 7h.01M7 18h.01M11 7h7M11 18h7"/>`,
    runs:
      `<circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 12h4a3 3 0 0 0 3-3V7M14 15v-3M14 15a3 3 0 0 0 3 3"/>`,
    workbench: `<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"/>`,
    refresh:
      `<path d="M20 6v5h-5M4 18v-5h5"/><path d="M18.1 9A7 7 0 0 0 6.7 6.7L4 11M5.9 15A7 7 0 0 0 17.3 17.3L20 13"/>`,
    shield:
      `<path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-4"/>`,
    cube: `<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4.4 7.7 12 12l7.6-4.3M12 12v9"/>`,
    copy:
      `<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>`,
  };
  return `<svg ${common}>${paths[name]}</svg>`;
}

function renderStatus(status: string, extraClass = ""): string {
  return `<span class="status ${statusTone(status as Availability)} ${extraClass}">
    <span class="status-dot" aria-hidden="true"></span>${esc(statusLabel(status))}
  </span>`;
}

function renderLabeledStatus(label: string, status: string, extraClass = ""): string {
  return `<span class="labeled-status tone-${
    statusTone(status as VerdictStatus)
  } ${extraClass}">
    <small>${esc(label)}</small>${renderStatus(status)}
  </span>`;
}

function preferredRunId(snapshot: ConsoleSnapshot): string | undefined {
  return snapshot.runs.items.find((run) => run.source === "observed")?.id ??
    snapshot.runs.items[0]?.id;
}

function reconcileSelectedRun(snapshot: ConsoleSnapshot): void {
  if (
    !runtime.selectedRunId || !runtime.hasExplicitRunSelection ||
    !snapshot.runs.items.some((run) => run.id === runtime.selectedRunId)
  ) {
    runtime.selectedRunId = preferredRunId(snapshot);
  }
}

function loadSelectedRunDetailIfNeeded(): void {
  if (
    runtime.activeTab === "runs" && runtime.selectedRunId &&
    !runtime.runDetails.has(runtime.selectedRunId)
  ) {
    void loadRunDetail(runtime.selectedRunId);
  }
}

function renderHeader(): string {
  const { snapshot } = runtime;
  const generatedLabel = formatClock(snapshot.generatedAt);
  const connectionLabel = runtime.connection === "hosted"
    ? "MCP HOST"
    : runtime.connection === "connecting"
    ? "CONNECTING"
    : "BROWSER PREVIEW";
  return `
    <header class="masthead">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span>DT</span></div>
        <div>
          <p class="eyebrow">CASYS // ENGINEERING OPERATIONS</p>
          <h1>Thread Console <span class="build-id">01</span></h1>
        </div>
      </div>
      <div class="mast-actions">
        <div class="connection">
          <span class="connection-light ${
    runtime.connection === "hosted" ? "is-live" : ""
  }" aria-hidden="true"></span>
          <span>
            <small>${esc(connectionLabel)}</small>
            <b>${esc(snapshot.mode.toUpperCase())} DATA</b>
          </span>
        </div>
        <button class="button refresh-button" type="button" data-action="refresh"
          ${runtime.refreshing || !runtime.ctx ? "disabled" : ""}
          aria-label="Refresh observed control-plane state">
          ${icon("refresh")}
          <span>${runtime.refreshing ? "Probing…" : "Refresh"}</span>
        </button>
      </div>
    </header>
    <section class="signal-strip" aria-label="Control plane summary">
      <div><span>Fleet</span><strong>${snapshot.fleet.counts.healthy}/${snapshot.fleet.counts.total}</strong><small>healthy MCP</small></div>
      <div><span>Drift</span><strong class="${
    snapshot.fleet.counts.drift ? "text-warn" : ""
  }">${snapshot.fleet.counts.drift}</strong><small>variance${
    snapshot.fleet.counts.drift === 1 ? "" : "s"
  }</small></div>
      <div><span>Runs</span><strong>${snapshot.runs.items.length}</strong><small>indexed</small></div>
      <div><span>Workbench</span><strong>${snapshot.workbench.panels.length}</strong><small>panel contracts</small></div>
      <div class="signal-time"><span>Last observation</span><strong>${
    esc(generatedLabel)
  }</strong><small>${esc(snapshot.schemaVersion)}</small></div>
    </section>
  `;
}

const tabMeta: Array<{ id: Tab; label: string; sub: string }> = [
  { id: "fleet", label: "Fleet", sub: "Runtime & trust" },
  { id: "runs", label: "Runs", sub: "Lineage & evidence" },
  { id: "workbench", label: "Workbench", sub: "Synchronized views" },
];

function renderTabs(): string {
  return `
    <nav class="tabs" role="tablist" aria-label="Thread console sections">
      ${
    tabMeta.map(({ id, label, sub }) => `
        <button id="tab-${id}" role="tab" type="button"
          aria-selected="${runtime.activeTab === id}"
          aria-controls="panel-${id}"
          tabindex="${runtime.activeTab === id ? "0" : "-1"}"
          data-tab="${id}">
          ${icon(id)}
          <span><b>${label}</b><small>${sub}</small></span>
        </button>
      `).join("")
  }
    </nav>
  `;
}

function renderFleetSummary(): string {
  const counts = runtime.snapshot.fleet.counts;
  return `
    <section class="section-heading">
      <div>
        <p class="eyebrow">OBSERVED STATE / DESIRED STATE</p>
        <h2>Engineering MCP fleet</h2>
        <p>Live protocol discovery reconciled against the checked-in control-plane manifest.</p>
      </div>
      <div class="health-score" aria-label="${counts.healthy} of ${counts.total} servers healthy">
        <span class="health-ring"><b>${counts.healthy}</b><small>/${counts.total}</small></span>
        <div><strong>${
    statusLabel(runtime.snapshot.fleet.status)
  }</strong><small>${counts.drift} drifting server${
    counts.drift === 1 ? "" : "s"
  }</small></div>
      </div>
    </section>
  `;
}

function renderToolCoverage(server: ServerRecord): string {
  const observed = new Set(server.observed.mcp.tools.map((tool) => tool.name));
  return server.desired.expectedTools.map((tool) => `
    <span class="token ${observed.has(tool) ? "token-ok" : "token-missing"}">
      <span aria-hidden="true">${observed.has(tool) ? "✓" : "!"}</span>${esc(tool)}
    </span>
  `).join("");
}

function renderServerCard(server: ServerRecord, index: number): string {
  const desired = server.desired;
  const observed = server.observed;
  const driftFields = server.drift.fields.filter((field) => field.status !== "in_sync");
  const views = observed.mcp.viewerUris.length
    ? observed.mcp.viewerUris
    : observed.mcp.resourceUris.filter((uri) => uri.startsWith("ui://"));
  const exposure = desired.network?.exposure ?? "unknown";
  const arbitrary = desired.trust?.executesArbitraryCode ?? false;
  const securityTone = arbitrary || exposure === "public" ? "warn" : "ok";
  return `
    <article class="server-card" aria-labelledby="server-${esc(server.id)}">
      <header class="server-head">
        <div class="server-sequence" aria-hidden="true">${
    String(index + 1).padStart(2, "0")
  }</div>
        <div class="server-title">
          <div class="title-line">
            <h3 id="server-${esc(server.id)}">${esc(desired.displayName)}</h3>
            ${server.demo ? `<span class="demo-tag">DEMO</span>` : ""}
          </div>
          <p>${esc(desired.role)}</p>
        </div>
        <div class="server-state">
          ${renderStatus(observed.status)}
          <small>${
    observed.latencyMs !== undefined ? `${observed.latencyMs} ms` : "no latency"
  }</small>
        </div>
      </header>

      <div class="server-facts">
        <div>
          <span>Server / version</span>
          <strong>${esc(observed.mcp.serverName || desired.serviceName)}</strong>
          <code>${esc(observed.mcp.serverVersion || "not reported")}</code>
        </div>
        <div>
          <span>Transport</span>
          <strong>${esc(desired.transport)}</strong>
          <code>HTTP ${esc(observed.httpStatus ?? "—")} · MCP ${
    esc(observed.mcp.protocolVersion ?? "—")
  }</code>
        </div>
        <div>
          <span>Container</span>
          <strong>${
    esc(
      observed.container.state ||
        (observed.container.present ? "present" : "not present"),
    )
  }</strong>
          <code title="${esc(observed.container.image)}">${
    esc(compactImage(observed.container.image))
  }</code>
        </div>
        <div>
          <span>Endpoint</span>
          <strong>${esc(exposure)}</strong>
          <code title="${esc(desired.mcpUrl)}">${esc(desired.mcpUrl)}</code>
        </div>
      </div>

      <div class="server-lower">
        <section class="coverage" aria-label="Expected tool coverage">
          <div class="mini-heading"><span>Tool surface</span><b>${observed.mcp.tools.length}/${desired.expectedTools.length}</b></div>
          <div class="token-list">${renderToolCoverage(server)}</div>
        </section>
        <section class="views" aria-label="Viewer resources">
          <div class="mini-heading"><span>Views / resources</span><b>${views.length}</b></div>
          ${
    views.length
      ? `<div class="uri-list">${
        views.map((uri) => `<code>${esc(uri)}</code>`).join("")
      }</div>`
      : `<p class="empty-note">No viewer advertised.</p>`
  }
        </section>
        <section class="security-card tone-${securityTone}" aria-label="Security posture">
          <div class="mini-heading"><span>${
    icon("shield")
  }Execution boundary</span><b>${esc(desired.trust?.level ?? "unspecified")}</b></div>
          <p>
            <strong>${
    arbitrary ? "Arbitrary code executor" : "Constrained tool surface"
  }</strong>
            · ${esc(desired.network?.composeNetwork ?? "no network declared")}
          </p>
          ${
    desired.network?.sharedVolumes?.length
      ? `<p>Volumes: ${desired.network.sharedVolumes.map(esc).join(", ")}</p>`
      : ""
  }
          ${
    desired.trust?.notes?.map((note) => `<small>${esc(note)}</small>`).join(
      "",
    ) ?? ""
  }
        </section>
      </div>

      <details class="drift-panel" ${server.drift.status === "drift" ? "open" : ""}>
        <summary>
          <span class="drift-label ${
    server.drift.status === "drift" ? "has-drift" : ""
  }">
            <span class="status-dot" aria-hidden="true"></span>
            ${
    server.drift.status === "drift"
      ? `${driftFields.length} desired / observed variance`
      : "Desired and observed state in sync"
  }
          </span>
          <span>Inspect reconciliation</span>
        </summary>
        <div class="drift-content">
          ${
    driftFields.length
      ? driftFields.map((field) => `
              <div class="drift-row">
                <code>${esc(field.field)}</code>
                <p>${esc(field.message)}</p>
                <span><small>desired</small>${esc(readableValue(field.desired))}</span>
                <span><small>observed</small>${
        esc(readableValue(field.observed))
      }</span>
              </div>
            `).join("")
      : `<p class="empty-note">Every reconciled field matches the manifest at ${
        esc(formatClock(observed.checkedAt))
      }.</p>`
  }
        </div>
      </details>
    </article>
  `;
}

function readableValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderFleet(): string {
  return `
    ${renderFleetSummary()}
    <div class="server-list">
      ${runtime.snapshot.fleet.servers.map(renderServerCard).join("")}
    </div>
  `;
}

function renderRunRail(): string {
  const runs = runtime.snapshot.runs.items;
  return `
    <aside class="run-rail" aria-label="Available engineering runs">
      <div class="rail-heading">
        <span>Run ledger</span>
        <b>${runs.length}</b>
      </div>
      <div class="run-index">
        ${
    runs.length
      ? runs.map((run, index) => `
            <button type="button" data-run-id="${esc(run.id)}"
              class="${runtime.selectedRunId === run.id ? "is-selected" : ""}"
              aria-pressed="${runtime.selectedRunId === run.id}">
              <span class="run-no">${String(index + 1).padStart(2, "0")}</span>
              <span class="run-copy">
                <b>${esc(run.name)}</b>
                <small>${esc(run.subject)}</small>
                <span>${esc(formatDateTime(run.startedAt))} · ${
        esc(duration(run.startedAt, run.completedAt))
      }</span>
              </span>
              ${renderLabeledStatus("simulation", run.status, "run-result")}
              ${
        renderLabeledStatus(
          "verdict",
          run.verdictStatus,
          "run-verdict",
        )
      }
            </button>
          `).join("")
      : `<p class="empty-note">No runs have been indexed.</p>`
  }
      </div>
    </aside>
  `;
}

function renderLineageStage(stage: RunStage, index: number): string {
  const stageGlyph: Record<string, string> = {
    requirements: "RQ",
    sysml: "SM",
    cad: "3D",
    fea: "FX",
    verdict: "OK",
  };
  return `
    <li class="lineage-stage tone-${statusTone(stage.status)}">
      <div class="stage-top">
        <span class="stage-index">${String(index + 1).padStart(2, "0")}</span>
        ${renderStatus(stage.status)}
      </div>
      <div class="stage-glyph" aria-hidden="true">${
    esc(stageGlyph[stage.id] ?? stage.id.slice(0, 2).toUpperCase())
  }</div>
      <h4>${esc(stage.title)}</h4>
      <p>${esc(stage.summary)}</p>
      <footer>
        <code>${esc(stage.serverId)}</code>
        <span title="${esc(stage.tool)}">${esc(stage.tool)}</span>
      </footer>
    </li>
  `;
}

function renderRequirement(requirement: RequirementVerdict): string {
  const width = Math.min(100, Math.max(4, requirement.marginPercent));
  return `
    <tr>
      <td>
        <span class="requirement-id">${esc(requirement.id)}</span>
        <strong>${esc(requirement.title)}</strong>
      </td>
      <td><code>${esc(requirement.computed.display)}</code></td>
      <td><span class="operator">${esc(requirement.operator)}</span> <code>${
    esc(requirement.limit.display)
  }</code></td>
      <td>
        <div class="margin-cell">
          <div class="margin-track" aria-hidden="true"><span style="width:${width}%"></span></div>
          <strong>${esc(requirement.margin.display)}</strong>
          <small>${esc(requirement.marginPercent.toFixed(1))}%</small>
        </div>
      </td>
      <td>${renderStatus(requirement.status)}</td>
    </tr>
  `;
}

function renderArtifact(artifact: EvidenceArtifact): string {
  const location = artifact.path ?? "in-memory artifact";
  const byteSize = artifact.bytes === undefined
    ? ""
    : ` · ${formatBytes(artifact.bytes)}`;
  return `
    <li>
      <span class="artifact-kind">${esc(artifact.kind)}</span>
      <div>
        <strong>${esc(artifact.label)}</strong>
        <small title="${esc(location)}">${esc(location)}${esc(byteSize)}</small>
      </div>
      <code title="${esc(artifact.sha256)}">${esc(compactHash(artifact.sha256))}</code>
      ${
    artifact.sha256
      ? `<button type="button" class="icon-button" data-copy="${
        esc(artifact.sha256)
      }" aria-label="Copy SHA-256 for ${esc(artifact.label)}">${icon("copy")}</button>`
      : ""
  }
    </li>
  `;
}

function renderMeasurement(measurement: RunMeasurement): string {
  return `
    <li>
      <span>${esc(measurement.label)}</span>
      <strong>${esc(measurement.value.display)}</strong>
      <code>${esc(measurement.id)}</code>
    </li>
  `;
}

function renderProvenance(fact: RunProvenance): string {
  const value = fact.value.includes("sha256") || fact.value.length > 38
    ? `<code title="${esc(fact.value)}">${esc(compactHash(fact.value))}</code>`
    : `<span>${esc(fact.value)}</span>`;
  return `<div><dt>${esc(fact.label)}</dt><dd>${value}</dd></div>`;
}

function renderRequirements(detail: RunDetail): string {
  if (detail.verdictStatus === "not_evaluated") {
    return `
      <div class="verdict-pending">
        <div>${renderLabeledStatus("requirement verdict", detail.verdictStatus)}</div>
        <p>No requirement verdict has been attached. This run proves that the simulation executed; SysON and the constraint solver must evaluate limits, units, and margins separately.</p>
      </div>
    `;
  }
  if (detail.requirements.length === 0) {
    return `<p class="empty-note">A requirement verdict was reported, but no individual requirement rows were supplied.</p>`;
  }
  return `
    <div class="table-scroll">
      <table>
        <caption class="sr-only">Requirement computations, limits, margins, and verdicts</caption>
        <thead><tr><th>Requirement</th><th>Computed</th><th>Limit</th><th>Margin</th><th>Verdict</th></tr></thead>
        <tbody>${detail.requirements.map(renderRequirement).join("")}</tbody>
      </table>
    </div>
  `;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function renderRunDetail(detail: RunDetail): string {
  const requirementCount = detail.passedRequirements + detail.failedRequirements +
    detail.unresolvedRequirements;
  const lineageTitle = detail.verdictStatus === "not_evaluated"
    ? "Input → simulation evidence"
    : "Requirement → proof";
  return `
    <section class="run-detail">
      <header class="run-titlebar">
        <div>
          <div class="title-line">
            <p class="eyebrow">${esc(detail.id)} // ${esc(detail.source)}</p>
            <div class="run-status-pair">
              ${renderLabeledStatus("simulation", detail.status)}
              ${renderLabeledStatus("verdict", detail.verdictStatus)}
            </div>
          </div>
          <h2>${esc(detail.name)}</h2>
          <p>${esc(detail.description)}</p>
        </div>
        <dl class="run-meta">
          <div><dt>Started</dt><dd>${esc(formatDateTime(detail.startedAt))}</dd></div>
          <div><dt>Elapsed</dt><dd>${
    esc(duration(detail.startedAt, detail.completedAt))
  }</dd></div>
          <div><dt>Requirements</dt><dd>${
    detail.verdictStatus === "not_evaluated"
      ? "not evaluated"
      : `${detail.passedRequirements}/${requirementCount}`
  }</dd></div>
        </dl>
      </header>

      <section class="lineage-block" aria-labelledby="lineage-title">
        <div class="block-heading">
          <div><span>Execution lineage</span><h3 id="lineage-title">${
    esc(lineageTitle)
  }</h3></div>
          <small>Each stage declares its provenance; immutable artifacts are hashed.</small>
        </div>
        <ol class="lineage">${detail.stages.map(renderLineageStage).join("")}</ol>
      </section>

      <div class="evidence-grid">
        <section class="requirements-block">
          <div class="block-heading observations-heading">
            <div><span>Computed observations</span><h3>Simulation observations</h3></div>
            <small>Value + unit</small>
          </div>
          ${
    detail.measurements.length
      ? `<ul class="measurement-list">${
        detail.measurements.map(renderMeasurement).join("")
      }</ul>`
      : `<p class="empty-note">No direct computed observations were attached to this run.</p>`
  }
          ${
    detail.provenance.length
      ? `<dl class="provenance-list">${
        detail.provenance.map(renderProvenance).join("")
      }</dl>`
      : ""
  }
          ${
    detail.warnings.length
      ? `<ul class="run-warnings">${
        detail.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")
      }</ul>`
      : ""
  }
          <div class="block-heading">
            <div><span>Computed margin</span><h3>Requirement verdicts</h3></div>
            <small>Never inferred from execution status</small>
          </div>
          ${renderRequirements(detail)}
        </section>

        <section class="artifacts-block">
          <div class="block-heading">
            <div><span>Immutable evidence</span><h3>Artifact ledger</h3></div>
            <small>SHA-256</small>
          </div>
          <ul class="artifact-list">${detail.evidence.map(renderArtifact).join("")}</ul>
        </section>
      </div>
    </section>
  `;
}

function renderRuns(): string {
  const selectedId = runtime.selectedRunId;
  const detail = selectedId ? runtime.runDetails.get(selectedId) : undefined;
  return `
    <section class="runs-layout">
      ${renderRunRail()}
      ${
    detail
      ? renderRunDetail(detail)
      : `<section class="run-empty" aria-busy="${
        runtime.loadingRunId ? "true" : "false"
      }">
            <div class="empty-orbit" aria-hidden="true"><span></span></div>
            <p class="eyebrow">RUN DETAIL</p>
            <h2>${
        runtime.loadingRunId
          ? "Resolving evidence bundle…"
          : "Select a run from the ledger"
      }</h2>
            <p>${
        runtime.loadingRunId
          ? `Calling console_run_detail for ${esc(runtime.loadingRunId)}.`
          : "The lineage, computed margins, and artifact hashes will appear here."
      }</p>
          </section>`
  }
    </section>
  `;
}

function sysonPreview(): string {
  return `
    <div class="model-tree">
      <div><span class="tree-caret">⌄</span><b>part</b><strong> bracket</strong></div>
      <div class="tree-child"><span class="type-mark">A</span><span>totalMass</span><code>56.915761 g</code></div>
      <div class="tree-child"><span class="type-mark">R</span><span>massBudget</span>${
    renderStatus("pass")
  }</div>
      <div class="tree-child"><span class="type-mark">R</span><span>holdLoad</span>${
    renderStatus("pass")
  }</div>
      <div class="model-rule"><code>totalMass ≤ 0.070 [kg]</code></div>
    </div>
  `;
}

function cadPreview(): string {
  return `
    <div class="visual-frame cad-frame" aria-label="Stylized bracket geometry preview">
      <svg viewBox="0 0 420 230" role="img" aria-label="Isometric mounting bracket">
        <g class="axis"><path d="M54 189h52M54 189l-21-17M54 189v-43"/><text x="110" y="193">X</text><text x="24" y="170">Y</text><text x="48" y="140">Z</text></g>
        <g class="cad-shadow"><path d="m137 169 102 34 129-60-101-35z"/></g>
        <g class="cad-part">
          <path d="m89 145 111 37 166-74-109-37z"/>
          <path d="m89 145 111 37v27L89 172z"/>
          <path d="m200 182 166-74v26l-166 75z"/>
          <path d="m104 137 33-15V42l74 25v86l-18 8z"/>
          <path d="m137 42 72-31 74 25-72 31z"/>
          <path d="m211 67 72-31v86l-72 31z"/>
          <ellipse cx="164" cy="109" rx="17" ry="23" transform="rotate(-16 164 109)"/>
          <ellipse cx="146" cy="155" rx="17" ry="7" transform="rotate(17 146 155)"/>
          <ellipse cx="304" cy="119" rx="18" ry="8" transform="rotate(-24 304 119)"/>
        </g>
        <g class="dimension"><path d="M83 205h286M83 198v14M369 138v74"/><text x="208" y="222">60.00 mm</text></g>
      </svg>
      <div class="visual-readout"><span>CHECKED-IN MASS</span><b>56.915761</b><small>g</small></div>
    </div>
  `;
}

function feaPreview(): string {
  return `
    <div class="visual-frame fea-frame" aria-label="Stylized finite element result preview">
      <svg viewBox="0 0 420 230" role="img" aria-label="Bracket finite element stress result">
        <g class="fea-part">
          <path class="stress-1" d="m89 145 111 37 166-74-109-37z"/>
          <path class="stress-2" d="m89 145 111 37v27L89 172z"/>
          <path class="stress-3" d="m200 182 166-74v26l-166 75z"/>
          <path class="stress-4" d="m104 137 33-15V42l74 25v111l-11 4-96-32z"/>
          <path class="stress-2" d="m137 42 72-31 74 25-72 31z"/>
          <path class="stress-1" d="m211 67 72-31v93l-72 49z"/>
          <g class="mesh">
            <path d="m90 145 71-12 39 49 26-64 140-10M104 137l55-37 52 67 33-74M137 42l22 58 50-89 35 82 39-57M90 172l71-39 39 76 26-91 140 16M211 67l33 26 39 36"/>
            <path d="m119 49 40 51 50-33 35 26 39-57M104 150l55-50 52 78 33-85 122 41"/>
          </g>
          <ellipse class="fea-hole" cx="164" cy="109" rx="17" ry="23" transform="rotate(-16 164 109)"/>
        </g>
        <g class="load-arrow"><path d="M98 48v57"/><path d="m88 94 10 12 10-12"/><text x="70" y="35">500 N</text></g>
      </svg>
      <div class="stress-scale" aria-label="Stress scale from 0 to 26.6 megapascals">
        <span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="s4"></span>
        <small>0</small><small>26.6 MPa</small>
      </div>
      <div class="provenance-flag">DOCUMENTED EXAMPLE · NOT FRESHLY SOLVED</div>
      <div class="visual-readout"><span>MAX VON MISES</span><b>26.6</b><small>MPa</small></div>
    </div>
  `;
}

function constraintsPreview(): string {
  const detail = runtime.selectedRunId
    ? runtime.runDetails.get(runtime.selectedRunId)
    : undefined;
  const requirements = detail?.requirements ?? demoRunDetail.requirements;
  return `
    <div class="constraint-preview">
      ${
    requirements.slice(0, 3).map((requirement) => `
        <div>
          <header><span>${esc(requirement.id)}</span>${
      renderStatus(requirement.status)
    }</header>
          <p><b>${esc(requirement.computed.display)}</b><span>${
      esc(requirement.operator)
    } ${esc(requirement.limit.display)}</span></p>
          <footer>
            <span class="micro-track"><i style="width:${
      Math.min(100, Math.max(4, requirement.marginPercent))
    }%"></i></span>
            <code>+${esc(requirement.marginPercent.toFixed(1))}%</code>
          </footer>
        </div>
      `).join("")
  }
    </div>
  `;
}

function genericPreview(panel: WorkbenchPanel): string {
  return `
    <div class="generic-preview">
      ${icon("cube")}
      <strong>${esc(panel.kind)}</strong>
      <code>${
    esc(panel.resourceUri ?? panel.endpoint ?? "No resource URI advertised")
  }</code>
    </div>
  `;
}

function workbenchPreview(panel: WorkbenchPanel): string {
  const key = `${panel.id} ${panel.title}`.toLowerCase();
  if (key.includes("requirement")) return constraintsPreview();
  if (key.includes("syson") || key.includes("sysml")) return sysonPreview();
  if (key.includes("model") || key.includes("diagram")) return sysonPreview();
  if (
    key.includes("build123d") || key.includes("cad") || key.includes("geometry")
  ) {
    return cadPreview();
  }
  if (
    key.includes("calculix") || key.includes("fea") || key.includes("physics")
  ) {
    return feaPreview();
  }
  if (key.includes("constraint") || key.includes("verdict")) {
    return constraintsPreview();
  }
  return genericPreview(panel);
}

function renderWorkbenchPanel(panel: WorkbenchPanel, index: number): string {
  return `
    <article class="workbench-panel panel-${index + 1}">
      <header>
        <div>
          <span class="panel-index">${String(index + 1).padStart(2, "0")}</span>
          <div><h3>${esc(panel.title)}</h3><code>${
    esc(panel.sourceServerId ?? panel.kind)
  }</code></div>
        </div>
        ${renderStatus(panel.availability)}
      </header>
      ${workbenchPreview(panel)}
      <footer>
        <span>${panel.demo ? "Demo projection" : "Observed resource"}</span>
        <code title="${esc(panel.resourceUri ?? panel.endpoint ?? "")}">${
    esc(panel.resourceUri ?? panel.endpoint ?? "evidence://local")
  }</code>
      </footer>
    </article>
  `;
}

function renderWorkbench(): string {
  const { workbench } = runtime.snapshot;
  return `
    <section class="section-heading workbench-heading">
      <div>
        <p class="eyebrow">COMPOSED ENGINEERING CONTEXT</p>
        <h2>Cross-tool workbench</h2>
        <p>${workbench.panels.length} read-only model and evidence surfaces assembled around the same run context.</p>
      </div>
      <div class="event-legend">
        <span class="${workbench.synchronization.enabled ? "is-enabled" : ""}">
          <i aria-hidden="true"></i>${
    workbench.synchronization.enabled ? "Event bus active" : "Composition pending"
  }
        </span>
        <small>${workbench.synchronization.events.length} declared events</small>
      </div>
    </section>

    <section class="workbench-grid" aria-label="Engineering application panels">
      ${workbench.panels.map(renderWorkbenchPanel).join("")}
    </section>

    <section class="compose-bay">
      <div class="compose-rail" aria-hidden="true">
        ${
    workbench.panels.map((_, index) =>
      `<span>${String(index + 1).padStart(2, "0")}</span>`
    ).join("<i></i>")
  }
      </div>
      <div class="compose-copy">
        <p class="eyebrow">MCP-COMPOSE RUNTIME BAY</p>
        <h3>${
    workbench.synchronization.enabled
      ? "Agent-authored dashboard mounted"
      : "Awaiting an agent-authored composition"
  }</h3>
        <p>Deterministic container/runtime for a generated YAML composition. ${
    esc(workbench.synchronization.note)
  }</p>
      </div>
      <div class="event-contracts" aria-label="Declared synchronization events">
        ${
    workbench.synchronization.events.map((event) => `<code>${esc(event)}</code>`).join(
      "",
    )
  }
      </div>
    </section>
  `;
}

function renderNotice(): string {
  if (!runtime.notice) return "";
  return `
    <div class="notice tone-${runtime.notice.tone}" role="${
    runtime.notice.tone === "error" ? "alert" : "status"
  }">
      <span aria-hidden="true">${runtime.notice.tone === "error" ? "!" : "i"}</span>
      <p>${esc(runtime.notice.message)}</p>
      <button type="button" data-action="dismiss-notice" aria-label="Dismiss notification">×</button>
    </div>
  `;
}

function buildConsole(): HTMLElement {
  const shell = document.createElement("div");
  shell.className = "console-shell";
  const activeContent = runtime.activeTab === "fleet"
    ? renderFleet()
    : runtime.activeTab === "runs"
    ? renderRuns()
    : renderWorkbench();
  shell.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to content</a>
    ${renderHeader()}
    ${renderTabs()}
    ${renderNotice()}
    <main id="main-content" class="main-content">
      <section id="panel-${runtime.activeTab}" role="tabpanel" tabindex="0" aria-labelledby="tab-${runtime.activeTab}">
        ${activeContent}
      </section>
    </main>
    <footer class="console-footer">
      <span>CASYS DIGITAL THREAD / CONTROL SURFACE</span>
      <span>READ-ONLY OPERATIONS · SCHEMA ${esc(runtime.snapshot.schemaVersion)}</span>
    </footer>
  `;
  bindInteractions(shell);
  return shell;
}

function renderNow(): void {
  appRoot.replaceChildren(buildConsole());
}

function bindInteractions(shell: HTMLElement): void {
  const tabs = [...shell.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  tabs.forEach((button, index) => {
    button.addEventListener(
      "click",
      () => activateTab(button.dataset.tab as Tab),
    );
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : (index - 1 + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (!next) return;
      activateTab(next.dataset.tab as Tab);
      requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>(`#tab-${next.dataset.tab}`)
          ?.focus()
      );
    });
  });

  shell.querySelector<HTMLButtonElement>('[data-action="refresh"]')
    ?.addEventListener("click", () => void refreshSnapshot());
  shell.querySelector<HTMLButtonElement>('[data-action="dismiss-notice"]')
    ?.addEventListener("click", () => {
      runtime.notice = undefined;
      renderNow();
    });

  shell.querySelectorAll<HTMLButtonElement>("[data-run-id]").forEach(
    (button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.runId;
        if (id) void selectRun(id);
      });
    },
  );

  shell.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copy;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        runtime.notice = {
          tone: "info",
          message: "SHA-256 copied to clipboard.",
        };
      } catch {
        runtime.notice = {
          tone: "error",
          message: "Clipboard access was refused by the host.",
        };
      }
      renderNow();
    });
  });
}

function activateTab(tab: Tab): void {
  runtime.activeTab = tab;
  renderNow();
  if (
    tab === "runs" && runtime.selectedRunId &&
    !runtime.runDetails.has(runtime.selectedRunId)
  ) {
    void loadRunDetail(runtime.selectedRunId);
  }
}

async function refreshSnapshot(): Promise<void> {
  if (!runtime.ctx || runtime.refreshing) return;
  runtime.refreshing = true;
  runtime.notice = undefined;
  renderNow();
  try {
    const result = await runtime.ctx.callTool("console_refresh", {});
    runtime.snapshot = snapshotFromResult(result);
    runtime.connection = "hosted";
    reconcileSelectedRun(runtime.snapshot);
    runtime.notice = {
      tone: "info",
      message: `Observed state refreshed at ${
        formatClock(runtime.snapshot.generatedAt)
      }.`,
    };
  } catch (error) {
    runtime.notice = {
      tone: "error",
      message: error instanceof Error
        ? error.message
        : "Unable to refresh the control plane.",
    };
  } finally {
    runtime.refreshing = false;
    renderNow();
    loadSelectedRunDetailIfNeeded();
  }
}

async function selectRun(id: string): Promise<void> {
  runtime.selectedRunId = id;
  runtime.hasExplicitRunSelection = true;
  renderNow();
  if (!runtime.runDetails.has(id)) await loadRunDetail(id);
}

async function loadRunDetail(id: string): Promise<void> {
  if (
    !runtime.ctx || runtime.loadingRunId === id || runtime.runDetails.has(id)
  ) return;
  runtime.loadingRunId = id;
  renderNow();
  try {
    const result = await runtime.ctx.callTool("console_run_detail", { id });
    runtime.runDetails.set(id, runDetailFromResult(result));
  } catch (error) {
    runtime.notice = {
      tone: "error",
      message: error instanceof Error ? error.message : `Unable to load run ${id}.`,
    };
  } finally {
    runtime.loadingRunId = undefined;
    renderNow();
  }
}

const consoleView = defineView<ViewState, void, ConsoleSnapshot>({
  async onEnter(ctx) {
    runtime.ctx = ctx;
    try {
      const result = await ctx.callTool("console_snapshot", {});
      runtime.connection = "hosted";
      return snapshotFromResult(result);
    } catch (error) {
      runtime.connection = "error";
      runtime.notice = {
        tone: "error",
        message: `Live snapshot unavailable; labelled demo fixture is shown. ${
          error instanceof Error ? error.message : ""
        }`,
      };
      return makeDemoSnapshot();
    }
  },
  render(ctx, snapshot) {
    runtime.ctx = ctx;
    runtime.snapshot = snapshot;
    reconcileSelectedRun(snapshot);
    return buildConsole();
  },
});

async function boot(): Promise<void> {
  if (globalThis.parent === globalThis.window) {
    runtime.connection = "standalone";
    runtime.notice = {
      tone: "info",
      message: "Standalone preview: all displayed observations are labelled demo data.",
    };
    renderNow();
    return;
  }

  try {
    const handle = await createMcpApp<ViewState>({
      info: { name: "Casys Thread Console", version: "1.0.0" },
      root: appRoot,
      views: { console: consoleView },
      initialView: "console",
      initialState: { initialized: true },
      strict: true,
      autoResize: true,
    });
    runtime.handle = handle;
    runtime.ctx = handle.ctx;
    runtime.connection = "hosted";

    // mcp-view owns the lifecycle and initial app-only snapshot call above.
    // This handler also accepts later host-pushed console_snapshot results.
    handle.ctx.app.ontoolresult = (result) => {
      if (!isConsoleSnapshot(result.structuredContent)) return;
      runtime.snapshot = result.structuredContent;
      runtime.connection = "hosted";
      reconcileSelectedRun(runtime.snapshot);
      renderNow();
      loadSelectedRunDetailIfNeeded();
    };
    renderNow();
  } catch (error) {
    runtime.connection = "error";
    runtime.notice = {
      tone: "error",
      message: `MCP Apps handshake failed; labelled demo fixture is shown. ${
        error instanceof Error ? error.message : ""
      }`,
    };
    renderNow();
  }
}

void boot();
