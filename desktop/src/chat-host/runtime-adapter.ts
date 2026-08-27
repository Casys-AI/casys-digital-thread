import { join } from "node:path";
import type {
  ChatRuntimeAdapter,
  ChatRuntimePort,
  RuntimeInteractionSink,
} from "../chat/runtime-port.ts";

interface AcpxRuntimeModule {
  createAcpRuntime(options: Record<string, unknown>): ChatRuntimePort;
  createFileSessionStore(options: { readonly stateDir: string }): unknown;
  createAgentRegistry(options: {
    readonly overrides: Readonly<Record<string, readonly string[]>>;
  }): unknown;
}

export interface PinnedRuntimeOptions {
  readonly dataRoot: string;
  readonly workspaceRoot: string;
  readonly acpxRuntimeUrl: string;
  readonly adapterEntry: string;
  readonly nodeExecutable: string;
}

/** Loads only the packaged acpx/runtime export. The module is externalized by the Node bundle. */
export async function createPinnedRuntimeAdapter(
  options: PinnedRuntimeOptions,
): Promise<ChatRuntimeAdapter> {
  const acpx = await import(options.acpxRuntimeUrl) as AcpxRuntimeModule;
  let sink: RuntimeInteractionSink | undefined;
  const runtime = acpx.createAcpRuntime({
    cwd: options.workspaceRoot,
    sessionStore: acpx.createFileSessionStore({
      stateDir: join(options.dataRoot, "acpx-sessions"),
    }),
    agentRegistry: acpx.createAgentRegistry({
      overrides: {
        "casys-codex": [options.nodeExecutable, options.adapterEntry],
      },
    }),
    mcpServers: [{
      type: "http",
      name: "casys-digital-thread",
      url: "http://127.0.0.1:3020/mcp",
      headers: [],
    }],
    permissionMode: "deny-all",
    nonInteractivePermissions: "deny",
    elicitationModes: ["form", "url"],
    onPermissionRequest: (request: unknown, context: { signal: AbortSignal }) => {
      if (sink === undefined) return Promise.resolve(undefined);
      return sink.requestPermission(
        request as Parameters<RuntimeInteractionSink["requestPermission"]>[0],
        context.signal,
      );
    },
  });
  return Object.freeze({
    runtime,
    setInteractionSink(next: RuntimeInteractionSink): void {
      sink = next;
    },
    close(): Promise<void> {
      sink = undefined;
      return Promise.resolve();
    },
  });
}
