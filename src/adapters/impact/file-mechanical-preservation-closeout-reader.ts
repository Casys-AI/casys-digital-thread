/**
 * Reopen an existing static-mechanical L5 closeout capture without calling
 * CalculiX and without inventing Thread consumption records.
 */

import type {
  MechanicalPreservationCloseoutFacts,
  MechanicalPreservationCloseoutReader,
} from "../../application/ports/out/impact/mechanical-preservation-closeout-reader.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import {
  validateStaticMechanicalEvaluationCloseoutCapture,
} from "../fea/evaluation-closeout/static-mechanical-evaluation-closeout-capture.ts";

export class FileMechanicalPreservationCloseoutReader
  implements MechanicalPreservationCloseoutReader {
  constructor(
    private readonly captures: Pick<
      FileCaptureStore<"evaluation-closeout-capture">,
      "read"
    >,
  ) {}

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<MechanicalPreservationCloseoutFacts | undefined> {
    const text = await this.captures.read(fingerprint);
    if (text === undefined) return undefined;
    const capture = validateStaticMechanicalEvaluationCloseoutCapture(
      JSON.parse(text),
    );
    const actual = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(actual, fingerprint)) {
      throw new TypeError(
        "Reopened static-mechanical closeout capture does not match its content address.",
      );
    }
    return {
      operation: {
        id: capture.operation.id,
        version: capture.operation.version,
      },
      trustedRunId: capture.trustedRunId,
      sealedAt: capture.sealedAt,
      consequence: capture.admission.consequence,
      inputs: {
        canonicalStep: identity(capture.inputs.canonicalStep),
        sealedProof: identity(capture.inputs.sealedProof),
        executionEvidence: identity(capture.inputs.executionEvidence),
        evaluationCapture: identity(capture.inputs.evaluationCapture),
      },
    };
  }
}

function identity(value: {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}) {
  return {
    id: value.id,
    fingerprint: value.fingerprint,
    producerRunId: value.producerRunId,
  };
}
