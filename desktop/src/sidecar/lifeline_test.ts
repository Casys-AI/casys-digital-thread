import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { type LifelineSignal, waitForLifeline } from "./lifeline.ts";

Deno.test("a signal cancels the pending stdin reader", async () => {
  let signal: ((value: Exclude<LifelineSignal, "stdin-eof">) => void) | undefined;
  let cancelled = false;
  const stdin = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const pending = waitForLifeline({
    stdin,
    listenSignals(listener) {
      signal = listener;
      return () => {};
    },
  });
  signal?.("SIGTERM");
  assertEquals(await pending, "SIGTERM");
  assertEquals(cancelled, true);
  assertEquals(stdin.locked, false);
});

Deno.test("an actual SIGTERM releases a Deno stdin lifeline and exits", async () => {
  if (Deno.build.os === "windows") return;
  const permission = await Deno.permissions.query({
    name: "run",
    command: "deno",
  });
  if (permission.state !== "granted") return;

  const moduleUrl = new URL("./lifeline.ts", import.meta.url).href;
  const source = [
    `import { denoLifelineRuntime, waitForLifeline } from ${
      JSON.stringify(moduleUrl)
    };`,
    "const waiting = waitForLifeline(denoLifelineRuntime);",
    'console.log("lifeline-ready");',
    "console.log(await waiting);",
  ].join("\n");
  const child = new Deno.Command("deno", {
    args: ["eval", source],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const reader = child.stdout.getReader();
  let stdout = "";
  const decoder = new TextDecoder();
  while (!stdout.includes("lifeline-ready\n")) {
    const next = await reader.read();
    if (next.done) throw new Error("lifeline child exited before readiness");
    stdout += decoder.decode(next.value, { stream: true });
  }
  child.kill("SIGTERM");
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    stdout += decoder.decode(next.value, { stream: true });
  }
  stdout += decoder.decode();
  reader.releaseLock();

  const status = await Promise.race([
    child.status,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("SIGTERM lifeline child did not exit")), 2_000)
    ),
  ]);
  assertEquals(status.success, true);
  assertStringIncludes(stdout, "SIGTERM\n");
});
