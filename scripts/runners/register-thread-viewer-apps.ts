/** Trusted display-only registrar. The Workbench itself remains a GET/SSE reader. */
import { parseArgs, stableId } from "../lib/cli.ts";
import { FileThreadViewerAppRegistrar } from "../../src/adapters/thread/thread-viewer-app-registrar.ts";

export function viewerRegistrationOptions(args: string[]) {
  const parsed = parseArgs(args);
  const allowed = new Set(["project-id", "watch", "interval-ms", "root", "help"]);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Unknown viewer registrar option: ${key}.`);
    }
  }
  const intervalMs = Number(parsed["interval-ms"] ?? 2000);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 250 || intervalMs > 60_000) {
    throw new TypeError("Viewer registrar interval must be 250–60000 ms.");
  }
  if (parsed.watch !== undefined && !["true", "false"].includes(parsed.watch)) {
    throw new TypeError("Viewer registrar --watch must be a boolean.");
  }
  return {
    root: parsed.root ?? ".",
    ...(parsed["project-id"] !== undefined
      ? { projectIds: [stableId(parsed["project-id"], "Project id")] }
      : {}),
    watch: parsed.watch === "true",
    help: parsed.help === "true",
    intervalMs,
  };
}

if (import.meta.main) {
  const options = viewerRegistrationOptions(Deno.args);
  if (options.help) {
    console.log(
      "Usage: register-thread-viewer-apps.ts [--project-id=ID] [--watch] [--interval-ms=2000] [--root=PATH]",
    );
    Deno.exit(0);
  }
  const registrar = new FileThreadViewerAppRegistrar(options);
  const abort = new AbortController();
  const stop = () => abort.abort();
  Deno.addSignalListener("SIGTERM", stop);
  Deno.addSignalListener("SIGINT", stop);
  let previousLog: string | undefined;
  try {
    do {
      try {
        const result = await registrar.reconcile();
        // Repeated missing/incompatible evidence is visible once, not log spam.
        const line = JSON.stringify({
          ...result,
          status: result.status === "updated" ? "unchanged" : result.status,
        });
        if (line !== previousLog || result.status === "updated") {
          console.log(JSON.stringify({ viewerRegistration: result }));
          previousLog = line;
        }
      } catch (error) {
        const line = error instanceof Error ? error.message : String(error);
        if (line !== previousLog) {
          console.error(`Viewer registration unavailable: ${line}`);
        }
        previousLog = line;
        if (!options.watch) throw error;
      }
      if (!options.watch || abort.signal.aborted) break;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, options.intervalMs);
        abort.signal.addEventListener("abort", done, { once: true });
        if (abort.signal.aborted) done();
      });
    } while (!abort.signal.aborted);
  } finally {
    Deno.removeSignalListener("SIGTERM", stop);
    Deno.removeSignalListener("SIGINT", stop);
  }
}
