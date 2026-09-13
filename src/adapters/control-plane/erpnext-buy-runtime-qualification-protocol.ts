/** Server-owned ERP Buy qualification probe protocol. tools/list is not this. */

import { ERPNEXT_BUY_CAPTURE_TOOL } from "../../domain/buy/buy-operations.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export const ERPNEXT_BUY_QUALIFICATION_PROTOCOL = deepFreeze({
  schemaVersion: "erpnext-buy-qualification-protocol/1.0",
  probeTool: ERPNEXT_BUY_CAPTURE_TOOL,
  argumentShape: "documents",
  argumentOwner: "server",
  installationReaderMaySupplyToolOrArgs: false,
  toolsListIsNotProof: true,
  evidenceBoundary:
    "Read-only Buy capture wire and installed-site contract only; tools/list, a fleet image tag, or an arbitrary tool envelope is not qualification.",
});

export function fingerprintErpnextBuyQualificationProtocol(): Promise<
  ContentFingerprint
> {
  return sha256Fingerprint(ERPNEXT_BUY_QUALIFICATION_PROTOCOL);
}
