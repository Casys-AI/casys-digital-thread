import type {
  FeaProofSealRequirementsReviewer,
  FeaProofSealRequirementsReviewResult,
} from "../../../application/ports/out/fea/seal-case/fea-proof-seal-requirements-reviewer.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { parseSysonModelSeedCapture } from "../../../domain/architecture/seed/syson-model-seed.ts";
import {
  listRequirementsCaptureContainers,
  REQUIREMENTS_CAPTURE_URI_PREFIX,
  selectRequirementsTip,
} from "../../../domain/thread/requirements-tip.ts";
import {
  assertTracedRequirementsRecaptureThreadContinuity,
  isRecaptureRequirementsCapture,
  isWriteRequirementsCapture,
  parseExactRequirementsCapture,
  requirementsCaptureProducerTool,
} from "../../architecture/requirements/requirements-capture.ts";
import { mechanicalProofRequirementsMatchCapture } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";

interface TextCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface CaptureBackedFeaProofSealRequirementsReviewerDependencies {
  readonly requirementsCaptures: TextCaptureReader;
  readonly seedCaptures: TextCaptureReader;
}

/**
 * Capture-backed implementation of the proof-seal requirements admission.
 *
 * It uses the same component-scoped, archive-aware tip selector as the SysON
 * writer and reopens both the V3 requirements capture and its seed identity.
 */
export class CaptureBackedFeaProofSealRequirementsReviewer
  implements FeaProofSealRequirementsReviewer {
  constructor(
    private readonly dependencies:
      CaptureBackedFeaProofSealRequirementsReviewerDependencies,
  ) {}

  async review(
    input: Parameters<FeaProofSealRequirementsReviewer["review"]>[0],
  ): Promise<FeaProofSealRequirementsReviewResult> {
    const matching: Array<{
      readonly artifact: ThreadArtifactLike;
      readonly component: string;
    }> = [];

    for (const component of listRequirementsCaptureContainers(input.snapshot)) {
      const tip = selectRequirementsTip(input.snapshot, component);
      if (tip.kind === "ambiguous") {
        return unresolved(
          "requirements-ambiguous",
          null,
          `The named basis does not expose one unique active requirements tip for exact component "${component}".`,
        );
      }
      if (tip.kind === "retired") {
        continue;
      }
      if (tip.kind !== "one") continue;
      const artifact = tip.artifact;

      let text: string | undefined;
      try {
        text = await this.dependencies.requirementsCaptures.read(
          artifact.fingerprint,
        );
      } catch (error) {
        return unresolved(
          "requirements-capture-unavailable",
          artifact.id,
          `Requirements capture "${artifact.id}" could not be reopened: ${
            errorMessage(error)
          }.`,
        );
      }
      if (text === undefined) {
        return unresolved(
          "requirements-capture-unavailable",
          artifact.id,
          `Requirements capture "${artifact.id}" is unavailable by its exact fingerprint.`,
        );
      }

      let capture;
      try {
        capture = parseExactRequirementsCapture(JSON.parse(text));
      } catch (error) {
        return unresolved(
          "requirements-capture-invalid",
          artifact.id,
          `Requirements capture "${artifact.id}" failed exact validation: ${
            errorMessage(error)
          }.`,
        );
      }
      if (
        capture.target.elementId !== input.proofCase.target.modelElementId ||
        capture.requirementsElementId !==
          input.proofCase.requirementsSource.elementId
      ) {
        continue;
      }
      if (
        (!isWriteRequirementsCapture(capture) &&
          !isRecaptureRequirementsCapture(capture)) ||
        artifact.uri !==
          `${REQUIREMENTS_CAPTURE_URI_PREFIX}${capture.containerComponent}/sha256/${artifact.fingerprint.digest}` ||
        capture.containerComponent !== component ||
        capture.target.label !== capture.containerComponent ||
        artifact.producer.tool !== requirementsCaptureProducerTool(capture)
      ) {
        return unresolved(
          "requirements-component-mismatch",
          artifact.id,
          `Requirements capture "${artifact.id}" does not bind one exact active requirements component lineage.`,
        );
      }
      try {
        await assertTracedRequirementsRecaptureThreadContinuity(
          capture,
          artifact,
          input.snapshot.artifacts,
          this.dependencies.requirementsCaptures,
        );
      } catch (error) {
        return unresolved(
          "requirements-capture-invalid",
          artifact.id,
          `Requirements capture "${artifact.id}" has no exact traced predecessor continuity: ${
            errorMessage(error)
          }.`,
        );
      }
      if (
        !mechanicalProofRequirementsMatchCapture(
          capture.requirements,
          input.proofCase.requirements,
        )
      ) {
        return unresolved(
          "requirements-capture-invalid",
          artifact.id,
          `Requirements capture "${artifact.id}" does not exactly restate the proof requirement metrics, operators, limits and units.`,
        );
      }

      let seedText: string | undefined;
      try {
        seedText = await this.dependencies.seedCaptures.read(
          capture.seed.fingerprint,
        );
      } catch (error) {
        return unresolved(
          "requirements-capture-unavailable",
          artifact.id,
          `Requirements seed for "${artifact.id}" could not be reopened: ${
            errorMessage(error)
          }.`,
        );
      }
      if (seedText === undefined) {
        return unresolved(
          "requirements-capture-unavailable",
          artifact.id,
          `Requirements seed for "${artifact.id}" is unavailable by its exact fingerprint.`,
        );
      }
      try {
        const seed = parseSysonModelSeedCapture(JSON.parse(seedText));
        if (
          seed.normalizedResults.project.editingContextId !==
            input.proofCase.requirementsSource.editingContextId
        ) {
          return unresolved(
            "requirements-capture-invalid",
            artifact.id,
            `Requirements seed editingContextId for "${artifact.id}" does not match the catalogued proof declaration.`,
          );
        }
      } catch (error) {
        return unresolved(
          "requirements-capture-invalid",
          artifact.id,
          `Requirements seed for "${artifact.id}" failed exact validation: ${
            errorMessage(error)
          }.`,
        );
      }
      matching.push({ artifact, component });
    }

    if (matching.length === 0) {
      return unresolved(
        "requirements-component-mismatch",
        null,
        `No reopened active requirements capture binds target element "${input.proofCase.target.modelElementId}" and RequirementUsage "${input.proofCase.requirementsSource.elementId}".`,
      );
    }
    if (matching.length > 1) {
      return unresolved(
        "requirements-ambiguous",
        null,
        `Several reopened requirements captures bind the exact proof target: ${
          matching.map((entry) => entry.artifact.id).join(", ")
        }.`,
      );
    }

    return { status: "resolved", artifact: matching[0]!.artifact };
  }
}

type ThreadArtifactLike = Parameters<
  FeaProofSealRequirementsReviewer["review"]
>[0]["snapshot"]["artifacts"][number];

function unresolved(
  code:
    | "requirements-absent"
    | "requirements-ambiguous"
    | "requirements-retired"
    | "requirements-component-mismatch"
    | "requirements-capture-unavailable"
    | "requirements-capture-invalid",
  artifactId: string | null,
  message: string,
): FeaProofSealRequirementsReviewResult {
  return {
    status: "unresolved",
    diagnostics: [{ code, artifactId, message }],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
