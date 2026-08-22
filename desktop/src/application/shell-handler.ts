import type { DesktopShellViewModel } from "../contracts/diagnostics.ts";
import { desktopShellResponseHeaders, renderDesktopShell } from "../renderer/mod.ts";

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
 * Closed Lot 1 HTTP surface. The renderer can load one static document; no
 * command, filesystem, process, provider, MCP, or project-state route exists.
 */
export function createDesktopShellHandler(
  model: DesktopShellViewModel,
): (request: Request) => Response {
  const document = renderDesktopShell(model);
  const headers = desktopShellResponseHeaders();

  return (request: Request): Response => {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return textResponse("Method not allowed.\n", 405, {
        Allow: "GET, HEAD",
      });
    }

    const path = new URL(request.url).pathname;
    if (!DOCUMENT_PATHS.has(path)) {
      return textResponse(method === "HEAD" ? null : "Not found.\n", 404);
    }

    return new Response(method === "HEAD" ? null : document, {
      status: 200,
      headers,
    });
  };
}
