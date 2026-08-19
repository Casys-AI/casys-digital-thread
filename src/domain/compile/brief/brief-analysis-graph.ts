/**
 * Canonical promotion of explicit brief gate dependencies into qualified facts.
 *
 * The source frontend remains responsible for parsing the native brief JSON.
 * This builder only accepts its already validated, passed bundle and preserves
 * each explicit `declared-dependency` without interpreting brief prose. The
 * resulting graph records no authority and never exposes source captures as
 * ThreadSnapshot evidence: the exact approved baseline document is the single
 * evidence artifact for every promoted assertion.
 */

import { exactRecord, literalValue, safeId } from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type AnalysisGraph,
  type AnalysisGraphNode,
  validateAnalysisGraph,
} from "../../thread/analysis-graph.ts";
import type {
  EngineeringEvidence,
  SemanticRef,
} from "../../thread/engineering-assertion.ts";
import {
  type SourceAnalysisBundle,
  type SourceAnalysisSymbol,
  validateSourceAnalysisBundle,
} from "../source/source-analysis.ts";

/** Exact approved-baseline document that exclusively evidences each fact. */
export interface BriefAnalysisGraphEvidenceArtifact {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export interface BriefAnalysisGraphInput {
  /** A validated result emitted by the native project-brief source frontend. */
  readonly bundle: SourceAnalysisBundle;
  /**
   * Exact documentary artifact retained in the ThreadSnapshot. Source and
   * analysis capture identities intentionally do not become assertion evidence.
   */
  readonly evidence: BriefAnalysisGraphEvidenceArtifact;
}

/**
 * Promote explicit V2 brief gate dependencies into declared assertions.
 *
 * A graph is absent, not empty, when the source declares no dependencies. This
 * avoids pretending that unlinked brief items are causal facts.
 */
export function buildBriefAnalysisGraph(
  input: BriefAnalysisGraphInput,
): AnalysisGraph | undefined {
  const bundle = validateSourceAnalysisBundle(input.bundle);
  assertBriefBundle(bundle);
  const evidence = validateEvidence(input.evidence);

  if (bundle.dependencies.length === 0) return undefined;

  const symbolById = new Map(bundle.symbols.map((symbol) => [symbol.id, symbol]));
  const referencedSymbolIds = new Set<string>();
  const relations = bundle.dependencies.map((dependency) => {
    if (dependency.kind !== "declared-dependency") {
      throw new TypeError(
        `Brief analysis dependency ${dependency.id} must be declared-dependency.`,
      );
    }
    const fromSymbol = symbolById.get(dependency.fromSymbolId);
    const toSymbol = symbolById.get(dependency.toSymbolId);
    if (fromSymbol === undefined || toSymbol === undefined) {
      // SourceAnalysisBundle currently prevents this. Keep the proof builder
      // explicit so it cannot acquire an implicit frontend trust boundary.
      throw new TypeError(
        `Brief analysis dependency ${dependency.id} must name local symbols.`,
      );
    }
    assertBriefItem(fromSymbol, `$bundle.symbols.${fromSymbol.id}`);
    assertBriefItem(toSymbol, `$bundle.symbols.${toSymbol.id}`);
    referencedSymbolIds.add(fromSymbol.id);
    referencedSymbolIds.add(toSymbol.id);

    const from = briefItemRef(fromSymbol, bundle.source.fingerprint);
    const to = briefItemRef(toSymbol, bundle.source.fingerprint);
    return {
      assertion: {
        schemaVersion: "engineering-assertion/1.0" as const,
        id:
          `brief-declared-dependency:${bundle.source.fingerprint.digest}:${dependency.id}`,
        relation: "declared-dependency" as const,
        from,
        to,
        epistemicBasis: "declared" as const,
        assertedBy: {
          kind: "analyzer" as const,
          id: bundle.analyzer.id,
          version: bundle.analyzer.version,
        },
        evidence: [evidence],
        scope: {
          kind: "basis" as const,
          basisFingerprint: bundle.source.fingerprint,
        },
        rationale:
          `The passed brief frontend explicitly declared dependency ${dependency.id} between exact brief items ${fromSymbol.id} and ${toSymbol.id}.`,
      },
      fromNodeId: briefNodeId(fromSymbol.id, bundle.source.fingerprint),
      toNodeId: briefNodeId(toSymbol.id, bundle.source.fingerprint),
    };
  });
  const nodes: AnalysisGraphNode[] = bundle.symbols
    .filter((symbol) => referencedSymbolIds.has(symbol.id))
    .map((symbol) => {
      assertBriefItem(symbol, `$bundle.symbols.${symbol.id}`);
      return {
        id: briefNodeId(symbol.id, bundle.source.fingerprint),
        kind: "brief-item" as const,
        semanticRef: briefItemRef(symbol, bundle.source.fingerprint),
      };
    });

  return validateAnalysisGraph({
    schemaVersion: "analysis-graph/1.0",
    nodes,
    relations,
  });
}

function assertBriefBundle(bundle: SourceAnalysisBundle): void {
  if (bundle.source.role !== "brief" || bundle.source.language !== "plain-text") {
    throw new TypeError(
      "Brief analysis graph requires source role brief and language plain-text.",
    );
  }
  if (bundle.policy.status !== "passed") {
    throw new TypeError(
      "Brief analysis graph requires a passed source-analysis policy.",
    );
  }
}

function assertBriefItem(symbol: SourceAnalysisSymbol, path: string): void {
  if (symbol.kind !== "brief-item") {
    throw new TypeError(`${path}.kind must be brief-item for a brief dependency.`);
  }
}

function briefItemRef(
  symbol: SourceAnalysisSymbol,
  basisFingerprint: ContentFingerprint,
): SemanticRef {
  return {
    domain: "brief",
    kind: "brief-item",
    // `symbol.id` is a bundle-local parser identity. The semantic occurrence is
    // the reviewed brief item id retained in `name`, qualified by exact source
    // bytes so the Workbench remains readable without trusting a label parser.
    id: safeId(symbol.name, `$bundle.symbols.${symbol.id}.name`),
    basisFingerprint,
  };
}

function briefNodeId(
  symbolId: string,
  sourceFingerprint: ContentFingerprint,
): string {
  // The source-local symbol id may intentionally remain stable across brief
  // revisions. A graph node identifies a semantic occurrence, so qualify it
  // with the exact source bytes just as its SemanticRef is qualified below.
  return `analysis-node:brief-item:${sourceFingerprint.digest}:${symbolId}`;
}

function validateEvidence(value: unknown): EngineeringEvidence {
  const input = exactRecord(value, ["id", "fingerprint"], "$input.evidence");
  const fingerprint = exactRecord(
    input.fingerprint,
    ["algorithm", "digest"],
    "$input.evidence.fingerprint",
  );
  literalValue(
    fingerprint.algorithm,
    "sha256",
    "$input.evidence.fingerprint.algorithm",
  );
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(
      "$input.evidence.fingerprint.digest must be a lowercase SHA-256 hex digest.",
    );
  }
  return {
    id: safeId(input.id, "$input.evidence.id"),
    fingerprint: { algorithm: "sha256", digest: fingerprint.digest },
  };
}
