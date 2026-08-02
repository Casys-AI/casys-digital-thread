import {
  executeProjectDiscoveryOperatorCommand,
  ProjectDiscoveryCommandHttpError,
  type ProjectDiscoveryOperatorCommandRequest,
  readProjectDiscoveryOperatorCommand,
} from "../src/adapters/project-discovery-command-http.ts";
import {
  executeProjectDiscoveryHandoffOperatorCommand,
  ProjectDiscoveryHandoffCommandHttpError,
  type ProjectDiscoveryHandoffOperatorCommandRequest,
  readProjectDiscoveryHandoffOperatorCommand,
} from "../src/adapters/project-discovery-handoff-command-http.ts";
import { FileEngineeringProjectRevisionStore } from "../src/adapters/engineering-project-store.ts";
import { FileProjectDiscoveryRevisionStore } from "../src/adapters/project-discovery-store.ts";
import { isExplicitLoopbackHostname } from "../src/adapters/loopback-host.ts";
import { EngineeringProjectStoreConflictError } from "../src/domain/engineering-project-command-service.ts";
import {
  ProjectDiscoveryCommandError,
  ProjectDiscoveryCommandService,
  type ProjectDiscoveryRevisionStore,
  ProjectDiscoveryStoreConflictError,
} from "../src/domain/project-discovery-command-service.ts";
import {
  ProjectDiscoveryHandoffError,
  ProjectDiscoveryHandoffService,
} from "../src/domain/project-discovery-handoff-service.ts";

export interface DiscoveryWorkbenchHandlerOptions {
  readonly discoveries: ProjectDiscoveryRevisionStore;
  readonly commands?: ProjectDiscoveryCommandService;
  /** Explicit human-only transition from an approved brief to a project shell. */
  readonly handoff?: ProjectDiscoveryHandoffService;
  readonly html: string;
  /** Polling observes immutable discovery revisions; it never invokes an agent. */
  readonly pollIntervalMs?: number;
}

type DiscoveryRoute = {
  readonly discoveryId: string;
  readonly action: "snapshot" | "events" | "commands" | "handoff";
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
    if (route.action === "handoff") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      if (!options.handoff) return projectHandoffDisabled();
      return await handleProjectHandoff(request, route.discoveryId, options);
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

/**
 * Creates only the durable engineering-project shell for an already approved
 * brief. It must not make a technical model, a ThreadSnapshot, or a cockpit
 * projection look as if it exists.
 */
async function handleProjectHandoff(
  request: Request,
  discoveryId: string,
  options: DiscoveryWorkbenchHandlerOptions,
): Promise<Response> {
  let command: ProjectDiscoveryHandoffOperatorCommandRequest | undefined;
  try {
    command = await readProjectDiscoveryHandoffOperatorCommand(request);
    if (command.discoveryId !== discoveryId) {
      return json({
        error: "invalid_discovery_handoff",
        message:
          `Command discovery ${command.discoveryId} does not match request path ${discoveryId}.`,
      }, 422);
    }
    if (command.command.projectId !== discoveryId) {
      return json({
        error: "invalid_discovery_handoff",
        message: "The engineering project id must match the approved discovery id.",
      }, 422);
    }
    const discovery = await readStableSnapshot(options.discoveries, discoveryId);
    if (!discovery) return discoveryNotFound(discoveryId);
    if (
      discovery.brief &&
      command.command.projectName !== discovery.brief.objective.trim()
    ) {
      return json({
        error: "invalid_discovery_handoff",
        message:
          "The engineering project name must match the approved brief objective.",
      }, 422);
    }
    const project = await executeProjectDiscoveryHandoffOperatorCommand(
      options.handoff!,
      command,
    );
    return json(
      {
        schemaVersion: "project-discovery-handoff-result/1.0",
        scope: "initial-project-shell",
        project: {
          id: project.project.id,
          name: project.project.name,
          revision: project.revision,
        },
        message:
          "The initial project shell preserved the approved brief and added no technical state.",
      },
      200,
      {
        "X-Casys-Data-Source": "immutable-engineering-project-handoff",
      },
    );
  } catch (error) {
    if (error instanceof ProjectDiscoveryHandoffCommandHttpError) {
      return json({ error: error.code, message: error.message }, error.status);
    }
    if (error instanceof ProjectDiscoveryHandoffError) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.code === "stale_discovery_revision" && command) {
        body.expectedRevision = command.expectedDiscoveryRevision;
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
    if (error instanceof EngineeringProjectStoreConflictError) {
      return json({
        error: "engineering_project_revision_unavailable",
        discoveryId,
        message:
          "The engineering project handoff is being finalized. Retry without changing the approved brief.",
      }, 409);
    }
    console.error(
      `Discovery project handoff failed unexpectedly: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return json({
      error: "project_discovery_handoff_failed",
      message: "The engineering project could not be created from this brief.",
    }, 500);
  }
}

function parseDiscoveryRoute(pathname: string): DiscoveryRoute | undefined {
  const match = pathname.match(
    /^\/api\/project-discoveries\/([^/]+)(?:\/(events|commands|handoff))?$/,
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
      : match[2] === "handoff"
      ? "handoff"
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

function projectHandoffDisabled(): Response {
  return json({
    error: "project_handoff_disabled",
    message:
      "Creating an engineering project is available only from the local Discovery Workbench.",
  }, 404);
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
  const projectDirectory = argument("project-dir") ??
    "state/local/engineering-projects";
  const htmlPath = argument("html") ??
    "src/ui/dist/discovery/discovery-workbench.html";
  const document = await Deno.readTextFile(htmlPath);
  const discoveries = new FileProjectDiscoveryRevisionStore(discoveryDirectory);
  const projects = new FileEngineeringProjectRevisionStore(projectDirectory);
  const operatorCommandsEnabled = isExplicitLoopbackHostname(hostname);
  const handler = createDiscoveryWorkbenchHandler({
    discoveries,
    commands: operatorCommandsEnabled
      ? new ProjectDiscoveryCommandService(discoveries)
      : undefined,
    handoff: operatorCommandsEnabled
      ? new ProjectDiscoveryHandoffService(discoveries, projects)
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
      console.log(`Engineering project shells: ${projectDirectory}`);
      console.log(
        operatorCommandsEnabled
          ? "Page loads are read-only; explicit same-origin human review commands append discovery revisions or create an empty engineering project shell."
          : "Read-only Discovery Workbench: human commands are disabled on a non-loopback binding.",
      );
    },
  }, handler);
}
