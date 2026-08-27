import type {
  ComponentDiagnostic,
  ComponentState,
  DesktopShellViewModel,
  ShellStatus,
} from "../contracts/diagnostics.ts";
import { escapeHtml } from "./escape.ts";
import { DESKTOP_SHELL_CSP } from "./headers.ts";
import { DESKTOP_SHELL_STYLES } from "./styles.ts";

const SHELL_STATUS_MEANING: Readonly<Record<ShellStatus, string>> = {
  ready: "every listed component is ready",
  degraded: "the shell is shown while one or more components are not ready",
  "recovery-required": "a blocking failure must be resolved before normal use",
};

const COMPONENT_STATE_MEANING: Readonly<Record<ComponentState, string>> = {
  ready: "observed and usable",
  unavailable: "not present to observe",
  unresolved: "observed, still incomplete",
  error: "observation failed",
};

function readShellStatus(status: ShellStatus): ShellStatus {
  if (
    status === "ready" ||
    status === "degraded" ||
    status === "recovery-required"
  ) {
    return status;
  }
  throw new TypeError(
    "Desktop shell status must be ready, degraded, or recovery-required",
  );
}

function readComponentState(state: ComponentState): ComponentState {
  if (
    state === "ready" ||
    state === "unavailable" ||
    state === "unresolved" ||
    state === "error"
  ) {
    return state;
  }
  throw new TypeError(
    "Component state must be ready, unavailable, unresolved, or error",
  );
}

function stamp(
  kind: "shell" | "component",
  token: ShellStatus | ComponentState,
  meaning: string,
): string {
  const attr = kind === "shell"
    ? `data-shell-status="${escapeHtml(token)}"`
    : `data-component-state="${escapeHtml(token)}"`;
  const word = escapeHtml(token);
  return `
    <p class="stamp" ${attr}>
      <span class="stamp-mark" aria-hidden="true"></span>
      <span class="stamp-word">${word}</span>
    </p>
    <p class="stamp-meaning">
      <span class="stamp-meaning-token">${word}</span>
      means ${escapeHtml(meaning)}.
    </p>
  `;
}

function field(label: string, value: string): string {
  return `
    <div class="field">
      <dt>${escapeHtml(label)}</dt>
      <dd><p>${escapeHtml(value)}</p></dd>
    </div>
  `;
}

function renderComponent(
  component: ComponentDiagnostic,
  index: number,
): string {
  const state = readComponentState(component.state);
  const headingId = `component-${index}-label`;
  const label = escapeHtml(component.label);
  const recovery = component.recovery === undefined
    ? ""
    : field("Recovery", component.recovery);
  const version = component.version === undefined
    ? ""
    : field("Observed version", component.version);
  return `
    <li class="component" data-component-state="${escapeHtml(state)}">
      <article aria-labelledby="${headingId}">
        <div class="component-head">
          <div>
            <h3 id="${headingId}" class="component-label">${label}</h3>
            <p class="component-id">${escapeHtml(component.id)}</p>
          </div>
          <div>
            ${stamp("component", state, COMPONENT_STATE_MEANING[state])}
          </div>
        </div>
        <p class="component-summary">${escapeHtml(component.summary)}</p>
        <dl class="fields">
          ${field("Evidence", component.evidence)}
          ${recovery}
          ${version}
        </dl>
      </article>
    </li>
  `;
}

function renderComponents(
  components: readonly ComponentDiagnostic[],
): string {
  if (components.length === 0) {
    return `<p class="empty-note">No component evidence in this view.</p>`;
  }
  return `
    <ul class="component-list">
      ${components.map(renderComponent).join("")}
    </ul>
  `;
}

/** Renders one complete, script-free HTML document from the shell view model. */
export function renderDesktopShell(model: DesktopShellViewModel): string {
  const status = readShellStatus(model.status);
  const statusAttr = escapeHtml(status);
  const productName = escapeHtml(model.productName);
  const title = escapeHtml(model.title);
  const pageTitle = `${title} · ${productName}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(DESKTOP_SHELL_CSP)}">
  <title>${pageTitle}</title>
  <style>${DESKTOP_SHELL_STYLES}</style>
</head>
<body data-shell-status="${statusAttr}">
  <a class="skip-link" href="#main">Skip to shell status</a>
  <div class="sheet">
    <header class="title-block">
      <dl>
        <div>
          <dt>Product</dt>
          <dd>${productName}</dd>
        </div>
        <div class="cell-meta">
          <dt>Version</dt>
          <dd>${escapeHtml(model.productVersion)}</dd>
        </div>
        <div class="cell-meta">
          <dt>Platform</dt>
          <dd>${escapeHtml(model.platform)}</dd>
        </div>
      </dl>
    </header>
    <main id="main">
      <section class="aggregate" aria-labelledby="shell-status-heading" data-shell-status="${statusAttr}">
        <p class="kicker">Shell status</p>
        <div class="aggregate-status">
          ${stamp("shell", status, SHELL_STATUS_MEANING[status])}
        </div>
        <h1 id="shell-status-heading" class="aggregate-heading">${title}</h1>
        <p class="aggregate-summary">${escapeHtml(model.summary)}</p>
      </section>
      <section class="components" aria-labelledby="component-evidence-heading">
        <h2 id="component-evidence-heading" class="components-heading">Component evidence</h2>
        <p class="section-note">These states are literal observations. They are not the shell aggregate.</p>
        ${renderComponents(model.components)}
      </section>
    </main>
    <footer>
      <p class="footer-note">This window is presentation only. It cannot start a service, choose a tool, or change evidence.</p>
    </footer>
  </div>
</body>
</html>
`;
}
