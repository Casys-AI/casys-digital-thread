import type { DesktopShellViewModel } from "../contracts/diagnostics.ts";
import { desktopShellResponseHeaders, renderDesktopShell } from "../renderer/mod.ts";
import type { WorkbenchSession } from "../workbench/contracts.ts";
import {
  isAllowedWorkbenchPath,
  proxyDesktopWorkbenchRequest,
} from "../workbench/proxy.ts";

const DOCUMENT_PATHS = new Set(["/", "/index.html"]);

function textResponse(
  body: string | null,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      ...desktopShellResponseHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders,
    },
  });
}

/**
 * Closed Desktop HTTP surface. The renderer can load one static document; no
 * command, filesystem, process, provider, MCP, or project-state route exists.
 */
export function createDesktopShellHandler(
  model: DesktopShellViewModel,
  workbenchSession?: WorkbenchSession,
  fetchImpl?: typeof fetch,
): (request: Request) => Promise<Response> {
  const document = renderDesktopShell(model);
  const headers = desktopShellResponseHeaders();

  return async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase();
    const path = new URL(request.url).pathname;
    const workbenchPath = isAllowedWorkbenchPath(path);
    const events = path === "/api/thread/workbench/events";
    if (
      workbenchPath &&
      (method !== "GET" && (method !== "HEAD" || events))
    ) {
      return textResponse("Method not allowed.\n", 405, {
        Allow: events ? "GET" : "GET, HEAD",
      });
    }
    if (workbenchSession && workbenchPath) {
      try {
        const proxied = await proxyDesktopWorkbenchRequest(request, {
          session: workbenchSession,
          fetchImpl,
        });
        if (proxied) return proxied;
      } catch {
        if (path.startsWith("/api/")) return workbenchUnavailable(method);
        if (!DOCUMENT_PATHS.has(path)) {
          return textResponse(method === "HEAD" ? null : "Not found.\n", 404);
        }
      }
    } else if (path.startsWith("/api/") && workbenchPath) {
      return workbenchUnavailable(method);
    }
    if (!DOCUMENT_PATHS.has(path)) {
      return textResponse(method === "HEAD" ? null : "Not found.\n", 404);
    }

    if (method !== "GET" && method !== "HEAD") {
      return textResponse("Method not allowed.\n", 405, {
        Allow: "GET, HEAD",
      });
    }

    return new Response(method === "HEAD" ? null : document, {
      status: 200,
      headers,
    });
  };
}

function workbenchUnavailable(method: string): Response {
  const body = JSON.stringify({
    schemaVersion: "desktop-workbench-unavailable/1.0",
    state: "unavailable",
  });
  return new Response(method === "HEAD" ? null : body, {
    status: 503,
    headers: {
      ...desktopShellResponseHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
