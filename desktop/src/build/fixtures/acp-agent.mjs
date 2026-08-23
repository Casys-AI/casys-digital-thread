import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";

const [acpxRoot, agentPidPath, grandchildPidPath] = process.argv.slice(2);
if (!acpxRoot || !agentPidPath || !grandchildPidPath) {
  throw new Error("fixture requires acpx root and two PID marker paths");
}
const sdk = await import(
  pathToFileURL(join(
    acpxRoot,
    "node_modules",
    "@agentclientprotocol",
    "sdk",
    "dist",
    "acp.js",
  )).href
);

writeFileSync(agentPidPath, `${process.pid}\n`, "utf8");
const grandchild = spawn(process.execPath, [
  "--eval",
  "setInterval(() => {}, 1000)",
], { stdio: "ignore" });
if (!grandchild.pid) throw new Error("fixture grandchild has no PID");
writeFileSync(grandchildPidPath, `${grandchild.pid}\n`, "utf8");

const sessions = new Set();
class FixtureAgent {
  initialize() {
    return {
      protocolVersion: sdk.PROTOCOL_VERSION,
      authMethods: [],
      agentCapabilities: {
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: { close: {} },
      },
    };
  }

  async authenticate() {}

  newSession() {
    const sessionId = randomUUID();
    sessions.add(sessionId);
    return { sessionId, _meta: { agentSessionId: `fixture-${sessionId}` } };
  }

  async prompt(params) {
    if (!sessions.has(params.sessionId)) throw new Error("unknown fixture session");
    const response = await connection.request(sdk.methods.client.elicitation.create, {
      mode: "form",
      sessionId: params.sessionId,
      message: "Confirm packaged runtime smoke",
      requestedSchema: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", title: "Confirm" },
        },
        required: ["confirmed"],
      },
    });
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `elicitation:${response.action}` },
      },
    });
    return { stopReason: "end_turn" };
  }

  async cancel() {}

  closeSession(params) {
    sessions.delete(params.sessionId);
    return {};
  }
}

const stream = sdk.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);
const connection = new sdk.AgentSideConnection(() => new FixtureAgent(), stream);
void connection;
