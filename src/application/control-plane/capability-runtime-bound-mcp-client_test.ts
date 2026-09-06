import { assertEquals, assertRejects } from "@std/assert";
import type {
  CapabilityRuntimeBoundMcpClient,
  CapabilityRuntimeConnectionHandle,
  CapabilityRuntimeConnectionRequest,
} from "../ports/out/capability/capability-runtime-connection.ts";
import { CapabilityRuntimeConnectionError } from "../ports/out/capability/capability-runtime-connection.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../ports/out/mcp-tool-client.ts";
import type { CapabilityRuntimeExecutionSession } from "./capability-runtime-execution-session.ts";
import { testResolvedCapabilityRuntimeOperation } from "../../testing/capability-runtime-execution-session-test-support.ts";
import { requiredQualifiedPersistentComposePublication } from "./capability-runtime-persistent-compose-publication.ts";
import { openLeaseBoundCapabilityRuntimeMcpClient } from "./capability-runtime-bound-mcp-client.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("the bound client opens only after the exact publication and session lease", async () => {
  const operational = testResolvedCapabilityRuntimeOperation({
    projectId: "project-review-demo",
    operation: { id: "model.write-architecture", version: "1" },
    capabilityId: "model.author-system",
    binding: { id: "syson-author-system", version: "1.0.0" },
  });
  const publication = requiredQualifiedPersistentComposePublication(operational);
  const lease = {
    id: "capability-jit-bound-client",
  } as CapabilityRuntimeExecutionSession["lease"];
  const events: string[] = [];
  const requests: CapabilityRuntimeConnectionRequest[] = [];
  const handle = Object.freeze({}) as CapabilityRuntimeConnectionHandle;
  const client = new UnusedSyson();
  const connection: CapabilityRuntimeBoundMcpClient = {
    broker: {
      connect: (request) => {
        events.push("connect");
        requests.push(request);
        return Promise.resolve(handle);
      },
    },
    openMcpClient: (opened) => {
      events.push("open");
      assertEquals(opened, handle);
      return Promise.resolve(client);
    },
  };

  const opened = await openLeaseBoundCapabilityRuntimeMcpClient({
    connection,
    session: sessionWithLease(lease),
    operationalCapability: operational,
  });

  assertEquals(opened, client);
  assertEquals(events, ["connect", "open"]);
  assertEquals(requests, [{
    lease,
    binding: publication.binding,
    launchGroup: publication.launchGroup,
  }]);
  assertEquals(publication.launchGroup, {
    id: "casys-syson",
    version: "1.0.0",
    fingerprint: FINGERPRINT,
  });
});

Deno.test("an unqualified ROP refuses before the broker connects or opens", async () => {
  const operational = testResolvedCapabilityRuntimeOperation({
    projectId: "project-review-demo",
    operation: { id: "model.write-architecture", version: "1" },
    capabilityId: "model.author-system",
    binding: { id: "syson-author-system", version: "1.0.0" },
  });
  const events: string[] = [];
  const connection = recordingConnection(events);
  await assertRejects(
    () =>
      openLeaseBoundCapabilityRuntimeMcpClient({
        connection,
        session: sessionWithLease(
          { id: "capability-jit-bound-client" } as CapabilityRuntimeExecutionSession[
            "lease"
          ],
        ),
        operationalCapability: {
          ...operational,
          bindings: [{
            ...operational.bindings[0]!,
            effectiveQualification: "compatible",
            capability: {
              ...operational.bindings[0]!.capability,
              minimumQualification: "compatible",
            },
          }],
        },
      }),
    CapabilityRuntimeConnectionError,
    "exactly one qualified binding",
  );
  assertEquals(events, []);
});

Deno.test("a broker connect failure never opens the MCP client", async () => {
  const operational = testResolvedCapabilityRuntimeOperation({
    projectId: "project-review-demo",
    operation: { id: "model.write-architecture", version: "1" },
    capabilityId: "model.author-system",
    binding: { id: "syson-author-system", version: "1.0.0" },
  });
  const events: string[] = [];
  const connection: CapabilityRuntimeBoundMcpClient = {
    broker: {
      connect: () => {
        events.push("connect");
        return Promise.reject(
          new CapabilityRuntimeConnectionError(
            "exact SysON publication is unavailable",
          ),
        );
      },
    },
    openMcpClient: () => {
      events.push("open");
      return Promise.reject(new Error("must not open"));
    },
  };
  await assertRejects(
    () =>
      openLeaseBoundCapabilityRuntimeMcpClient({
        connection,
        session: sessionWithLease(
          { id: "capability-jit-bound-client" } as CapabilityRuntimeExecutionSession[
            "lease"
          ],
        ),
        operationalCapability: operational,
      }),
    CapabilityRuntimeConnectionError,
    "publication is unavailable",
  );
  assertEquals(events, ["connect"]);
});

function sessionWithLease(
  lease: CapabilityRuntimeExecutionSession["lease"],
): CapabilityRuntimeExecutionSession {
  return {
    lease,
    releaseTerminal: () => Promise.resolve(),
    retainForRecovery: () => undefined,
  };
}

function recordingConnection(events: string[]): CapabilityRuntimeBoundMcpClient {
  return {
    broker: {
      connect: () => {
        events.push("connect");
        return Promise.resolve(
          Object.freeze({}) as CapabilityRuntimeConnectionHandle,
        );
      },
    },
    openMcpClient: () => {
      events.push("open");
      return Promise.resolve(new UnusedSyson());
    },
  };
}

class UnusedSyson implements McpToolClient {
  callTool(call: McpToolCall): Promise<McpToolResult> {
    return Promise.reject(new Error(`unused (${call.name})`));
  }

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`unused text (${call.name})`));
  }
}
