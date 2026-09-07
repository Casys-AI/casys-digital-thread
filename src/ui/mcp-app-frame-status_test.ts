import { assertEquals } from "@std/assert";
import {
  advanceMcpAppFrameStatus,
  type McpAppFrameStatus,
  mcpAppFrameStatusAllowsRetry,
  mcpAppFrameStatusCoversFrame,
  mcpAppFrameStatusLabel,
  mcpAppFrameUnavailableFromLoaderError,
} from "./src/thread/mcp-app-frame-status.ts";

Deno.test("frame status keeps success monotonic and freezes after a known failure", () => {
  let status: McpAppFrameStatus = { kind: "loading", stage: "starting" };
  status = advanceMcpAppFrameStatus(status, {
    kind: "loading",
    stage: "fetching-document",
  });
  status = advanceMcpAppFrameStatus(status, {
    kind: "loading",
    stage: "loading-document",
  });
  status = advanceMcpAppFrameStatus(status, {
    kind: "loading",
    stage: "awaiting-session",
  });
  status = advanceMcpAppFrameStatus(status, { kind: "session-accepted" });
  status = advanceMcpAppFrameStatus(status, {
    kind: "loading",
    stage: "awaiting-session",
  });
  assertEquals(status, { kind: "session-accepted" });
  assertEquals(mcpAppFrameStatusCoversFrame(status), false);

  status = advanceMcpAppFrameStatus(status, {
    kind: "resource-delivered",
    status: "available",
  });
  status = advanceMcpAppFrameStatus(status, { kind: "session-accepted" });
  assertEquals(status, {
    kind: "resource-delivered",
    status: "available",
  });

  status = advanceMcpAppFrameStatus(status, {
    kind: "error",
    reason: "document-replaced",
  });
  status = advanceMcpAppFrameStatus(status, { kind: "session-accepted" });
  assertEquals(status, { kind: "error", reason: "document-replaced" });
  assertEquals(mcpAppFrameStatusAllowsRetry(status), true);
  assertEquals(mcpAppFrameStatusCoversFrame(status), true);
  assertEquals(
    mcpAppFrameStatusLabel(status),
    "Registered App document was replaced",
  );

  status = advanceMcpAppFrameStatus(status, {
    kind: "loading",
    stage: "starting",
  });
  assertEquals(status, { kind: "loading", stage: "starting" });
});

Deno.test("loader errors map to literal unavailable reasons", () => {
  assertEquals(
    mcpAppFrameUnavailableFromLoaderError(
      new TypeError("The Workbench MCP App host nonce is unavailable."),
    ),
    { kind: "unavailable", reason: "host-nonce-unavailable" },
  );
  assertEquals(
    mcpAppFrameUnavailableFromLoaderError(
      new Error("The registered MCP App document is unavailable."),
    ),
    { kind: "unavailable", reason: "document-unavailable" },
  );
  assertEquals(
    mcpAppFrameUnavailableFromLoaderError(
      new Error("The registered MCP App document fingerprint changed."),
    ),
    { kind: "unavailable", reason: "document-invalid" },
  );
  assertEquals(
    mcpAppFrameStatusLabel({
      kind: "unavailable",
      reason: "document-unavailable",
    }),
    "Registered App unavailable",
  );
});
