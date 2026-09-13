/**
 * Closed documentary clause-response capture.
 *
 * One append-only Thread document records an agent's source-backed answer to
 * exactly one approved brief item. Human MRTR authorizes the act of recording.
 * It does not accept the answer content, create a requirement, or manufacture
 * a verification pass.
 */

import {
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../kernel/deterministic-json.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../project/engineering-project.ts";
import {
  isProjectBriefItemKind,
  isProjectBriefSourceKind,
  type ProjectBriefItem,
  type ProjectBriefItemKind,
  type ProjectBriefSourceRef,
} from "../project/project-brief.ts";
import { parseExactThreadSnapshotBasis } from "../project/thread-tip.ts";
import type { ContentFingerprint } from "../thread/thread-snapshot.ts";
import type { AgentResourceReference } from "../resource/agent-resource-capture.ts";
import { parseAgentResourceReference } from "../resource/agent-resource-reference.ts";

export const RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION = {
  id: "record.seal-documentary-clause-response",
  version: "1",
} as const;

export const DOCUMENTARY_CLAUSE_RESPONSE_SCHEMA =
  "documentary-clause-response/1.0" as const;

export const DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX =
  "casys://documentary-clause-response/" as const;

export const DOCUMENTARY_CLAUSE_RESPONSE_ANSWER_MAX = 4096;
export const DOCUMENTARY_CLAUSE_RESPONSE_SCOPE_MAX = 512;
export const DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX = 8;

export const DOCUMENTARY_CLAUSE_RESPONSE_RECORDING_STATUS = "proposal" as const;
export const DOCUMENTARY_CLAUSE_RESPONSE_AUTHOR_KIND = "agent" as const;

export interface DocumentaryClauseResponseRecordReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface DocumentaryClauseResponseThreadSource {
  readonly kind: "thread-artifact";
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface DocumentaryClauseResponseAgentResourceSource {
  readonly kind: "agent-resource";
  readonly resourceRef: AgentResourceReference;
}

export type DocumentaryClauseResponseSource =
  | DocumentaryClauseResponseAgentResourceSource
  | DocumentaryClauseResponseThreadSource;

export interface DocumentaryClauseResponseProposal {
  readonly sourceItemId: string;
  readonly answer: string;
  readonly scope: string;
  readonly briefBasis: EngineeringApprovedBriefBasis;
  readonly itemKind: ProjectBriefItemKind;
  readonly itemFingerprint: ContentFingerprint;
  readonly sources: readonly DocumentaryClauseResponseSource[];
  readonly predecessor?: DocumentaryClauseResponseRecordReference;
}

export interface DocumentaryClauseResponseCapture {
  readonly schemaVersion: typeof DOCUMENTARY_CLAUSE_RESPONSE_SCHEMA;
  readonly operation: typeof RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION;
  readonly mode: "documentary-proposal";
  readonly recording: {
    readonly status: typeof DOCUMENTARY_CLAUSE_RESPONSE_RECORDING_STATUS;
    readonly authorKind: typeof DOCUMENTARY_CLAUSE_RESPONSE_AUTHOR_KIND;
  };
  readonly projectId: string;
  readonly trustedRunId: string;
  readonly linkedAt: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly briefBasis: EngineeringApprovedBriefBasis;
  readonly sourceItem: ProjectBriefItem;
  readonly claim: {
    readonly id: string;
    readonly revision: number;
    readonly sourceItemId: string;
    readonly predecessor?: DocumentaryClauseResponseRecordReference;
  };
  readonly answer: string;
  readonly scope: string;
  readonly sources: readonly DocumentaryClauseResponseSource[];
  readonly decision: {
    readonly decisionId: string;
    readonly inputFingerprint: ContentFingerprint;
  };
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
}

const PATH = "$documentaryClauseResponseCapture";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CLAIM_ID = /^documentary-clause-response-[a-f0-9]{64}$/;

export function parseDocumentaryClauseResponseParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): DocumentaryClauseResponseProposal {
  if (!Array.isArray(parameters)) {
    throw new TypeError("Documentary clause-response parameters must be an array.");
  }
  const map = parameterMap(parameters);
  const sourceCount = integerValue(map, "clause.sourceCount");
  if (
    sourceCount < 1 ||
    sourceCount > DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX
  ) {
    throw new TypeError(
      `clause.sourceCount must be an integer from 1 to ${DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX}.`,
    );
  }
  const sources: DocumentaryClauseResponseSource[] = [];
  for (let index = 0; index < sourceCount; index++) {
    sources.push(parseSourceFromParameters(map, index));
  }
  const predecessor = parsePredecessorFromParameters(map);
  assertClosedParameterKeys(map, sources, predecessor !== undefined);
  assertUniqueThreadArtifactSources(sources, predecessor?.artifactId);
  const proposal: DocumentaryClauseResponseProposal = {
    sourceItemId: idValue(map, "clause.sourceItemId"),
    answer: boundedText(
      stringValue(map, "clause.answer"),
      DOCUMENTARY_CLAUSE_RESPONSE_ANSWER_MAX,
      "clause.answer",
    ),
    scope: boundedText(
      stringValue(map, "clause.scope"),
      DOCUMENTARY_CLAUSE_RESPONSE_SCOPE_MAX,
      "clause.scope",
    ),
    briefBasis: parseBriefBasisFromParameters(map),
    itemKind: itemKindValue(map, "clause.itemKind"),
    itemFingerprint: parsePrefixedFingerprint(
      stringValue(map, "clause.itemFingerprint"),
      "clause.itemFingerprint",
    ),
    sources,
    ...(predecessor ? { predecessor } : {}),
  };
  return deepFreeze(proposal);
}

export function documentaryClauseResponseParameters(
  proposal: DocumentaryClauseResponseProposal,
): readonly EngineeringDecisionProposalParameter[] {
  assertProposal(proposal);
  const parameters: EngineeringDecisionProposalParameter[] = [
    parameter("clause.sourceItemId", proposal.sourceItemId),
    parameter("clause.answer", proposal.answer),
    parameter("clause.scope", proposal.scope),
    parameter("clause.brief.kind", proposal.briefBasis.kind),
    parameter("clause.brief.projectId", proposal.briefBasis.projectId),
    parameter(
      "clause.brief.projectSnapshotId",
      proposal.briefBasis.projectSnapshotId,
    ),
    parameter(
      "clause.brief.projectRevision",
      proposal.briefBasis.projectRevision,
    ),
    parameter("clause.brief.briefId", proposal.briefBasis.briefId),
    parameter(
      "clause.brief.briefSnapshotId",
      proposal.briefBasis.briefSnapshotId,
    ),
    parameter("clause.brief.briefRevision", proposal.briefBasis.briefRevision),
    parameter(
      "clause.brief.approvedBriefFingerprint",
      prefixedFingerprint(proposal.briefBasis.approvedBriefFingerprint),
    ),
    parameter("clause.itemKind", proposal.itemKind),
    parameter(
      "clause.itemFingerprint",
      prefixedFingerprint(proposal.itemFingerprint),
    ),
    parameter("clause.sourceCount", proposal.sources.length),
  ];
  proposal.sources.forEach((source, index) => {
    parameters.push(...sourceParameters(source, index));
  });
  if (proposal.predecessor) {
    parameters.push(
      parameter(
        "clause.predecessorArtifactId",
        proposal.predecessor.artifactId,
      ),
      parameter(
        "clause.predecessorFingerprint",
        prefixedFingerprint(proposal.predecessor.fingerprint),
      ),
      parameter(
        "clause.predecessorRunId",
        proposal.predecessor.producerRunId,
      ),
    );
  }
  parseDocumentaryClauseResponseParameters(parameters);
  return deepFreeze(parameters);
}

export function parseDocumentaryClauseResponseCapture(
  value: unknown,
): DocumentaryClauseResponseCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "mode",
    "recording",
    "projectId",
    "trustedRunId",
    "linkedAt",
    "basis",
    "briefBasis",
    "sourceItem",
    "claim",
    "answer",
    "scope",
    "sources",
    "decision",
    "parameters",
  ], PATH);
  literalValue(
    root.schemaVersion,
    DOCUMENTARY_CLAUSE_RESPONSE_SCHEMA,
    `${PATH}.schemaVersion`,
  );
  literalValue(root.mode, "documentary-proposal", `${PATH}.mode`);
  const recording = exactRecord(
    root.recording,
    ["status", "authorKind"],
    `${PATH}.recording`,
  );
  literalValue(
    recording.status,
    DOCUMENTARY_CLAUSE_RESPONSE_RECORDING_STATUS,
    `${PATH}.recording.status`,
  );
  literalValue(
    recording.authorKind,
    DOCUMENTARY_CLAUSE_RESPONSE_AUTHOR_KIND,
    `${PATH}.recording.authorKind`,
  );
  const operation = parseOperation(root.operation);
  const projectId = safeId(root.projectId, `${PATH}.projectId`);
  const basis = parseExactThreadSnapshotBasis(root.basis, `${PATH}.basis`);
  const parameters = parseParameters(root.parameters, `${PATH}.parameters`);
  const proposal = parseDocumentaryClauseResponseParameters(parameters);
  const briefBasis = parseApprovedBriefBasis(
    root.briefBasis,
    `${PATH}.briefBasis`,
  );
  if (deterministicJson(briefBasis) !== deterministicJson(proposal.briefBasis)) {
    throw new TypeError(
      `${PATH}.briefBasis must equal the parsed proposal brief basis.`,
    );
  }
  if (briefBasis.projectId !== projectId) {
    throw new TypeError(
      `${PATH}.briefBasis.projectId must equal ${PATH}.projectId.`,
    );
  }
  const sourceItem = parseSourceItem(root.sourceItem, `${PATH}.sourceItem`);
  if (sourceItem.id !== proposal.sourceItemId) {
    throw new TypeError(
      `${PATH}.sourceItem.id must equal clause.sourceItemId.`,
    );
  }
  if (sourceItem.kind !== proposal.itemKind) {
    throw new TypeError(
      `${PATH}.sourceItem.kind must equal clause.itemKind.`,
    );
  }
  const sources = parseSources(root.sources, `${PATH}.sources`);
  if (deterministicJson(sources) !== deterministicJson(proposal.sources)) {
    throw new TypeError(
      `${PATH}.sources must equal the parsed proposal sources.`,
    );
  }
  const answer = boundedText(
    nonEmptyText(root.answer, `${PATH}.answer`),
    DOCUMENTARY_CLAUSE_RESPONSE_ANSWER_MAX,
    `${PATH}.answer`,
  );
  const scope = boundedText(
    nonEmptyText(root.scope, `${PATH}.scope`),
    DOCUMENTARY_CLAUSE_RESPONSE_SCOPE_MAX,
    `${PATH}.scope`,
  );
  if (answer !== proposal.answer || scope !== proposal.scope) {
    throw new TypeError(
      `${PATH}.answer and ${PATH}.scope must equal the parsed proposal.`,
    );
  }
  const decision = exactRecord(
    root.decision,
    ["decisionId", "inputFingerprint"],
    `${PATH}.decision`,
  );
  const capture: DocumentaryClauseResponseCapture = {
    schemaVersion: DOCUMENTARY_CLAUSE_RESPONSE_SCHEMA,
    operation,
    mode: "documentary-proposal",
    recording: {
      status: DOCUMENTARY_CLAUSE_RESPONSE_RECORDING_STATUS,
      authorKind: DOCUMENTARY_CLAUSE_RESPONSE_AUTHOR_KIND,
    },
    projectId,
    trustedRunId: safeId(root.trustedRunId, `${PATH}.trustedRunId`),
    linkedAt: parseIsoUtc(root.linkedAt, `${PATH}.linkedAt`),
    basis,
    briefBasis,
    sourceItem,
    claim: parseClaim(root.claim, proposal),
    answer,
    scope,
    sources,
    decision: {
      decisionId: safeId(decision.decisionId, `${PATH}.decision.decisionId`),
      inputFingerprint: parseFingerprint(
        decision.inputFingerprint,
        `${PATH}.decision.inputFingerprint`,
      ),
    },
    parameters,
  };
  return deepFreeze(capture);
}

export function documentaryClauseResponseArtifactId(
  fingerprint: ContentFingerprint,
): string {
  return `documentary-clause-response-${
    parseFingerprint(fingerprint, "$fingerprint").digest
  }`;
}

export function documentaryClauseResponseUri(
  fingerprint: ContentFingerprint,
): string {
  return `${DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX}sha256/${
    parseFingerprint(fingerprint, "$fingerprint").digest
  }`;
}

export async function documentaryClauseResponseClaimId(
  projectId: string,
  sourceItemId: string,
): Promise<string> {
  safeId(projectId, "$projectId");
  safeId(sourceItemId, "$sourceItemId");
  const fingerprint = await sha256Fingerprint({ projectId, sourceItemId });
  return `documentary-clause-response-${fingerprint.digest}`;
}

export async function documentaryClauseResponseItemFingerprint(
  item: ProjectBriefItem,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(parseSourceItem(item, "$sourceItem"));
}

function parseOperation(
  value: unknown,
): typeof RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION {
  const operation = exactRecord(value, ["id", "version"], `${PATH}.operation`);
  literalValue(
    operation.id,
    RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.id,
    `${PATH}.operation.id`,
  );
  literalValue(
    operation.version,
    RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.version,
    `${PATH}.operation.version`,
  );
  return RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION;
}

function parseClaim(
  value: unknown,
  proposal: DocumentaryClauseResponseProposal,
): DocumentaryClauseResponseCapture["claim"] {
  const root = closedRecord(
    value,
    ["id", "revision", "sourceItemId", "predecessor"],
    ["id", "revision", "sourceItemId"],
    `${PATH}.claim`,
  );
  const id = safeId(root.id, `${PATH}.claim.id`);
  if (!CLAIM_ID.test(id)) {
    throw new TypeError(
      `${PATH}.claim.id must be documentary-clause-response-<sha256>.`,
    );
  }
  const sourceItemId = safeId(root.sourceItemId, `${PATH}.claim.sourceItemId`);
  if (sourceItemId !== proposal.sourceItemId) {
    throw new TypeError(
      `${PATH}.claim.sourceItemId must equal clause.sourceItemId.`,
    );
  }
  const predecessor = root.predecessor === undefined
    ? undefined
    : parseRecordReference(root.predecessor, `${PATH}.claim.predecessor`);
  if (!sameRecordReference(predecessor, proposal.predecessor)) {
    throw new TypeError(
      `${PATH}.claim.predecessor must equal parsed proposal predecessor.`,
    );
  }
  const revision = root.revision;
  if (
    typeof revision !== "number" || !Number.isSafeInteger(revision) ||
    revision < (predecessor ? 2 : 1)
  ) {
    throw new TypeError(
      `${PATH}.claim.revision must be ${
        predecessor ? "an integer >= 2" : "1 without a predecessor"
      }.`,
    );
  }
  if (!predecessor && revision !== 1) {
    throw new TypeError(
      `${PATH}.claim.revision must equal 1 without a predecessor.`,
    );
  }
  return predecessor === undefined
    ? { id, revision, sourceItemId }
    : { id, revision, sourceItemId, predecessor };
}

function parseSources(
  value: unknown,
  path: string,
): readonly DocumentaryClauseResponseSource[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (value.length < 1 || value.length > DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX) {
    throw new TypeError(
      `${path} must contain 1 to ${DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX} sources.`,
    );
  }
  return value.map((item, index) => parseSource(item, `${path}[${index}]`));
}

function parseSource(
  value: unknown,
  path: string,
): DocumentaryClauseResponseSource {
  const root = closedRecord(
    value,
    [
      "kind",
      "resourceRef",
      "artifactId",
      "fingerprint",
      "producerRunId",
    ],
    ["kind"],
    path,
  );
  if (root.kind === "agent-resource") {
    if (
      root.artifactId !== undefined || root.fingerprint !== undefined ||
      root.producerRunId !== undefined
    ) {
      throw new TypeError(
        `${path} agent-resource sources must not name a Thread artifact.`,
      );
    }
    return deepFreeze({
      kind: "agent-resource",
      resourceRef: parseAgentResourceReference(
        root.resourceRef,
        `${path}.resourceRef`,
      ),
    });
  }
  if (root.kind === "thread-artifact") {
    if (root.resourceRef !== undefined) {
      throw new TypeError(
        `${path} thread-artifact sources must not carry a resourceRef.`,
      );
    }
    return deepFreeze({
      kind: "thread-artifact",
      artifactId: safeId(root.artifactId, `${path}.artifactId`),
      fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
      producerRunId: safeId(root.producerRunId, `${path}.producerRunId`),
    });
  }
  throw new TypeError(
    `${path}.kind must be agent-resource or thread-artifact.`,
  );
}

function parseSourceFromParameters(
  map: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  index: number,
): DocumentaryClauseResponseSource {
  const kind = stringValue(map, `clause.source.${index}.kind`);
  if (kind === "agent-resource") {
    return {
      kind: "agent-resource",
      resourceRef: parseAgentResourceReference({
        schemaVersion: "agent-resource-capture/1.0",
        uri: stringValue(map, `clause.source.${index}.uri`),
        name: stringValue(map, `clause.source.${index}.name`),
        mimeType: stringValue(map, `clause.source.${index}.mimeType`),
        representation: stringValue(
          map,
          `clause.source.${index}.representation`,
        ),
        byteCount: integerValue(map, `clause.source.${index}.byteCount`),
        fingerprint: parsePrefixedFingerprint(
          stringValue(map, `clause.source.${index}.fingerprint`),
          `clause.source.${index}.fingerprint`,
        ),
      }, `clause.source.${index}`),
    };
  }
  if (kind === "thread-artifact") {
    return {
      kind: "thread-artifact",
      artifactId: idValue(map, `clause.source.${index}.artifactId`),
      fingerprint: parsePrefixedFingerprint(
        stringValue(map, `clause.source.${index}.fingerprint`),
        `clause.source.${index}.fingerprint`,
      ),
      producerRunId: idValue(map, `clause.source.${index}.producerRunId`),
    };
  }
  throw new TypeError(
    `clause.source.${index}.kind must be agent-resource or thread-artifact.`,
  );
}

function sourceParameters(
  source: DocumentaryClauseResponseSource,
  index: number,
): EngineeringDecisionProposalParameter[] {
  if (source.kind === "agent-resource") {
    const ref = source.resourceRef;
    return [
      parameter(`clause.source.${index}.kind`, "agent-resource"),
      parameter(`clause.source.${index}.uri`, ref.uri),
      parameter(`clause.source.${index}.name`, ref.name),
      parameter(`clause.source.${index}.mimeType`, ref.mimeType),
      parameter(`clause.source.${index}.representation`, ref.representation),
      parameter(`clause.source.${index}.byteCount`, ref.byteCount),
      parameter(
        `clause.source.${index}.fingerprint`,
        prefixedFingerprint(ref.fingerprint),
      ),
    ];
  }
  return [
    parameter(`clause.source.${index}.kind`, "thread-artifact"),
    parameter(`clause.source.${index}.artifactId`, source.artifactId),
    parameter(
      `clause.source.${index}.fingerprint`,
      prefixedFingerprint(source.fingerprint),
    ),
    parameter(`clause.source.${index}.producerRunId`, source.producerRunId),
  ];
}

function assertClosedParameterKeys(
  map: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  sources: readonly DocumentaryClauseResponseSource[],
  hasPredecessor: boolean,
): void {
  const expected = new Set<string>([
    "clause.sourceItemId",
    "clause.answer",
    "clause.scope",
    "clause.brief.kind",
    "clause.brief.projectId",
    "clause.brief.projectSnapshotId",
    "clause.brief.projectRevision",
    "clause.brief.briefId",
    "clause.brief.briefSnapshotId",
    "clause.brief.briefRevision",
    "clause.brief.approvedBriefFingerprint",
    "clause.itemKind",
    "clause.itemFingerprint",
    "clause.sourceCount",
  ]);
  for (const [index, source] of sources.entries()) {
    if (source.kind === "agent-resource") {
      for (
        const field of [
          "kind",
          "uri",
          "name",
          "mimeType",
          "representation",
          "byteCount",
          "fingerprint",
        ]
      ) {
        expected.add(`clause.source.${index}.${field}`);
      }
    } else {
      for (
        const field of ["kind", "artifactId", "fingerprint", "producerRunId"]
      ) {
        expected.add(`clause.source.${index}.${field}`);
      }
    }
  }
  if (hasPredecessor) {
    expected.add("clause.predecessorArtifactId");
    expected.add("clause.predecessorFingerprint");
    expected.add("clause.predecessorRunId");
  }
  const extra = [...map.keys()].filter((key) => !expected.has(key)).toSorted();
  if (extra.length > 0) {
    throw new TypeError(
      `Documentary clause-response parameter "${
        extra[0]
      }" is not part of the closed grammar implied by sourceCount, source kind and predecessor presence.`,
    );
  }
}

export function assertUniqueThreadArtifactSources(
  sources: readonly DocumentaryClauseResponseSource[],
  predecessorArtifactId?: string,
): void {
  const ids = sources.flatMap((source) =>
    source.kind === "thread-artifact" ? [source.artifactId] : []
  );
  if (new Set(ids).size !== ids.length) {
    throw new TypeError(
      "Documentary clause-response Thread artifact sources must be unique.",
    );
  }
  if (predecessorArtifactId && ids.includes(predecessorArtifactId)) {
    throw new TypeError(
      "Documentary clause-response sources must not repeat the predecessor artifact.",
    );
  }
}

function parsePredecessorFromParameters(
  map: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
): DocumentaryClauseResponseRecordReference | undefined {
  const keys = [
    "clause.predecessorArtifactId",
    "clause.predecessorFingerprint",
    "clause.predecessorRunId",
  ] as const;
  const present = keys.filter((key) => map.has(key));
  if (present.length === 0) return undefined;
  if (present.length !== keys.length) {
    throw new TypeError(
      "Documentary clause-response predecessor metadata must be all present or all absent.",
    );
  }
  return parseRecordReference({
    artifactId: stringValue(map, "clause.predecessorArtifactId"),
    fingerprint: parsePrefixedFingerprint(
      stringValue(map, "clause.predecessorFingerprint"),
      "clause.predecessorFingerprint",
    ),
    producerRunId: stringValue(map, "clause.predecessorRunId"),
  }, "$parameters.predecessor");
}

function parseBriefBasisFromParameters(
  map: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
): EngineeringApprovedBriefBasis {
  return parseApprovedBriefBasis({
    kind: stringValue(map, "clause.brief.kind"),
    projectId: stringValue(map, "clause.brief.projectId"),
    projectSnapshotId: stringValue(map, "clause.brief.projectSnapshotId"),
    projectRevision: integerValue(map, "clause.brief.projectRevision"),
    briefId: stringValue(map, "clause.brief.briefId"),
    briefSnapshotId: stringValue(map, "clause.brief.briefSnapshotId"),
    briefRevision: integerValue(map, "clause.brief.briefRevision"),
    approvedBriefFingerprint: parsePrefixedFingerprint(
      stringValue(map, "clause.brief.approvedBriefFingerprint"),
      "clause.brief.approvedBriefFingerprint",
    ),
  }, "$parameters.briefBasis");
}

export function parseApprovedBriefBasis(
  value: unknown,
  path: string,
): EngineeringApprovedBriefBasis {
  const root = exactRecord(value, [
    "kind",
    "projectId",
    "projectSnapshotId",
    "projectRevision",
    "briefId",
    "briefSnapshotId",
    "briefRevision",
    "approvedBriefFingerprint",
  ], path);
  literalValue(root.kind, "approved-brief", `${path}.kind`);
  return deepFreeze({
    kind: "approved-brief",
    projectId: safeId(root.projectId, `${path}.projectId`),
    projectSnapshotId: safeId(
      root.projectSnapshotId,
      `${path}.projectSnapshotId`,
    ),
    projectRevision: positiveInteger(
      root.projectRevision,
      `${path}.projectRevision`,
    ),
    briefId: safeId(root.briefId, `${path}.briefId`),
    briefSnapshotId: safeId(root.briefSnapshotId, `${path}.briefSnapshotId`),
    briefRevision: positiveInteger(root.briefRevision, `${path}.briefRevision`),
    approvedBriefFingerprint: parseFingerprint(
      root.approvedBriefFingerprint,
      `${path}.approvedBriefFingerprint`,
    ),
  });
}

function parseSourceItem(value: unknown, path: string): ProjectBriefItem {
  const root = closedRecord(
    value,
    [
      "id",
      "kind",
      "statement",
      "sourceRefs",
      "owner",
      "reviewTrigger",
      "dependsOnItemIds",
      "verificationAuthority",
    ],
    ["id", "kind", "statement", "sourceRefs"],
    path,
  );
  if (!isProjectBriefItemKind(root.kind)) {
    throw new TypeError(`${path}.kind is not a brief item kind.`);
  }
  if (!Array.isArray(root.sourceRefs)) {
    throw new TypeError(`${path}.sourceRefs must be an array.`);
  }
  const sourceRefs: ProjectBriefSourceRef[] = root.sourceRefs.map(
    (entry, index) => {
      const ref = exactRecord(
        entry,
        ["kind", "reference"],
        `${path}.sourceRefs[${index}]`,
      );
      if (!isProjectBriefSourceKind(ref.kind)) {
        throw new TypeError(
          `${path}.sourceRefs[${index}].kind is not a brief source kind.`,
        );
      }
      return {
        kind: ref.kind,
        reference: nonEmptyText(
          ref.reference,
          `${path}.sourceRefs[${index}].reference`,
        ),
      };
    },
  );
  const item: ProjectBriefItem = {
    id: safeId(root.id, `${path}.id`),
    kind: root.kind,
    statement: nonEmptyText(root.statement, `${path}.statement`),
    sourceRefs,
    ...(root.owner === undefined
      ? {}
      : { owner: nonEmptyText(root.owner, `${path}.owner`) }),
    ...(root.reviewTrigger === undefined ? {} : {
      reviewTrigger: nonEmptyText(root.reviewTrigger, `${path}.reviewTrigger`),
    }),
    ...(root.dependsOnItemIds === undefined ? {} : {
      dependsOnItemIds: parseIdArray(
        root.dependsOnItemIds,
        `${path}.dependsOnItemIds`,
      ),
    }),
    ...(root.verificationAuthority === undefined ? {} : {
      verificationAuthority: parseVerificationAuthority(
        root.verificationAuthority,
        `${path}.verificationAuthority`,
      ),
    }),
  };
  return deepFreeze(item);
}

function parseVerificationAuthority(
  value: unknown,
  path: string,
): { readonly id: string; readonly version: string } {
  const root = exactRecord(value, ["id", "version"], path);
  return {
    id: nonEmptyText(root.id, `${path}.id`),
    version: nonEmptyText(root.version, `${path}.version`),
  };
}

function parseIdArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value.map((item, index) => safeId(item, `${path}[${index}]`));
}

function parseRecordReference(
  value: unknown,
  path: string,
): DocumentaryClauseResponseRecordReference {
  const root = exactRecord(
    value,
    ["artifactId", "fingerprint", "producerRunId"],
    path,
  );
  return deepFreeze({
    artifactId: safeId(root.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
    producerRunId: safeId(root.producerRunId, `${path}.producerRunId`),
  });
}

function sameRecordReference(
  left: DocumentaryClauseResponseRecordReference | undefined,
  right: DocumentaryClauseResponseRecordReference | undefined,
): boolean {
  return left?.artifactId === right?.artifactId &&
    left?.producerRunId === right?.producerRunId &&
    fingerprintsEqual(left?.fingerprint, right?.fingerprint);
}

function assertProposal(proposal: DocumentaryClauseResponseProposal): void {
  safeId(proposal.sourceItemId, "$proposal.sourceItemId");
  boundedText(
    proposal.answer,
    DOCUMENTARY_CLAUSE_RESPONSE_ANSWER_MAX,
    "$proposal.answer",
  );
  boundedText(
    proposal.scope,
    DOCUMENTARY_CLAUSE_RESPONSE_SCOPE_MAX,
    "$proposal.scope",
  );
  parseApprovedBriefBasis(proposal.briefBasis, "$proposal.briefBasis");
  if (!isProjectBriefItemKind(proposal.itemKind)) {
    throw new TypeError("$proposal.itemKind is not a brief item kind.");
  }
  parseFingerprint(proposal.itemFingerprint, "$proposal.itemFingerprint");
  if (
    proposal.sources.length < 1 ||
    proposal.sources.length > DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX
  ) {
    throw new TypeError(
      `$proposal.sources must contain 1 to ${DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX} sources.`,
    );
  }
  proposal.sources.forEach((source, index) => {
    parseSource(source, `$proposal.sources[${index}]`);
  });
  if (proposal.predecessor) {
    parseRecordReference(proposal.predecessor, "$proposal.predecessor");
  }
}

function parseParameters(
  value: unknown,
  path: string,
): readonly EngineeringDecisionProposalParameter[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value.map((item, index) => {
    const rec = closedRecord(item, ["key", "label", "value", "unit"], [
      "key",
      "label",
      "value",
    ], `${path}[${index}]`);
    const base: EngineeringDecisionProposalParameter = {
      key: typeof rec.key === "string" ? rec.key : (() => {
        throw new TypeError(`${path}[${index}].key must be a string.`);
      })(),
      label: nonEmptyText(rec.label, `${path}[${index}].label`),
      value: parseParameterValue(rec.value, `${path}[${index}].value`),
    };
    return rec.unit === undefined ? base : {
      ...base,
      unit: nonEmptyText(rec.unit, `${path}[${index}].unit`),
    };
  });
}

function parseParameterValue(
  value: unknown,
  path: string,
): string | number | boolean {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError(`${path} must be a finite number, string, or boolean.`);
}

function parameterMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ReadonlyMap<string, EngineeringDecisionProposalParameter> {
  const map = new Map<string, EngineeringDecisionProposalParameter>();
  for (const parameter of parameters) {
    closedRecord(parameter, ["key", "label", "value", "unit"], [
      "key",
      "label",
      "value",
    ], "Documentary clause-response parameter");
    if (typeof parameter.key !== "string") {
      throw new TypeError(
        "Each documentary clause-response parameter key must be a string.",
      );
    }
    if (map.has(parameter.key)) {
      throw new TypeError(
        `Documentary clause-response parameter "${parameter.key}" is duplicated.`,
      );
    }
    if (parameter.unit !== undefined) {
      throw new TypeError(`${parameter.key} must not carry a unit.`);
    }
    map.set(parameter.key, parameter);
  }
  return map;
}

function stringValue(
  map: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  key: string,
): string {
  const parameter = map.get(key);
  if (!parameter) throw new TypeError(`${key} is required.`);
  if (typeof parameter.value !== "string") {
    throw new TypeError(`${key} must be a string.`);
  }
  return parameter.value;
}

function idValue(
  map: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  key: string,
): string {
  return safeId(stringValue(map, key), key);
}

function integerValue(
  map: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  key: string,
): number {
  const parameter = map.get(key);
  if (!parameter) throw new TypeError(`${key} is required.`);
  if (typeof parameter.value !== "number" || !Number.isSafeInteger(parameter.value)) {
    throw new TypeError(`${key} must be a safe integer.`);
  }
  return parameter.value;
}

function itemKindValue(
  map: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  key: string,
): ProjectBriefItemKind {
  const value = stringValue(map, key);
  if (!isProjectBriefItemKind(value)) {
    throw new TypeError(`${key} is not a brief item kind.`);
  }
  return value;
}

function boundedText(value: string, max: number, path: string): string {
  const text = nonEmptyText(value, path);
  if (text.length > max) {
    throw new TypeError(`${path} must be at most ${max} characters.`);
  }
  return text;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (typeof fingerprint.digest !== "string" || !SHA256_HEX.test(fingerprint.digest)) {
    throw new TypeError(`${path}.digest must be canonical lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function parsePrefixedFingerprint(value: unknown, path: string): ContentFingerprint {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be sha256:<64 lowercase hex>.`);
  }
  const match = /^sha256:([a-f0-9]{64})$/.exec(value);
  if (!match) throw new TypeError(`${path} must be sha256:<64 lowercase hex>.`);
  return { algorithm: "sha256", digest: match[1]! };
}

function prefixedFingerprint(fingerprint: ContentFingerprint): string {
  return `sha256:${parseFingerprint(fingerprint, "$fingerprint").digest}`;
}

function parseIsoUtc(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== text) {
    throw new TypeError(`${path} must be an exact ISO UTC timestamp.`);
  }
  return text;
}

function parameter(
  key: string,
  value: string | number | boolean,
): EngineeringDecisionProposalParameter {
  return { key, label: key, value };
}
