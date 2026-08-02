import {
  executeProjectDiscoveryOperatorCommand,
  ProjectDiscoveryCommandHttpError,
  type ProjectDiscoveryOperatorCommandRequest,
  readProjectDiscoveryOperatorCommand,
} from "../src/adapters/project-discovery-command-http.ts";
import { FileProjectDiscoveryRevisionStore } from "../src/adapters/project-discovery-store.ts";
import { isExplicitLoopbackHostname } from "../src/adapters/loopback-host.ts";
import {
  ProjectDiscoveryCommandError,
  ProjectDiscoveryCommandService,
  type ProjectDiscoveryRevisionStore,
  ProjectDiscoveryStoreConflictError,
} from "../src/domain/project-discovery-command-service.ts";

export interface DiscoveryWorkbenchHandlerOptions {
  readonly discoveries: ProjectDiscoveryRevisionStore;
  readonly commands?: ProjectDiscoveryCommandService;
  readonly html: string;
  /** Polling observes immutable discovery revisions; it never invokes an agent. */
  readonly pollIntervalMs?: number;
}

type DiscoveryRoute = {
  readonly discoveryId: string;
  readonly action: "snapshot" | "events" | "commands";
};

/** Serve one local, live view over immutable ProjectDiscovery revisions. */
export function createDiscoveryWorkbenchHandler(
  options: DiscoveryWorkbenchHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/discovery-workbench.html") {
      if (request.method !== "GET") return methodNotAllowed();
      return html(options.html);
    }

    const route = parseDiscoveryRoute(url.pathname);
    if (!route) return new Response("Not found", { status: 404 });
    if (!validDiscoveryId(route.discoveryId)) {
      return json({
        error: "invalid_discovery_id",
        message: "The discovery id in the request path is invalid.",
      }, 400);
    }

    if (route.action === "snapshot") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveSnapshot(route.discoveryId, options.discoveries);
    }
    if (route.action === "events") {
      if (request.method !== "GET") return methodNotAllowed();
      return await snapshotEventStream(request, route.discoveryId, options);
    }
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!options.commands) {
      return json({
        error: "operator_commands_disabled",
        message: "Human discovery commands are disabled for this Workbench.",
      }, 404);
    }
    return await handleOperatorCommand(request, route.discoveryId, options);
  };
}

async function serveSnapshot(
  discoveryId: string,
  discoveries: ProjectDiscoveryRevisionStore,
): Promise<Response> {
  let snapshot;
  try {
    snapshot = await readStableSnapshot(discoveries, discoveryId);
  } catch (error) {
    if (error instanceof ProjectDiscoveryStoreConflictError) {
      return revisionUnavailable(discoveryId);
    }
    throw error;
  }
  if (!snapshot) return discoveryNotFound(discoveryId);
  return json(snapshot, 200, snapshotHeaders());
}

async function snapshotEventStream(
  request: Request,
  discoveryId: string,
  options: DiscoveryWorkbenchHandlerOptions,
): Promise<Response> {
  let initial;
  try {
    initial = await readStableSnapshot(options.discoveries, discoveryId);
  } catch (error) {
    if (error instanceof ProjectDiscoveryStoreConflictError) {
      return revisionUnavailable(discoveryId);
    }
    throw error;
  }
  if (!initial) return discoveryNotFound(discoveryId);

  const encoder = new TextEncoder();
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  let lastEventId = request.headers.get("Last-Event-ID") ?? "";
  let cancelled = false;
  let lastWrite = Date.now();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const run = async () => {
        while (!cancelled) {
          const snapshot = await readStableSnapshot(
            options.discoveries,
            discoveryId,
          );
          // A discovery removed during an established stream cannot revoke the
          // last valid event. A reconnect receives an explicit 404 instead.
          if (snapshot) {
            const eventId = String(snapshot.revision);
            if (eventId !== lastEventId) {
              controller.enqueue(encoder.encode(
                `id: ${eventId}\nevent: project-discovery-snapshot\ndata: ${
                  JSON.stringify(snapshot)
                }\n\n`,
              ));
              lastEventId = eventId;
              lastWrite = Date.now();
            }
          }
          if (Date.now() - lastWrite >= 15_000) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastWrite = Date.now();
          }
          await waitForPoll(pollIntervalMs);
        }
      };
      void run().then(() => {
        try {
          controller.close();
        } catch {
          // The browser may have cancelled the stream first.
        }
      }).catch((error) => {
        try {
          controller.error(error);
        } catch {
          // The browser may have cancelled the stream first.
        }
      });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      ...snapshotHeaders(),
    },
  });
}

async function handleOperatorCommand(
  request: Request,
  discoveryId: string,
  options: DiscoveryWorkbenchHandlerOptions,
): Promise<Response> {
  let command: ProjectDiscoveryOperatorCommandRequest | undefined;
  try {
    command = await readProjectDiscoveryOperatorCommand(request);
    if (command.discoveryId !== discoveryId) {
      return json({
        error: "invalid_discovery_command",
        message:
          `Command discovery ${command.discoveryId} does not match request path ${discoveryId}.`,
      }, 422);
    }
    const snapshot = await executeProjectDiscoveryOperatorCommand(
      options.commands!,
      options.discoveries,
      command,
    );
    return json(snapshot, 200, snapshotHeaders());
  } catch (error) {
    if (error instanceof ProjectDiscoveryCommandHttpError) {
      return json({ error: error.code, message: error.message }, error.status);
    }
    if (error instanceof ProjectDiscoveryCommandError) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.code === "stale_revision" && command) {
        body.expectedRevision = command.expectedRevision;
        try {
          body.actualRevision = (await readStableSnapshot(
            options.discoveries,
            discoveryId,
          ))?.revision;
        } catch (readError) {
          if (!(readError instanceof ProjectDiscoveryStoreConflictError)) {
            throw readError;
          }
        }
      }
      return json(body, error.httpStatus);
    }
    if (error instanceof ProjectDiscoveryStoreConflictError) {
      return revisionUnavailable(discoveryId);
    }
    console.error(
      `Discovery operator command failed unexpectedly: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return json({
      error: "discovery_operator_command_failed",
      message: "The discovery command could not be applied.",
    }, 500);
  }
}

function parseDiscoveryRoute(pathname: string): DiscoveryRoute | undefined {
  const match = pathname.match(
    /^\/api\/project-discoveries\/([^/]+)(?:\/(events|commands))?$/,
  );
  if (!match) return undefined;
  let discoveryId: string;
  try {
    discoveryId = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  return {
    discoveryId,
    action: match[2] === "events"
      ? "events"
      : match[2] === "commands"
      ? "commands"
      : "snapshot",
  };
}

function validDiscoveryId(value: string): boolean {
  return value.length <= 160 && value.toLowerCase() !== "latest" &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value);
}

function html(value: string): Response {
  return new Response(value, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function json(
  value: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function snapshotHeaders(): Record<string, string> {
  return { "X-Casys-Data-Source": "immutable-project-discovery-snapshot" };
}

function discoveryNotFound(discoveryId: string): Response {
  return json({ error: "project_discovery_not_found", discoveryId }, 404);
}

function revisionUnavailable(discoveryId: string): Response {
  return json({
    error: "project_discovery_revision_unavailable",
    discoveryId,
    message:
      "A discovery revision is claimed but not yet durably available. Retry without guessing its contents.",
  }, 409);
}

function methodNotAllowed(allow = "GET"): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: allow },
  });
}

function waitForPoll(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * A normal immutable commit claims its revision just before the atomic rename.
 * Readers retry that tiny publication window, while a stranded claim still
 * fails closed after a bounded wait.
 */
async function readStableSnapshot(
  discoveries: ProjectDiscoveryRevisionStore,
  discoveryId: string,
) {
  let conflict: ProjectDiscoveryStoreConflictError | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await discoveries.get(discoveryId);
    } catch (error) {
      if (!(error instanceof ProjectDiscoveryStoreConflictError)) throw error;
      conflict = error;
      if (attempt < 49) await waitForPoll(2);
    }
  }
  throw conflict!;
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((value) => value.startsWith(prefix))?.slice(
    prefix.length,
  );
}

function integerArgument(name: string): number | undefined {
  const value = argument(name);
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0 || result > 65535) {
    throw new Error(`--${name} must be an integer between 1 and 65535.`);
  }
  return result;
}

if (import.meta.main) {
  const hostname = argument("host") ?? "127.0.0.1";
  const port = integerArgument("port") ?? 5174;
  const discoveryId = argument("discovery-id") ?? "drone-concept";
  const discoveryDirectory = argument("discovery-dir") ??
    "state/local/project-discoveries";
  const htmlPath = argument("html") ??
    "src/ui/dist/discovery/discovery-workbench.html";
  const document = await Deno.readTextFile(htmlPath);
  const discoveries = new FileProjectDiscoveryRevisionStore(discoveryDirectory);
  const operatorCommandsEnabled = isExplicitLoopbackHostname(hostname);
  const handler = createDiscoveryWorkbenchHandler({
    discoveries,
    commands: operatorCommandsEnabled
      ? new ProjectDiscoveryCommandService(discoveries)
      : undefined,
    html: document,
  });

  Deno.serve({
    hostname,
    port,
    onListen: ({ hostname, port }) => {
      const query = new URLSearchParams({ discovery: discoveryId });
      console.log(
        `Discovery Workbench: http://${hostname}:${port}/?${query.toString()}`,
      );
      console.log(`Project discovery id: ${discoveryId}`);
      console.log(`Immutable discovery revisions: ${discoveryDirectory}`);
      console.log(
        operatorCommandsEnabled
          ? "Page loads are read-only; explicit same-origin human commands append ProjectDiscovery revisions."
          : "Read-only Discovery Workbench: human commands are disabled on a non-loopback binding.",
      );
    },
  }, handler);
}
