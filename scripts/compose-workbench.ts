export interface ComposeWorkbenchDashboard {
  id: string;
  title: string;
  description: string;
}

export interface EmbeddedDashboardHandle {
  url: string;
  shutdown(): Promise<void>;
}

export interface ServeComposeWorkbenchOptions {
  dashboards: readonly ComposeWorkbenchDashboard[];
  startDashboard(
    dashboard: ComposeWorkbenchDashboard,
    frameAncestors: readonly string[],
  ): Promise<EmbeddedDashboardHandle>;
  port?: number;
  open?: boolean;
}

export interface ComposeWorkbenchHandle {
  url: string;
  shutdown(): Promise<void>;
}

interface ActiveDashboard {
  definition: ComposeWorkbenchDashboard;
  handle: EmbeddedDashboardHandle;
}

const HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 60_060;
const DASHBOARD_ID = /^[a-z0-9][a-z0-9-]*$/;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function pageResponse(): Response {
  return new Response(WORKBENCH_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'none'",
        "style-src 'unsafe-inline'",
        "script-src 'unsafe-inline'",
        "connect-src 'self'",
        "frame-src http://127.0.0.1:* http://localhost:*",
        "frame-ancestors http://127.0.0.1:* http://localhost:*",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ].join("; "),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function validateDashboards(
  dashboards: readonly ComposeWorkbenchDashboard[],
): Map<string, ComposeWorkbenchDashboard> {
  if (dashboards.length === 0) {
    throw new Error("Compose Workbench needs at least one dashboard.");
  }

  const byId = new Map<string, ComposeWorkbenchDashboard>();
  for (const dashboard of dashboards) {
    if (!DASHBOARD_ID.test(dashboard.id)) {
      throw new Error(
        `Invalid dashboard id "${dashboard.id}". Use lowercase letters, numbers and hyphens.`,
      );
    }
    if (!dashboard.title.trim() || !dashboard.description.trim()) {
      throw new Error(`Dashboard "${dashboard.id}" needs a title and description.`);
    }
    if (byId.has(dashboard.id)) {
      throw new Error(`Duplicate dashboard id "${dashboard.id}".`);
    }
    byId.set(dashboard.id, dashboard);
  }
  return byId;
}

function reviewedLoopbackOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const reviewed: string[] = [];
  for (const candidate of value.slice(0, 8)) {
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate);
      const isLoopback = url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" || url.hostname === "[::1]";
      if (
        url.protocol === "http:" && isLoopback && candidate === url.origin &&
        !reviewed.includes(candidate)
      ) {
        reviewed.push(candidate);
      }
    } catch {
      // Ignore client-supplied values that are not exact loopback origins.
    }
  }
  return reviewed;
}

async function openWorkbench(url: string): Promise<void> {
  const command = Deno.build.os === "darwin"
    ? ["open", url]
    : Deno.build.os === "windows"
    ? ["cmd", "/c", "start", url]
    : ["xdg-open", url];
  const [executable, ...args] = command;
  const child = new Deno.Command(executable, {
    args,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  await child.status;
}

export async function serveComposeWorkbench(
  options: ServeComposeWorkbenchOptions,
): Promise<ComposeWorkbenchHandle> {
  const dashboards = [...options.dashboards];
  const dashboardsById = validateDashboards(dashboards);
  let active: ActiveDashboard | null = null;
  let activationQueue: Promise<void> = Promise.resolve();
  let shuttingDown = false;
  let listenPort = options.port ?? DEFAULT_PORT;
  let workbenchOrigin = "";

  async function activate(
    definition: ComposeWorkbenchDashboard,
    requestedAncestors: unknown,
  ): Promise<{ activeDashboardId: string; dashboardUrl: string }> {
    let result: { activeDashboardId: string; dashboardUrl: string } | undefined;
    const operation = activationQueue.then(async () => {
      if (shuttingDown) throw new Error("Compose Workbench is shutting down.");
      if (active?.definition.id === definition.id) {
        result = {
          activeDashboardId: definition.id,
          dashboardUrl: active.handle.url,
        };
        return;
      }

      const frameAncestors = [
        workbenchOrigin,
        ...reviewedLoopbackOrigins(requestedAncestors).filter((origin) =>
          origin !== workbenchOrigin
        ),
      ];
      const nextHandle = await options.startDashboard(definition, frameAncestors);
      const previous = active;
      active = { definition, handle: nextHandle };
      result = {
        activeDashboardId: definition.id,
        dashboardUrl: nextHandle.url,
      };

      if (previous) await previous.handle.shutdown();
    });
    activationQueue = operation.then(() => undefined, () => undefined);
    await operation;
    if (!result) throw new Error("Dashboard activation did not complete.");
    return result;
  }

  const server = Deno.serve(
    {
      hostname: HOSTNAME,
      port: listenPort,
      onListen(address) {
        listenPort = address.port;
        workbenchOrigin = `http://${HOSTNAME}:${listenPort}`;
      },
    },
    async (request) => {
      const url = new URL(request.url);
      if (
        request.method === "GET" &&
        (url.pathname === "/" || url.pathname === "/index.html")
      ) {
        return pageResponse();
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          activeDashboardId: active?.definition.id ?? null,
        });
      }
      if (request.method === "GET" && url.pathname === "/api/dashboards") {
        return jsonResponse({
          dashboards,
          activeDashboardId: active?.definition.id ?? null,
          dashboardUrl: active?.handle.url ?? null,
        });
      }

      const activationMatch = url.pathname.match(
        /^\/api\/dashboards\/([a-z0-9-]+)\/activate$/,
      );
      if (request.method === "POST" && activationMatch) {
        if (request.headers.get("Origin") !== workbenchOrigin) {
          return jsonResponse({ error: "Forbidden origin." }, 403);
        }
        const definition = dashboardsById.get(activationMatch[1]);
        if (!definition) {
          return jsonResponse({ error: "Unknown dashboard." }, 404);
        }
        try {
          let requestedAncestors: unknown = [];
          if (request.headers.get("Content-Type")?.includes("application/json")) {
            const body = await request.json() as { frameAncestors?: unknown };
            requestedAncestors = body.frameAncestors;
          }
          return jsonResponse(await activate(definition, requestedAncestors));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return jsonResponse({ error: message }, 500);
        }
      }

      return jsonResponse({ error: "Not found." }, 404);
    },
  );

  const url = workbenchOrigin;
  if (options.open) await openWorkbench(url);

  return {
    url,
    async shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      const serverShutdown = server.shutdown();
      await activationQueue;
      const current = active;
      active = null;
      if (current) await current.handle.shutdown();
      await serverShutdown;
    },
  };
}

const WORKBENCH_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compose Workbench</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0d0e;
      --surface: #111516;
      --surface-raised: #171c1d;
      --line: #293031;
      --line-hot: #6a7b73;
      --text: #f1f3ee;
      --muted: #8f9b96;
      --accent: #b9f54d;
      --danger: #ff806e;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font: 13px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    button { font: inherit; }
    .shell { display: grid; grid-template-columns: 272px minmax(0, 1fr); height: 100%; }
    .rail {
      display: flex;
      min-height: 0;
      flex-direction: column;
      border-right: 1px solid var(--line);
      background: var(--surface);
    }
    .brand { padding: 20px 18px 17px; border-bottom: 1px solid var(--line); }
    .eyebrow {
      color: var(--accent);
      font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1 { margin: 7px 0 3px; font-size: 18px; letter-spacing: -.02em; }
    .brand p { margin: 0; color: var(--muted); font-size: 11px; }
    .catalogue { overflow: auto; padding: 10px; }
    .dashboard {
      width: 100%;
      margin: 0 0 7px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease;
    }
    .dashboard:hover { border-color: var(--line-hot); background: var(--surface-raised); }
    .dashboard[aria-current="true"] {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 7%, var(--surface));
    }
    .dashboard:disabled { cursor: wait; opacity: .65; }
    .dashboard strong { display: block; margin-bottom: 4px; font-size: 12px; }
    .dashboard span { display: block; color: var(--muted); font-size: 10px; line-height: 1.4; }
    .stage { position: relative; min-width: 0; background: #080a0b; }
    .stage-head {
      position: absolute;
      z-index: 2;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 43px;
      padding: 0 14px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--surface) 94%, transparent);
      backdrop-filter: blur(10px);
    }
    .stage-title { min-width: 0; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
    .status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #69716d; }
    .status.live::before { background: var(--accent); box-shadow: 0 0 0 3px rgb(185 245 77 / 10%); }
    .status.error { color: var(--danger); }
    .status.error::before { background: var(--danger); }
    .dashboard-frame { width: 100%; height: 100%; padding-top: 43px; border: 0; background: var(--bg); }
    .empty {
      position: absolute;
      inset: 43px 0 0;
      display: grid;
      place-items: center;
      padding: 28px;
      text-align: center;
    }
    .empty-card { max-width: 430px; }
    .empty-mark {
      display: grid;
      width: 52px;
      height: 52px;
      margin: 0 auto 16px;
      place-items: center;
      border: 1px solid var(--line-hot);
      border-radius: 50%;
      color: var(--accent);
      font: 700 19px ui-monospace, monospace;
    }
    .empty h2 { margin: 0 0 8px; font-size: 17px; }
    .empty p { margin: 0; color: var(--muted); }
    .hidden { display: none; }
    @media (max-width: 720px) {
      .shell { grid-template-columns: 210px minmax(0, 1fr); }
      .brand { padding: 14px 12px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <aside class="rail">
      <header class="brand">
        <div class="eyebrow">Saved compositions</div>
        <h1>Compose Workbench</h1>
        <p>Select one live engineering surface.</p>
      </header>
      <nav class="catalogue" id="catalogue" aria-label="Compose dashboards"></nav>
    </aside>
    <section class="stage">
      <header class="stage-head">
        <div class="stage-title" id="stage-title">No dashboard selected</div>
        <div class="status" id="status">ready</div>
      </header>
      <div class="empty" id="empty">
        <div class="empty-card">
          <div class="empty-mark">C</div>
          <h2>Choose a composition</h2>
          <p>The selected MCP Compose dashboard starts here with its real, capability-scoped viewers.</p>
        </div>
      </div>
      <iframe class="dashboard-frame hidden" id="dashboard-frame" title="Active MCP Compose dashboard"></iframe>
    </section>
  </main>
  <script>
    const catalogue = document.getElementById("catalogue");
    const frame = document.getElementById("dashboard-frame");
    const empty = document.getElementById("empty");
    const status = document.getElementById("status");
    const stageTitle = document.getElementById("stage-title");
    let dashboards = [];
    let activeId = null;
    let busy = false;

    function setStatus(label, state = "") {
      status.textContent = label;
      status.className = "status " + state;
    }

    function renderCatalogue() {
      catalogue.replaceChildren(...dashboards.map((dashboard) => {
        const button = document.createElement("button");
        button.className = "dashboard";
        button.type = "button";
        button.disabled = busy;
        button.setAttribute("aria-current", String(dashboard.id === activeId));
        const title = document.createElement("strong");
        title.textContent = dashboard.title;
        const description = document.createElement("span");
        description.textContent = dashboard.description;
        button.append(title, description);
        button.addEventListener("click", () => activate(dashboard));
        return button;
      }));
    }

    function showDashboard(dashboard, url) {
      activeId = dashboard.id;
      stageTitle.textContent = dashboard.title;
      frame.src = url;
      frame.classList.remove("hidden");
      empty.classList.add("hidden");
      setStatus("live composition", "live");
      renderCatalogue();
    }

    async function activate(dashboard) {
      if (busy || dashboard.id === activeId) return;
      busy = true;
      stageTitle.textContent = "Starting " + dashboard.title + "…";
      setStatus("composing…");
      renderCatalogue();
      try {
        const response = await fetch("/api/dashboards/" + encodeURIComponent(dashboard.id) + "/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frameAncestors: Array.from(location.ancestorOrigins || []),
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Dashboard activation failed.");
        showDashboard(dashboard, result.dashboardUrl);
      } catch (error) {
        stageTitle.textContent = dashboard.title;
        setStatus(error instanceof Error ? error.message : String(error), "error");
      } finally {
        busy = false;
        renderCatalogue();
      }
    }

    async function initialize() {
      try {
        const response = await fetch("/api/dashboards");
        if (!response.ok) throw new Error("Dashboard catalogue is unavailable.");
        const state = await response.json();
        dashboards = state.dashboards;
        renderCatalogue();
        if (state.activeDashboardId && state.dashboardUrl) {
          const dashboard = dashboards.find((item) => item.id === state.activeDashboardId);
          if (dashboard) showDashboard(dashboard, state.dashboardUrl);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), "error");
      }
    }

    initialize();
  </script>
</body>
</html>`;
