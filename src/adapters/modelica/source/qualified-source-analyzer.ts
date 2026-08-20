/**
 * Parser-backed frontend for the locked Modelica closed subset v2.
 *
 * The agent supplies exact UTF-8 Modelica. This adapter consumes the same
 * generic executable IR as the admitted worker, then emits source-local facts.
 * Dependencies bind symbol ids, never labels. The adapter never calls a
 * provider and never treats a simulation-case JSON envelope as Modelica source
 * authority.
 *
 * The shared v2 authorizer is the only parser. Any source that the worker would
 * refuse is therefore `rejected`, never a `passed` bundle that fails only after
 * MRTR.
 *
 * If the subset grows beyond about fifteen forms, migrate the lexer/parser to
 * tree-sitter-modelica WASM rather than stretching the hand-written subset.
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
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  type AuthorizedModelicaClosedSubsetV2Source,
  authorizeModelicaClosedSubsetV2Source,
  MODELICA_CLOSED_SUBSET_V2_PROFILE_ID,
} from "../../../domain/modelica/source/closed-subset-v2.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const QUALIFIED_MODELICA_SOURCE_ANALYZER_ID =
  "modelica-qualified-mo-subset" as const;
export const QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION = "2.0.0" as const;
export const QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE =
  MODELICA_CLOSED_SUBSET_V2_PROFILE_ID;

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
    let authorized: AuthorizedModelicaClosedSubsetV2Source;
    try {
      authorized = authorizeModelicaClosedSubsetV2Source(input.sourceText);
    } catch (error) {
      if (error instanceof TypeError) {
        return rejectedByExecutableSubset(input, fingerprint);
      }
      throw error;
    }
    const artifact = await modelSymbol(input.sourceId, authorized.modelName);
    const parameters = await namedSymbols(
      input.sourceId,
      "parameter",
      authorized.parameters,
    );
    const variables = await namedSymbols(
      input.sourceId,
      "variable",
      authorized.outputs,
    );
    const equations = await Promise.all(
      authorized.equations.map((node) => equationSymbol(input.sourceId, node)),
    );

    const symbols: SourceAnalysisSymbol[] = [
      artifact,
      ...parameters,
      ...variables,
      ...equations,
    ];
    const parametersByName = new Map(
      authorized.parameters.map((node, index) => [node.name, parameters[index]!]),
    );
    const variablesByName = new Map(
      authorized.outputs.map((node, index) => [node.name, variables[index]!]),
    );

    const dependencies = [
      ...await structuralIncidences(input.sourceId, artifact, parameters),
      ...await structuralIncidences(input.sourceId, artifact, variables),
      ...await valueFlows(
        input.sourceId,
        authorized.equations,
        parametersByName,
        variablesByName,
        equations,
      ),
    ];

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
      unresolvedConstructs: [],
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
  modelName: string,
): Promise<SourceAnalysisSymbol> {
  return {
    id: await modelicaAstSymbolId(sourceId, { kind: "model", name: modelName }),
    kind: "artifact",
    name: modelName,
  };
}

type AuthorizedParameterNode =
  AuthorizedModelicaClosedSubsetV2Source["parameters"][number];
type AuthorizedOutputNode = AuthorizedModelicaClosedSubsetV2Source["outputs"][number];
type AuthorizedEquationNode =
  AuthorizedModelicaClosedSubsetV2Source["equations"][number];
type SpannedSourceAnalysisSymbol = SourceAnalysisSymbol & {
  readonly span: NonNullable<SourceAnalysisSymbol["span"]>;
};

async function namedSymbols(
  sourceId: string,
  kind: "parameter" | "variable",
  nodes: readonly (AuthorizedParameterNode | AuthorizedOutputNode)[],
): Promise<SpannedSourceAnalysisSymbol[]> {
  const symbols: SpannedSourceAnalysisSymbol[] = [];
  for (const node of nodes) {
    symbols.push({
      id: await modelicaAstSymbolId(sourceId, {
        kind,
        name: node.name,
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
  node: AuthorizedEquationNode,
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
  members: readonly SpannedSourceAnalysisSymbol[],
): Promise<SourceAnalysisDependency[]> {
  return await Promise.all(
    members.map((member) =>
      dependency(
        sourceId,
        "structural-incidence",
        member.id,
        artifact.id,
        member.span,
      )
    ),
  );
}

async function valueFlows(
  sourceId: string,
  nodes: readonly AuthorizedEquationNode[],
  parametersByName: ReadonlyMap<string, SourceAnalysisSymbol>,
  variablesByName: ReadonlyMap<string, SourceAnalysisSymbol>,
  equations: readonly SourceAnalysisSymbol[],
): Promise<SourceAnalysisDependency[]> {
  const edges: SourceAnalysisDependency[] = [];
  for (const [index, node] of nodes.entries()) {
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
      const source = parametersByName.get(name) ?? variablesByName.get(name);
      if (source === undefined) continue;
      edges.push(
        await dependency(
          sourceId,
          "static-value-flow",
          source.id,
          equation.id,
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

function rejectedByExecutableSubset(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
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
      findings: [{
        id: "finding:modelica-closed-subset-v2-rejected",
        code: "modelica-closed-subset-v2-rejected",
        severity: "error",
        message:
          "The source is outside the executable Modelica closed-subset-v2 grammar.",
      }],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  });
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
