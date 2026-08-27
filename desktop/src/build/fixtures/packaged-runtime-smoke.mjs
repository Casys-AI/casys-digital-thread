import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [runtimeRoot, fixturePath, stateRoot] = process.argv.slice(2);
if (!runtimeRoot || !fixturePath || !stateRoot) {
  throw new Error("smoke requires runtime root, fixture, and state root");
}
const acpxRoot = join(runtimeRoot, "acpx");
const runtime = await import(pathToFileURL(join(acpxRoot, "dist", "runtime.js")).href);
for (
  const name of ["createAcpRuntime", "createFileSessionStore", "createAgentRegistry"]
) {
  if (typeof runtime[name] !== "function") {
    throw new Error(`missing acpx export ${name}`);
  }
}

const agentPidPath = join(stateRoot, "agent.pid");
const grandchildPidPath = join(stateRoot, "grandchild.pid");
const instance = runtime.createAcpRuntime({
  cwd: stateRoot,
  sessionStore: runtime.createFileSessionStore({
    stateDir: join(stateRoot, "sessions"),
  }),
  agentRegistry: runtime.createAgentRegistry({
    overrides: {
      fixture: [
        process.execPath,
        fixturePath,
        acpxRoot,
        agentPidPath,
        grandchildPidPath,
      ],
    },
  }),
  permissionMode: "deny-all",
  nonInteractivePermissions: "deny",
  elicitationModes: ["form", "url"],
});

const handle = await instance.ensureSession({
  sessionKey: "packaged-runtime-smoke",
  agent: "fixture",
  mode: "persistent",
  cwd: stateRoot,
  sessionOptions: { systemPrompt: "Package smoke only." },
});
let elicitationContext;
const turn = instance.startTurn({
  handle,
  text: "smoke",
  mode: "prompt",
  requestId: "smoke-turn",
  onElicitation: (request, context) => {
    elicitationContext = {
      mode: request.mode,
      message: request.message,
      requestIdType: typeof context.requestId,
      aborted: context.signal.aborted,
    };
    return Promise.resolve({ action: "accept", content: { confirmed: true } });
  },
});
const events = [];
for await (const event of turn.events) events.push(event);
const result = await turn.result;
await instance.close({
  handle,
  reason: "packaged runtime smoke complete",
  discardPersistentState: true,
});

const agentPid = Number((await readFile(agentPidPath, "utf8")).trim());
const grandchildPid = Number((await readFile(grandchildPidPath, "utf8")).trim());
await waitUntilGone(agentPid);
await waitUntilGone(grandchildPid);
if (result.status !== "completed") throw new Error(`turn ${result.status}`);
const text = events.filter((event) => event.type === "text_delta")
  .map((event) => event.text).join("");
if (text !== "elicitation:accept") throw new Error(`unexpected stream: ${text}`);
if (
  elicitationContext?.mode !== "form" || elicitationContext.aborted !== false ||
  elicitationContext.requestIdType !== "number"
) {
  throw new Error("elicitation context did not cross packaged acpx/runtime");
}
process.stdout.write(`${
  JSON.stringify({
    ok: true,
    runtime: "acpx/runtime",
    result: result.status,
    text,
    elicitation: elicitationContext,
    noOrphan: true,
  })
}\n`);

async function waitUntilGone(pid) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`orphan process remains: ${pid}`);
}
