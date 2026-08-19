/**
 * Parser-backed frontend for the locked architecture SysML closed subset.
 *
 * The agent supplies exact UTF-8 SysML. This adapter tokenizes fail-closed,
 * parses the three renderer forms, and emits source-local facts. Unresolved
 * constructs are first-class and are never omitted. Dependencies bind symbol
 * ids, never labels. The adapter never calls a provider and never treats a
 * `sysml-source-capture/1.0` renderer envelope as agent-authored authority.
 */

import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "../../../domain/compile/source/source-analysis-frontend.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  type SourceAnalysisBundle,
  type SourceAnalysisDependency,
  type SourceAnalysisSymbol,
  type SourceAnalysisUnresolvedConstruct,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  ArchitectureSysmlLexicalError,
} from "../../../domain/architecture/agent-seal/architecture-sysml-lexical.ts";
import {
  type ArchitectureSysmlPackageNode,
  type ArchitectureSysmlParse,
  ArchitectureSysmlParseError,
  type ArchitectureSysmlPartDefNode,
  type ArchitectureSysmlUnresolved,
  type ArchitectureSysmlUsageNode,
  parseArchitectureSysmlSubset,
} from "../../../domain/architecture/agent-seal/architecture-sysml-parse.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_ID =
  "architecture-sysml-qualified" as const;
export const QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_VERSION = "1.0.0" as const;
export const QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE =
  "sysml-architecture-closed-subset-v1" as const;

interface NamedDefinition {
  readonly node: ArchitectureSysmlPartDefNode;
  readonly symbol: SourceAnalysisSymbol;
}

/** Pure, provider-free architecture SysML closed-subset analyzer. */
export class QualifiedArchitectureSysmlAnalyzer implements SourceAnalysisFrontend {
  async analyze(
    input: SourceAnalysisFrontendInput,
  ): Promise<SourceAnalysisBundle> {
    if (input.role !== "sysml-model" || input.language !== "sysml-v2") {
      throw new TypeError(
        "QualifiedArchitectureSysmlAnalyzer only accepts sysml-model/sysml-v2 sources.",
      );
    }
    if (typeof input.sourceText !== "string") {
      throw new TypeError("Qualified architecture SysML sourceText must be a string.");
    }

    const fingerprint = await fingerprintText(input.sourceText);
    let parsed: ArchitectureSysmlParse;
    try {
      parsed = parseArchitectureSysmlSubset(input.sourceText);
    } catch (error) {
      if (
        error instanceof ArchitectureSysmlLexicalError ||
        error instanceof ArchitectureSysmlParseError
      ) {
        return rejected(input, fingerprint, error);
      }
      throw error;
    }

    const symbols: SourceAnalysisSymbol[] = [];
    const definitionsByName = new Map<string, NamedDefinition[]>();
    const usages: Array<{
      readonly node: ArchitectureSysmlUsageNode;
      readonly symbol: SourceAnalysisSymbol;
      readonly parentName?: string;
    }> = [];

    if (parsed.package !== undefined) {
      symbols.push(await packageSymbol(input.sourceId, parsed.package));
      for (const definition of parsed.package.definitions) {
        await collectDefinition(
          input.sourceId,
          parsed.package.packageName,
          definition,
          symbols,
          definitionsByName,
          usages,
        );
      }
    } else if (parsed.definition !== undefined) {
      await collectDefinition(
        input.sourceId,
        undefined,
        parsed.definition,
        symbols,
        definitionsByName,
        usages,
      );
    } else if (parsed.usage !== undefined) {
      const symbol = await usageSymbol(input.sourceId, undefined, parsed.usage, 0);
      symbols.push(symbol);
      usages.push({ node: parsed.usage, symbol });
    }

    const unresolvedCandidates = [...parsed.unresolved];
    recordDuplicateDefinitions(definitionsByName, unresolvedCandidates);
    recordDuplicateUsages(usages, unresolvedCandidates);

    const dependencies: SourceAnalysisDependency[] = [];
    for (const usage of usages) {
      const matches = definitionsByName.get(usage.node.targetName) ?? [];
      if (matches.length > 1) {
        unresolvedCandidates.push({
          kind: "sysml-type-ambiguous",
          message:
            "A PartUsage type name matches more than one PartDefinition in this source.",
          span: usage.node.targetNameSpan,
        });
        continue;
      }
      const target = matches[0];
      const toSymbol = target?.symbol ?? await typeReferenceSymbol(
        input.sourceId,
        usage.node,
        usage.symbol.id,
      );
      if (target === undefined) symbols.push(toSymbol);
      dependencies.push(
        await structuralIncidence(
          input.sourceId,
          usage.symbol.id,
          toSymbol.id,
          usage.node,
        ),
      );
    }

    const unresolved = await Promise.all(
      unresolvedCandidates.map((candidate, ordinal) =>
        unresolvedConstruct(input.sourceId, candidate, ordinal)
      ),
    );

    return validateSourceAnalysisBundle({
      schemaVersion: SOURCE_ANALYSIS_SCHEMA,
      source: {
        id: input.sourceId,
        role: input.role,
        language: input.language,
        fingerprint,
      },
      analyzer: {
        id: QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_ID,
        version: QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_VERSION,
      },
      policy: {
        profile: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
        status: "passed",
        findings: [],
      },
      symbols,
      dependencies: deduplicateDependencies(dependencies),
      unresolvedConstructs: unresolved,
    });
  }
}

async function collectDefinition(
  sourceId: string,
  parentPackageName: string | undefined,
  definition: ArchitectureSysmlPartDefNode,
  symbols: SourceAnalysisSymbol[],
  definitionsByName: Map<string, NamedDefinition[]>,
  usages: Array<{
    readonly node: ArchitectureSysmlUsageNode;
    readonly symbol: SourceAnalysisSymbol;
    readonly parentName?: string;
  }>,
): Promise<void> {
  const symbol = await definitionSymbol(sourceId, parentPackageName, definition);
  symbols.push(symbol);
  const existing = definitionsByName.get(definition.definitionName) ?? [];
  existing.push({ node: definition, symbol });
  definitionsByName.set(definition.definitionName, existing);
  for (const [index, usage] of definition.usages.entries()) {
    const usageSymbolValue = await usageSymbol(
      sourceId,
      definition.definitionName,
      usage,
      index,
    );
    symbols.push(usageSymbolValue);
    usages.push({
      node: usage,
      symbol: usageSymbolValue,
      parentName: definition.definitionName,
    });
  }
}

function recordDuplicateDefinitions(
  definitionsByName: ReadonlyMap<string, readonly NamedDefinition[]>,
  unresolved: ArchitectureSysmlUnresolved[],
): void {
  for (const [name, definitions] of definitionsByName) {
    if (definitions.length < 2) continue;
    for (const definition of definitions.slice(1)) {
      unresolved.push({
        kind: "sysml-duplicate-definition",
        message: `PartDefinition ${name} is declared more than once in this source.`,
        span: definition.node.nameSpan,
      });
    }
  }
}

function recordDuplicateUsages(
  usages: readonly {
    readonly node: ArchitectureSysmlUsageNode;
    readonly parentName?: string;
  }[],
  unresolved: ArchitectureSysmlUnresolved[],
): void {
  const seen = new Set<string>();
  for (const usage of usages) {
    const key = `${usage.parentName ?? ""}\u0000${usage.node.usageName}`;
    if (seen.has(key)) {
      unresolved.push({
        kind: "sysml-duplicate-usage",
        message:
          `PartUsage ${usage.node.usageName} is declared more than once under the same parent.`,
        span: usage.node.usageNameSpan,
      });
      continue;
    }
    seen.add(key);
  }
}

async function packageSymbol(
  sourceId: string,
  node: ArchitectureSysmlPackageNode,
): Promise<SourceAnalysisSymbol> {
  return {
    id: await astStableId("symbol", sourceId, {
      kind: "package",
      name: node.packageName,
    }),
    kind: "artifact",
    name: node.packageName,
    span: node.nameSpan,
  };
}

async function definitionSymbol(
  sourceId: string,
  parentPackageName: string | undefined,
  node: ArchitectureSysmlPartDefNode,
): Promise<SourceAnalysisSymbol> {
  return {
    id: await astStableId("symbol", sourceId, {
      kind: "part-definition",
      name: node.definitionName,
      parentPackageName,
      bodyStyle: node.bodyStyle,
    }),
    kind: "component",
    name: node.definitionName,
    span: node.nameSpan,
  };
}

async function usageSymbol(
  sourceId: string,
  parentName: string | undefined,
  node: ArchitectureSysmlUsageNode,
  ordinal: number,
): Promise<SourceAnalysisSymbol> {
  return {
    id: await astStableId("symbol", sourceId, {
      kind: "part-usage",
      name: node.usageName,
      parentName,
      targetName: node.targetName,
      ordinal,
    }),
    kind: "component",
    name: node.usageName,
    span: node.usageNameSpan,
  };
}

async function typeReferenceSymbol(
  sourceId: string,
  node: ArchitectureSysmlUsageNode,
  usageSymbolId: string,
): Promise<SourceAnalysisSymbol> {
  return {
    id: await astStableId("type-reference", sourceId, {
      kind: "type-reference",
      name: node.targetName,
      usageSymbolId,
    }),
    kind: "component",
    name: node.targetName,
    span: node.targetNameSpan,
  };
}

async function structuralIncidence(
  sourceId: string,
  fromSymbolId: string,
  toSymbolId: string,
  node: ArchitectureSysmlUsageNode,
): Promise<SourceAnalysisDependency> {
  return {
    id: await astStableId("dependency", sourceId, {
      kind: "structural-incidence",
      fromSymbolId,
      toSymbolId,
    }),
    kind: "structural-incidence",
    fromSymbolId,
    toSymbolId,
    span: node.span,
  };
}

async function unresolvedConstruct(
  sourceId: string,
  candidate: ArchitectureSysmlUnresolved,
  ordinal: number,
): Promise<SourceAnalysisUnresolvedConstruct> {
  return {
    id: await astStableId("unresolved", sourceId, {
      kind: candidate.kind,
      span: candidate.span,
      ordinal,
    }),
    kind: candidate.kind,
    message: candidate.message,
    span: candidate.span,
  };
}

function rejected(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
  error: ArchitectureSysmlLexicalError | ArchitectureSysmlParseError,
): SourceAnalysisBundle {
  const lexical = error instanceof ArchitectureSysmlLexicalError;
  return validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: input.sourceId,
      role: input.role,
      language: input.language,
      fingerprint,
    },
    analyzer: {
      id: QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_ID,
      version: QUALIFIED_ARCHITECTURE_SYSML_ANALYZER_VERSION,
    },
    policy: {
      profile: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
      status: "rejected",
      findings: [{
        id: lexical ? "finding:sysml-lexical" : "finding:sysml-syntax",
        code: lexical ? "sysml-lexical-error" : "sysml-syntax-error",
        severity: "error",
        message: lexical
          ? "The architecture SysML lexical guard rejected this source."
          : "The architecture SysML closed subset could not form a recognized write form.",
        ...(error.span === undefined ? {} : { span: error.span }),
      }],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  });
}

async function astStableId(
  prefix: "symbol" | "dependency" | "unresolved" | "type-reference",
  sourceId: string,
  tuple: unknown,
): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: "architecture-sysml-ast-identity/1.0",
    sourceId,
    prefix,
    tuple,
  });
  return `${prefix}:${fingerprint.digest}`;
}

function deduplicateDependencies(
  dependencies: readonly SourceAnalysisDependency[],
): readonly SourceAnalysisDependency[] {
  const byId = new Map<string, SourceAnalysisDependency>();
  for (const item of dependencies) byId.set(item.id, item);
  return [...byId.values()];
}

async function fingerprintText(sourceText: string): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sourceText),
  );
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}
