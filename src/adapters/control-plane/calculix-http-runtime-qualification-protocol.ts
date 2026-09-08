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
  schemaVersion: "calculix-http-qualification-protocol/1.5",
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
  quarantineResourceRoles: CALCULIX_RECORDED_RESOURCE_ORDER,
  quarantineResourceFailures: ["read-error", "byte-or-digest-mismatch"],
  quarantineResourceErrorKinds: [
    "transport",
    "protocol-invalid",
    "http-rejection",
    "rpc-rejection",
    "result-envelope",
    "content-envelope",
    "content-encoding",
    "content-integrity",
    "unexpected",
  ],
  quarantineResourceRule:
    "Role and failure appear together only for provider-resource-content; protocol 1.4 read errors also carry one closed error kind. Historical WAL may omit it. No URI, status, provider message or payload is retained.",
  resourceReadProjection:
    "Each listed artifact is projected to the exact uri, mediaType, byteCount and sha256 tuple before the strict MCP reader; provider role remains service-local.",
  resources: CALCULIX_RECORDED_RESOURCE_ORDER,
  evidenceBoundary:
    "Recorded solve and readback only; no product, Thread, requirement, safety, or engineering verdict.",
});

export function fingerprintCalculixHttpQualificationProtocol(): Promise<
  ContentFingerprint
> {
  return sha256Fingerprint(CALCULIX_HTTP_QUALIFICATION_PROTOCOL);
}
