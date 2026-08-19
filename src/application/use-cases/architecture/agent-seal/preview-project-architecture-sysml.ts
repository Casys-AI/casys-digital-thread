/**
 * Provider-free preview of agent-authored architecture SysML.
 *
 * Raw text is analysed in memory. A capture reference is reopened from CAS.
 * Unresolved constructs are always returned. Decision parameters exist only
 * for a reopened passed capture and name the exact CAS identities a later
 * `model.seal-architecture-sysml@1` proposal must sign.
 */

import type {
  ProjectArchitectureSysmlPreviewCommand,
  ProjectArchitectureSysmlPreviewResult,
  ProjectArchitectureSysmlPreviewStatus,
  ProjectArchitectureSysmlPreviewUseCase,
} from "../../../ports/in/architecture/agent-seal/project-architecture-sysml-preview.ts";
import type { SourceAnalysisFrontend } from "../../../../domain/compile/source/source-analysis-frontend.ts";
import {
  type SourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../../../domain/compile/source/source-analysis.ts";
import { encodeArchitectureSysmlSealParameters } from "../../../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import { exactRecord, safeId } from "../../../../domain/kernel/case-validation.ts";
import type {
  ArchitectureSysmlSourceAnalysisReader,
  ReopenedArchitectureSysmlSourceAnalysis,
} from "../../../ports/out/architecture/agent-seal/architecture-sysml-source-analysis-reader.ts";

export type PreviewProjectArchitectureSysmlErrorCode =
  | "invalid_request"
  | "source_resolution_failed";

export class PreviewProjectArchitectureSysmlError extends Error {
  readonly code: PreviewProjectArchitectureSysmlErrorCode;

  constructor(
    code: PreviewProjectArchitectureSysmlErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PreviewProjectArchitectureSysmlError";
    this.code = code;
  }
}

export interface PreviewProjectArchitectureSysmlDependencies {
  readonly frontend: SourceAnalysisFrontend;
  readonly captures?: ArchitectureSysmlSourceAnalysisReader;
}

export class PreviewProjectArchitectureSysml
  implements ProjectArchitectureSysmlPreviewUseCase {
  readonly #frontend: SourceAnalysisFrontend;
  readonly #captures: ArchitectureSysmlSourceAnalysisReader | undefined;

  constructor(dependencies: PreviewProjectArchitectureSysmlDependencies) {
    this.#frontend = dependencies.frontend;
    this.#captures = dependencies.captures;
  }

  async execute(value: unknown): Promise<ProjectArchitectureSysmlPreviewResult> {
    let command: ProjectArchitectureSysmlPreviewCommand;
    try {
      command = parseCommand(value);
    } catch (cause) {
      throw previewError(
        "invalid_request",
        "The architecture SysML preview request failed exact validation.",
        cause,
      );
    }

    if (command.sourceRef !== undefined) {
      if (this.#captures === undefined) {
        throw previewError(
          "source_resolution_failed",
          "No architecture SysML capture reader is composed for this preview.",
        );
      }
      try {
        const reopened = await this.#captures.reopen(command.sourceRef);
        return previewFromAnalysis(
          reopened.analysis,
          reopened.reference,
        );
      } catch (cause) {
        throw previewError(
          "source_resolution_failed",
          "The architecture SysML capture reference could not be reopened.",
          cause,
        );
      }
    }

    const sourceId = safeId(command.sourceId, "$preview.sourceId");
    const sourceText = command.sourceText!;
    const analysis = validateSourceAnalysisBundle(
      await this.#frontend.analyze({
        sourceId,
        role: "sysml-model",
        language: "sysml-v2",
        sourceText,
      }),
    );
    return previewFromAnalysis(analysis);
  }
}

function previewFromAnalysis(
  analysis: SourceAnalysisBundle,
  reference?: ReopenedArchitectureSysmlSourceAnalysis["reference"],
): ProjectArchitectureSysmlPreviewResult {
  const status = previewStatus(analysis);
  const decisionParameters = reference === undefined || status === "rejected"
    ? undefined
    : encodeArchitectureSysmlSealParameters({
      schemaVersion: "architecture-sysml-seal-admission/1.0",
      sourceId: reference.source.id,
      profile: reference.profile,
      source: {
        sha256: reference.source.sha256,
        byteCount: reference.source.byteCount,
        casUri: reference.source.casUri,
      },
      analysis: {
        analyzer: reference.analysis.analyzer,
        policy: {
          profile: reference.analysis.policy.profile,
          status: "passed",
        },
        sha256: reference.analysis.sha256,
        byteCount: reference.analysis.byteCount,
        casUri: reference.analysis.casUri,
      },
    });
  return {
    status,
    analysis,
    unresolvedConstructs: analysis.unresolvedConstructs,
    ...(reference === undefined
      ? {}
      : { sourceRef: reference as Readonly<Record<string, unknown>> }),
    ...(decisionParameters === undefined ? {} : { decisionParameters }),
  };
}

function previewStatus(
  analysis: SourceAnalysisBundle,
): ProjectArchitectureSysmlPreviewStatus {
  if (analysis.policy.status === "rejected") return "rejected";
  if (analysis.unresolvedConstructs.length > 0) return "unresolved";
  return "ready-for-review";
}

function parseCommand(value: unknown): ProjectArchitectureSysmlPreviewCommand {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("$preview must be an object.");
  }
  const record = value as Record<string, unknown>;
  const hasText = Object.hasOwn(record, "sourceText");
  const hasRef = Object.hasOwn(record, "sourceRef");
  if (hasText === hasRef) {
    throw new TypeError(
      "$preview must name either sourceText or sourceRef, not both or neither.",
    );
  }
  if (hasRef) {
    const root = exactRecord(value, ["sourceRef"], "$preview");
    if (
      root.sourceRef === null || typeof root.sourceRef !== "object" ||
      Array.isArray(root.sourceRef)
    ) {
      throw new TypeError("$preview.sourceRef must be an object.");
    }
    return { sourceRef: root.sourceRef as Readonly<Record<string, unknown>> };
  }
  const keys = Object.hasOwn(record, "sourceId")
    ? ["sourceId", "sourceText"] as const
    : ["sourceText"] as const;
  const root = exactRecord(value, keys, "$preview");
  if (typeof root.sourceText !== "string" || root.sourceText.length === 0) {
    throw new TypeError("$preview.sourceText must be a non-empty string.");
  }
  return {
    sourceId: typeof root.sourceId === "string"
      ? root.sourceId
      : "architecture-sysml-preview",
    sourceText: root.sourceText,
  };
}

function previewError(
  code: PreviewProjectArchitectureSysmlErrorCode,
  message: string,
  cause?: unknown,
): PreviewProjectArchitectureSysmlError {
  return new PreviewProjectArchitectureSysmlError(code, message, cause);
}
