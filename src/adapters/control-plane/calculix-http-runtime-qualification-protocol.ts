/** Exact recorded-solve/readback protocol for the HTTP CalculiX host probe. */

import {
  CALCULIX_RECORDED_RESOURCE_ORDER,
  MCP_CALCULIX_RECORDED_STATIC_TOOL,
  MCP_CALCULIX_RUN_GET_TOOL,
} from "../sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export const CALCULIX_HTTP_QUALIFICATION_PROTOCOL = deepFreeze({
  schemaVersion: "calculix-http-qualification-protocol/1.2",
  dispatchTool: MCP_CALCULIX_RECORDED_STATIC_TOOL,
  readbackTool: MCP_CALCULIX_RUN_GET_TOOL,
  acceptedRunState: "completed",
  acknowledgementRecovery:
    "A missing or malformed dispatch acknowledgement is recovered by exact request-id readback only; it is never redispatched.",
  quarantineStages: [
    "provider-readback",
    "provider-resource-list",
    "provider-resource-content",
  ],
  resources: CALCULIX_RECORDED_RESOURCE_ORDER,
  evidenceBoundary:
    "Recorded solve and readback only; no product, Thread, requirement, safety, or engineering verdict.",
});

export function fingerprintCalculixHttpQualificationProtocol(): Promise<
  ContentFingerprint
> {
  return sha256Fingerprint(CALCULIX_HTTP_QUALIFICATION_PROTOCOL);
}
