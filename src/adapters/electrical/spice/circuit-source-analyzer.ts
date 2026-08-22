/**
 * Parser-backed frontend for the locked circuit-only SPICE closed subset v1.
 *
 * The agent supplies exact UTF-8 SPICE. This adapter hashes those bytes
 * before parse, consumes the same generic IR as a later worker would, and
 * emits source-local facts. Dependencies bind symbol ids, never labels. The
 * adapter never calls a provider and never treats an mcp-spice envelope as
 * source authority.
 *
 * Named numeric levers are `.param` literals only. Device and model-card
 * numbers stay circuit structure.
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
  type AuthorizedSpiceCircuitClosedSubsetV1Source,
  authorizeSpiceCircuitClosedSubsetV1Source,
  SPICE_CIRCUIT_CLOSED_SUBSET_V1_PROFILE_ID,
} from "../../../domain/electrical/spice/closed-subset-v1.ts";
import type { SpiceElementNode } from "../../../domain/electrical/spice/parse.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const SPICE_CIRCUIT_SOURCE_ANALYZER_ID = "spice-circuit-closed-subset" as const;
export const SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION = "1.0.0" as const;
export const SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE =
  SPICE_CIRCUIT_CLOSED_SUBSET_V1_PROFILE_ID;

export const SPICE_AST_IDENTITY_SCHEMA = "spice-ast-identity/1.0" as const;

export type SpiceAstSymbolKind =
  | "circuit"
  | "parameter"
  | "component"
  | "model"
  | "node";

export interface SpiceAstIdentity {
  readonly kind: SpiceAstSymbolKind;
  readonly name: string;
}

/** Pure, provider-free circuit-only SPICE analyzer. */
export class SpiceCircuitSourceAnalyzer implements SourceAnalysisFrontend {
  async analyze(
    input: SourceAnalysisFrontendInput,
  ): Promise<SourceAnalysisBundle> {
    if (input.role !== "spice-circuit" || input.language !== "spice") {
      throw new TypeError(
        "SpiceCircuitSourceAnalyzer only accepts spice-circuit/spice sources.",
      );
    }
    if (typeof input.sourceText !== "string") {
      throw new TypeError("Circuit-only SPICE sourceText must be a string.");
    }

    const fingerprint = await fingerprintText(input.sourceText);
    let authorized: AuthorizedSpiceCircuitClosedSubsetV1Source;
    try {
      authorized = authorizeSpiceCircuitClosedSubsetV1Source(input.sourceText);
    } catch (error) {
      if (error instanceof TypeError) {
        return rejectedByCircuitSubset(input, fingerprint);
      }
      throw error;
    }

    const artifact = await circuitSymbol(input.sourceId, authorized.circuitName);
    const parameters = await namedSymbols(
      input.sourceId,
      "parameter",
      authorized.parameters.map((node) => ({
        name: node.name,
        span: node.nameSpan,
      })),
    );
    const components = await namedSymbols(
      input.sourceId,
      "component",
      authorized.elements.map((node) => ({
        name: node.name,
        span: node.nameSpan,
      })),
    );
    const models = await namedSymbols(
      input.sourceId,
      "component",
      authorized.models.map((node) => ({
        name: node.name,
        span: node.nameSpan,
      })),
      "model",
    );
    const nodes = await namedSymbols(
      input.sourceId,
      "variable",
      authorized.nodes.map((name) => ({ name })),
    );

    const symbols: SourceAnalysisSymbol[] = [
      artifact,
      ...parameters,
      ...components,
      ...models,
      ...nodes,
    ];
    const parametersByName = new Map(
      authorized.parameters.map((node, index) => [
        foldName(node.name),
        parameters[index]!,
      ]),
    );
    const componentsByName = new Map(
      authorized.elements.map((node, index) => [
        foldName(node.name),
        components[index]!,
      ]),
    );
    const modelsByName = new Map(
      authorized.models.map((node, index) => [
        foldName(node.name),
        models[index]!,
      ]),
    );
    const nodesByName = new Map(
      authorized.nodes.map((name, index) => [foldName(name), nodes[index]!]),
    );

    const dependencies = [
      ...await structuralIncidences(input.sourceId, artifact, [
        ...parameters,
        ...components,
        ...models,
        ...nodes,
      ]),
      ...await componentNodeIncidences(
        input.sourceId,
        authorized.elements,
        componentsByName,
        nodesByName,
      ),
      ...await parameterFlows(
        input.sourceId,
        authorized.elements,
        parametersByName,
        componentsByName,
      ),
      ...await modelIncidences(
        input.sourceId,
        authorized.elements,
        componentsByName,
        modelsByName,
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
        id: SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
        version: SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
      },
      policy: {
        profile: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
        status: "passed",
        findings: [],
      },
      symbols,
      dependencies: deduplicateDependencies(dependencies),
      unresolvedConstructs: [],
    });
  }
}

export async function spiceAstSymbolId(
  sourceId: string,
  identity: SpiceAstIdentity,
): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: SPICE_AST_IDENTITY_SCHEMA,
    sourceId,
    kind: identity.kind,
    name: identity.name,
  });
  return fingerprint.digest;
}

async function circuitSymbol(
  sourceId: string,
  circuitName: string,
): Promise<SourceAnalysisSymbol> {
  return {
    id: await spiceAstSymbolId(sourceId, { kind: "circuit", name: circuitName }),
    kind: "artifact",
    name: circuitName,
  };
}

type SpannedName = {
  readonly name: string;
  readonly span?: SourceAnalysisSymbol["span"];
};

async function namedSymbols(
  sourceId: string,
  kind: "parameter" | "component" | "variable",
  nodes: readonly SpannedName[],
  identityKind: SpiceAstSymbolKind = kind === "variable" ? "node" : kind,
): Promise<SourceAnalysisSymbol[]> {
  const symbols: SourceAnalysisSymbol[] = [];
  for (const node of nodes) {
    symbols.push({
      id: await spiceAstSymbolId(sourceId, { kind: identityKind, name: node.name }),
      kind,
      name: node.name,
      ...(node.span === undefined ? {} : { span: node.span }),
    });
  }
  return symbols;
}

async function structuralIncidences(
  sourceId: string,
  artifact: SourceAnalysisSymbol,
  members: readonly SourceAnalysisSymbol[],
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

async function componentNodeIncidences(
  sourceId: string,
  elements: readonly SpiceElementNode[],
  componentsByName: ReadonlyMap<string, SourceAnalysisSymbol>,
  nodesByName: ReadonlyMap<string, SourceAnalysisSymbol>,
): Promise<SourceAnalysisDependency[]> {
  const edges: SourceAnalysisDependency[] = [];
  for (const element of elements) {
    const component = componentsByName.get(foldName(element.name));
    if (component === undefined) continue;
    for (const node of element.nodes) {
      const target = nodesByName.get(foldName(node.name));
      if (target === undefined) continue;
      edges.push(
        await dependency(
          sourceId,
          "structural-incidence",
          component.id,
          target.id,
          node.span,
        ),
      );
    }
  }
  return edges;
}

async function modelIncidences(
  sourceId: string,
  elements: readonly SpiceElementNode[],
  componentsByName: ReadonlyMap<string, SourceAnalysisSymbol>,
  modelsByName: ReadonlyMap<string, SourceAnalysisSymbol>,
): Promise<SourceAnalysisDependency[]> {
  const edges: SourceAnalysisDependency[] = [];
  for (const element of elements) {
    if (element.modelName === undefined) continue;
    const component = componentsByName.get(foldName(element.name));
    const model = modelsByName.get(foldName(element.modelName));
    if (component === undefined || model === undefined) continue;
    edges.push(
      await dependency(
        sourceId,
        "declared-dependency",
        component.id,
        model.id,
        element.modelNameSpan,
      ),
    );
  }
  return edges;
}

async function parameterFlows(
  sourceId: string,
  elements: readonly SpiceElementNode[],
  parametersByName: ReadonlyMap<string, SourceAnalysisSymbol>,
  componentsByName: ReadonlyMap<string, SourceAnalysisSymbol>,
): Promise<SourceAnalysisDependency[]> {
  const edges: SourceAnalysisDependency[] = [];
  for (const element of elements) {
    const component = componentsByName.get(foldName(element.name));
    if (component === undefined) continue;
    const refs = [
      element.value?.kind === "param-ref" ? element.value.name : undefined,
      ...element.namedValues.map((named) =>
        named.value.kind === "param-ref" ? named.value.name : undefined
      ),
    ];
    for (const name of refs) {
      if (name === undefined) continue;
      const parameter = parametersByName.get(foldName(name));
      if (parameter === undefined) continue;
      edges.push(
        await dependency(
          sourceId,
          "static-value-flow",
          parameter.id,
          component.id,
          component.span,
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
  span: SourceAnalysisDependency["span"],
): Promise<SourceAnalysisDependency> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: SPICE_AST_IDENTITY_SCHEMA,
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
    ...(span === undefined ? {} : { span }),
  };
}

function rejectedByCircuitSubset(
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
      id: SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
      version: SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
    },
    policy: {
      profile: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
      status: "rejected",
      findings: [{
        id: "finding:spice-circuit-closed-subset-v1-rejected",
        code: "spice-circuit-closed-subset-v1-rejected",
        severity: "error",
        message:
          "The source is outside the circuit-only SPICE closed-subset-v1 grammar.",
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

function foldName(name: string): string {
  return name.toLowerCase();
}
