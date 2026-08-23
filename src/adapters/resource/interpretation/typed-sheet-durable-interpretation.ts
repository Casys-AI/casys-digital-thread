/**
 * Typed interpretation only after the existing domain store rereads an
 * exact canonical sheet. Validation failures stay at the codec; this
 * helper labels persistence and readback as interpretation-failed.
 */

import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import type { AgentResourceInterpretation } from "../../../domain/resource/agent-resource-capture.ts";
import {
  typedAgentResourceInterpretation,
  unresolvedAgentResourceInterpretation,
} from "../../../domain/resource/agent-resource-capture.ts";

export interface DurableTypedSheetStore<Sheet> {
  save(
    sheet: Sheet,
  ): Promise<{ fingerprint: ContentFingerprint; uri: string }>;
  read(fingerprint: ContentFingerprint): Promise<Sheet | undefined>;
}

export async function typedInterpretationAfterDurableStore<Sheet>(
  schemaVersion: string,
  sheet: Sheet,
  store: DurableTypedSheetStore<Sheet>,
  fingerprintSheet: (sheet: Sheet) => Promise<ContentFingerprint>,
): Promise<AgentResourceInterpretation> {
  try {
    const stored = await store.save(sheet);
    const reread = await store.read(stored.fingerprint);
    if (reread === undefined) {
      return unresolvedAgentResourceInterpretation(schemaVersion, {
        code: "interpretation-failed",
        message:
          `Declared ${schemaVersion} disappeared from the typed store after save.`,
      });
    }
    if (deterministicJson(reread) !== deterministicJson(sheet)) {
      return unresolvedAgentResourceInterpretation(schemaVersion, {
        code: "interpretation-failed",
        message: `Declared ${schemaVersion} reread does not match the canonical sheet.`,
      });
    }
    const actual = await fingerprintSheet(reread);
    if (!fingerprintsEqual(actual, stored.fingerprint)) {
      return unresolvedAgentResourceInterpretation(schemaVersion, {
        code: "interpretation-failed",
        message:
          `Declared ${schemaVersion} reread fingerprint does not match the typed store receipt.`,
      });
    }
    return typedAgentResourceInterpretation({
      schemaVersion,
      fingerprint: stored.fingerprint,
      uri: stored.uri,
    });
  } catch (error) {
    return unresolvedAgentResourceInterpretation(schemaVersion, {
      code: "interpretation-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
