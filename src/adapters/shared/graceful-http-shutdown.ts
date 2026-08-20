export const GRACEFUL_HTTP_SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type GracefulHttpShutdownSignal =
  (typeof GRACEFUL_HTTP_SHUTDOWN_SIGNALS)[number];

export type GracefulHttpShutdownListener = () => void | Promise<void>;

export interface GracefulHttpShutdownSignalRuntime {
  listen(
    signal: GracefulHttpShutdownSignal,
    listener: GracefulHttpShutdownListener,
  ): () => void;
}

export interface GracefulHttpShutdownTarget {
  shutdown(): Promise<void>;
}

export interface GracefulHttpShutdownErrorContext {
  phase: "listener-removal" | "shutdown";
  signal?: GracefulHttpShutdownSignal;
}

export type GracefulHttpShutdownOutcome =
  | {
    status: "stopped";
    signal: GracefulHttpShutdownSignal;
  }
  | {
    status: "error";
    signal: GracefulHttpShutdownSignal;
    error: unknown;
  };

export interface GracefulHttpShutdownRegistration {
  readonly completion: Promise<GracefulHttpShutdownOutcome>;
  dispose(): void;
}

export const denoGracefulHttpShutdownSignalRuntime: GracefulHttpShutdownSignalRuntime =
  {
    listen(signal, listener) {
      const denoListener = () => {
        void listener();
      };
      Deno.addSignalListener(signal, denoListener);
      return () => Deno.removeSignalListener(signal, denoListener);
    },
  };

export function installGracefulHttpShutdown(
  target: GracefulHttpShutdownTarget,
  options: {
    runtime?: GracefulHttpShutdownSignalRuntime;
    onError?: (
      error: unknown,
      context: GracefulHttpShutdownErrorContext,
    ) => void;
  } = {},
): GracefulHttpShutdownRegistration {
  const runtime = options.runtime ?? denoGracefulHttpShutdownSignalRuntime;
  const removers: Array<() => void> = [];
  let disposed = false;
  let stopping = false;
  let resolveCompletion!: (outcome: GracefulHttpShutdownOutcome) => void;
  const completion = new Promise<GracefulHttpShutdownOutcome>((resolve) => {
    resolveCompletion = resolve;
  });

  const reportError = (
    error: unknown,
    context: GracefulHttpShutdownErrorContext,
  ): void => {
    try {
      options.onError?.(error, context);
    } catch {
      // Error reporting must not prevent listener cleanup or server shutdown.
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch (error) {
        reportError(error, { phase: "listener-removal" });
      }
    }
  };

  const stop = async (signal: GracefulHttpShutdownSignal): Promise<void> => {
    if (stopping) return;
    stopping = true;
    dispose();
    try {
      await target.shutdown();
      resolveCompletion({ status: "stopped", signal });
    } catch (error) {
      reportError(error, { phase: "shutdown", signal });
      resolveCompletion({ status: "error", signal, error });
    }
  };

  try {
    for (const signal of GRACEFUL_HTTP_SHUTDOWN_SIGNALS) {
      removers.push(runtime.listen(signal, () => stop(signal)));
    }
  } catch (error) {
    dispose();
    throw error;
  }

  return { completion, dispose };
}
