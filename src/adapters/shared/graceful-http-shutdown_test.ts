import {
  assertEquals,
  assertFalse,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  type GracefulHttpShutdownListener,
  type GracefulHttpShutdownSignal,
  type GracefulHttpShutdownSignalRuntime,
  installGracefulHttpShutdown,
} from "./graceful-http-shutdown.ts";

class FakeSignalRuntime implements GracefulHttpShutdownSignalRuntime {
  readonly listeners = new Map<
    GracefulHttpShutdownSignal,
    GracefulHttpShutdownListener
  >();
  readonly removals: GracefulHttpShutdownSignal[] = [];
  failOn?: GracefulHttpShutdownSignal;

  listen(
    signal: GracefulHttpShutdownSignal,
    listener: GracefulHttpShutdownListener,
  ): () => void {
    if (this.failOn === signal) throw new Error(`cannot listen for ${signal}`);
    this.listeners.set(signal, listener);
    return () => {
      this.removals.push(signal);
      this.listeners.delete(signal);
    };
  }

  async emit(signal: GracefulHttpShutdownSignal): Promise<boolean> {
    const listener = this.listeners.get(signal);
    if (!listener) return false;
    await listener();
    return true;
  }
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

Deno.test("graceful HTTP shutdown removes both listeners before awaiting shutdown", async () => {
  const runtime = new FakeSignalRuntime();
  const shutdown = deferred();
  let shutdownCalls = 0;
  const registration = installGracefulHttpShutdown(
    {
      async shutdown() {
        shutdownCalls += 1;
        await shutdown.promise;
      },
    },
    { runtime },
  );

  let emitSettled = false;
  const emitted = runtime.emit("SIGINT").then((value) => {
    emitSettled = true;
    return value;
  });
  await Promise.resolve();

  assertEquals(shutdownCalls, 1);
  assertEquals(runtime.removals, ["SIGINT", "SIGTERM"]);
  assertEquals([...runtime.listeners.keys()], []);
  assertFalse(emitSettled);
  assertFalse(await runtime.emit("SIGTERM"));

  shutdown.resolve();
  assertEquals(await emitted, true);
  assertEquals(await registration.completion, {
    status: "stopped",
    signal: "SIGINT",
  });
});

Deno.test("graceful HTTP shutdown is one-shot even for already-delivered callbacks", async () => {
  const runtime = new FakeSignalRuntime();
  let shutdownCalls = 0;
  const registration = installGracefulHttpShutdown(
    {
      shutdown() {
        shutdownCalls += 1;
        return Promise.resolve();
      },
    },
    { runtime },
  );
  const interrupt = runtime.listeners.get("SIGINT");
  const terminate = runtime.listeners.get("SIGTERM");
  if (!interrupt || !terminate) throw new Error("listeners were not installed");

  await Promise.all([interrupt(), terminate()]);

  assertEquals(shutdownCalls, 1);
  assertEquals(await registration.completion, {
    status: "stopped",
    signal: "SIGINT",
  });
});

Deno.test("graceful HTTP shutdown reports a shutdown failure without rejecting", async () => {
  const runtime = new FakeSignalRuntime();
  const failure = new Error("shutdown failed");
  const errors: Array<{ error: unknown; phase: string; signal?: string }> = [];
  const registration = installGracefulHttpShutdown(
    {
      shutdown() {
        return Promise.reject(failure);
      },
    },
    {
      runtime,
      onError(error, context) {
        errors.push({ error, ...context });
      },
    },
  );

  assertEquals(await runtime.emit("SIGTERM"), true);
  const outcome = await registration.completion;

  assertEquals(outcome.status, "error");
  if (outcome.status !== "error") throw new Error("expected error outcome");
  assertEquals(outcome.signal, "SIGTERM");
  assertStrictEquals(outcome.error, failure);
  assertEquals(errors.length, 1);
  assertStrictEquals(errors[0].error, failure);
  assertEquals(errors[0].phase, "shutdown");
  assertEquals(errors[0].signal, "SIGTERM");
});

Deno.test("graceful HTTP shutdown rolls back a partially installed listener set", () => {
  const runtime = new FakeSignalRuntime();
  runtime.failOn = "SIGTERM";

  assertThrows(
    () =>
      installGracefulHttpShutdown(
        { shutdown: () => Promise.resolve() },
        { runtime },
      ),
    Error,
    "cannot listen for SIGTERM",
  );
  assertEquals(runtime.removals, ["SIGINT"]);
  assertEquals([...runtime.listeners.keys()], []);
});
