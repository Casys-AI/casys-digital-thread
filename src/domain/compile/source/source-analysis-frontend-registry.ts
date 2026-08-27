/**
 * Exact-version registry for parser-backed source-analysis frontends.
 *
 * A persisted source-analysis bundle names the parser that produced it.  A
 * replay must therefore resolve that exact `{ id, version }` pair instead of
 * silently substituting whatever parser happens to be current at runtime.
 * This is a domain port: registrations are supplied by the composition root;
 * no adapter implementation is imported here.
 */

import { nonEmptyText, safeId } from "../../kernel/case-validation.ts";
import type { SourceAnalysisAnalyzer } from "./source-analysis.ts";
import type { SourceAnalysisFrontend } from "./source-analysis-frontend.ts";

export interface SourceAnalysisFrontendRegistration {
  readonly analyzer: SourceAnalysisAnalyzer;
  readonly frontend: SourceAnalysisFrontend;
}

/** Read-only resolution port used by capture and replay boundaries. */
export interface SourceAnalysisFrontendRegistry {
  require(analyzer: SourceAnalysisAnalyzer): SourceAnalysisFrontend;
}

/** A sealed parser version was not supplied by this process. */
export class SourceAnalysisFrontendNotRegisteredError extends Error {
  constructor(readonly analyzer: SourceAnalysisAnalyzer) {
    super(
      `No source-analysis frontend is registered for ${analyzer.id}@${analyzer.version}.`,
    );
    this.name = "SourceAnalysisFrontendNotRegisteredError";
  }
}

/**
 * Small in-memory implementation owned by the composition root.
 *
 * It intentionally has no fallback by id alone: upgrading a parser requires
 * retaining the old registration for every persisted analysis that may be
 * replayed, or that analysis fails closed.
 */
export class FixedSourceAnalysisFrontendRegistry
  implements SourceAnalysisFrontendRegistry {
  readonly #frontends: ReadonlyMap<string, SourceAnalysisFrontend>;

  constructor(registrations: readonly SourceAnalysisFrontendRegistration[]) {
    const frontends = new Map<string, SourceAnalysisFrontend>();
    for (const registration of registrations) {
      const analyzer = validateAnalyzer(
        registration.analyzer,
        "$registration.analyzer",
      );
      if (
        registration.frontend === null ||
        typeof registration.frontend !== "object" ||
        typeof registration.frontend.analyze !== "function"
      ) {
        throw new TypeError("$registration.frontend must implement analyze.");
      }
      const key = analyzerKey(analyzer);
      if (frontends.has(key)) {
        throw new TypeError(
          `Duplicate source-analysis frontend registration for ${analyzer.id}@${analyzer.version}.`,
        );
      }
      frontends.set(key, registration.frontend);
    }
    this.#frontends = frontends;
  }

  require(analyzer: SourceAnalysisAnalyzer): SourceAnalysisFrontend {
    const exact = validateAnalyzer(analyzer, "$analyzer");
    const frontend = this.#frontends.get(analyzerKey(exact));
    if (frontend === undefined) {
      throw new SourceAnalysisFrontendNotRegisteredError(exact);
    }
    return frontend;
  }
}

function validateAnalyzer(
  value: SourceAnalysisAnalyzer,
  path: string,
): SourceAnalysisAnalyzer {
  return Object.freeze({
    id: safeId(value.id, `${path}.id`),
    version: nonEmptyText(value.version, `${path}.version`),
  });
}

function analyzerKey(analyzer: SourceAnalysisAnalyzer): string {
  return `${analyzer.id.length}:${analyzer.id}${analyzer.version.length}:${analyzer.version}`;
}
