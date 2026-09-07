import { assertEquals, assertStringIncludes } from "@std/assert";
import type {
  ThreadViewerSession,
  ThreadViewerSessionJson,
} from "../../presentation/workbench/thread/viewer-sessions.ts";
import { createMcpAppReadOnlyHost } from "../../ui/src/thread/mcp-app-read-only-host.ts";
import { planMcpAppDocument } from "../../ui/src/thread/mcp-app-document-loader.ts";
import {
  PROJECT_RECORDS_APP_ID,
  PROJECT_RECORDS_APP_VERSION,
  PROJECT_RECORDS_SESSION_KIND,
  PROJECT_RECORDS_SESSION_SCHEMA,
} from "./identity.ts";
import {
  buildProjectRecordsAppHtml,
  loadProjectRecordsRuntime,
} from "./project-records-app.ts";

const XSS = '<img src=x onerror="alert(1)">';
const SCRIPT = "</p><script>window.__xss=1</script>";

Deno.test("project-records HTML is an admitted single-file whole App", () => {
  const html = buildProjectRecordsAppHtml();
  planMcpAppDocument(html);
  assertEquals(html.startsWith("<!doctype html>"), true);
  assertEquals((html.match(/<script /g) ?? []).length, 1);
  assertStringIncludes(html, 'type="module"');
  assertEquals(html.includes("<script src"), false);
  assertEquals(html.includes("importmap"), false);
  assertEquals(html.includes("modulepreload"), false);
  assertEquals(html.includes("import("), false);
  assertEquals(html.includes("fetch("), false);
  assertStringIncludes(html, PROJECT_RECORDS_APP_ID);
});

Deno.test("project-records App handshake reads only the registered fingerprint and renders the brief", async () => {
  const capture = documentaryCapture({
    statement: `Keep ${XSS} as captured text.`,
    extraItem: {
      id: "xss",
      kind: "constraint",
      statement: SCRIPT,
      sourceRefs: [{ kind: "intent", reference: XSS }],
    },
  });
  const bytes = new TextEncoder().encode(JSON.stringify(capture));
  const fingerprint = await sha256Of(bytes);
  const payload = sessionPayload(fingerprint, capture);
  const session = viewerSession(payload, bytes.byteLength);
  const document = fakeDocument();
  const runtime = loadProjectRecordsRuntime();
  const hostTarget = new LoopbackTarget();
  const appEnv = {
    parent: {
      postMessage(
        message: unknown,
        _origin: string,
        transfer?: Transferable[],
      ) {
        queueMicrotask(() => {
          host.handleMessage({
            source: hostTarget,
            origin: "null",
            data: message,
            ports: transfer as MessagePort[] | undefined,
          });
        });
      },
    },
    document,
    addEventListener(
      type: string,
      handler: (event: { data: unknown }) => void,
    ) {
      if (type === "message") hostTarget.listeners.push(handler);
    },
    MessageChannel,
  };
  const host = createMcpAppReadOnlyHost({
    target: hostTarget,
    session,
    hostContext: {
      theme: "dark",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
    fetcher: () =>
      Promise.resolve(
        new Response(bytes, {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(bytes.byteLength),
          },
        }),
      ),
  });
  const parsed = runtime.parseApprovedBriefCapture(
    new TextDecoder().decode(bytes),
  );
  assertEquals(parsed !== null, true);
  runtime.connectProjectRecordsApp(appEnv);
  const app = await waitForApp(document);

  assertEquals(document.documentElement.dataset.theme, "dark");
  assertEquals(app.querySelector(".unavailable"), null);
  assertEquals(
    app.querySelector(".kicker")?.textContent,
    "Documentary baseline",
  );
  assertEquals(
    document.getElementById("app")?.querySelector(".scope")?.textContent,
    "pre-technical-documentation",
  );
  assertStringIncludes(
    document.getElementById("app")?.querySelector("h1")?.textContent ?? "",
    "Generic Industrial Product",
  );
  const articles = document.getElementById("app")?.querySelectorAll("article") ?? [];
  const statements = [...articles].map((article) =>
    article.querySelector("p")?.textContent
  );
  assertEquals(statements.includes(`Keep ${XSS} as captured text.`), true);
  assertEquals(statements.includes(SCRIPT), true);
  assertEquals(document.querySelectorAll("img").length, 0);
  assertEquals(document.querySelectorAll("script").length, 0);
  assertEquals((globalThis as { __xss?: number }).__xss, undefined);
  host.invalidate();
});

Deno.test("project-records App states unavailable for malformed or unavailable resources", async () => {
  const capture = documentaryCapture({});
  const bytes = new TextEncoder().encode(JSON.stringify(capture));
  const fingerprint = await sha256Of(bytes);
  const payload = sessionPayload(fingerprint, capture);
  await assertUnavailable(
    payload,
    bytes.byteLength,
    () =>
      Promise.resolve(
        new Response("not-json", {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "8",
          },
        }),
      ),
  );
  await assertUnavailable(
    payload,
    bytes.byteLength,
    () =>
      Promise.resolve(
        new Response(null, {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
  );
  const wrong = sessionPayload(`sha256:${"a".repeat(64)}`, capture);
  await assertUnavailable(
    wrong,
    bytes.byteLength,
    () =>
      Promise.resolve(
        new Response(bytes, {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(bytes.byteLength),
          },
        }),
      ),
  );
});

async function assertUnavailable(
  payload: Record<string, unknown>,
  bytes: number,
  fetcher: () => Promise<Response>,
): Promise<void> {
  const session = viewerSession(payload, bytes);
  const document = fakeDocument();
  const runtime = loadProjectRecordsRuntime();
  const hostTarget = new LoopbackTarget();
  const host = createMcpAppReadOnlyHost({
    target: hostTarget,
    session,
    hostContext: {
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
    fetcher,
  });
  runtime.connectProjectRecordsApp({
    parent: {
      postMessage(
        message: unknown,
        _origin: string,
        transfer?: Transferable[],
      ) {
        queueMicrotask(() => {
          host.handleMessage({
            source: hostTarget,
            origin: "null",
            data: message,
            ports: transfer as MessagePort[] | undefined,
          });
        });
      },
    },
    document,
    addEventListener(
      type: string,
      handler: (event: { data: unknown }) => void,
    ) {
      if (type === "message") hostTarget.listeners.push(handler);
    },
    MessageChannel,
  });
  const app = await waitForApp(document);
  const status = app.querySelector("[data-status]");
  assertEquals(status?.textContent, "unavailable");
  assertEquals(status?.dataset.status, "unavailable");
  assertEquals(document.querySelector("h1")?.textContent ?? "", "");
  host.invalidate();
}

async function waitForApp(document: ReturnType<typeof fakeDocument>) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const app = document.getElementById("app");
    if (
      app &&
      (app.querySelector(".kicker") ||
        app.querySelector("[data-status='unavailable']") ||
        app.querySelector(".unavailable"))
    ) {
      return app;
    }
    await delay(25);
  }
  const app = document.getElementById("app");
  throw new Error(
    `project-records App did not settle; children=${
      app?.children.length ?? "none"
    } class=${app?.children[0]?.className ?? ""} text=${
      app?.children[0]?.textContent ?? ""
    }`,
  );
}

function documentaryCapture(options: {
  readonly statement?: string;
  readonly extraItem?: {
    readonly id: string;
    readonly kind: string;
    readonly statement: string;
    readonly sourceRefs: readonly {
      readonly kind: string;
      readonly reference: string;
    }[];
  };
}) {
  return {
    schemaVersion: "approved-brief-baseline-capture/1.1",
    kind: "approved-brief-documentary-baseline",
    scope: "pre-technical-documentation",
    statement: options.statement ??
      "Immutable documentary capture of the exact human-approved project brief.",
    runId: "run:baseline",
    capturedAt: "2026-08-03T09:00:01.000Z",
    operation: {
      id: "baseline.from-approved-brief",
      version: "1",
      bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
    },
    workItemId: "record-brief",
    projectDefinition: {
      identity: {
        id: "generic-product-v1",
        name: "Generic Industrial Product",
        subjectId: "generic-product-v1",
      },
    },
    approvedBrief: {
      briefId: "generic-product-v1:brief",
      id: "generic-product-v1:brief:r1",
      revision: 1,
      proposedAt: "2026-08-03T09:00:00.000Z",
      proposedBy: { id: "mcp:casys-mcp-call@1", origin: "agent" },
      items: [
        {
          id: "objective",
          kind: "objective",
          statement: options.statement ??
            "Prepare a reviewable industrial product design.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        },
        {
          id: "mission",
          kind: "mission-scenario",
          statement: "Operate safely under the intended operating conditions.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        },
        {
          id: "success",
          kind: "success-criterion",
          statement: "Demonstrate the approved baseline before technical evidence.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        },
        ...(options.extraItem ? [options.extraItem] : []),
      ],
    },
    briefSourceAnalysis: { briefId: "generic-product-v1:brief" },
  };
}

function sessionPayload(
  fingerprint: string,
  capture: ReturnType<typeof documentaryCapture>,
) {
  return {
    schemaVersion: PROJECT_RECORDS_SESSION_SCHEMA,
    kind: PROJECT_RECORDS_SESSION_KIND,
    fingerprint,
    artifactId: `approved-brief-document-${fingerprint.slice(7)}`,
    runId: capture.runId,
    workItemId: capture.workItemId,
    projectId: capture.projectDefinition.identity.id,
    subjectId: capture.projectDefinition.identity.subjectId,
    briefId: capture.approvedBrief.briefId,
    briefSnapshotId: capture.approvedBrief.id,
    briefRevision: capture.approvedBrief.revision,
  };
}

function viewerSession(
  payload: Record<string, unknown>,
  bytes: number,
): ThreadViewerSession {
  const fingerprint = payload.fingerprint as string;
  return {
    id: `mcp-app:${"d".repeat(64)}`,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: payload.artifactId as string },
    app: { id: PROJECT_RECORDS_APP_ID, version: PROJECT_RECORDS_APP_VERSION },
    manifest: {
      uri: "ui://digital-thread/project-records/manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://digital-thread/project-records",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 1024,
    },
    launchUri: "/api/thread/viewer-apps/launch/aa/bb",
    readResources: [{
      uri: `/api/thread/viewer-apps/resources/${fingerprint.slice(7)}`,
      mimeType: "application/json",
      bytes,
      fingerprint,
    }],
    session: {
      action: "viewer.session.apply",
      schema: PROJECT_RECORDS_SESSION_SCHEMA,
      payload: payload as Readonly<Record<string, ThreadViewerSessionJson>>,
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}

class LoopbackTarget {
  readonly listeners: Array<(event: { data: unknown }) => void> = [];
  postMessage(
    message: unknown,
    _origin: string,
    _transfer?: Transferable[],
  ): void {
    queueMicrotask(() => {
      for (const listener of this.listeners) listener({ data: message });
    });
  }
}

function fakeDocument() {
  const documentElement = el("html");
  const body = el("body");
  const app = el("main");
  app.id = "app";
  app.setAttribute("id", "app");
  body.append(app);
  const nodes = new Map<string, FakeElement>([["app", app]]);
  return {
    documentElement,
    body,
    getElementById(id: string) {
      return nodes.get(id) ?? null;
    },
    createElement(tag: string) {
      return el(tag);
    },
    querySelector(selector: string) {
      return body.querySelector(selector);
    },
    querySelectorAll(selector: string) {
      return body.querySelectorAll(selector);
    },
  };
}

interface FakeElement {
  readonly tagName: string;
  id: string;
  className: string;
  textContent: string;
  readonly dataset: Record<string, string>;
  readonly style: Record<string, string>;
  readonly children: FakeElement[];
  readonly childNodes: FakeElement[];
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  append(...nodes: FakeElement[]): void;
  replaceChildren(): void;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
}

function el(tag: string): FakeElement {
  const children: FakeElement[] = [];
  const attributes = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const node: FakeElement = {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    dataset,
    style: {},
    children,
    childNodes: children,
    setAttribute(name, value) {
      attributes.set(name, value);
      if (name === "id") node.id = value;
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(
          /-([a-z])/g,
          (_all, letter) => letter.toUpperCase(),
        );
        dataset[key] = value;
      }
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    append(...nodes) {
      children.push(...nodes);
    },
    replaceChildren() {
      children.length = 0;
      node.textContent = "";
    },
    querySelector(selector) {
      return queryAll(node, selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return queryAll(node, selector);
    },
  };
  return node;
}

function queryAll(root: FakeElement, selector: string): FakeElement[] {
  const matches: FakeElement[] = [];
  const visit = (node: FakeElement) => {
    if (matchesSelector(node, selector)) matches.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return matches;
}

function matchesSelector(node: FakeElement, selector: string): boolean {
  if (selector.startsWith(".")) {
    return node.className.split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  if (selector.startsWith("[data-status]")) {
    return Object.prototype.hasOwnProperty.call(node.dataset, "status");
  }
  return node.tagName === selector.toUpperCase();
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    )
  }`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
