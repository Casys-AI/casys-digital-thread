import snapshotFixture from "../../../state/fixtures/console-snapshot.json";
import runFixture from "../../../state/fixtures/runs/bracket-demo.json";
import type { ConsoleSnapshot, RunDetail } from "../../domain/types.ts";

/**
 * The browser preview intentionally reuses the repository's canonical,
 * evidence-reviewed fixtures. No UI-only observations live in this bundle.
 */
const canonicalSnapshot = snapshotFixture as unknown as ConsoleSnapshot;
const canonicalRunDetail = runFixture as unknown as RunDetail;

export function makeDemoSnapshot(): ConsoleSnapshot {
  return structuredClone(canonicalSnapshot);
}

export const demoRunDetail: RunDetail = structuredClone(canonicalRunDetail);
