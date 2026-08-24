/**
 * Closed, provider-free declaration of reviewed cross-domain impact.
 *
 * This document names causal concepts, immutable Thread changes, exact source
 * anchors, branch inputs and human independence assertions. It deliberately
 * contains no equation, engineering value, unit, provider, operation or tool.
 * Validation only proves closed shape and internal joins; it does not approve
 * a change, execute a method, or establish a product verdict.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { fingerprintsEqual, sha256Fingerprint } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { EngineeringGateClaimRole } from "../project/engineering-project.ts";
import type { ThreadChangeKind } from "../thread/thread-snapshot.ts";

export const CROSS_DOMAIN_IMPACT_MANIFEST_SCHEMA =
  "cross-domain-impact-manifest/2.0" as const;

/**
 * Document-defined causal concept identifier. Validated as a `safeId` from the
 * manifest and source anchors; not a code catalog and not free prose.
 * Distinct from the closed Thread mutation verbs on `threadChange.kind`.
 */
export type CrossDomainImpactChangeKind = string;

/** Parse one causal change kind from manifest, seal-proposal, or evaluation data. */
export function parseCrossDomainImpactChangeKind(
  value: unknown,
  path: string,
): CrossDomainImpactChangeKind {
  return safeId(value, path);
}

/** Existing Thread mutation vocabulary, retained as immutable anchor lineage. */
export const CROSS_DOMAIN_IMPACT_THREAD_CHANGE_KINDS = [
  "created",
  "modified",
  "deleted",
  "archived",
] as const satisfies readonly ThreadChangeKind[];

export type CrossDomainImpactThreadChangeKind =
  (typeof CROSS_DOMAIN_IMPACT_THREAD_CHANGE_KINDS)[number];

/**
 * Manifest-local branch identifier. Validated as a `safeId` from the declared
 * branch list; not a global catalogue and not free prose.
 * The exact id `mechanical` is the only branch that may carry an independence
 * assertion or X11 preservation semantics.
 */
export type CrossDomainImpactBranchId = string;

const MECHANICAL_BRANCH_ID = "mechanical";

/** Parse one manifest-local branch id. */
export function parseCrossDomainImpactBranchId(
  value: unknown,
  path: string,
): CrossDomainImpactBranchId {
  return safeId(value, path);
}

/** Lexicographic order for a declared branch vocabulary. */
export function crossDomainImpactBranchOrder(
  left: CrossDomainImpactBranchId,
  right: CrossDomainImpactBranchId,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Exact set equality in both directions. Extra or missing branch ids fail
 * closed at capture boundaries.
 */
export function requireExactDeclaredBranchSet(
  ids: readonly CrossDomainImpactBranchId[],
  declared: readonly CrossDomainImpactBranchId[],
  path: string,
): void {
  const actual = [...ids].sort(crossDomainImpactBranchOrder);
  const expected = [...declared].sort(crossDomainImpactBranchOrder);
  if (
    actual.length !== expected.length ||
    actual.some((id, index) => id !== expected[index])
  ) {
    throw new TypeError(
      `${path} must declare exactly the sealed manifest branch set.`,
    );
  }
}

export interface CrossDomainImpactReference {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export interface CrossDomainImpactProjectIdentity extends CrossDomainImpactReference {}

export interface CrossDomainImpactSubjectIdentity extends CrossDomainImpactReference {}

export interface CrossDomainImpactThreadBasis {
  readonly projectId: string;
  readonly subjectId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly fingerprint: ContentFingerprint;
}

export type CrossDomainImpactAnchorSourceKind =
  | "artifact"
  | "requirement"
  | "sysml-element";

export interface CrossDomainImpactSourceAnchor {
  readonly id: string;
  readonly changeKind: CrossDomainImpactChangeKind;
  readonly role: "reviewed-change-source";
  readonly threadChange: {
    readonly id: string;
    readonly kind: CrossDomainImpactThreadChangeKind;
    readonly fingerprint: ContentFingerprint;
  };
  readonly source: {
    readonly kind: CrossDomainImpactAnchorSourceKind;
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
}

export interface CrossDomainImpactBranchInput extends CrossDomainImpactReference {}

/**
 * Method and join references are evidence identities only. They are not
 * operations, providers, tool names or executable envelopes.
 */
export interface CrossDomainImpactBranch {
  readonly id: CrossDomainImpactBranchId;
  readonly version: "1.0";
  readonly inputs: readonly CrossDomainImpactBranchInput[];
  readonly method: CrossDomainImpactReference;
  readonly joins: readonly CrossDomainImpactReference[];
}

export interface CrossDomainImpactCausalEdge {
  readonly id: string;
  readonly fromAnchorId: string;
  readonly to: {
    readonly branchId: CrossDomainImpactBranchId;
    readonly inputId: string;
    readonly inputFingerprint: ContentFingerprint;
  };
  /** An edge is positive by construction; the schema has no negative edge. */
  readonly relation: "positive-input";
  readonly assertion: {
    readonly source: CrossDomainImpactReference;
    readonly justification: string;
  };
  readonly scope: string;
  readonly evidence: readonly CrossDomainImpactReference[];
}

export interface CrossDomainImpactInspectedSourceAnchor {
  readonly sourceAnchorId: string;
  readonly threadChangeFingerprint: ContentFingerprint;
  readonly sourceFingerprint: ContentFingerprint;
}

export interface CrossDomainImpactInspectedConsumption {
  readonly id: string;
  readonly input: CrossDomainImpactReference;
}

/**
 * A human assertion is the only declaration which may support a later
 * carried-forward mechanical gate claim. It is still only a declaration until
 * a pure evaluation recrosses it against exact current evidence and inputs.
 */
export interface CrossDomainImpactIndependenceAssertion {
  readonly id: string;
  readonly branchId: CrossDomainImpactBranchId;
  readonly assertion: "independent";
  readonly author: {
    readonly kind: "human";
    readonly id: string;
  };
  readonly source: CrossDomainImpactReference;
  readonly justification: string;
  readonly inspectedSourceAnchors: readonly CrossDomainImpactInspectedSourceAnchor[];
  readonly evidence: CrossDomainImpactReference;
  readonly inspectedConsumptions: readonly CrossDomainImpactInspectedConsumption[];
  readonly review: {
    readonly trigger: CrossDomainImpactReference;
    readonly reviewedAt: string;
    readonly expiresAt: string;
  };
}

export interface CrossDomainImpactGateMap {
  readonly gateItemId: string;
  readonly branchId: CrossDomainImpactBranchId;
  readonly role: EngineeringGateClaimRole;
}

export interface CrossDomainImpactManifestBody {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_MANIFEST_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly project: CrossDomainImpactProjectIdentity;
  readonly subject: CrossDomainImpactSubjectIdentity;
  readonly basis: CrossDomainImpactThreadBasis;
  readonly changeKinds: readonly CrossDomainImpactChangeKind[];
  readonly sourceAnchors: readonly CrossDomainImpactSourceAnchor[];
  readonly branches: readonly CrossDomainImpactBranch[];
  readonly causalEdges: readonly CrossDomainImpactCausalEdge[];
  readonly independenceAssertions: readonly CrossDomainImpactIndependenceAssertion[];
  readonly gateMap: readonly CrossDomainImpactGateMap[];
  readonly limitations: readonly string[];
}

export interface CrossDomainImpactManifest extends CrossDomainImpactManifestBody {
  /** SHA-256 of the canonical body, excluding this field. */
  readonly fingerprint: ContentFingerprint;
}

export const CROSS_DOMAIN_IMPACT_MANIFEST_BODY_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "project",
  "subject",
  "basis",
  "changeKinds",
  "sourceAnchors",
  "branches",
  "causalEdges",
  "independenceAssertions",
  "gateMap",
  "limitations",
] as const;
const ROOT_KEYS = [...CROSS_DOMAIN_IMPACT_MANIFEST_BODY_KEYS, "fingerprint"] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ANCHOR_SOURCE_KINDS = ["artifact", "requirement", "sysml-element"] as const;
const GATE_ROLES = ["contributes-to", "satisfies"] as const;

/**
 * Canonicalize a body before hashing or sealing it. Arrays whose order has no
 * semantics are sorted by their stable identity, so equivalent manifests have
 * one body fingerprint.
 */
export function canonicalizeCrossDomainImpactManifestBody(
  value: unknown,
): CrossDomainImpactManifestBody {
  const root = exactRecord(value, CROSS_DOMAIN_IMPACT_MANIFEST_BODY_KEYS, "$manifest");
  return parseBody(root);
}

/** Build a canonical manifest and compute its body fingerprint. */
export async function createCrossDomainImpactManifest(
  bodyValue: unknown,
): Promise<CrossDomainImpactManifest> {
  const body = canonicalizeCrossDomainImpactManifestBody(bodyValue);
  return deepFreeze({
    ...body,
    fingerprint: await sha256Fingerprint(body),
  });
}

/** Recompute the fingerprint of a canonical body, excluding a manifest fingerprint. */
export async function fingerprintCrossDomainImpactManifestBody(
  bodyValue: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(
    canonicalizeCrossDomainImpactManifestBody(bodyValue),
  );
}

/**
 * Validate an untrusted, sealed manifest and recompute its canonical body
 * fingerprint. A digest from a differently ordered or altered body is refused.
 */
export async function validateCrossDomainImpactManifest(
  value: unknown,
): Promise<CrossDomainImpactManifest> {
  const root = exactRecord(value, ROOT_KEYS, "$manifest");
  const body = parseBody(root);
  const fingerprint = parseFingerprint(root.fingerprint, "$manifest.fingerprint");
  const recomputed = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, recomputed)) {
    throw new TypeError(
      "$manifest.fingerprint must equal the SHA-256 of the canonical manifest body.",
    );
  }
  return deepFreeze({ ...body, fingerprint: recomputed });
}

function parseBody(root: Record<string, unknown>): CrossDomainImpactManifestBody {
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_MANIFEST_SCHEMA,
    "$manifest.schemaVersion",
  );
  const project = parseProject(root.project, "$manifest.project");
  const subject = parseSubject(root.subject, "$manifest.subject");
  const basis = parseBasis(root.basis, "$manifest.basis");
  if (basis.projectId !== project.id || basis.subjectId !== subject.id) {
    throw new TypeError(
      "$manifest.basis projectId and subjectId must exactly match $manifest.project and $manifest.subject.",
    );
  }

  const changeKinds = nonEmptyArray(root.changeKinds, "$manifest.changeKinds").map(
    (item, index) => parseChangeKind(item, `$manifest.changeKinds[${index}]`),
  );
  rejectDuplicates(changeKinds, "$manifest.changeKinds");
  const orderedChangeKinds = [...changeKinds].sort(changeKindOrder);

  const sourceAnchors = nonEmptyArray(
    root.sourceAnchors,
    "$manifest.sourceAnchors",
  ).map((item, index) => parseSourceAnchor(item, `$manifest.sourceAnchors[${index}]`));
  rejectDuplicates(sourceAnchors.map((item) => item.id), "$manifest.sourceAnchors ids");
  rejectDuplicates(
    sourceAnchors.map((item) =>
      `${item.threadChange.id}:${item.source.kind}:${item.source.id}`
    ),
    "$manifest.sourceAnchors Thread/source identities",
  );
  for (const anchor of sourceAnchors) {
    if (!orderedChangeKinds.includes(anchor.changeKind)) {
      throw new TypeError(
        `$manifest.sourceAnchors ${
          JSON.stringify(anchor.id)
        } uses a semantic changeKind absent from $manifest.changeKinds.`,
      );
    }
  }
  for (const changeKind of orderedChangeKinds) {
    if (!sourceAnchors.some((anchor) => anchor.changeKind === changeKind)) {
      throw new TypeError(
        `$manifest.changeKinds includes ${
          JSON.stringify(changeKind)
        } without an exact sourceAnchor.`,
      );
    }
  }
  const anchorsById = new Map(sourceAnchors.map((item) => [item.id, item]));

  const branches = nonEmptyArray(root.branches, "$manifest.branches").map(
    (item, index) => parseBranch(item, `$manifest.branches[${index}]`),
  );
  rejectDuplicates(branches.map((item) => item.id), "$manifest.branches ids");
  const declaredBranchIds = branches.map((item) => item.id);
  const branchesById = new Map(branches.map((item) => [item.id, item]));

  const causalEdges = arrayOf(root.causalEdges, "$manifest.causalEdges").map(
    (item, index) => parseCausalEdge(item, `$manifest.causalEdges[${index}]`),
  );
  rejectDuplicates(causalEdges.map((item) => item.id), "$manifest.causalEdges ids");
  rejectDuplicates(
    causalEdges.map((item) =>
      `${item.fromAnchorId}:${item.to.branchId}:${item.to.inputId}`
    ),
    "$manifest.causalEdges targets",
  );
  for (const edge of causalEdges) {
    if (!anchorsById.has(edge.fromAnchorId)) {
      throw new TypeError(
        `$manifest.causalEdges ${
          JSON.stringify(edge.id)
        } names an unknown sourceAnchor.`,
      );
    }
    const branch = branchesById.get(edge.to.branchId);
    const input = branch?.inputs.find((item) => item.id === edge.to.inputId);
    if (!input || !fingerprintsEqual(input.fingerprint, edge.to.inputFingerprint)) {
      throw new TypeError(
        `$manifest.causalEdges ${
          JSON.stringify(edge.id)
        } must target an exact declared branch input fingerprint.`,
      );
    }
    if (!edge.evidence.some((item) => sameReference(item, edge.assertion.source))) {
      throw new TypeError(
        `$manifest.causalEdges ${
          JSON.stringify(edge.id)
        } assertion source must be one of its exact evidence references.`,
      );
    }
  }

  const independenceAssertions = arrayOf(
    root.independenceAssertions,
    "$manifest.independenceAssertions",
  ).map((item, index) =>
    parseIndependenceAssertion(item, `$manifest.independenceAssertions[${index}]`)
  );
  rejectDuplicates(
    independenceAssertions.map((item) => item.id),
    "$manifest.independenceAssertions ids",
  );
  for (const assertion of independenceAssertions) {
    if (assertion.branchId !== MECHANICAL_BRANCH_ID) {
      throw new TypeError(
        `$manifest.independenceAssertions ${
          JSON.stringify(assertion.id)
        } is legal only for the mechanical branch.`,
      );
    }
    if (!branchesById.has(assertion.branchId)) {
      throw new TypeError(
        `$manifest.independenceAssertions ${
          JSON.stringify(assertion.id)
        } names an unknown branch.`,
      );
    }
    for (const inspected of assertion.inspectedSourceAnchors) {
      const anchor = anchorsById.get(inspected.sourceAnchorId);
      if (
        !anchor ||
        !fingerprintsEqual(
          inspected.threadChangeFingerprint,
          anchor.threadChange.fingerprint,
        ) ||
        !fingerprintsEqual(inspected.sourceFingerprint, anchor.source.fingerprint)
      ) {
        throw new TypeError(
          `$manifest.independenceAssertions ${
            JSON.stringify(assertion.id)
          } must inspect exact sourceAnchor fingerprints.`,
        );
      }
    }
  }

  const gateMap = nonEmptyArray(root.gateMap, "$manifest.gateMap").map(
    (item, index) => parseGateMap(item, `$manifest.gateMap[${index}]`),
  );
  rejectDuplicates(
    gateMap.map((item) => item.gateItemId),
    "$manifest.gateMap gateItemIds",
  );
  for (const gate of gateMap) {
    if (!branchesById.has(gate.branchId)) {
      throw new TypeError(
        `$manifest.gateMap ${JSON.stringify(gate.gateItemId)} names an unknown branch.`,
      );
    }
  }
  for (const branch of branches) {
    if (!gateMap.some((item) => item.branchId === branch.id)) {
      throw new TypeError(
        `$manifest.branches ${
          JSON.stringify(branch.id)
        } must have at least one canonical gateMap entry.`,
      );
    }
  }
  requireExactDeclaredBranchSet(
    [...new Set(gateMap.map((item) => item.branchId))],
    declaredBranchIds,
    "$manifest.gateMap",
  );

  const limitations = nonEmptyArray(root.limitations, "$manifest.limitations").map(
    (item, index) => nonEmptyText(item, `$manifest.limitations[${index}]`),
  );
  rejectDuplicates(limitations, "$manifest.limitations");

  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SCHEMA,
    id: safeId(root.id, "$manifest.id"),
    revision: positiveInteger(root.revision, "$manifest.revision"),
    project,
    subject,
    basis,
    changeKinds: orderedChangeKinds,
    sourceAnchors: [...sourceAnchors].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    branches: [...branches].sort((left, right) =>
      crossDomainImpactBranchOrder(left.id, right.id)
    ),
    causalEdges: [...causalEdges].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    independenceAssertions: [...independenceAssertions].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    gateMap: [...gateMap].sort((left, right) =>
      gateMapKey(left).localeCompare(gateMapKey(right))
    ),
    limitations: [...limitations].sort((left, right) => left.localeCompare(right)),
  });
}

function parseProject(value: unknown, path: string): CrossDomainImpactProjectIdentity {
  const input = exactRecord(value, ["id", "fingerprint"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseSubject(value: unknown, path: string): CrossDomainImpactSubjectIdentity {
  const input = exactRecord(value, ["id", "fingerprint"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseBasis(value: unknown, path: string): CrossDomainImpactThreadBasis {
  const input = exactRecord(
    value,
    ["projectId", "subjectId", "snapshotId", "revision", "fingerprint"],
    path,
  );
  return {
    projectId: safeId(input.projectId, `${path}.projectId`),
    subjectId: safeId(input.subjectId, `${path}.subjectId`),
    snapshotId: safeId(input.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(input.revision, `${path}.revision`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseSourceAnchor(
  value: unknown,
  path: string,
): CrossDomainImpactSourceAnchor {
  const input = exactRecord(
    value,
    ["id", "changeKind", "role", "threadChange", "source"],
    path,
  );
  literalValue(input.role, "reviewed-change-source", `${path}.role`);
  const threadChange = exactRecord(
    input.threadChange,
    ["id", "kind", "fingerprint"],
    `${path}.threadChange`,
  );
  const threadChangeKind = nonEmptyText(
    threadChange.kind,
    `${path}.threadChange.kind`,
  );
  if (
    !CROSS_DOMAIN_IMPACT_THREAD_CHANGE_KINDS.includes(
      threadChangeKind as CrossDomainImpactThreadChangeKind,
    )
  ) {
    throw new TypeError(
      `${path}.threadChange.kind must use the existing Thread change vocabulary.`,
    );
  }
  const source = exactRecord(
    input.source,
    ["kind", "id", "fingerprint"],
    `${path}.source`,
  );
  const sourceKind = nonEmptyText(source.kind, `${path}.source.kind`);
  if (!ANCHOR_SOURCE_KINDS.includes(sourceKind as CrossDomainImpactAnchorSourceKind)) {
    throw new TypeError(
      `${path}.source.kind must be artifact, requirement or sysml-element.`,
    );
  }
  return {
    id: safeId(input.id, `${path}.id`),
    changeKind: parseChangeKind(input.changeKind, `${path}.changeKind`),
    role: "reviewed-change-source",
    threadChange: {
      id: safeId(threadChange.id, `${path}.threadChange.id`),
      kind: threadChangeKind as CrossDomainImpactThreadChangeKind,
      fingerprint: parseFingerprint(
        threadChange.fingerprint,
        `${path}.threadChange.fingerprint`,
      ),
    },
    source: {
      kind: sourceKind as CrossDomainImpactAnchorSourceKind,
      id: safeId(source.id, `${path}.source.id`),
      fingerprint: parseFingerprint(source.fingerprint, `${path}.source.fingerprint`),
    },
  };
}

function parseBranch(value: unknown, path: string): CrossDomainImpactBranch {
  const input = exactRecord(
    value,
    ["id", "version", "inputs", "method", "joins"],
    path,
  );
  const id = parseBranchId(input.id, `${path}.id`);
  literalValue(input.version, "1.0", `${path}.version`);
  const inputs = nonEmptyArray(input.inputs, `${path}.inputs`).map((item, index) =>
    parseReference(item, `${path}.inputs[${index}]`)
  );
  rejectDuplicates(inputs.map((item) => item.id), `${path}.inputs ids`);
  const joins = nonEmptyArray(input.joins, `${path}.joins`).map((item, index) =>
    parseReference(item, `${path}.joins[${index}]`)
  );
  rejectDuplicates(joins.map(referenceKey), `${path}.joins`);
  return {
    id,
    version: "1.0",
    inputs: [...inputs].sort((left, right) => left.id.localeCompare(right.id)),
    method: parseReference(input.method, `${path}.method`),
    joins: [...joins].sort((left, right) =>
      referenceKey(left).localeCompare(referenceKey(right))
    ),
  };
}

function parseCausalEdge(value: unknown, path: string): CrossDomainImpactCausalEdge {
  const input = exactRecord(
    value,
    ["id", "fromAnchorId", "to", "relation", "assertion", "scope", "evidence"],
    path,
  );
  literalValue(input.relation, "positive-input", `${path}.relation`);
  const target = exactRecord(
    input.to,
    ["branchId", "inputId", "inputFingerprint"],
    `${path}.to`,
  );
  const assertion = exactRecord(
    input.assertion,
    ["source", "justification"],
    `${path}.assertion`,
  );
  const evidence = nonEmptyArray(input.evidence, `${path}.evidence`).map((
    item,
    index,
  ) => parseReference(item, `${path}.evidence[${index}]`));
  rejectDuplicates(evidence.map(referenceKey), `${path}.evidence`);
  return {
    id: safeId(input.id, `${path}.id`),
    fromAnchorId: safeId(input.fromAnchorId, `${path}.fromAnchorId`),
    to: {
      branchId: parseBranchId(target.branchId, `${path}.to.branchId`),
      inputId: safeId(target.inputId, `${path}.to.inputId`),
      inputFingerprint: parseFingerprint(
        target.inputFingerprint,
        `${path}.to.inputFingerprint`,
      ),
    },
    relation: "positive-input",
    assertion: {
      source: parseReference(assertion.source, `${path}.assertion.source`),
      justification: nonEmptyText(
        assertion.justification,
        `${path}.assertion.justification`,
      ),
    },
    scope: nonEmptyText(input.scope, `${path}.scope`),
    evidence: [...evidence].sort((left, right) =>
      referenceKey(left).localeCompare(referenceKey(right))
    ),
  };
}

function parseIndependenceAssertion(
  value: unknown,
  path: string,
): CrossDomainImpactIndependenceAssertion {
  const input = exactRecord(
    value,
    [
      "id",
      "branchId",
      "assertion",
      "author",
      "source",
      "justification",
      "inspectedSourceAnchors",
      "evidence",
      "inspectedConsumptions",
      "review",
    ],
    path,
  );
  literalValue(input.assertion, "independent", `${path}.assertion`);
  const author = exactRecord(input.author, ["kind", "id"], `${path}.author`);
  literalValue(author.kind, "human", `${path}.author.kind`);
  const inspectedSourceAnchors = nonEmptyArray(
    input.inspectedSourceAnchors,
    `${path}.inspectedSourceAnchors`,
  ).map((item, index) =>
    parseInspectedSourceAnchor(item, `${path}.inspectedSourceAnchors[${index}]`)
  );
  rejectDuplicates(
    inspectedSourceAnchors.map((item) => item.sourceAnchorId),
    `${path}.inspectedSourceAnchors ids`,
  );
  const inspectedConsumptions = nonEmptyArray(
    input.inspectedConsumptions,
    `${path}.inspectedConsumptions`,
  ).map((item, index) =>
    parseInspectedConsumption(item, `${path}.inspectedConsumptions[${index}]`)
  );
  rejectDuplicates(
    inspectedConsumptions.map((item) => item.id),
    `${path}.inspectedConsumptions ids`,
  );
  rejectDuplicates(
    inspectedConsumptions.map((item) => referenceKey(item.input)),
    `${path}.inspectedConsumptions inputs`,
  );
  const review = parseReview(input.review, `${path}.review`);
  if (Date.parse(review.expiresAt) <= Date.parse(review.reviewedAt)) {
    throw new TypeError(`${path}.review.expiresAt must be after reviewedAt.`);
  }
  return {
    id: safeId(input.id, `${path}.id`),
    branchId: parseBranchId(input.branchId, `${path}.branchId`),
    assertion: "independent",
    author: { kind: "human", id: safeId(author.id, `${path}.author.id`) },
    source: parseReference(input.source, `${path}.source`),
    justification: nonEmptyText(input.justification, `${path}.justification`),
    inspectedSourceAnchors: [...inspectedSourceAnchors].sort((left, right) =>
      left.sourceAnchorId.localeCompare(right.sourceAnchorId)
    ),
    evidence: parseReference(input.evidence, `${path}.evidence`),
    inspectedConsumptions: [...inspectedConsumptions].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    review,
  };
}

function parseInspectedSourceAnchor(
  value: unknown,
  path: string,
): CrossDomainImpactInspectedSourceAnchor {
  const input = exactRecord(
    value,
    ["sourceAnchorId", "threadChangeFingerprint", "sourceFingerprint"],
    path,
  );
  return {
    sourceAnchorId: safeId(input.sourceAnchorId, `${path}.sourceAnchorId`),
    threadChangeFingerprint: parseFingerprint(
      input.threadChangeFingerprint,
      `${path}.threadChangeFingerprint`,
    ),
    sourceFingerprint: parseFingerprint(
      input.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
  };
}

function parseInspectedConsumption(
  value: unknown,
  path: string,
): CrossDomainImpactInspectedConsumption {
  const input = exactRecord(value, ["id", "input"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    input: parseReference(input.input, `${path}.input`),
  };
}

function parseReview(
  value: unknown,
  path: string,
): CrossDomainImpactIndependenceAssertion["review"] {
  const input = exactRecord(value, ["trigger", "reviewedAt", "expiresAt"], path);
  const reviewedAt = parseIsoDateTime(input.reviewedAt, `${path}.reviewedAt`);
  const expiresAt = parseIsoDateTime(input.expiresAt, `${path}.expiresAt`);
  return {
    trigger: parseReference(input.trigger, `${path}.trigger`),
    reviewedAt,
    expiresAt,
  };
}

function parseGateMap(value: unknown, path: string): CrossDomainImpactGateMap {
  const input = exactRecord(value, ["gateItemId", "branchId", "role"], path);
  const role = nonEmptyText(input.role, `${path}.role`);
  if (!GATE_ROLES.includes(role as EngineeringGateClaimRole)) {
    throw new TypeError(`${path}.role must be contributes-to or satisfies.`);
  }
  return {
    gateItemId: safeId(input.gateItemId, `${path}.gateItemId`),
    branchId: parseBranchId(input.branchId, `${path}.branchId`),
    role: role as EngineeringGateClaimRole,
  };
}

function parseReference(value: unknown, path: string): CrossDomainImpactReference {
  const input = exactRecord(value, ["id", "fingerprint"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(input.digest, `${path}.digest`);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest };
}

function parseChangeKind(value: unknown, path: string): CrossDomainImpactChangeKind {
  return parseCrossDomainImpactChangeKind(value, path);
}

function parseBranchId(value: unknown, path: string): CrossDomainImpactBranchId {
  return parseCrossDomainImpactBranchId(value, path);
}

function parseIsoDateTime(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!ISO_DATE_TIME.test(text) || Number.isNaN(Date.parse(text))) {
    throw new TypeError(`${path} must be an ISO-8601 UTC timestamp.`);
  }
  return text;
}

function sameReference(
  left: CrossDomainImpactReference,
  right: CrossDomainImpactReference,
): boolean {
  return left.id === right.id && fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function referenceKey(value: CrossDomainImpactReference): string {
  return `${value.id}:${value.fingerprint.algorithm}:${value.fingerprint.digest}`;
}

function gateMapKey(value: CrossDomainImpactGateMap): string {
  return `${value.gateItemId}:${value.branchId}:${value.role}`;
}

function changeKindOrder(
  left: CrossDomainImpactChangeKind,
  right: CrossDomainImpactChangeKind,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
