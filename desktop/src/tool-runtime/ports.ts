/**
 * Host-owned loopback port allocation for app-managed providers (#57).
 *
 * The fleet manifest names provider identity, never a usable address: the
 * historical port (3014 for Build123d) may be occupied by an unrelated
 * process. Allocation probes the preferred port on 127.0.0.1 first (stable
 * diagnostics across restarts) and falls back to an ephemeral port on
 * conflict. Probing closes its listener immediately; the caller must start
 * the provider under its exclusive gate and retry once on a Docker bind
 * conflict, which closes the probe/use race.
 */
export interface LoopbackListenHandle {
  readonly port: number;
  close(): void;
}

export interface AllocateLoopbackPortOptions {
  readonly preferred: number;
  readonly listen?: (port: number) => LoopbackListenHandle;
}

export function allocateLoopbackPort(options: AllocateLoopbackPortOptions): number {
  const { preferred } = options;
  if (!Number.isSafeInteger(preferred) || preferred < 1 || preferred > 65535) {
    throw new TypeError("Preferred port must be a valid port.");
  }
  const listen = options.listen ?? defaultListen;
  try {
    return probe(listen, preferred);
  } catch (error) {
    if (!(error instanceof Deno.errors.AddrInUse)) throw error;
  }
  try {
    return probe(listen, 0);
  } catch (error) {
    throw new Error(
      `Could not allocate a loopback port: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

function probe(
  listen: (port: number) => LoopbackListenHandle,
  port: number,
): number {
  const handle = listen(port);
  try {
    if (
      !Number.isSafeInteger(handle.port) || handle.port < 1 || handle.port > 65535
    ) {
      throw new Error("Listener reported an invalid port.");
    }
    return handle.port;
  } finally {
    handle.close();
  }
}

function defaultListen(port: number): LoopbackListenHandle {
  const listener = Deno.listen({
    transport: "tcp",
    hostname: "127.0.0.1",
    port,
  });
  const addr = listener.addr as Deno.NetAddr;
  return { port: addr.port, close: () => listener.close() };
}
