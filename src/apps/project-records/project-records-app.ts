import {
  MCP_APP_HOST_RESOURCE_READ_SCHEMA,
  MCP_APP_PROTOCOL_VERSION,
  PROJECT_RECORDS_APP_ID,
  PROJECT_RECORDS_APP_TITLE,
  PROJECT_RECORDS_APP_VERSION,
  PROJECT_RECORDS_DOCUMENT_KIND,
  PROJECT_RECORDS_DOCUMENT_SCHEMA,
  PROJECT_RECORDS_DOCUMENT_SCOPE,
  PROJECT_RECORDS_RESOURCE_REQUEST_ID,
  PROJECT_RECORDS_SESSION_KIND,
  PROJECT_RECORDS_SESSION_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "./identity.ts";

const BRIEF_ITEM_KINDS = [
  "objective",
  "primary-user",
  "mission-scenario",
  "operating-environment",
  "success-criterion",
  "constraint",
  "exclusion",
  "intended-market",
  "manufacturing-jurisdiction",
  "operating-jurisdiction",
  "compliance-target",
  "verification-activity",
  "manufacturing-evidence",
  "observed-fact",
  "assumption",
  "open-question",
  "proposed-decision",
] as const;

const SOURCE_KINDS = [
  "intent",
  "answer",
  "tool",
  "document",
  "expert",
] as const;

export const PROJECT_RECORDS_CSS = [
  ":root {",
  "  color-scheme: light;",
  "  --pr-text: #1c2126;",
  "  --pr-muted: #5f6773;",
  "  --pr-border: #e2e5e9;",
  "  --pr-panel: #ffffff;",
  "  --pr-subtle: #f2f4f6;",
  "  --pr-accent: #5e6ad2;",
  "  font-family: ui-sans-serif, system-ui, sans-serif;",
  "  line-height: 1.45;",
  "  background: var(--pr-panel);",
  "  color: var(--pr-text);",
  "}",
  ':root[data-theme="dark"] {',
  "  color-scheme: dark;",
  "  --pr-text: #e8eaed;",
  "  --pr-muted: #9aa0a6;",
  "  --pr-border: #3c4043;",
  "  --pr-panel: #111418;",
  "  --pr-subtle: #1c2126;",
  "  --pr-accent: #8ab4f8;",
  "}",
  "@media (prefers-color-scheme: dark) {",
  '  :root:not([data-theme="light"]) {',
  "    color-scheme: dark;",
  "    --pr-text: #e8eaed;",
  "    --pr-muted: #9aa0a6;",
  "    --pr-border: #3c4043;",
  "    --pr-panel: #111418;",
  "    --pr-subtle: #1c2126;",
  "    --pr-accent: #8ab4f8;",
  "  }",
  "}",
  "html, body { margin: 0; background: var(--pr-panel); color: var(--pr-text); }",
  "main { max-width: 52rem; margin: 0 auto; padding: 1.25rem 1.5rem 2rem; }",
  ".kicker, .scope, .unavailable { letter-spacing: 0.04em; text-transform: uppercase;",
  "  font-size: 0.75rem; color: var(--pr-accent); font-weight: 700; }",
  ".scope, .meta, .muted { color: var(--pr-muted); text-transform: none; font-weight: 500;",
  "  letter-spacing: 0; }",
  "h1 { font-size: 1.5rem; margin: 0.35rem 0 0.75rem; }",
  "h2 { font-size: 0.95rem; margin: 1.25rem 0 0.4rem; color: var(--pr-muted);",
  "  font-family: ui-monospace, SFMono-Regular, monospace; }",
  "h3 { font-size: 0.95rem; margin: 0 0 0.35rem; }",
  "article { border: 1px solid var(--pr-border); background: var(--pr-subtle);",
  "  border-radius: 0.75rem; padding: 0.85rem 1rem; margin: 0.5rem 0; }",
  "dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 0.85rem;",
  "  margin: 0.75rem 0 1rem; }",
  "dt { color: var(--pr-muted); }",
  "dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }",
  "ul { margin: 0.35rem 0 0; padding-left: 1.1rem; }",
  "details { margin-top: 1.25rem; border-top: 1px solid var(--pr-border); padding-top: 0.75rem; }",
  "summary { cursor: pointer; color: var(--pr-muted); }",
  ".unavailable { color: var(--pr-text); }",
].join("\n");

/**
 * Exact inline module body. No imports, fetch, or extra script forms.
 * Constants below are closed over by the generated HTML bootstrap.
 */
export function projectRecordsModuleSource(): string {
  return [
    `"use strict";`,
    `const APP_ID = ${JSON.stringify(PROJECT_RECORDS_APP_ID)};`,
    `const APP_VERSION = ${JSON.stringify(PROJECT_RECORDS_APP_VERSION)};`,
    `const PROTOCOL_VERSION = ${JSON.stringify(MCP_APP_PROTOCOL_VERSION)};`,
    `const SESSION_SCHEMA = ${JSON.stringify(PROJECT_RECORDS_SESSION_SCHEMA)};`,
    `const SESSION_KIND = ${JSON.stringify(PROJECT_RECORDS_SESSION_KIND)};`,
    `const DOCUMENT_SCHEMA = ${JSON.stringify(PROJECT_RECORDS_DOCUMENT_SCHEMA)};`,
    `const DOCUMENT_KIND = ${JSON.stringify(PROJECT_RECORDS_DOCUMENT_KIND)};`,
    `const DOCUMENT_SCOPE = ${JSON.stringify(PROJECT_RECORDS_DOCUMENT_SCOPE)};`,
    `const RESOURCE_SCHEMA = ${JSON.stringify(MCP_APP_HOST_RESOURCE_READ_SCHEMA)};`,
    `const SESSION_ACTION = ${JSON.stringify(VIEWER_SESSION_APPLY_ACTION)};`,
    `const REQUEST_ID = ${JSON.stringify(PROJECT_RECORDS_RESOURCE_REQUEST_ID)};`,
    `const BRIEF_ITEM_KINDS = ${JSON.stringify(BRIEF_ITEM_KINDS)};`,
    `const SOURCE_KINDS = ${JSON.stringify(SOURCE_KINDS)};`,
    PROJECT_RECORDS_MODULE_BODY,
  ].join("\n");
}

export const PROJECT_RECORDS_MODULE_BODY = `
const SESSION_KEYS = [
  "artifactId",
  "briefId",
  "briefRevision",
  "briefSnapshotId",
  "fingerprint",
  "kind",
  "projectId",
  "runId",
  "schemaVersion",
  "subjectId",
  "workItemId",
];
const CAPTURE_KEYS = [
  "approvedBrief",
  "briefSourceAnalysis",
  "capturedAt",
  "kind",
  "operation",
  "projectDefinition",
  "runId",
  "schemaVersion",
  "scope",
  "statement",
  "workItemId",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    if (actual[index] !== keys[index]) return false;
  }
  return true;
}

function closedKeys(value, required, optional) {
  if (!isRecord(value)) return false;
  const allowed = {};
  for (let index = 0; index < required.length; index += 1) {
    allowed[required[index]] = true;
    if (!Object.prototype.hasOwnProperty.call(value, required[index])) {
      return false;
    }
  }
  for (let index = 0; index < optional.length; index += 1) {
    allowed[optional[index]] = true;
  }
  const actual = Object.keys(value);
  for (let index = 0; index < actual.length; index += 1) {
    if (!allowed[actual[index]]) return false;
  }
  return true;
}

function isSha256(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isId(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function isInstant(value) {
  return typeof value === "string" &&
    /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function isPositiveInt(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isFingerprint(value) {
  return isRecord(value) &&
    exactKeys(value, ["algorithm", "digest"]) &&
    value.algorithm === "sha256" &&
    typeof value.digest === "string" &&
    /^[a-f0-9]{64}$/.test(value.digest);
}

function parseApprovedBriefSession(value) {
  if (!exactKeys(value, SESSION_KEYS)) return null;
  if (value.schemaVersion !== SESSION_SCHEMA || value.kind !== SESSION_KIND) {
    return null;
  }
  if (
    !isSha256(value.fingerprint) ||
    !isId(value.artifactId) ||
    !isId(value.runId) ||
    !isId(value.workItemId) ||
    !isId(value.projectId) ||
    !isId(value.subjectId) ||
    !isId(value.briefId) ||
    !isId(value.briefSnapshotId) ||
    !isPositiveInt(value.briefRevision)
  ) {
    return null;
  }
  return value;
}

function parseSourceRef(value) {
  if (!exactKeys(value, ["kind", "reference"])) return null;
  if (SOURCE_KINDS.indexOf(value.kind) < 0) return null;
  if (typeof value.reference !== "string" || value.reference.trim().length === 0) {
    return null;
  }
  return value;
}

function parseBriefItem(value) {
  if (
    !closedKeys(value, ["id", "kind", "statement", "sourceRefs"], [
      "owner",
      "reviewTrigger",
      "dependsOnItemIds",
      "verificationAuthority",
    ])
  ) {
    return null;
  }
  if (!isId(value.id) || BRIEF_ITEM_KINDS.indexOf(value.kind) < 0) return null;
  if (typeof value.statement !== "string" || value.statement.length === 0) {
    return null;
  }
  if (!Array.isArray(value.sourceRefs)) return null;
  for (let index = 0; index < value.sourceRefs.length; index += 1) {
    if (!parseSourceRef(value.sourceRefs[index])) return null;
  }
  return value;
}

function parseApprovedBrief(value) {
  if (
    !closedKeys(value, [
      "briefId",
      "id",
      "items",
      "proposedAt",
      "proposedBy",
      "revision",
    ], ["contractVersion", "previous"])
  ) {
    return null;
  }
  if (
    !isId(value.briefId) || !isId(value.id) || !isPositiveInt(value.revision) ||
    !isInstant(value.proposedAt) || !isRecord(value.proposedBy) ||
    typeof value.proposedBy.id !== "string" || value.proposedBy.id.trim().length === 0 ||
    (value.proposedBy.origin !== "human" && value.proposedBy.origin !== "agent") ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  for (let index = 0; index < value.items.length; index += 1) {
    if (!parseBriefItem(value.items[index])) return null;
  }
  return value;
}

function parseApprovedBriefCapture(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  let capture;
  try {
    capture = JSON.parse(text);
  } catch (_error) {
    return null;
  }
  if (!exactKeys(capture, CAPTURE_KEYS)) return null;
  if (
    capture.schemaVersion !== DOCUMENT_SCHEMA ||
    capture.kind !== DOCUMENT_KIND ||
    capture.scope !== DOCUMENT_SCOPE
  ) {
    return null;
  }
  if (
    typeof capture.statement !== "string" || capture.statement.length === 0 ||
    !isId(capture.runId) || !isInstant(capture.capturedAt) ||
    !isId(capture.workItemId) || !isRecord(capture.operation) ||
    capture.operation.id !== "baseline.from-approved-brief" ||
    capture.operation.version !== "1" ||
    !isRecord(capture.projectDefinition) ||
    !isRecord(capture.projectDefinition.identity) ||
    typeof capture.projectDefinition.identity.name !== "string" ||
    capture.projectDefinition.identity.name.length === 0 ||
    !isId(capture.projectDefinition.identity.id) ||
    !isId(capture.projectDefinition.identity.subjectId) ||
    !parseApprovedBrief(capture.approvedBrief) ||
    !isRecord(capture.briefSourceAnalysis)
  ) {
    return null;
  }
  return capture;
}

function captureMatchesSession(capture, session) {
  return capture.runId === session.runId &&
    capture.workItemId === session.workItemId &&
    capture.projectDefinition.identity.id === session.projectId &&
    capture.projectDefinition.identity.subjectId === session.subjectId &&
    capture.approvedBrief.briefId === session.briefId &&
    capture.approvedBrief.id === session.briefSnapshotId &&
    capture.approvedBrief.revision === session.briefRevision;
}

function textEl(document, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function appendMeta(document, list, label, value) {
  if (typeof value !== "string" || value.length === 0) return;
  list.append(textEl(document, "dt", label));
  list.append(textEl(document, "dd", value));
}

function showUnavailable(document, reason) {
  const root = document.getElementById("app");
  if (!root) return;
  root.replaceChildren();
  const status = textEl(document, "p", "unavailable");
  status.className = "unavailable";
  status.dataset.status = "unavailable";
  if (typeof reason === "string" && reason.length > 0) {
    status.dataset.reason = reason;
  }
  root.append(status);
}

function renderApprovedBriefDocument(document, capture, session) {
  const root = document.getElementById("app");
  if (!root) return;
  root.replaceChildren();
  const identity = capture.projectDefinition.identity;
  const brief = capture.approvedBrief;
  const kicker = textEl(document, "p", "Documentary baseline");
  kicker.className = "kicker";
  const scope = textEl(document, "p", DOCUMENT_SCOPE);
  scope.className = "scope";
  const title = textEl(document, "h1", identity.name);
  const meta = document.createElement("dl");
  appendMeta(document, meta, "Brief id", brief.briefId);
  appendMeta(document, meta, "Brief revision", String(brief.revision));
  appendMeta(document, meta, "Capture time", capture.capturedAt);
  appendMeta(
    document,
    meta,
    "proposedBy",
    brief.proposedBy.origin + ":" + brief.proposedBy.id,
  );
  appendMeta(document, meta, "proposedAt", brief.proposedAt);
  root.append(kicker, scope, title, meta);

  const groups = {};
  for (let index = 0; index < brief.items.length; index += 1) {
    const item = brief.items[index];
    if (!groups[item.kind]) groups[item.kind] = [];
    groups[item.kind].push(item);
  }
  for (let kindIndex = 0; kindIndex < BRIEF_ITEM_KINDS.length; kindIndex += 1) {
    const kind = BRIEF_ITEM_KINDS[kindIndex];
    const items = groups[kind];
    if (!items || items.length === 0) continue;
    const heading = textEl(document, "h2", kind);
    root.append(heading);
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      const article = document.createElement("article");
      article.append(textEl(document, "h3", item.id));
      article.append(textEl(document, "p", item.statement));
      const itemMeta = document.createElement("dl");
      appendMeta(document, itemMeta, "Owner", item.owner);
      appendMeta(document, itemMeta, "Review trigger", item.reviewTrigger);
      if (Array.isArray(item.dependsOnItemIds)) {
        appendMeta(document, itemMeta, "Declared dependencies", item.dependsOnItemIds.join(", ") || "None declared");
      }
      if (isRecord(item.verificationAuthority)) {
        appendMeta(document, itemMeta, "Verification method", item.verificationAuthority.id + "@" + item.verificationAuthority.version);
      }
      if (itemMeta.childNodes.length > 0) article.append(itemMeta);
      if (item.sourceRefs.length > 0) {
        const list = document.createElement("ul");
        for (let refIndex = 0; refIndex < item.sourceRefs.length; refIndex += 1) {
          const ref = item.sourceRefs[refIndex];
          list.append(textEl(document, "li", ref.kind + " " + ref.reference));
        }
        article.append(list);
      }
      root.append(article);
    }
  }

  const provenance = document.createElement("details");
  provenance.append(textEl(document, "summary", "Provenance"));
  const facts = document.createElement("dl");
  appendMeta(document, facts, "Historic brief snapshot", brief.id);
  appendMeta(document, facts, "Recorded operation",
    capture.operation.id + "@" + capture.operation.version);
  appendMeta(document, facts, "Recorded run", capture.runId);
  appendMeta(document, facts, "Work item", capture.workItemId);
  appendMeta(document, facts, "Documentary statement", capture.statement);
  appendMeta(document, facts, "Artifact", session.artifactId);
  provenance.append(facts);
  root.append(provenance);
}

function bytesToFingerprint(bytes) {
  return crypto.subtle.digest("SHA-256", bytes).then(function (digest) {
    const hex = [...new Uint8Array(digest)]
      .map(function (byte) {
        return byte.toString(16).padStart(2, "0");
      })
      .join("");
    return "sha256:" + hex;
  });
}

function decodeBase64(data) {
  if (typeof data !== "string" || data.indexOf(",") >= 0) return null;
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (_error) {
    return null;
  }
}

function applyHostTheme(document, context) {
  if (!isRecord(context)) return;
  const theme = context.theme;
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }
}

function connectProjectRecordsApp(env) {
  const runtime = env || globalThis;
  const parent = runtime.parent;
  const document = runtime.document;
  const Channel = runtime.MessageChannel;
  const listen = runtime.addEventListener.bind(runtime);
  const channel = new Channel();
  let initializeId = 1;
  let sessionApplied = false;
  let resourceRequested = false;
  let currentSession = null;

  function fail(reason) {
    showUnavailable(document, reason);
  }

  async function admitResource(message) {
    if (
      !isRecord(message) ||
      message.schemaVersion !== RESOURCE_SCHEMA ||
      message.type !== "mcp-app-host.resource.read.result" ||
      message.requestId !== REQUEST_ID ||
      !currentSession
    ) {
      fail("malformed-resource");
      return;
    }
    if (message.status === "unavailable") {
      fail("unavailable");
      return;
    }
    if (
      message.status !== "available" ||
      !isRecord(message.resource) ||
      message.fingerprint !== currentSession.fingerprint ||
      message.resource.fingerprint !== currentSession.fingerprint ||
      message.resource.encoding !== "base64" ||
      typeof message.resource.bytes !== "number"
    ) {
      fail("malformed-resource");
      return;
    }
    const bytes = decodeBase64(message.resource.data);
    if (!bytes || bytes.byteLength !== message.resource.bytes) {
      fail("byte-count-mismatch");
      return;
    }
    const fingerprint = await bytesToFingerprint(bytes);
    if (fingerprint !== currentSession.fingerprint) {
      fail("fingerprint-mismatch");
      return;
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_error) {
      fail("invalid-document");
      return;
    }
    const capture = parseApprovedBriefCapture(text);
    if (!capture || !captureMatchesSession(capture, currentSession)) {
      fail("invalid-document");
      return;
    }
    renderApprovedBriefDocument(document, capture, currentSession);
  }

  channel.port1.start();
  channel.port1.addEventListener("message", function (event) {
    void admitResource(event.data);
  });

  listen("message", function (event) {
    const message = event.data;
    if (!isRecord(message) || message.jsonrpc !== "2.0") return;
    if (
      Object.prototype.hasOwnProperty.call(message, "id") &&
      message.id === initializeId &&
      isRecord(message.result)
    ) {
      applyHostTheme(document, message.result.hostContext);
      parent.postMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/initialized",
      }, "*");
      return;
    }
    if (message.method === "ui/notifications/host-context-changed") {
      applyHostTheme(document, message.params);
      return;
    }
    if (message.method !== "ui/compose/event" || sessionApplied) return;
    if (!isRecord(message.params) || message.params.action !== SESSION_ACTION) {
      fail("malformed-session");
      return;
    }
    const session = parseApprovedBriefSession(message.params.data);
    if (!session) {
      fail("malformed-session");
      return;
    }
    sessionApplied = true;
    currentSession = session;
    if (resourceRequested) return;
    resourceRequested = true;
    channel.port1.postMessage({
      schemaVersion: RESOURCE_SCHEMA,
      type: "mcp-app-host.resource.read",
      requestId: REQUEST_ID,
      fingerprint: session.fingerprint,
    });
  });

  parent.postMessage({
    schemaVersion: RESOURCE_SCHEMA,
    type: "mcp-app-host.resource.port.offer",
  }, "*", [channel.port2]);
  parent.postMessage({
    jsonrpc: "2.0",
    id: initializeId,
    method: "ui/initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      appInfo: { name: APP_ID, version: APP_VERSION },
      appCapabilities: {},
    },
  }, "*");
}
`.trim();

export function buildProjectRecordsAppHtml(): string {
  const module = projectRecordsModuleSource();
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${PROJECT_RECORDS_APP_TITLE}</title>`,
    "<style>",
    PROJECT_RECORDS_CSS,
    "</style>",
    "</head>",
    "<body>",
    '<main id="app"><p data-status="pending">Loading documentary baseline</p></main>',
    '<script type="module">',
    module,
    "connectProjectRecordsApp();",
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export interface ProjectRecordsRuntime {
  parseApprovedBriefCapture(text: string): unknown | null;
  parseApprovedBriefSession(value: unknown): unknown | null;
  connectProjectRecordsApp(env?: unknown): void;
  showUnavailable(document: unknown, reason?: string): void;
  renderApprovedBriefDocument(
    document: unknown,
    capture: unknown,
    session: unknown,
  ): void;
}

export function loadProjectRecordsRuntime(): ProjectRecordsRuntime {
  return new Function(
    `${projectRecordsModuleSource()}; return { parseApprovedBriefCapture, parseApprovedBriefSession, connectProjectRecordsApp, showUnavailable, renderApprovedBriefDocument };`,
  )() as ProjectRecordsRuntime;
}
