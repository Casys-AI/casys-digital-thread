export type DesktopShutdownSignal = "SIGINT" | "SIGTERM";

export interface DesktopSignalPorts {
  readonly add: (
    signal: DesktopShutdownSignal,
    listener: () => void,
  ) => void;
  readonly remove: (
    signal: DesktopShutdownSignal,
    listener: () => void,
  ) => void;
}

export interface DesktopDrainPorts {
  /** Resolves only after the owned in-memory child, if any, has exited. */
  readonly stopApplication: () => Promise<void>;
  /** Resolves only after the renderer HTTP listener has drained. */
  readonly shutdownServer: () => Promise<void>;
  /** Terminates the Deno Desktop process after both owned drains settle. */
  readonly exitProcess: (code: number) => void;
}

/**
 * Drains every process-owned resource before terminating the Desktop process.
 * Both drains are attempted, but explicit process exit is forbidden until each
 * drain has resolved successfully.
 */
export async function drainAndExitDesktop(
  ports: DesktopDrainPorts,
): Promise<void> {
  const results = await Promise.allSettled([
    ports.stopApplication(),
    ports.shutdownServer(),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Desktop shutdown remains unresolved; process exit is withheld.",
    );
  }
  ports.exitProcess(0);
}

/** Installs one idempotent shutdown edge and returns an idempotent cleanup. */
export function installDesktopShutdownSignals(
  onShutdown: () => void,
  ports: DesktopSignalPorts,
): () => void {
  const removers: Array<() => void> = [];
  let requested = false;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const remove of removers) remove();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const listener = () => {
      if (requested) return;
      requested = true;
      onShutdown();
    };
    try {
      ports.add(signal, listener);
      removers.push(() => {
        try {
          ports.remove(signal, listener);
        } catch {
          // Already removed or unsupported by this platform.
        }
      });
    } catch {
      // The current platform does not expose this signal.
    }
  }

  return cleanup;
}
