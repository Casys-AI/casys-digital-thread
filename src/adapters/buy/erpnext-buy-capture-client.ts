/**
 * Read-only ERPNext Buy capture over the existing HTTP MCP transport.
 *
 * The tool name is a server lock. The caller cannot supply sourceInstance,
 * capturedAt, or an attested fingerprint.
 */

import type { McpToolClient } from "../../application/ports/out/mcp-tool-client.ts";
import { ERPNEXT_BUY_CAPTURE_TOOL } from "../../domain/buy/buy-operations.ts";
import type { BuyDocumentRequest } from "../../domain/buy/buy-proposal.ts";
import {
  assertBuySourceCaptureFingerprint,
  type BuySourceCaptureEnvelope,
  validateBuySourceCaptureEnvelope,
} from "../../domain/buy/buy-source-capture.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";

export class ErpnextBuyCaptureClient {
  constructor(private readonly mcp: McpToolClient) {}

  async capture(
    documents: readonly BuyDocumentRequest[],
  ): Promise<BuySourceCaptureEnvelope> {
    const result = await this.mcp.callTool({
      name: ERPNEXT_BUY_CAPTURE_TOOL,
      arguments: {
        documents: documents.map((document) => ({
          doctype: document.doctype,
          name: document.name,
          ...(document.expectedModified
            ? { expectedModified: document.expectedModified }
            : {}),
        })),
      },
    });
    const envelope = validateBuySourceCaptureEnvelope(result.structuredContent);
    await assertBuySourceCaptureFingerprint(envelope, sha256Hex);
    if (envelope.capture.consistency.consistent !== true) {
      throw new TypeError(
        "erpnext_buy_capture consistency is not a usable repeated-read; it is not an authoritative cost capture.",
      );
    }
    return envelope;
  }
}
