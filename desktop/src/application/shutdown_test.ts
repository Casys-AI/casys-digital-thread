import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  type DesktopShutdownSignal,
  drainAndExitDesktop,
  installDesktopShutdownSignals,
} from "./shutdown.ts";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  if (resolve === undefined) throw new Error("deferred resolver was not installed");
  return { promise, resolve };
}

Deno.test("process exit waits for both application and server drains", async () => {
  const application = deferred();
  const server = deferred();
  const events: string[] = [];
  const shutdown = drainAndExitDesktop({
    stopApplication: async () => {
      events.push("application-started");
      await application.promise;
      events.push("application-stopped");
    },
    shutdownServer: async () => {
      events.push("server-started");
      await server.promise;
      events.push("server-stopped");
    },
    exitProcess(code) {
      events.push(`process-exited-${code}`);
    },
  });

  await Promise.resolve();
  assertEquals(events, ["application-started", "server-started"]);

  server.resolve();
  await Promise.resolve();
  assertEquals(events, [
    "application-started",
    "server-started",
    "server-stopped",
  ]);

  application.resolve();
  await shutdown;
  assertEquals(events, [
    "application-started",
    "server-started",
    "server-stopped",
    "application-stopped",
    "process-exited-0",
  ]);
});

Deno.test("shutdown signals keep swallowing repeats until explicit cleanup", () => {
  const listeners = new Map<DesktopShutdownSignal, () => void>();
  const removed: DesktopShutdownSignal[] = [];
  let shutdowns = 0;
  const cleanup = installDesktopShutdownSignals(() => {
    shutdowns += 1;
  }, {
    add(signal, listener) {
      listeners.set(signal, listener);
    },
    remove(signal, listener) {
      if (listeners.get(signal) === listener) listeners.delete(signal);
      removed.push(signal);
    },
  });

  const interrupt = listeners.get("SIGINT");
  const terminate = listeners.get("SIGTERM");
  if (interrupt === undefined || terminate === undefined) {
    throw new Error("expected both shutdown listeners");
  }
  interrupt();
  assertEquals([...listeners.keys()].sort(), ["SIGINT", "SIGTERM"]);
  listeners.get("SIGTERM")?.();
  assertEquals(shutdowns, 1);
  assertEquals([...listeners.keys()].sort(), ["SIGINT", "SIGTERM"]);

  cleanup();
  cleanup();

  assertEquals(shutdowns, 1);
  assertEquals([...listeners.keys()], []);
  assertEquals(removed.sort(), ["SIGINT", "SIGTERM"]);
});

Deno.test("an unsupported signal does not prevent the supported listener", () => {
  let interrupt: (() => void) | undefined;
  let shutdowns = 0;
  const cleanup = installDesktopShutdownSignals(() => {
    shutdowns += 1;
  }, {
    add(signal, listener) {
      if (signal === "SIGTERM") throw new Error("unsupported");
      interrupt = listener;
    },
    remove() {},
  });

  if (interrupt === undefined) throw new Error("SIGINT listener not installed");
  interrupt();
  cleanup();
  assertEquals(shutdowns, 1);
});
