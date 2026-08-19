/**
 * Parser-backed frontend for the locked Modelica closed subset v1.
 *
 * The agent supplies exact UTF-8 Modelica. This adapter tokenizes fail-closed,
 * parses the LinearThermalRamp kit forms, and emits source-local facts.
 * Unresolved constructs are first-class and are never omitted. Dependencies
 * bind symbol ids, never labels. The adapter never calls a provider and never
 * treats a simulation-case JSON envelope as Modelica source authority.
 *
 * Graduation: lexical errors, a missing model block, and an `end` mismatch
 * are `severity: "error"` findings and force `status: "rejected"`. Unsupported
 * but tokenizable forms stay in `unresolvedConstructs` and keep `passed` when
 * no error finding is present.
 *
 * If the subset grows beyond about fifteen forms, migrate the lexer/parser to
 * tree-sitter-modelica WASM rather than stretching the hand-written subset.
 */

import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "../../../domain/analysis/source-analysis-frontend.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  type SourceAnalysisBundle,
  type SourceAnalysisDependency,
  type SourceAnalysisFinding,
  type SourceAnalysisSymbol,
  type SourceAnalysisUnresolvedConstruct,
  validateSourceAnalysisBundle,
} from "../../../domain/analysis/source-analysis.ts";
import { ModelicaLexicalError } from "../../../domain/modelica/source/lexical.ts";
import {
  type ModelicaEquationNode,
  type ModelicaModelNode,
  type ModelicaParameterNode,
  type ModelicaParse,
  ModelicaParseError,
  type ModelicaUnresolved,
  type ModelicaVariableNode,
  parseModelicaSubset,
} from "../../../domain/modelica/source/parse.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const QUALIFIED_MODELICA_SOURCE_ANALYZER_ID =
  "modelica-qualified-mo-subset" as const;
export const QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION = "1.0.0" as const;
export const QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE =
  "modelica-closed-subset-v1" as const;

export const MODELICA_AST_IDENTITY_SCHEMA = "modelica-ast-identity/1.0" as const;

export type ModelicaAstSymbolKind = "model" | "parameter" | "variable" | "equation";

export interface ModelicaAstIdentity {
  readonly kind: ModelicaAstSymbolKind;
  readonly name?: string;
  readonly ordinal?: number;
  readonly discriminator?: "der" | "algebraic";
}

/** Pure, provider-free Modelica closed-subset analyzer. */
export class QualifiedModelicaSourceAnalyzer implements SourceAnalysisFrontend {
  async analyze(
    input: SourceAnalysisFrontendInput,
  ): Promise<SourceAnalysisBundle> {
    if (input.role !== "modelica-model" || input.language !== "modelica") {
      throw new TypeError(
        "QualifiedModelicaSourceAnalyzer only accepts modelica-model/modelica sources.",
      );
    }
    if (typeof input.sourceText !== "string") {
      throw new TypeError("Qualified Modelica sourceText must be a string.");
    }

    const fingerprint = await fingerprintText(input.sourceText);
    let parsed: ModelicaParse;
    try {
      parsed = parseModelicaSubset(input.sourceText);
    } catch (error) {
      if (
        error instanceof ModelicaLexicalError ||
        error instanceof ModelicaParseError
      ) {
        return rejected(input, fingerprint, error);
      }
      throw error;
    }

    const artifact = await modelSymbol(input.sourceId, parsed.model);
    const unresolvedCandidates = [...parsed.unresolved];
    const parameters = await namedSymbols(
      input.sourceId,
      "parameter",
      parsed.model.parameters,
      unresolvedCandidates,
    );
    const variables = await namedSymbols(
      input.sourceId,
      "variable",
      parsed.model.variables,
      unresolvedCandidates,
    );
    const equations = await Promise.all(
      parsed.model.equations.map((node) => equationSymbol(input.sourceId, node)),
    );

    const symbols: SourceAnalysisSymbol[] = [
      artifact,
      ...parameters,
      ...variables,
      ...equations,
    ];
    const parametersByName = new Map(
      parsed.model.parameters.map((node, index) => [node.name, parameters[index]!]),
    );
    const variablesByName = new Map(
      parsed.model.variables.map((node, index) => [node.name, variables[index]!]),
    );

    const dependencies = [
      ...await structuralIncidences(input.sourceId, artifact, parameters, parsed.model),
      ...await structuralIncidences(input.sourceId, artifact, variables, parsed.model),
      ...await valueFlows(
        input.sourceId,
        parsed.model,
        parametersByName,
        variablesByName,
        equations,
      ),
      ...await declaredDependencies(input.sourceId, parsed.model, parametersByName),
    ];

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
        id: QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
        version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
      },
      policy: {
        profile: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
        status: "passed",
        findings: [],
      },
      symbols,
      dependencies: deduplicateDependencies(dependencies),
      unresolvedConstructs: unresolved,
    });
  }
}

export async function modelicaAstSymbolId(
  sourceId: string,
  identity: ModelicaAstIdentity,
): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: MODELICA_AST_IDENTITY_SCHEMA,
    sourceId,
    kind: identity.kind,
    ...(identity.name === undefined ? {} : { name: identity.name }),
    ...(identity.ordinal === undefined ? {} : { ordinal: identity.ordinal }),
    ...(identity.discriminator === undefined
      ? {}
      : { discriminator: identity.discriminator }),
  });
  return fingerprint.digest;
}

async function modelSymbol(
  sourceId: string,
  node: ModelicaModelNode,
): Promise<SourceAnalysisSymbol> {
  return {
    id: await modelicaAstSymbolId(sourceId, { kind: "model", name: node.name }),
    kind: "artifact",
    name: node.name,
    span: node.nameSpan,
  };
}

async function namedSymbols(
  sourceId: string,
  kind: "parameter" | "variable",
  nodes: readonly (ModelicaParameterNode | ModelicaVariableNode)[],
  unresolved: ModelicaUnresolved[],
): Promise<SourceAnalysisSymbol[]> {
  const seen = new Map<string, number>();
  const symbols: SourceAnalysisSymbol[] = [];
  for (const node of nodes) {
    const occurrence = seen.get(node.name) ?? 0;
    seen.set(node.name, occurrence + 1);
    if (occurrence > 0) {
      unresolved.push({
        kind: "modelica-duplicate-declaration",
        message: `The ${kind} ${node.name} is declared more than once in this source.`,
        span: node.nameSpan,
      });
    }
    symbols.push({
      id: await modelicaAstSymbolId(sourceId, {
        kind,
        name: node.name,
        ...(occurrence === 0 ? {} : { ordinal: occurrence }),
      }),
      kind,
      name: node.name,
      span: node.nameSpan,
    });
  }
  return symbols;
}

async function equationSymbol(
  sourceId: string,
  node: ModelicaEquationNode,
): Promise<SourceAnalysisSymbol> {
  return {
    id: await modelicaAstSymbolId(sourceId, {
      kind: "equation",
      ordinal: node.ordinal,
      discriminator: node.discriminator,
    }),
    kind: "equation",
    name: node.discriminator === "der" ? `der(${node.lhsName})` : node.lhsName,
    span: node.span,
  };
}

async function structuralIncidences(
  sourceId: string,
  artifact: SourceAnalysisSymbol,
  members: readonly SourceAnalysisSymbol[],
  model: ModelicaModelNode,
): Promise<SourceAnalysisDependency[]> {
  return await Promise.all(
    members.map((member) =>
      dependency(
        sourceId,
        "structural-incidence",
        member.id,
        artifact.id,
        member.span ?? model.span,
      )
    ),
  );
}

async function valueFlows(
  sourceId: string,
  model: ModelicaModelNode,
  parametersByName: ReadonlyMap<string, SourceAnalysisSymbol>,
  variablesByName: ReadonlyMap<string, SourceAnalysisSymbol>,
  equations: readonly SourceAnalysisSymbol[],
): Promise<SourceAnalysisDependency[]> {
  const edges: SourceAnalysisDependency[] = [];
  for (const [index, node] of model.equations.entries()) {
    const equation = equations[index]!;
    const lhs = variablesByName.get(node.lhsName);
    if (lhs !== undefined) {
      edges.push(
        await dependency(
          sourceId,
          "static-value-flow",
          lhs.id,
          equation.id,
          node.span,
        ),
      );
    }
    for (const name of node.rhsNames) {
      const parameter = parametersByName.get(name);
      if (parameter === undefined) continue;
      edges.push(
        await dependency(
          sourceId,
          "static-value-flow",
          parameter.id,
          equation.id,
          node.span,
        ),
      );
    }
  }
  return edges;
}

async function declaredDependencies(
  sourceId: string,
  model: ModelicaModelNode,
  parametersByName: ReadonlyMap<string, SourceAnalysisSymbol>,
): Promise<SourceAnalysisDependency[]> {
  const edges: SourceAnalysisDependency[] = [];
  for (const node of model.parameters) {
    const declared = parametersByName.get(node.name);
    if (declared === undefined) continue;
    const referencedNames = [
      ...(node.defaultReferencedName === undefined ? [] : [node.defaultReferencedName]),
      ...node.attributes.flatMap((attribute) =>
        attribute.referencedName === undefined ? [] : [attribute.referencedName]
      ),
    ];
    for (const name of referencedNames) {
      const referenced = parametersByName.get(name);
      if (referenced === undefined || referenced.id === declared.id) continue;
      edges.push(
        await dependency(
          sourceId,
          "declared-dependency",
          referenced.id,
          declared.id,
          node.span,
        ),
      );
    }
  }
  return edges;
}

async function dependency(
  sourceId: string,
  kind: SourceAnalysisDependency["kind"],
  fromSymbolId: string,
  toSymbolId: string,
  span: SourceAnalysisSpanLike,
): Promise<SourceAnalysisDependency> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: MODELICA_AST_IDENTITY_SCHEMA,
    sourceId,
    kind,
    fromSymbolId,
    toSymbolId,
  });
  return {
    id: `dependency:${fingerprint.digest}`,
    kind,
    fromSymbolId,
    toSymbolId,
    span,
  };
}

async function unresolvedConstruct(
  sourceId: string,
  candidate: ModelicaUnresolved,
  ordinal: number,
): Promise<SourceAnalysisUnresolvedConstruct> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: MODELICA_AST_IDENTITY_SCHEMA,
    sourceId,
    prefix: "unresolved",
    kind: candidate.kind,
    ordinal,
  });
  return {
    id: `unresolved:${fingerprint.digest}`,
    kind: candidate.kind,
    message: candidate.message,
    span: candidate.span,
  };
}

function rejected(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
  error: ModelicaLexicalError | ModelicaParseError,
): SourceAnalysisBundle {
  return validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: input.sourceId,
      role: input.role,
      language: input.language,
      fingerprint,
    },
    analyzer: {
      id: QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
      version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
    },
    policy: {
      profile: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
      status: "rejected",
      findings: [findingFor(error)],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  });
}

function findingFor(
  error: ModelicaLexicalError | ModelicaParseError,
): SourceAnalysisFinding {
  if (error instanceof ModelicaLexicalError) {
    return {
      id: "finding:modelica-lexical-error",
      code: "modelica-lexical-error",
      severity: "error",
      message: "The Modelica lexical guard rejected this source.",
      ...(error.span === undefined ? {} : { span: error.span }),
    };
  }
  if (error.code === "end_mismatch" || error.code === "unclosed_block") {
    return {
      id: "finding:modelica-end-mismatch",
      code: "modelica-end-mismatch",
      severity: "error",
      message: "The Modelica model end name does not match the opening model name.",
      ...(error.span === undefined ? {} : { span: error.span }),
    };
  }
  return {
    id: "finding:modelica-missing-model-block",
    code: "modelica-missing-model-block",
    severity: "error",
    message: "The Modelica closed subset requires exactly one root model block.",
    ...(error.span === undefined ? {} : { span: error.span }),
  };
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

type SourceAnalysisSpanLike = SourceAnalysisDependency["span"];
