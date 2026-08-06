import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";
import {
  type Cm01DripTrayMechanicalR3Capture,
  parseCm01DripTrayMechanicalR3Capture,
} from "./cm01-drip-tray-mechanical-capture-r3.ts";

export interface Cm01R3CompletedAttemptReader {
  completedCapture(
    input: { projectId: string; runId: string },
  ): Promise<ContentFingerprint | undefined>;
}

export interface Cm01R3CaptureReader {
  uriFor(fingerprint: ContentFingerprint): string;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface Cm01R3RecoveredCapture {
  readonly value: Cm01DripTrayMechanicalR3Capture;
  readonly uri: string;
}

/**
 * Read-only bridge from a completed R3 provider attempt to an identity-only
 * recovery.  It never dispatches a provider, creates an attempt marker, or
 * accepts a capture selected by an agent.
 */
export class Cm01DripTrayMechanicalR3CaptureRecovery {
  constructor(
    private readonly attempts: Cm01R3CompletedAttemptReader,
    private readonly captures: Cm01R3CaptureReader,
  ) {}

  async require(
    input: {
      projectId: string;
      historicalRunId: string;
      expectedCaptureFingerprint: ContentFingerprint;
    },
  ): Promise<Cm01R3RecoveredCapture> {
    const stored = await this.attempts.completedCapture({
      projectId: input.projectId,
      runId: input.historicalRunId,
    });
    if (!stored) {
      throw new Error(
        "CM-01 R3 identity recovery requires a completed original R3 capture; it will not call providers.",
      );
    }
    const text = await this.captures.read(stored);
    if (!text) {
      throw new Error(
        "CM-01 R3 identity recovery cannot read the completed original R3 capture.",
      );
    }
    const value = await parseCm01DripTrayMechanicalR3Capture(JSON.parse(text));
    if (
      value.fingerprint.algorithm !== input.expectedCaptureFingerprint.algorithm ||
      value.fingerprint.digest !== input.expectedCaptureFingerprint.digest
    ) {
      throw new Error(
        "CM-01 R3 identity recovery capture does not match the historical R10 evidence identity.",
      );
    }
    return { value, uri: this.captures.uriFor(stored) };
  }
}
