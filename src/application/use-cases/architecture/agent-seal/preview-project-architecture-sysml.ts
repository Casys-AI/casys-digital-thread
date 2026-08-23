/**
 * Provider-free preview of a captured agent-authored architecture SysML.
 *
 * The use case always reopens one capture reference. Unresolved constructs
 * are always returned. Decision parameters exist only for a reopened passed
 * capture and name the exact CAS identities a later
 * `model.seal-architecture-sysml@1` proposal must sign.
 */

import type {
  ProjectArchitectureSysmlPreviewCommand,
  ProjectArchitectureSysmlPreviewResult,
  ProjectArchitectureSysmlPreviewStatus,
  ProjectArchitectureSysmlPreviewUseCase,
} from "../../../ports/in/architecture/agent-seal/project-architecture-sysml-preview.ts";
import { encodeArchitectureSysmlSealParameters } from "../../../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import { exactRecord } from "../../../../domain/kernel/case-validation.ts";
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
  readonly captures: ArchitectureSysmlSourceAnalysisReader;
}

export class PreviewProjectArchitectureSysml
  implements ProjectArchitectureSysmlPreviewUseCase {
  readonly #captures: ArchitectureSysmlSourceAnalysisReader;

  constructor(dependencies: PreviewProjectArchitectureSysmlDependencies) {
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

    try {
      const reopened = await this.#captures.reopen(command.sourceRef);
      return previewFromAnalysis(reopened.analysis, reopened.reference);
    } catch (cause) {
      throw previewError(
        "source_resolution_failed",
        "The architecture SysML capture reference could not be reopened.",
        cause,
      );
    }
  }
}

function previewFromAnalysis(
  analysis: ReopenedArchitectureSysmlSourceAnalysis["analysis"],
  reference: ReopenedArchitectureSysmlSourceAnalysis["reference"],
): ProjectArchitectureSysmlPreviewResult {
  const status = previewStatus(analysis);
  const decisionParameters = status === "rejected"
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
    sourceRef: reference as Readonly<Record<string, unknown>>,
    ...(decisionParameters === undefined ? {} : { decisionParameters }),
  };
}

function previewStatus(
  analysis: ReopenedArchitectureSysmlSourceAnalysis["analysis"],
): ProjectArchitectureSysmlPreviewStatus {
  if (analysis.policy.status === "rejected") return "rejected";
  if (analysis.unresolvedConstructs.length > 0) return "unresolved";
  return "ready-for-review";
}

function parseCommand(value: unknown): ProjectArchitectureSysmlPreviewCommand {
  const root = exactRecord(value, ["sourceRef"], "$preview");
  if (
    root.sourceRef === null || typeof root.sourceRef !== "object" ||
    Array.isArray(root.sourceRef)
  ) {
    throw new TypeError("$preview.sourceRef must be an object.");
  }
  return { sourceRef: root.sourceRef as Readonly<Record<string, unknown>> };
}

function previewError(
  code: PreviewProjectArchitectureSysmlErrorCode,
  message: string,
  cause?: unknown,
): PreviewProjectArchitectureSysmlError {
  return new PreviewProjectArchitectureSysmlError(code, message, cause);
}
