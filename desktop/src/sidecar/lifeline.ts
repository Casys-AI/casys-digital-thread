export type LifelineSignal = "SIGINT" | "SIGTERM" | "stdin-eof";

export interface LifelineRuntime {
  readonly stdin: ReadableStream<Uint8Array>;
  listenSignals(
    onSignal: (signal: Exclude<LifelineSignal, "stdin-eof">) => void,
  ): () => void;
}

export const denoLifelineRuntime: LifelineRuntime = {
  stdin: Deno.stdin.readable,
  listenSignals(onSignal) {
    const removers: Array<() => void> = [];
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const listener = () => onSignal(signal);
      try {
        Deno.addSignalListener(signal, listener);
        removers.push(() => {
          try {
            Deno.removeSignalListener(signal, listener);
          } catch {
            // Listener may already have been removed during shutdown.
          }
        });
      } catch {
        // The platform may not expose this signal.
      }
    }
    return () => {
      for (const remove of removers) remove();
    };
  },
};

/** Owning-host crash closes stdin; the helper then exits instead of orphaning. */
export function waitForLifeline(
  runtime: LifelineRuntime,
): Promise<LifelineSignal> {
  const reader = runtime.stdin.getReader();
  return new Promise((resolve) => {
    let settled = false;
    let removeSignals = () => {};
    const finish = (signal: LifelineSignal) => {
      if (settled) return;
      settled = true;
      removeSignals();
      if (signal === "stdin-eof") {
        resolve(signal);
        return;
      }
      void reader.cancel().catch(() => {
        // A concurrent EOF may already have closed the reader.
      }).finally(() => resolve(signal));
    };

    const installedRemover = runtime.listenSignals((signal) => finish(signal));
    removeSignals = installedRemover;
    if (settled) installedRemover();
    void drainStdin(reader).then(() => finish("stdin-eof"));
  });
}

async function drainStdin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // A closed or cancelled stdin is the same owning-host death as EOF.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released.
    }
  }
}
