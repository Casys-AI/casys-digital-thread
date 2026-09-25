/**
 * Closed source-backed pre-sizing worksheet seal.
 *
 * One append-only Thread document records an agent's source-backed
 * pre-sizing quantities for exactly one project subject. Human MRTR
 * authorizes the act of recording. It does not accept the numbers, create
 * a requirement, grant a verdict, or manufacture engineering authority.
 * Every quantity stays documentary until an independent authority consumes it.
 */

import {
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson, sha256Fingerprint } from "../kernel/deterministic-json.ts";
import { isSha256HexDigest } from "../kernel/content-fingerprint.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../project/engineering-project.ts";
import type { AgentResourceReference } from "../resource/agent-resource-capture.ts";
import { parseAgentResourceReference } from "../resource/agent-resource-reference.ts";
import { parseExactThreadSnapshotBasis } from "../project/thread-tip.ts";
import type { ContentFingerprint } from "../thread/thread-snapshot.ts";

export const RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION = {
  id: "record.seal-pre-sizing-worksheet",
  version: "1",
} as const;

export const PRE_SIZING_WORKSHEET_SCHEMA = "pre-sizing-worksheet/1.0" as const;

export const PRE_SIZING_WORKSHEET_URI_PREFIX = "casys://pre-sizing-worksheet/" as const;

export const PRE_SIZING_WORKSHEET_TITLE_MAX = 256;
export const PRE_SIZING_WORKSHEET_QUANTITY_MAX = 64;
export const PRE_SIZING_WORKSHEET_LABEL_MAX = 128;
export const PRE_SIZING_WORKSHEET_UNIT_MAX = 32;
export const PRE_SIZING_WORKSHEET_VALUE_MAX = 64;
export const PRE_SIZING_WORKSHEET_ASSUMPTION_MAX = 1024;
export const PRE_SIZING_WORKSHEET_SOURCE_MAX = 16;

export const PRE_SIZING_WORKSHEET_RECORDING_STATUS = "recorded" as const;
export const PRE_SIZING_WORKSHEET_AUTHOR_KIND = "agent" as const;

export interface PreSizingWorksheetRecordReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface PreSizingWorksheetThreadSource {
  readonly kind: "thread-artifact";
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface PreSizingWorksheetAgentResourceSource {
  readonly kind: "agent-resource";
  readonly resourceRef: AgentResourceReference;
}

export type PreSizingWorksheetSource =
  | PreSizingWorksheetAgentResourceSource
  | PreSizingWorksheetThreadSource;

export interface PreSizingWorksheetQuantity {
  readonly id: string;
  readonly label?: string;
  readonly value: string;
  readonly unit: string;
  readonly sourceIndex: number;
  readonly assumption?: string;
}

export interface PreSizingWorksheetProposal {
  readonly worksheetId: string;
  readonly revision: number;
  readonly title: string;
  readonly quantities: readonly PreSizingWorksheetQuantity[];
  readonly sources: readonly PreSizingWorksheetSource[];
  readonly predecessor?: PreSizingWorksheetRecordReference;
}

export interface PreSizingWorksheetCapture {
  readonly schemaVersion: typeof PRE_SIZING_WORKSHEET_SCHEMA;
  readonly operation: typeof RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION;
  readonly mode: "documentary-evidence";
  readonly recording: {
    readonly status: typeof PRE_SIZING_WORKSHEET_RECORDING_STATUS;
    readonly authorKind: typeof PRE_SIZING_WORKSHEET_AUTHOR_KIND;
  };
  readonly projectId: string;
  readonly trustedRunId: string;
  readonly linkedAt: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly claim: {
    readonly id: string;
    readonly revision: number;
    readonly worksheetId: string;
    readonly predecessor?: PreSizingWorksheetRecordReference;
  };
  readonly title: string;
  readonly quantities: readonly PreSizingWorksheetQuantity[];
  readonly sources: readonly PreSizingWorksheetSource[];
  readonly decision: {
    readonly decisionId: string;
    readonly inputFingerprint: ContentFingerprint;
  };
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
}

const PATH = "$preSizingWorksheetCapture";
const DECIMAL = /^-?\d+(\.\d+)?$/;
const CLAIM_ID = /^pre-sizing-worksheet-[a-f0-9]{64}$/;

export function parsePreSizingWorksheetParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): PreSizingWorksheetProposal {
  if (!Array.isArray(parameters)) {
    throw new TypeError("Pre-sizing worksheet parameters must be an array.");
  }
  const map = parameterMap(parameters);
  const quantityCount = integerValue(map, "presizing.quantityCount");
  if (
    quantityCount < 1 || quantityCount > PRE_SIZING_WORKSHEET_QUANTITY_MAX
  ) {
    throw new TypeError(
      `presizing.quantityCount must be an integer from 1 to ${PRE_SIZING_WORKSHEET_QUANTITY_MAX}.`,
    );
  }
  const sourceCount = integerValue(map, "presizing.sourceCount");
  if (sourceCount < 1 || sourceCount > PRE_SIZING_WORKSHEET_SOURCE_MAX) {
    throw new TypeError(
      `presizing.sourceCount must be an integer from 1 to ${PRE_SIZING_WORKSHEET_SOURCE_MAX}.`,
    );
  }
  const sources: PreSizingWorksheetSource[] = [];
  for (let index = 0; index < sourceCount; index++) {
    sources.push(parseSourceFromParameters(map, index));
  }
  const quantities: PreSizingWorksheetQuantity[] = [];
  for (let index = 0; index < quantityCount; index++) {
    quantities.push(parseQuantityFromParameters(map, index, sourceCount));
  }
  const ids = quantities.map((quantity) => quantity.id);
  rejectDuplicates(ids, "presizing.quantity.id");
  const predecessor = parsePredecessorFromParameters(map);
  assertClosedParameterKeys(map, quantityCount, sourceCount, predecessor !== undefined);
  assertUniqueThreadArtifactSources(sources, predecessor?.artifactId);
  const proposal: PreSizingWorksheetProposal = {
    worksheetId: idValue(map, "presizing.worksheetId"),
    revision: integerValue(map, "presizing.revision"),
    title: boundedText(
      stringValue(map, "presizing.title"),
      PRE_SIZING_WORKSHEET_TITLE_MAX,
      "presizing.title",
    ),
    quantities,
    sources,
    ...(predecessor ? { predecessor } : {}),
  };
  if (proposal.revision < 1) {
    throw new TypeError("presizing.revision must be a positive integer.");
  }
  return deepFreeze(proposal);
}

export function preSizingWorksheetParameters(
  proposal: PreSizingWorksheetProposal,
): readonly EngineeringDecisionProposalParameter[] {
  assertProposal(proposal);
  const parameters: EngineeringDecisionProposalParameter[] = [
    parameter("presizing.worksheetId", proposal.worksheetId),
    parameter("presizing.revision", proposal.revision),
    parameter("presizing.title", proposal.title),
    parameter("presizing.quantityCount", proposal.quantities.length),
    parameter("presizing.sourceCount", proposal.sources.length),
  ];
  proposal.quantities.forEach((quantity, index) => {
    parameters.push(...quantityParameters(quantity, index));
  });
  proposal.sources.forEach((source, index) => {
    parameters.push(...sourceParameters(source, index));
  });
  if (proposal.predecessor) {
    parameters.push(
      parameter(
        "presizing.predecessorArtifactId",
        proposal.predecessor.artifactId,
      ),
      parameter(
        "presizing.predecessorFingerprint",
        prefixedFingerprint(proposal.predecessor.fingerprint),
      ),
      parameter(
        "presizing.predecessorRunId",
        proposal.predecessor.producerRunId,
      ),
    );
  }
  parsePreSizingWorksheetParameters(parameters);
  return deepFreeze(parameters);
}

export function parsePreSizingWorksheetCapture(
  value: unknown,
): PreSizingWorksheetCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "mode",
    "recording",
    "projectId",
    "trustedRunId",
    "linkedAt",
    "basis",
    "claim",
    "title",
    "quantities",
    "sources",
    "decision",
    "parameters",
  ], PATH);
  literalValue(
    root.schemaVersion,
    PRE_SIZING_WORKSHEET_SCHEMA,
    `${PATH}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${PATH}.operation`);
  literalValue(
    operation.id,
    RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.id,
    `${PATH}.operation.id`,
  );
  literalValue(
    operation.version,
    RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.version,
    `${PATH}.operation.version`,
  );
  literalValue(root.mode, "documentary-evidence", `${PATH}.mode`);
  const recording = exactRecord(
    root.recording,
    ["status", "authorKind"],
    `${PATH}.recording`,
  );
  literalValue(
    recording.status,
    PRE_SIZING_WORKSHEET_RECORDING_STATUS,
    `${PATH}.recording.status`,
  );
  literalValue(
    recording.authorKind,
    PRE_SIZING_WORKSHEET_AUTHOR_KIND,
    `${PATH}.recording.authorKind`,
  );
  const basis = parseExactThreadSnapshotBasis(root.basis, `${PATH}.basis`);
  const claim = closedRecord(
    root.claim,
    ["id", "revision", "worksheetId", "predecessor"],
    ["id", "revision", "worksheetId"],
    `${PATH}.claim`,
  );
  const claimId = nonEmptyText(claim.id, `${PATH}.claim.id`);
  if (!CLAIM_ID.test(claimId)) {
    throw new TypeError(`${PATH}.claim.id must match ${CLAIM_ID}.`);
  }
  const claimRevision = positiveInteger(claim.revision, `${PATH}.claim.revision`);
  const quantities = parseQuantities(root.quantities, `${PATH}.quantities`);
  const sources = parseSources(root.sources, `${PATH}.sources`);
  for (const quantity of quantities) {
    if (quantity.sourceIndex >= sources.length) {
      throw new TypeError(
        `${PATH}.quantities[${quantity.id}].sourceIndex is out of range.`,
      );
    }
  }
  const decision = exactRecord(
    root.decision,
    ["decisionId", "inputFingerprint"],
    `${PATH}.decision`,
  );
  const capture: PreSizingWorksheetCapture = {
    schemaVersion: PRE_SIZING_WORKSHEET_SCHEMA,
    operation: RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION,
    mode: "documentary-evidence",
    recording: {
      status: PRE_SIZING_WORKSHEET_RECORDING_STATUS,
      authorKind: PRE_SIZING_WORKSHEET_AUTHOR_KIND,
    },
    projectId: safeId(root.projectId, `${PATH}.projectId`),
    trustedRunId: nonEmptyText(root.trustedRunId, `${PATH}.trustedRunId`),
    linkedAt: nonEmptyText(root.linkedAt, `${PATH}.linkedAt`),
    basis,
    claim: {
      id: claimId,
      revision: claimRevision,
      worksheetId: safeId(claim.worksheetId, `${PATH}.claim.worksheetId`),
      ...(claim.predecessor === undefined || claim.predecessor === null ? {} : {
        predecessor: parseRecordReference(
          claim.predecessor,
          `${PATH}.claim.predecessor`,
        ),
      }),
    },
    title: boundedText(
      nonEmptyText(root.title, `${PATH}.title`),
      PRE_SIZING_WORKSHEET_TITLE_MAX,
      `${PATH}.title`,
    ),
    quantities,
    sources,
    decision: {
      decisionId: nonEmptyText(decision.decisionId, `${PATH}.decision.decisionId`),
      inputFingerprint: parseFingerprint(
        decision.inputFingerprint,
        `${PATH}.decision.inputFingerprint`,
      ),
    },
    parameters: parseParameters(root.parameters, `${PATH}.parameters`),
  };
  if (!Array.isArray(root.quantities) || quantities.length < 1) {
    throw new TypeError(`${PATH}.quantities must hold at least one quantity.`);
  }
  if (!Array.isArray(root.sources) || sources.length < 1) {
    throw new TypeError(`${PATH}.sources must hold at least one source.`);
  }
  return deepFreeze(capture);
}

export async function preSizingWorksheetClaimId(
  projectId: string,
  worksheetId: string,
): Promise<string> {
  safeId(projectId, "$projectId");
  safeId(worksheetId, "$worksheetId");
  const fingerprint = await sha256Fingerprint({ projectId, worksheetId });
  return `pre-sizing-worksheet-${fingerprint.digest}`;
}

export function preSizingWorksheetArtifactId(digest: string): string {
  if (!isSha256HexDigest(digest)) {
    throw new TypeError("Pre-sizing worksheet digest must be lowercase SHA-256.");
  }
  return `pre-sizing-worksheet-${digest}`;
}

export function preSizingWorksheetUri(digest: string): string {
  return `${PRE_SIZING_WORKSHEET_URI_PREFIX}${preSizingWorksheetArtifactId(digest)}`;
}

export function canonicalPreSizingWorksheetCaptureText(
  capture: PreSizingWorksheetCapture,
): string {
  return deterministicJson(capture);
}

export function assertUniqueThreadArtifactSources(
  sources: readonly PreSizingWorksheetSource[],
  predecessorArtifactId?: string,
): void {
  const seen = new Set<string>();
  for (const source of sources) {
    if (source.kind !== "thread-artifact") continue;
    if (seen.has(source.artifactId)) {
      throw new TypeError(
        `Duplicate thread-artifact source ${source.artifactId}.`,
      );
    }
    seen.add(source.artifactId);
    if (
      predecessorArtifactId !== undefined &&
      source.artifactId === predecessorArtifactId
    ) {
      throw new TypeError(
        `Thread-artifact source ${source.artifactId} must not equal the predecessor artifact.`,
      );
    }
  }
}

function assertProposal(proposal: PreSizingWorksheetProposal): void {
  safeId(proposal.worksheetId, "$proposal.worksheetId");
  if (!Number.isInteger(proposal.revision) || proposal.revision < 1) {
    throw new TypeError("$proposal.revision must be a positive integer.");
  }
  boundedText(
    proposal.title,
    PRE_SIZING_WORKSHEET_TITLE_MAX,
    "$proposal.title",
  );
  if (
    proposal.quantities.length < 1 ||
    proposal.quantities.length > PRE_SIZING_WORKSHEET_QUANTITY_MAX
  ) {
    throw new TypeError(
      `$proposal.quantities must contain 1 to ${PRE_SIZING_WORKSHEET_QUANTITY_MAX} quantities.`,
    );
  }
  proposal.quantities.forEach((quantity, index) => {
    parseQuantity(quantity, `$proposal.quantities[${index}]`, proposal.sources.length);
  });
  const ids = proposal.quantities.map((quantity) => quantity.id);
  rejectDuplicates(ids, "$proposal.quantities.id");
  if (
    proposal.sources.length < 1 ||
    proposal.sources.length > PRE_SIZING_WORKSHEET_SOURCE_MAX
  ) {
    throw new TypeError(
      `$proposal.sources must contain 1 to ${PRE_SIZING_WORKSHEET_SOURCE_MAX} sources.`,
    );
  }
  proposal.sources.forEach((source, index) => {
    parseSource(source, `$proposal.sources[${index}]`);
  });
  if (proposal.predecessor) {
    parseRecordReference(proposal.predecessor, "$proposal.predecessor");
  }
  assertUniqueThreadArtifactSources(
    proposal.sources,
    proposal.predecessor?.artifactId,
  );
}

function parameterMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ReadonlyMap<string, string | number | boolean> {
  const map = new Map<string, string | number | boolean>();
  for (const item of parameters) {
    closedRecord(item, ["key", "label", "value", "unit"], [
      "key",
      "label",
      "value",
    ], "Pre-sizing worksheet parameter");
    if (typeof item.key !== "string") {
      throw new TypeError(
        "Each pre-sizing worksheet parameter key must be a string.",
      );
    }
    if (map.has(item.key)) {
      throw new TypeError(`Duplicate pre-sizing parameter ${item.key}.`);
    }
    if (item.unit !== undefined) {
      throw new TypeError(`${item.key} must not carry a unit.`);
    }
    map.set(item.key, item.value);
  }
  return map;
}

function parameter(
  key: string,
  value: string | number | boolean,
): EngineeringDecisionProposalParameter {
  return { key, label: key, value };
}

function stringValue(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const value = map.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Missing pre-sizing parameter ${key}.`);
  }
  return value;
}

function optionalText(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Pre-sizing parameter ${key} must be non-empty text.`);
  }
  return value;
}

function idValue(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  return safeId(stringValue(map, key), key);
}

function integerValue(
  map: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = map.get(key);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`Missing pre-sizing parameter ${key}.`);
  }
  return value;
}

function boundedText(value: string, max: number, path: string): string {
  if (value.length === 0 || value.length > max) {
    throw new TypeError(`${path} must be 1 to ${max} characters.`);
  }
  return value;
}

function decimalValue(value: string, path: string): string {
  if (value.length === 0 || value.length > PRE_SIZING_WORKSHEET_VALUE_MAX) {
    throw new TypeError(
      `${path} must be 1 to ${PRE_SIZING_WORKSHEET_VALUE_MAX} characters.`,
    );
  }
  if (!DECIMAL.test(value)) {
    throw new TypeError(`${path} must be a strict decimal string.`);
  }
  return value;
}

function prefixedFingerprint(fingerprint: ContentFingerprint): string {
  return `${fingerprint.algorithm}:${fingerprint.digest}`;
}

function parsePrefixedFingerprint(value: unknown, path: string): ContentFingerprint {
  const text = nonEmptyText(value, path);
  const [algorithm, digest] = text.split(":");
  if (algorithm !== "sha256" || !isSha256HexDigest(digest)) {
    throw new TypeError(`${path} must be a sha256:<hex> fingerprint.`);
  }
  return { algorithm, digest };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  if (root.algorithm !== "sha256") {
    throw new TypeError(`${path}.algorithm must be sha256.`);
  }
  const digest = nonEmptyText(root.digest, `${path}.digest`);
  if (!isSha256HexDigest(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256.`);
  }
  return { algorithm: "sha256", digest };
}

function parseQuantityFromParameters(
  map: ReadonlyMap<string, string | number | boolean>,
  index: number,
  sourceCount: number,
): PreSizingWorksheetQuantity {
  const base = `presizing.quantity.${index}`;
  const label = optionalText(map, `${base}.label`);
  const assumption = optionalText(map, `${base}.assumption`);
  return parseQuantity(
    {
      id: idValue(map, `${base}.id`),
      ...(label === undefined ? {} : { label }),
      value: decimalValue(
        stringValue(map, `${base}.value`),
        `${base}.value`,
      ),
      unit: boundedText(
        stringValue(map, `${base}.unit`),
        PRE_SIZING_WORKSHEET_UNIT_MAX,
        `${base}.unit`,
      ),
      sourceIndex: integerValue(map, `${base}.sourceIndex`),
      ...(assumption === undefined ? {} : { assumption }),
    },
    base,
    sourceCount,
  );
}

function quantityParameters(
  quantity: PreSizingWorksheetQuantity,
  index: number,
): EngineeringDecisionProposalParameter[] {
  const base = `presizing.quantity.${index}`;
  return [
    parameter(`${base}.id`, quantity.id),
    ...(quantity.label === undefined
      ? []
      : [parameter(`${base}.label`, quantity.label)]),
    parameter(`${base}.value`, quantity.value),
    parameter(`${base}.unit`, quantity.unit),
    parameter(`${base}.sourceIndex`, quantity.sourceIndex),
    ...(quantity.assumption === undefined
      ? []
      : [parameter(`${base}.assumption`, quantity.assumption)]),
  ];
}

function parseQuantity(
  value: unknown,
  path: string,
  sourceCount: number,
): PreSizingWorksheetQuantity {
  const root = closedRecord(
    value,
    [
      "id",
      "label",
      "value",
      "unit",
      "sourceIndex",
      "assumption",
    ],
    ["id", "value", "unit", "sourceIndex"],
    path,
  );
  const sourceIndex = positiveIntegerOrZero(root.sourceIndex, `${path}.sourceIndex`);
  if (sourceIndex >= sourceCount) {
    throw new TypeError(`${path}.sourceIndex is out of range.`);
  }
  return {
    id: safeId(root.id, `${path}.id`),
    ...(root.label === undefined || root.label === null ? {} : {
      label: boundedText(
        nonEmptyText(root.label, `${path}.label`),
        PRE_SIZING_WORKSHEET_LABEL_MAX,
        `${path}.label`,
      ),
    }),
    value: decimalValue(
      nonEmptyText(root.value, `${path}.value`),
      `${path}.value`,
    ),
    unit: boundedText(
      nonEmptyText(root.unit, `${path}.unit`),
      PRE_SIZING_WORKSHEET_UNIT_MAX,
      `${path}.unit`,
    ),
    sourceIndex,
    ...(root.assumption === undefined || root.assumption === null ? {} : {
      assumption: boundedText(
        nonEmptyText(root.assumption, `${path}.assumption`),
        PRE_SIZING_WORKSHEET_ASSUMPTION_MAX,
        `${path}.assumption`,
      ),
    }),
  };
}

function positiveIntegerOrZero(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer.`);
  }
  return value;
}

function parseSourceFromParameters(
  map: ReadonlyMap<string, string | number | boolean>,
  index: number,
): PreSizingWorksheetSource {
  const base = `presizing.source.${index}`;
  const kind = stringValue(map, `${base}.kind`);
  if (kind === "agent-resource") {
    return {
      kind,
      resourceRef: parseAgentResourceReference({
        schemaVersion: "agent-resource-capture/1.0",
        uri: stringValue(map, `${base}.uri`),
        name: stringValue(map, `${base}.name`),
        mimeType: stringValue(map, `${base}.mimeType`),
        representation: stringValue(map, `${base}.representation`),
        byteCount: integerValue(map, `${base}.byteCount`),
        fingerprint: parsePrefixedFingerprint(
          stringValue(map, `${base}.fingerprint`),
          `${base}.fingerprint`,
        ),
      }, base),
    };
  }
  if (kind === "thread-artifact") {
    return {
      kind,
      artifactId: idValue(map, `${base}.artifactId`),
      fingerprint: parsePrefixedFingerprint(
        stringValue(map, `${base}.fingerprint`),
        `${base}.fingerprint`,
      ),
      producerRunId: idValue(map, `${base}.producerRunId`),
    };
  }
  throw new TypeError(
    `${base}.kind must be agent-resource or thread-artifact.`,
  );
}

function sourceParameters(
  source: PreSizingWorksheetSource,
  index: number,
): EngineeringDecisionProposalParameter[] {
  const base = `presizing.source.${index}`;
  if (source.kind === "agent-resource") {
    const ref = source.resourceRef;
    return [
      parameter(`${base}.kind`, source.kind),
      parameter(`${base}.uri`, ref.uri),
      parameter(`${base}.name`, ref.name),
      parameter(`${base}.mimeType`, ref.mimeType),
      parameter(`${base}.representation`, ref.representation),
      parameter(`${base}.byteCount`, ref.byteCount),
      parameter(
        `${base}.fingerprint`,
        prefixedFingerprint(ref.fingerprint),
      ),
    ];
  }
  return [
    parameter(`${base}.kind`, source.kind),
    parameter(`${base}.artifactId`, source.artifactId),
    parameter(
      `${base}.fingerprint`,
      prefixedFingerprint(source.fingerprint),
    ),
    parameter(`${base}.producerRunId`, source.producerRunId),
  ];
}

function parseSource(value: unknown, path: string): PreSizingWorksheetSource {
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
    return {
      kind: "agent-resource",
      resourceRef: parseAgentResourceReference(
        root.resourceRef,
        `${path}.resourceRef`,
      ),
    };
  }
  if (root.kind === "thread-artifact") {
    if (root.resourceRef !== undefined) {
      throw new TypeError(
        `${path} thread-artifact sources must not carry a resourceRef.`,
      );
    }
    return {
      kind: "thread-artifact",
      artifactId: safeId(root.artifactId, `${path}.artifactId`),
      fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
      producerRunId: safeId(root.producerRunId, `${path}.producerRunId`),
    };
  }
  throw new TypeError(`${path}.kind must be agent-resource or thread-artifact.`);
}

function parsePredecessorFromParameters(
  map: ReadonlyMap<string, string | number | boolean>,
): PreSizingWorksheetRecordReference | undefined {
  const present = map.has("presizing.predecessorArtifactId") ||
    map.has("presizing.predecessorFingerprint") ||
    map.has("presizing.predecessorRunId");
  if (!present) return undefined;
  return {
    artifactId: idValue(map, "presizing.predecessorArtifactId"),
    fingerprint: parsePrefixedFingerprint(
      stringValue(map, "presizing.predecessorFingerprint"),
      "presizing.predecessorFingerprint",
    ),
    producerRunId: idValue(map, "presizing.predecessorRunId"),
  };
}

function assertClosedParameterKeys(
  map: ReadonlyMap<string, string | number | boolean>,
  quantityCount: number,
  sourceCount: number,
  hasPredecessor: boolean,
): void {
  const expected = new Set([
    "presizing.worksheetId",
    "presizing.revision",
    "presizing.title",
    "presizing.quantityCount",
    "presizing.sourceCount",
  ]);
  for (let index = 0; index < quantityCount; index++) {
    const base = `presizing.quantity.${index}`;
    for (const key of ["id", "label", "value", "unit", "sourceIndex", "assumption"]) {
      expected.add(`${base}.${key}`);
    }
  }
  for (let index = 0; index < sourceCount; index++) {
    const base = `presizing.source.${index}`;
    for (
      const key of [
        "kind",
        "uri",
        "name",
        "mimeType",
        "representation",
        "byteCount",
        "fingerprint",
        "artifactId",
        "producerRunId",
      ]
    ) {
      expected.add(`${base}.${key}`);
    }
  }
  if (hasPredecessor) {
    expected.add("presizing.predecessorArtifactId");
    expected.add("presizing.predecessorFingerprint");
    expected.add("presizing.predecessorRunId");
  }
  for (const key of map.keys()) {
    if (!expected.has(key)) {
      throw new TypeError(`Unexpected pre-sizing parameter ${key}.`);
    }
  }
}

function parseQuantities(value: unknown, path: string): PreSizingWorksheetQuantity[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  if (value.length < 1 || value.length > PRE_SIZING_WORKSHEET_QUANTITY_MAX) {
    throw new TypeError(
      `${path} must contain 1 to ${PRE_SIZING_WORKSHEET_QUANTITY_MAX} quantities.`,
    );
  }
  const quantities = value.map((item, index) =>
    parseQuantity(item, `${path}[${index}]`, Number.MAX_SAFE_INTEGER)
  );
  const ids = quantities.map((quantity) => quantity.id);
  rejectDuplicates(ids, `${path}.id`);
  return quantities;
}

function parseSources(value: unknown, path: string): PreSizingWorksheetSource[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  if (value.length < 1 || value.length > PRE_SIZING_WORKSHEET_SOURCE_MAX) {
    throw new TypeError(
      `${path} must contain 1 to ${PRE_SIZING_WORKSHEET_SOURCE_MAX} sources.`,
    );
  }
  return value.map((item, index) => parseSource(item, `${path}[${index}]`));
}

function parseRecordReference(
  value: unknown,
  path: string,
): PreSizingWorksheetRecordReference {
  const root = exactRecord(
    value,
    ["artifactId", "fingerprint", "producerRunId"],
    path,
  );
  return {
    artifactId: safeId(root.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
    producerRunId: safeId(root.producerRunId, `${path}.producerRunId`),
  };
}

function parseParameters(
  value: unknown,
  path: string,
): readonly EngineeringDecisionProposalParameter[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  return value.map((item, index) => {
    const root = exactRecord(item, ["key", "label", "value"], `${path}[${index}]`);
    const key = nonEmptyText(root.key, `${path}[${index}].key`);
    const label = nonEmptyText(root.label, `${path}[${index}].label`);
    if (
      typeof root.value !== "string" && typeof root.value !== "number" &&
      typeof root.value !== "boolean"
    ) {
      throw new TypeError(`${path}[${index}].value must be a scalar.`);
    }
    return { key, label, value: root.value };
  });
}
