/**
 * Canonical provider-neutral index over validated engineering assertions.
 *
 * The graph deliberately does not introduce a second relation language.
 * Epistemic status, exact evidence, validity scope, and the full local
 * finite-difference measurement remain owned by engineering-assertion/1.0.
 * This contract only supplies stable graph nodes and assertion-to-node links.
 * Graphology is a later read/navigation projection, never this graph's source
 * of truth or an authority boundary.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { sha256Fingerprint } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import {
  type EngineeringAssertion,
  type SemanticRef,
  validateEngineeringAssertion,
} from "./engineering-assertion.ts";

export const ANALYSIS_GRAPH_SCHEMA = "analysis-graph/1.0" as const;

/**
 * A graph node reuses the semantic reference taxonomy rather than owning a
 * closed, second vocabulary.  It remains a safe identifier and must exactly
 * equal `semanticRef.kind`; a new source construct therefore needs no global
 * IR change but cannot be relabelled at the graph boundary.
 */
export type AnalysisGraphNodeKind = string;

/**
 * One provider-neutral semantic occurrence. `semanticRef` identifies a concept
 * in a representation; a graph node does not contain parser, provider, or UI
 * data. Nodes with the same semantic ref must not be duplicated.
 */
export interface AnalysisGraphNode {
  readonly id: string;
  readonly kind: AnalysisGraphNodeKind;
  readonly semanticRef: SemanticRef;
}

/**
 * An exact validated assertion embedded by value in the canonical graph.
 *
 * The assertion itself carries one of the qualified relations, its declared /
 * inferred / observed epistemic basis, exact evidence references, scope and,
 * for measured-local-sensitivity, base, step, responses and derivative.
 */
export interface AnalysisGraphRelation {
  readonly assertion: EngineeringAssertion;
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

/**
 * Immutable causal graph. Its fingerprint is a deterministic content identity:
 * node order, relation order, and assertion evidence order cannot affect it.
 */
export interface AnalysisGraph {
  readonly schemaVersion: typeof ANALYSIS_GRAPH_SCHEMA;
  readonly nodes: readonly AnalysisGraphNode[];
  readonly relations: readonly AnalysisGraphRelation[];
}

/**
 * Validate and deeply freeze a canonical analysis graph.
 *
 * The graph is a pure index: all relation semantics are revalidated through
 * `validateEngineeringAssertion`, then checked against exact endpoint semantic
 * refs. It records facts only and grants neither an admission nor execution
 * authority.
 */
export function validateAnalysisGraph(value: unknown): AnalysisGraph {
  const root = exactRecord(value, ["schemaVersion", "nodes", "relations"], "$graph");
  literalValue(root.schemaVersion, ANALYSIS_GRAPH_SCHEMA, "$graph.schemaVersion");

  const nodes = arrayOf(root.nodes, "$graph.nodes")
    .map((item, index) => parseNode(item, `$graph.nodes[${index}]`))
    .sort(compareNodes);
  if (nodes.length === 0) throw new TypeError("$graph.nodes must not be empty.");
  rejectDuplicates(nodes.map((node) => node.id), "$graph.nodes ids");
  rejectDuplicates(
    nodes.map((node) => semanticRefKey(node.semanticRef)),
    "$graph.nodes semantic refs",
  );

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const relations = arrayOf(root.relations, "$graph.relations")
    .map((item, index) => parseRelation(item, `$graph.relations[${index}]`, nodeById))
    .sort(compareRelations);
  if (relations.length === 0) {
    throw new TypeError("$graph.relations must not be empty.");
  }
  rejectDuplicates(
    relations.map((relation) => relation.assertion.id),
    "$graph.relations assertion ids",
  );
  const referencedNodeIds = new Set(
    relations.flatMap((relation) => [relation.fromNodeId, relation.toNodeId]),
  );
  for (const node of nodes) {
    if (!referencedNodeIds.has(node.id)) {
      throw new TypeError(
        `$graph.nodes.${node.id} must be referenced by at least one assertion.`,
      );
    }
  }

  return deepFreeze({
    schemaVersion: ANALYSIS_GRAPH_SCHEMA,
    nodes,
    relations,
  });
}

/** Hash the validated canonical graph; input permutations cannot change its identity. */
export async function fingerprintAnalysisGraph(
  value: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(validateAnalysisGraph(value));
}

function parseNode(value: unknown, path: string): AnalysisGraphNode {
  const input = exactRecord(value, ["id", "kind", "semanticRef"], path);
  const kind = safeId(input.kind, `${path}.kind`);
  const semanticRef = parseSemanticRef(input.semanticRef, `${path}.semanticRef`);
  if (semanticRef.kind !== kind) {
    throw new TypeError(`${path}.semanticRef.kind must equal ${path}.kind.`);
  }
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    kind,
    semanticRef,
  });
}

function parseRelation(
  value: unknown,
  path: string,
  nodeById: ReadonlyMap<string, AnalysisGraphNode>,
): AnalysisGraphRelation {
  const input = exactRecord(value, ["assertion", "fromNodeId", "toNodeId"], path);
  const fromNodeId = safeId(input.fromNodeId, `${path}.fromNodeId`);
  const toNodeId = safeId(input.toNodeId, `${path}.toNodeId`);
  if (fromNodeId === toNodeId) {
    throw new TypeError(`${path}.fromNodeId and ${path}.toNodeId must be distinct.`);
  }
  const from = nodeById.get(fromNodeId);
  const to = nodeById.get(toNodeId);
  if (from === undefined) {
    throw new TypeError(`${path}.fromNodeId must name a node in $graph.nodes.`);
  }
  if (to === undefined) {
    throw new TypeError(`${path}.toNodeId must name a node in $graph.nodes.`);
  }
  const assertion = validateEngineeringAssertion(input.assertion);
  if (!sameSemanticRef(from.semanticRef, assertion.from)) {
    throw new TypeError(`${path}.fromNodeId must exactly match assertion.from.`);
  }
  if (!sameSemanticRef(to.semanticRef, assertion.to)) {
    throw new TypeError(`${path}.toNodeId must exactly match assertion.to.`);
  }
  return deepFreeze({ assertion, fromNodeId, toNodeId });
}

/**
 * SemanticRef is intentionally parsed with the same exact shape as
 * engineering-assertion/1.0. This is graph-node identity, not a second relation
 * or evidence dialect; relation facts are always delegated to the assertion.
 */
function parseSemanticRef(value: unknown, path: string): SemanticRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const candidate = value as Record<string, unknown>;
  const input = exactRecord(
    candidate,
    Object.hasOwn(candidate, "basisFingerprint")
      ? ["domain", "kind", "id", "basisFingerprint"]
      : ["domain", "kind", "id"],
    path,
  );
  const domain = enumeration(
    input.domain,
    ["brief", "sysml", "cad", "modelica", "calculix", "thread"] as const,
    `${path}.domain`,
  );
  const result = {
    domain,
    kind: safeId(input.kind, `${path}.kind`),
    id: safeId(input.id, `${path}.id`),
    ...(Object.hasOwn(input, "basisFingerprint")
      ? {
        basisFingerprint: parseFingerprint(
          input.basisFingerprint,
          `${path}.basisFingerprint`,
        ),
      }
      : {}),
  };
  return deepFreeze(result);
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: input.digest });
}

function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function sameSemanticRef(left: SemanticRef, right: SemanticRef): boolean {
  return semanticRefKey(left) === semanticRefKey(right);
}

function semanticRefKey(value: SemanticRef): string {
  return [
    value.domain,
    value.kind,
    value.id,
    value.basisFingerprint?.algorithm ?? "",
    value.basisFingerprint?.digest ?? "",
  ].join("\u0000");
}

function compareNodes(left: AnalysisGraphNode, right: AnalysisGraphNode): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareRelations(
  left: AnalysisGraphRelation,
  right: AnalysisGraphRelation,
): number {
  return left.assertion.id < right.assertion.id
    ? -1
    : left.assertion.id > right.assertion.id
    ? 1
    : 0;
}
