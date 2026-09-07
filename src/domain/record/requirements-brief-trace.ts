/**
 * Closed documentary trace capture for legacy requirements records.
 *
 * This appendix binds one existing requirements-capture member to the exact
 * reviewed brief clause that its already-recorded requirement reflects.
 * It neither creates requirements nor asserts satisfaction, proof, approval,
 * storage attestation, or a native SysML edit.
 */

import {
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../kernel/deterministic-json.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../project/engineering-project.ts";
import { parseExactThreadSnapshotBasis } from "../project/thread-tip.ts";
import type { ContentFingerprint } from "../thread/thread-snapshot.ts";
import {
  parseRequirementsBriefProvenance,
  type RequirementsBriefProvenance,
} from "../architecture/requirements/requirements-brief-provenance.ts";
import {
  parseTracedRequirementsProposalParameters,
  type TracedRequirementsProposal,
  tracedRequirementsProposalParameters,
} from "../architecture/requirements/requirements-traced-proposal.ts";

export const RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION = {
  id: "record.seal-requirements-brief-trace",
  version: "1",
} as const;

export const REQUIREMENTS_BRIEF_TRACE_SCHEMA = "requirements-brief-trace/1.0" as const;

export const REQUIREMENTS_BRIEF_TRACE_URI_PREFIX =
  "casys://requirements-brief-trace/" as const;

export interface RequirementsBriefTraceCaptureReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly schemaVersion:
    | "requirements-capture/3.0"
    | "requirements-capture/4.0"
    | "requirements-capture/5.0"
    | "requirements-capture/6.0";
}

export interface RequirementsBriefTraceRecordReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface RequirementsBriefTraceProposal {
  readonly requirementsCapture: RequirementsBriefTraceCaptureReference;
  readonly requirements: TracedRequirementsProposal;
  readonly predecessor?: RequirementsBriefTraceRecordReference;
}

export interface RequirementsBriefTraceCapture {
  readonly schemaVersion: typeof REQUIREMENTS_BRIEF_TRACE_SCHEMA;
  readonly operation: typeof RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION;
  readonly mode: "retrospective-documentary";
  readonly projectId: string;
  readonly trustedRunId: string;
  readonly linkedAt: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly requirementsCapture: RequirementsBriefTraceCaptureReference;
  readonly claim: {
    readonly id: string;
    readonly revision: number;
    readonly targetElementId: string;
    readonly requirementId: string;
    readonly predecessor?: RequirementsBriefTraceRecordReference;
  };
  readonly decision: {
    readonly decisionId: string;
    readonly inputFingerprint: ContentFingerprint;
  };
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
  readonly briefProvenance: RequirementsBriefProvenance;
}

const PATH = "$requirementsBriefTraceCapture";
const TRACE_KEYS = [
  "trace.artifactId",
  "trace.captureFingerprint",
  "trace.producerRunId",
  "trace.captureSchema",
  "trace.predecessorArtifactId",
  "trace.predecessorFingerprint",
  "trace.predecessorRunId",
] as const;

type TraceKey = (typeof TRACE_KEYS)[number];
const TRACE_KEY_SET: ReadonlySet<string> = new Set(TRACE_KEYS);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CLAIM_ID = /^requirements-brief-claim-[a-f0-9]{64}$/;

/**
 * Parse this appendix's capture metadata plus the complete existing
 * traced-requirements grammar. The existing capture itself is not reopened
 * here: exact persisted-capture equality remains adapter-owned.
 */
export function parseRequirementsBriefTraceParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): RequirementsBriefTraceProposal {
  if (!Array.isArray(parameters)) {
    throw new TypeError("Requirements brief trace parameters must be an array.");
  }

  const metadata = new Map<TraceKey, EngineeringDecisionProposalParameter>();
  const traced: EngineeringDecisionProposalParameter[] = [];
  const seen = new Set<string>();
  for (const parameter of parameters) {
    closedRecord(parameter, ["key", "label", "value", "unit"], [
      "key",
      "label",
      "value",
    ], "Requirements brief trace parameter");
    if (typeof parameter.key !== "string") {
      throw new TypeError(
        "Each requirements brief trace parameter key must be a string.",
      );
    }
    if (seen.has(parameter.key)) {
      throw new TypeError(
        `Requirements brief trace parameter "${parameter.key}" is duplicated.`,
      );
    }
    seen.add(parameter.key);
    if (parameter.key.startsWith("trace.") && !TRACE_KEY_SET.has(parameter.key)) {
      throw new TypeError(
        `Requirements brief trace parameter "${parameter.key}" is unknown.`,
      );
    }
    if (TRACE_KEY_SET.has(parameter.key)) {
      metadata.set(parameter.key as TraceKey, parameter);
    } else {
      traced.push(parameter);
    }
  }

  const requirementsCapture = parseRequirementsCaptureReferenceFromParameters(
    metadata,
  );
  const requirements = parseTracedRequirementsProposalParameters(traced);
  assertAtomicIdentityRequirement(requirements);
  const predecessor = parsePredecessorFromParameters(metadata);
  return deepFreeze(
    predecessor === undefined
      ? { requirementsCapture, requirements }
      : { requirementsCapture, requirements, predecessor },
  );
}

/** Encode the complete traced-requirements grammar with exactly four metadata keys. */
export function requirementsBriefTraceParameters(
  proposal: RequirementsBriefTraceProposal,
): readonly EngineeringDecisionProposalParameter[] {
  assertRequirementsCaptureReference(
    proposal.requirementsCapture,
    "$proposal.requirementsCapture",
  );
  assertAtomicIdentityRequirement(proposal.requirements);
  if (proposal.predecessor !== undefined) {
    assertRecordReference(proposal.predecessor, "$proposal.predecessor");
  }
  const parameters = [
    ...tracedRequirementsProposalParameters(proposal.requirements),
    parameter("trace.artifactId", proposal.requirementsCapture.artifactId),
    parameter(
      "trace.captureFingerprint",
      prefixedFingerprint(proposal.requirementsCapture.fingerprint),
    ),
    parameter("trace.producerRunId", proposal.requirementsCapture.producerRunId),
    parameter("trace.captureSchema", proposal.requirementsCapture.schemaVersion),
  ];
  if (proposal.predecessor) {
    parameters.push(
      parameter("trace.predecessorArtifactId", proposal.predecessor.artifactId),
      parameter(
        "trace.predecessorFingerprint",
        prefixedFingerprint(proposal.predecessor.fingerprint),
      ),
      parameter("trace.predecessorRunId", proposal.predecessor.producerRunId),
    );
  }
  // Reopen the encoder's own output so a malformed hand-built typed proposal
  // cannot create an unsigned grammar variant.
  parseRequirementsBriefTraceParameters(parameters);
  return deepFreeze(parameters);
}

/** Parse the closed persisted documentary capture. */
export function parseRequirementsBriefTraceCapture(
  value: unknown,
): RequirementsBriefTraceCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "mode",
    "projectId",
    "trustedRunId",
    "linkedAt",
    "basis",
    "requirementsCapture",
    "claim",
    "decision",
    "parameters",
    "briefProvenance",
  ], PATH);
  literalValue(
    root.schemaVersion,
    REQUIREMENTS_BRIEF_TRACE_SCHEMA,
    `${PATH}.schemaVersion`,
  );
  literalValue(root.mode, "retrospective-documentary", `${PATH}.mode`);
  const operation = parseOperation(root.operation);
  const projectId = safeId(root.projectId, `${PATH}.projectId`);
  const basis = parseExactThreadSnapshotBasis(root.basis, `${PATH}.basis`);
  const parameters = parseParameters(root.parameters, `${PATH}.parameters`);
  const proposal = parseRequirementsBriefTraceParameters(parameters);
  const requirementsCapture = parseRequirementsCaptureReference(
    root.requirementsCapture,
    `${PATH}.requirementsCapture`,
  );
  if (!sameCaptureReference(proposal.requirementsCapture, requirementsCapture)) {
    throw new TypeError(
      `${PATH}.parameters trace capture metadata must equal ${PATH}.requirementsCapture.`,
    );
  }
  const provenance = parseRequirementsBriefProvenance(root.briefProvenance);
  if (provenance.briefBasis.projectId !== projectId) {
    throw new TypeError(
      `${PATH}.briefProvenance.briefBasis.projectId must equal ${PATH}.projectId.`,
    );
  }
  assertProvenanceMatchesProposal(proposal.requirements, provenance);
  const claim = parseClaim(root.claim, projectId, proposal);

  const decision = exactRecord(
    root.decision,
    ["decisionId", "inputFingerprint"],
    `${PATH}.decision`,
  );
  const capture: RequirementsBriefTraceCapture = {
    schemaVersion: REQUIREMENTS_BRIEF_TRACE_SCHEMA,
    operation,
    mode: "retrospective-documentary",
    projectId,
    trustedRunId: safeId(root.trustedRunId, `${PATH}.trustedRunId`),
    linkedAt: parseIsoUtc(root.linkedAt, `${PATH}.linkedAt`),
    basis,
    requirementsCapture,
    claim,
    decision: {
      decisionId: safeId(decision.decisionId, `${PATH}.decision.decisionId`),
      inputFingerprint: parseFingerprint(
        decision.inputFingerprint,
        `${PATH}.decision.inputFingerprint`,
      ),
    },
    parameters,
    briefProvenance: provenance,
  };
  return deepFreeze(capture);
}

export function requirementsBriefTraceArtifactId(
  fingerprint: ContentFingerprint,
): string {
  return `requirements-brief-trace-${
    parseFingerprint(fingerprint, "$fingerprint").digest
  }`;
}

export function requirementsBriefTraceUri(fingerprint: ContentFingerprint): string {
  return `${REQUIREMENTS_BRIEF_TRACE_URI_PREFIX}sha256/${
    parseFingerprint(fingerprint, "$fingerprint").digest
  }`;
}

export async function requirementsBriefTraceClaimId(
  projectId: string,
  targetElementId: string,
  requirementId: string,
): Promise<string> {
  safeId(projectId, "$projectId");
  safeId(targetElementId, "$targetElementId");
  safeId(requirementId, "$requirementId");
  const fingerprint = await sha256Fingerprint({
    projectId,
    targetElementId,
    requirementId,
  });
  return `requirements-brief-claim-${fingerprint.digest}`;
}

function parseRequirementsCaptureReferenceFromParameters(
  metadata: ReadonlyMap<TraceKey, EngineeringDecisionProposalParameter>,
): RequirementsBriefTraceCaptureReference {
  const required = (key: TraceKey): EngineeringDecisionProposalParameter => {
    const parameter = metadata.get(key);
    if (!parameter) throw new TypeError(`${key} is required.`);
    if (parameter.unit !== undefined) {
      throw new TypeError(`${key} must not carry a unit.`);
    }
    return parameter;
  };
  return parseRequirementsCaptureReference({
    artifactId: required("trace.artifactId").value,
    fingerprint: parsePrefixedFingerprint(
      required("trace.captureFingerprint").value,
      "trace.captureFingerprint",
    ),
    producerRunId: required("trace.producerRunId").value,
    schemaVersion: required("trace.captureSchema").value,
  }, "$parameters");
}

function parsePredecessorFromParameters(
  metadata: ReadonlyMap<TraceKey, EngineeringDecisionProposalParameter>,
): RequirementsBriefTraceRecordReference | undefined {
  const keys = [
    "trace.predecessorArtifactId",
    "trace.predecessorFingerprint",
    "trace.predecessorRunId",
  ] as const;
  const present = keys.filter((key) => metadata.has(key));
  if (present.length === 0) return undefined;
  if (present.length !== keys.length) {
    throw new TypeError(
      "Requirements brief trace predecessor metadata must be all present or all absent.",
    );
  }
  const required = (
    key: (typeof keys)[number],
  ): EngineeringDecisionProposalParameter => {
    const parameter = metadata.get(key)!;
    if (parameter.unit !== undefined) {
      throw new TypeError(`${key} must not carry a unit.`);
    }
    return parameter;
  };
  return parseRecordReference({
    artifactId: required("trace.predecessorArtifactId").value,
    fingerprint: parsePrefixedFingerprint(
      required("trace.predecessorFingerprint").value,
      "trace.predecessorFingerprint",
    ),
    producerRunId: required("trace.predecessorRunId").value,
  }, "$parameters.predecessor");
}

function parseRequirementsCaptureReference(
  value: unknown,
  path: string,
): RequirementsBriefTraceCaptureReference {
  const root = exactRecord(value, [
    "artifactId",
    "fingerprint",
    "producerRunId",
    "schemaVersion",
  ], path);
  const schemaVersion = root.schemaVersion;
  if (
    schemaVersion !== "requirements-capture/3.0" &&
    schemaVersion !== "requirements-capture/4.0" &&
    schemaVersion !== "requirements-capture/5.0" &&
    schemaVersion !== "requirements-capture/6.0"
  ) {
    throw new TypeError(
      `${path}.schemaVersion must be requirements-capture/3.0, /4.0, /5.0, or /6.0.`,
    );
  }
  return deepFreeze({
    artifactId: safeId(root.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
    producerRunId: safeId(root.producerRunId, `${path}.producerRunId`),
    schemaVersion,
  });
}

function parseRecordReference(
  value: unknown,
  path: string,
): RequirementsBriefTraceRecordReference {
  const root = exactRecord(value, ["artifactId", "fingerprint", "producerRunId"], path);
  return deepFreeze({
    artifactId: safeId(root.artifactId, `${path}.artifactId`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
    producerRunId: safeId(root.producerRunId, `${path}.producerRunId`),
  });
}

function assertRecordReference(
  reference: RequirementsBriefTraceRecordReference,
  path: string,
): void {
  parseRecordReference(reference, path);
}

function assertRequirementsCaptureReference(
  reference: RequirementsBriefTraceCaptureReference,
  path: string,
): void {
  parseRequirementsCaptureReference(reference, path);
}

function parseOperation(
  value: unknown,
): typeof RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION {
  const operation = exactRecord(value, ["id", "version"], `${PATH}.operation`);
  literalValue(
    operation.id,
    RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.id,
    `${PATH}.operation.id`,
  );
  literalValue(
    operation.version,
    RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.version,
    `${PATH}.operation.version`,
  );
  return RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION;
}

function parseParameters(
  value: unknown,
  path: string,
): readonly EngineeringDecisionProposalParameter[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value.map((item, index) => {
    const parameter = closedRecord(item, ["key", "label", "value", "unit"], [
      "key",
      "label",
      "value",
    ], `${path}[${index}]`);
    const base: EngineeringDecisionProposalParameter = {
      key: typeof parameter.key === "string" ? parameter.key : (() => {
        throw new TypeError(`${path}[${index}].key must be a string.`);
      })(),
      label: nonEmptyText(parameter.label, `${path}[${index}].label`),
      value: parseParameterValue(parameter.value, `${path}[${index}].value`),
    };
    return parameter.unit === undefined ? base : {
      ...base,
      unit: nonEmptyText(parameter.unit, `${path}[${index}].unit`),
    };
  });
}

function parseParameterValue(value: unknown, path: string): string | number | boolean {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError(`${path} must be a finite number, string, or boolean.`);
}

function assertAtomicIdentityRequirement(proposal: TracedRequirementsProposal): void {
  const entries = new Map(proposal.requirements.map((entry) => [entry.metric, entry]));
  if (
    proposal.requirements.length !== 1 ||
    proposal.briefSource.requirements.length !== 1 ||
    entries.size !== 1
  ) {
    throw new TypeError(
      "Requirements brief trace must name exactly one parsed requirement and source declaration.",
    );
  }
  for (const source of proposal.briefSource.requirements) {
    const entry = entries.get(source.requirementId);
    if (
      !entry || source.transformation !== "identity" ||
      !Object.is(source.declaredThreshold.value, entry.threshold.value) ||
      source.declaredThreshold.unit !== entry.threshold.unit
    ) {
      throw new TypeError(
        "Requirements brief trace accepts only identity declared thresholds equal to existing proposal thresholds.",
      );
    }
  }
}

function parseClaim(
  value: unknown,
  projectId: string,
  proposal: RequirementsBriefTraceProposal,
): RequirementsBriefTraceCapture["claim"] {
  const root = closedRecord(
    value,
    [
      "id",
      "revision",
      "targetElementId",
      "requirementId",
      "predecessor",
    ],
    ["id", "revision", "targetElementId", "requirementId"],
    `${PATH}.claim`,
  );
  const id = safeId(root.id, `${PATH}.claim.id`);
  if (!CLAIM_ID.test(id)) {
    throw new TypeError(`${PATH}.claim.id must be requirements-brief-claim-<sha256>.`);
  }
  // projectId is intentionally accepted here only after validating its stable
  // identity.  The adapter recomputes the digest against its reopened target.
  safeId(projectId, `${PATH}.projectId`);
  const requirementId = safeId(root.requirementId, `${PATH}.claim.requirementId`);
  if (requirementId !== proposal.requirements.requirements[0]!.metric) {
    throw new TypeError(
      `${PATH}.claim.requirementId must equal the sole parsed requirement metric.`,
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
    throw new TypeError(`${PATH}.claim.revision must equal 1 without a predecessor.`);
  }
  return predecessor === undefined
    ? {
      id,
      revision,
      targetElementId: safeId(root.targetElementId, `${PATH}.claim.targetElementId`),
      requirementId,
    }
    : {
      id,
      revision,
      targetElementId: safeId(root.targetElementId, `${PATH}.claim.targetElementId`),
      requirementId,
      predecessor,
    };
}

function assertProvenanceMatchesProposal(
  requirements: TracedRequirementsProposal,
  provenance: RequirementsBriefProvenance,
): void {
  if (
    deterministicJson(requirements.briefSource.basis) !==
      deterministicJson(provenance.briefBasis) ||
    !fingerprintsEqual(
      requirements.briefSource.briefContentFingerprint,
      provenance.briefContentFingerprint,
    ) ||
    requirements.briefSource.containerSourceItemId !==
      provenance.container.sourceItem.id
  ) {
    throw new TypeError(
      "Requirements brief provenance does not match the complete parsed proposal source basis.",
    );
  }
  const declarations = new Map(
    requirements.briefSource.requirements.map((
      source,
    ) => [source.requirementId, source]),
  );
  const provenanceByMetric = new Map(
    provenance.requirements.map((source) => [source.requirementId, source]),
  );
  if (
    declarations.size !== requirements.requirements.length ||
    provenanceByMetric.size !== requirements.requirements.length
  ) {
    throw new TypeError(
      "Requirements brief provenance must bijectively name parsed requirement metrics.",
    );
  }
  for (const requirement of requirements.requirements) {
    const declaration = declarations.get(requirement.metric);
    const source = provenanceByMetric.get(requirement.metric);
    if (
      !declaration || !source || declaration.sourceItemId !== source.sourceItem.id ||
      !Object.is(declaration.declaredThreshold.value, source.declaredThreshold.value) ||
      declaration.declaredThreshold.unit !== source.declaredThreshold.unit ||
      declaration.transformation !== source.transformation
    ) {
      throw new TypeError(
        `Requirements brief provenance does not exactly match requirement "${requirement.metric}".`,
      );
    }
  }
}

function sameCaptureReference(
  left: RequirementsBriefTraceCaptureReference,
  right: RequirementsBriefTraceCaptureReference,
): boolean {
  return left.artifactId === right.artifactId &&
    left.producerRunId === right.producerRunId &&
    left.schemaVersion === right.schemaVersion &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function sameRecordReference(
  left: RequirementsBriefTraceRecordReference | undefined,
  right: RequirementsBriefTraceRecordReference | undefined,
): boolean {
  return left?.artifactId === right?.artifactId &&
    left?.producerRunId === right?.producerRunId &&
    fingerprintsEqual(left?.fingerprint, right?.fingerprint);
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
