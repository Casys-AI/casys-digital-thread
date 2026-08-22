/**
 * Closed, provider-free MRTR grammar for admitting one technical compilation.
 *
 * This contract seals identities that a human can review. It does not admit an
 * execution, select a provider, name a tool, or carry runtime arguments. The
 * later executor must independently reopen every content-addressed capture and
 * compare it with this decision before it may prepare an execution plan.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import type {
  TechnicalBindingRelation,
  TechnicalCompilationProfile,
  TechnicalCompilationTarget,
} from "./technical-compilation.ts";

/** Human-reviewed operation identity. It confers no execution authority. */
export const COMPILE_SEAL_ADMISSION_OPERATION = {
  id: "compile.seal-admission",
  version: "1",
} as const;

export const TECHNICAL_COMPILATION_ADMISSION_SCHEMA =
  "technical-compilation-admission/1.0" as const;

export const TECHNICAL_COMPILATION_ADMISSION_LIMITS = {
  maxSources: 32,
  maxBindings: 256,
  maxCompilationProfileRequests: 32,
  maxSourceIdsPerProfileRequest: 32,
} as const;

export interface TechnicalCompilationAdmissionSource {
  readonly id: string;
  readonly role: TechnicalCompilationProfile["sourceRole"];
  readonly language: TechnicalCompilationProfile["language"];
  /** Exact server-owned source-capture/profile identity. */
  readonly profileId: string;
  readonly profileVersion: string;
  readonly profileFingerprint: ContentFingerprint;
  readonly analyzer: {
    readonly id: string;
    readonly version: string;
  };
  readonly sourceFingerprint: ContentFingerprint;
  readonly captureFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
}

export interface TechnicalCompilationAdmissionBinding {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceSymbolId: string;
  readonly sysmlElementId: string;
  readonly sysmlElementKind: string;
  readonly relation: TechnicalBindingRelation;
}

export interface TechnicalCompilationAdmissionProfileRequest {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly target: TechnicalCompilationTarget;
  readonly sourceIds: readonly string[];
  readonly profileFingerprint: ContentFingerprint;
}

/**
 * Complete identity reviewed by the human before a compilation can be sealed.
 *
 * `ready-for-review` is deliberately the only accepted status. An unresolved
 * or rejected compiler result cannot be transformed into an admission merely
 * by asking for a decision.
 */
export interface TechnicalCompilationAdmission {
  readonly schemaVersion: typeof TECHNICAL_COMPILATION_ADMISSION_SCHEMA;
  readonly draft: {
    readonly draftId: string;
    readonly projectId: string;
    readonly documentFingerprint: ContentFingerprint;
    readonly envelopeFingerprint: ContentFingerprint;
  };
  readonly basis: {
    readonly fingerprint: ContentFingerprint;
    readonly thread: {
      readonly projectId: string;
      readonly subjectId: string;
      readonly snapshotId: string;
      readonly revision: number;
      readonly fingerprint: ContentFingerprint;
    };
    readonly sysml: {
      readonly artifactId: string;
      readonly artifactFingerprint: ContentFingerprint;
      readonly captureId: string;
      readonly editingContextId: string;
      readonly rootElementId: string;
      readonly rootElementKind: "Package";
      readonly anchorFingerprint: ContentFingerprint;
    };
  };
  readonly sources: readonly TechnicalCompilationAdmissionSource[];
  readonly bindings: readonly TechnicalCompilationAdmissionBinding[];
  readonly compilationProfileRequests:
    readonly TechnicalCompilationAdmissionProfileRequest[];
  readonly compilation: {
    readonly fingerprint: ContentFingerprint;
    readonly status: "ready-for-review";
  };
}

type ParameterValue = EngineeringDecisionProposalParameter["value"];

interface ParameterSpec {
  readonly key: string;
  readonly label: string;
  readonly value: ParameterValue;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const BINDING_RELATIONS = new Set<TechnicalBindingRelation>([
  "represents",
  "parameterizes",
  "satisfies",
  "constrains",
]);
const TARGET_SOURCE_CONTRACT: Readonly<
  Record<
    TechnicalCompilationTarget,
    {
      readonly role: TechnicalCompilationProfile["sourceRole"];
      readonly language: TechnicalCompilationProfile["language"];
    }
  >
> = {
  "build123d-source": { role: "cad-script", language: "python" },
  "calculix-source-candidate": { role: "cad-script", language: "python" },
  "modelica-source-qualification": {
    role: "modelica-model",
    language: "modelica",
  },
  "spice-circuit-source": { role: "spice-circuit", language: "spice" },
};

const FIXED_PARAMETER_COUNT = 24;
const SOURCE_PARAMETER_COUNT = 11;
const BINDING_PARAMETER_COUNT = 6;
const PROFILE_REQUEST_FIXED_PARAMETER_COUNT = 5;
const MAX_PARAMETER_COUNT = FIXED_PARAMETER_COUNT +
  TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSources * SOURCE_PARAMETER_COUNT +
  TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxBindings * BINDING_PARAMETER_COUNT +
  TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxCompilationProfileRequests *
    (PROFILE_REQUEST_FIXED_PARAMETER_COUNT +
      TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSourceIdsPerProfileRequest);

/**
 * Encode a typed admission into the unique canonical MRTR parameter sequence.
 * Collections are sorted by stable identities before indexes are assigned.
 */
export function encodeTechnicalCompilationAdmissionParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateAdmission(value, "$admission");
  return deepFreeze(
    parameterSpecs(admission).map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  );
}

/**
 * Parse the complete signed MRTR list back into the typed identity.
 *
 * The grammar is canonical and fail-closed: parameter records, labels, order,
 * keys, values, counts, references, and limits are all checked. No `Map` is
 * built until duplicate keys have been rejected.
 */
export function parseTechnicalCompilationAdmissionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): TechnicalCompilationAdmission {
  if (!Array.isArray(parameters)) {
    throw new TypeError("$parameters must be an array.");
  }
  if (parameters.length > MAX_PARAMETER_COUNT) {
    throw new TypeError(
      `$parameters must contain at most ${MAX_PARAMETER_COUNT} entries.`,
    );
  }

  const values = new Map<string, ParameterValue>();
  const actualKeys: string[] = [];
  const actualLabels = new Map<string, string>();
  for (const [index, parameter] of parameters.entries()) {
    const record = exactRecord(
      parameter,
      ["key", "label", "value"],
      `$parameters[${index}]`,
    );
    const key = safeId(record.key, `$parameters[${index}].key`);
    if (values.has(key)) {
      throw new TypeError(`$parameters contains duplicate key ${key}.`);
    }
    const label = requireLabel(record.label, `$parameters[${index}].label`);
    const parameterValue = requireParameterValue(
      record.value,
      `$parameters[${index}].value`,
    );
    values.set(key, parameterValue);
    actualLabels.set(key, label);
    actualKeys.push(key);
  }

  const sourceCount = requireBoundedCount(
    values,
    "compile.admission.sources.count",
    1,
    TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSources,
  );
  const bindingCount = requireBoundedCount(
    values,
    "compile.admission.bindings.count",
    0,
    TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxBindings,
  );
  const profileCount = requireBoundedCount(
    values,
    "compile.admission.compilationProfileRequests.count",
    1,
    TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxCompilationProfileRequests,
  );

  const parsed: TechnicalCompilationAdmission = {
    schemaVersion: requireLiteralString(
      values,
      "compile.admission.schemaVersion",
      TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
    ),
    draft: {
      draftId: requireText(values, "compile.admission.draft.draftId"),
      projectId: requireId(values, "compile.admission.draft.projectId"),
      documentFingerprint: requireFingerprint(
        values,
        "compile.admission.draft.documentSha256",
      ),
      envelopeFingerprint: requireFingerprint(
        values,
        "compile.admission.draft.envelopeSha256",
      ),
    },
    basis: {
      fingerprint: requireFingerprint(
        values,
        "compile.admission.basis.sha256",
      ),
      thread: {
        projectId: requireId(
          values,
          "compile.admission.basis.thread.projectId",
        ),
        subjectId: requireId(
          values,
          "compile.admission.basis.thread.subjectId",
        ),
        snapshotId: requireExactSnapshotId(
          values,
          "compile.admission.basis.thread.snapshotId",
        ),
        revision: requirePositiveInteger(
          values,
          "compile.admission.basis.thread.revision",
        ),
        fingerprint: requireFingerprint(
          values,
          "compile.admission.basis.thread.sha256",
        ),
      },
      sysml: {
        artifactId: requireId(
          values,
          "compile.admission.basis.sysml.artifactId",
        ),
        artifactFingerprint: requireFingerprint(
          values,
          "compile.admission.basis.sysml.artifactSha256",
        ),
        captureId: requireId(
          values,
          "compile.admission.basis.sysml.captureId",
        ),
        editingContextId: requireId(
          values,
          "compile.admission.basis.sysml.editingContextId",
        ),
        rootElementId: requireId(
          values,
          "compile.admission.basis.sysml.rootElementId",
        ),
        rootElementKind: requireLiteralString(
          values,
          "compile.admission.basis.sysml.rootElementKind",
          "Package",
        ),
        anchorFingerprint: requireFingerprint(
          values,
          "compile.admission.basis.sysml.anchorSha256",
        ),
      },
    },
    sources: Array.from({ length: sourceCount }, (_, index) => ({
      id: requireId(values, `compile.admission.sources.${index}.id`),
      role: requireSourceRole(
        values,
        `compile.admission.sources.${index}.role`,
      ),
      language: requireSourceLanguage(
        values,
        `compile.admission.sources.${index}.language`,
      ),
      profileId: requireId(
        values,
        `compile.admission.sources.${index}.profileId`,
      ),
      profileVersion: requireVersion(
        values,
        `compile.admission.sources.${index}.profileVersion`,
      ),
      profileFingerprint: requireFingerprint(
        values,
        `compile.admission.sources.${index}.profileSha256`,
      ),
      analyzer: {
        id: requireId(
          values,
          `compile.admission.sources.${index}.analyzerId`,
        ),
        version: requireVersion(
          values,
          `compile.admission.sources.${index}.analyzerVersion`,
        ),
      },
      sourceFingerprint: requireFingerprint(
        values,
        `compile.admission.sources.${index}.sourceSha256`,
      ),
      captureFingerprint: requireFingerprint(
        values,
        `compile.admission.sources.${index}.captureSha256`,
      ),
      analysisFingerprint: requireFingerprint(
        values,
        `compile.admission.sources.${index}.analysisSha256`,
      ),
    })),
    bindings: Array.from({ length: bindingCount }, (_, index) => ({
      id: requireId(
        values,
        `compile.admission.bindings.${index}.id`,
      ),
      sourceId: requireId(
        values,
        `compile.admission.bindings.${index}.sourceId`,
      ),
      sourceSymbolId: requireId(
        values,
        `compile.admission.bindings.${index}.sourceSymbolId`,
      ),
      sysmlElementId: requireId(
        values,
        `compile.admission.bindings.${index}.sysmlElementId`,
      ),
      sysmlElementKind: requireId(
        values,
        `compile.admission.bindings.${index}.sysmlElementKind`,
      ),
      relation: requireBindingRelation(
        values,
        `compile.admission.bindings.${index}.relation`,
      ),
    })),
    compilationProfileRequests: Array.from(
      { length: profileCount },
      (_, index) => {
        const sourceIdCount = requireBoundedCount(
          values,
          `compile.admission.compilationProfileRequests.${index}.sourceIds.count`,
          1,
          TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSourceIdsPerProfileRequest,
        );
        return {
          profileId: requireId(
            values,
            `compile.admission.compilationProfileRequests.${index}.profileId`,
          ),
          profileVersion: requireVersion(
            values,
            `compile.admission.compilationProfileRequests.${index}.profileVersion`,
          ),
          target: requireCompilationTarget(
            values,
            `compile.admission.compilationProfileRequests.${index}.target`,
          ),
          sourceIds: Array.from(
            { length: sourceIdCount },
            (_, sourceIndex) =>
              requireId(
                values,
                `compile.admission.compilationProfileRequests.${index}.sourceIds.${sourceIndex}`,
              ),
          ),
          profileFingerprint: requireFingerprint(
            values,
            `compile.admission.compilationProfileRequests.${index}.profileSha256`,
          ),
        };
      },
    ),
    compilation: {
      fingerprint: requireFingerprint(
        values,
        "compile.admission.compilation.sha256",
      ),
      status: requireLiteralString(
        values,
        "compile.admission.compilation.status",
        "ready-for-review",
      ),
    },
  };

  requireLiteralString(
    values,
    "compile.admission.operation",
    `${COMPILE_SEAL_ADMISSION_OPERATION.id}@${COMPILE_SEAL_ADMISSION_OPERATION.version}`,
  );

  const admission = validateAdmission(parsed, "$parameters");
  const expected = parameterSpecs(admission);
  if (actualKeys.length !== expected.length) {
    throw new TypeError(
      `$parameters must contain exactly ${expected.length} entries for its declared counts.`,
    );
  }
  for (const [index, spec] of expected.entries()) {
    const actualKey = actualKeys[index];
    if (actualKey !== spec.key) {
      throw new TypeError(
        `$parameters[${index}].key must equal ${spec.key}.`,
      );
    }
    if (actualLabels.get(spec.key) !== spec.label) {
      throw new TypeError(
        `$parameters label for ${spec.key} must equal ${JSON.stringify(spec.label)}.`,
      );
    }
    if (!Object.is(values.get(spec.key), spec.value)) {
      throw new TypeError(
        `$parameters value for ${spec.key} is not in canonical identity order.`,
      );
    }
  }
  return admission;
}

function validateAdmission(
  value: unknown,
  path: string,
): TechnicalCompilationAdmission {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "draft",
      "basis",
      "sources",
      "bindings",
      "compilationProfileRequests",
      "compilation",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const draft = exactRecord(
    root.draft,
    ["draftId", "projectId", "documentFingerprint", "envelopeFingerprint"],
    `${path}.draft`,
  );
  const basis = exactRecord(
    root.basis,
    ["fingerprint", "thread", "sysml"],
    `${path}.basis`,
  );
  const thread = exactRecord(
    basis.thread,
    ["projectId", "subjectId", "snapshotId", "revision", "fingerprint"],
    `${path}.basis.thread`,
  );
  const sysml = exactRecord(
    basis.sysml,
    [
      "artifactId",
      "artifactFingerprint",
      "captureId",
      "editingContextId",
      "rootElementId",
      "rootElementKind",
      "anchorFingerprint",
    ],
    `${path}.basis.sysml`,
  );
  const compilation = exactRecord(
    root.compilation,
    ["fingerprint", "status"],
    `${path}.compilation`,
  );
  literalValue(
    compilation.status,
    "ready-for-review",
    `${path}.compilation.status`,
  );

  const sources = boundedArray(
    root.sources,
    `${path}.sources`,
    1,
    TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSources,
  ).map((item, index) => {
    const source = exactRecord(
      item,
      [
        "id",
        "role",
        "language",
        "profileId",
        "profileVersion",
        "profileFingerprint",
        "analyzer",
        "sourceFingerprint",
        "captureFingerprint",
        "analysisFingerprint",
      ],
      `${path}.sources[${index}]`,
    );
    return {
      id: safeId(source.id, `${path}.sources[${index}].id`),
      role: technicalSourceRole(
        source.role,
        `${path}.sources[${index}].role`,
      ),
      language: technicalSourceLanguage(
        source.language,
        `${path}.sources[${index}].language`,
      ),
      profileId: safeId(
        source.profileId,
        `${path}.sources[${index}].profileId`,
      ),
      profileVersion: safeVersion(
        source.profileVersion,
        `${path}.sources[${index}].profileVersion`,
      ),
      profileFingerprint: parseFingerprint(
        source.profileFingerprint,
        `${path}.sources[${index}].profileFingerprint`,
      ),
      analyzer: parseAnalyzer(
        source.analyzer,
        `${path}.sources[${index}].analyzer`,
      ),
      sourceFingerprint: parseFingerprint(
        source.sourceFingerprint,
        `${path}.sources[${index}].sourceFingerprint`,
      ),
      captureFingerprint: parseFingerprint(
        source.captureFingerprint,
        `${path}.sources[${index}].captureFingerprint`,
      ),
      analysisFingerprint: parseFingerprint(
        source.analysisFingerprint,
        `${path}.sources[${index}].analysisFingerprint`,
      ),
    };
  }).sort(compareSources);
  rejectDuplicates(sources.map((source) => source.id), `${path}.sources ids`);

  const bindings = boundedArray(
    root.bindings,
    `${path}.bindings`,
    0,
    TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxBindings,
  ).map((item, index) => {
    const binding = exactRecord(
      item,
      [
        "id",
        "sourceId",
        "sourceSymbolId",
        "sysmlElementId",
        "sysmlElementKind",
        "relation",
      ],
      `${path}.bindings[${index}]`,
    );
    return {
      id: safeId(binding.id, `${path}.bindings[${index}].id`),
      sourceId: safeId(
        binding.sourceId,
        `${path}.bindings[${index}].sourceId`,
      ),
      sourceSymbolId: safeId(
        binding.sourceSymbolId,
        `${path}.bindings[${index}].sourceSymbolId`,
      ),
      sysmlElementId: safeId(
        binding.sysmlElementId,
        `${path}.bindings[${index}].sysmlElementId`,
      ),
      sysmlElementKind: safeId(
        binding.sysmlElementKind,
        `${path}.bindings[${index}].sysmlElementKind`,
      ),
      relation: bindingRelation(
        binding.relation,
        `${path}.bindings[${index}].relation`,
      ),
    };
  }).sort(compareBindings);
  rejectDuplicates(bindings.map((binding) => binding.id), `${path}.bindings ids`);
  rejectDuplicates(
    bindings.map((binding) =>
      JSON.stringify([binding.sourceId, binding.sourceSymbolId])
    ),
    `${path}.bindings source/symbol pairs`,
  );

  const compilationProfileRequests = boundedArray(
    root.compilationProfileRequests,
    `${path}.compilationProfileRequests`,
    1,
    TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxCompilationProfileRequests,
  ).map((item, index) => {
    const request = exactRecord(
      item,
      [
        "profileId",
        "profileVersion",
        "target",
        "sourceIds",
        "profileFingerprint",
      ],
      `${path}.compilationProfileRequests[${index}]`,
    );
    const sourceIds = boundedArray(
      request.sourceIds,
      `${path}.compilationProfileRequests[${index}].sourceIds`,
      1,
      TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSourceIdsPerProfileRequest,
    ).map((sourceId, sourceIndex) =>
      safeId(
        sourceId,
        `${path}.compilationProfileRequests[${index}].sourceIds[${sourceIndex}]`,
      )
    ).sort(compareText);
    rejectDuplicates(
      sourceIds,
      `${path}.compilationProfileRequests[${index}].sourceIds`,
    );
    return {
      profileId: safeId(
        request.profileId,
        `${path}.compilationProfileRequests[${index}].profileId`,
      ),
      profileVersion: safeVersion(
        request.profileVersion,
        `${path}.compilationProfileRequests[${index}].profileVersion`,
      ),
      target: compilationTarget(
        request.target,
        `${path}.compilationProfileRequests[${index}].target`,
      ),
      sourceIds,
      profileFingerprint: parseFingerprint(
        request.profileFingerprint,
        `${path}.compilationProfileRequests[${index}].profileFingerprint`,
      ),
    };
  }).sort(compareProfiles);
  rejectDuplicates(
    compilationProfileRequests.map((request) =>
      `${request.profileId}@${request.profileVersion}`
    ),
    `${path}.compilationProfileRequests refs`,
  );

  const sourceIds = new Set(sources.map((source) => source.id));
  for (const binding of bindings) {
    if (!sourceIds.has(binding.sourceId)) {
      throw new TypeError(
        `${path}.bindings sourceId ${binding.sourceId} must name an exact local source.`,
      );
    }
  }
  for (const request of compilationProfileRequests) {
    for (const sourceId of request.sourceIds) {
      const source = sources.find((candidate) => candidate.id === sourceId);
      if (!source) {
        throw new TypeError(
          `${path}.compilationProfileRequests ${request.profileId}@${request.profileVersion} sourceIds must name exact local sources.`,
        );
      }
      const expectedSource = TARGET_SOURCE_CONTRACT[request.target];
      if (
        source.role !== expectedSource.role ||
        source.language !== expectedSource.language
      ) {
        throw new TypeError(
          `${path}.compilationProfileRequests ${request.profileId}@${request.profileVersion} target must match each source role and language.`,
        );
      }
    }
  }
  const requestedSourceIds = new Set(
    compilationProfileRequests.flatMap((request) => request.sourceIds),
  );
  if (
    requestedSourceIds.size !== sourceIds.size ||
    [...sourceIds].some((sourceId) => !requestedSourceIds.has(sourceId))
  ) {
    throw new TypeError(
      `${path}.compilationProfileRequests must exactly cover every admitted source.`,
    );
  }
  for (const binding of bindings) {
    if (!requestedSourceIds.has(binding.sourceId)) {
      throw new TypeError(
        `${path}.bindings sourceId ${binding.sourceId} must be in the compilation profile request scope.`,
      );
    }
  }

  // This id is derived from a project id (up to the shared safe-id bound), a
  // fixed prefix, and a SHA-256 digest, so it can legitimately exceed the
  // standalone safeId length. Exact template equality below is the validator.
  const draftId = nonEmptyText(draft.draftId, `${path}.draft.draftId`);
  const draftProjectId = safeId(draft.projectId, `${path}.draft.projectId`);
  const threadProjectId = safeId(
    thread.projectId,
    `${path}.basis.thread.projectId`,
  );
  const documentFingerprint = parseFingerprint(
    draft.documentFingerprint,
    `${path}.draft.documentFingerprint`,
  );
  const compilationFingerprint = parseFingerprint(
    compilation.fingerprint,
    `${path}.compilation.fingerprint`,
  );
  const expectedDraftId =
    `technical-compilation:${draftProjectId}:${documentFingerprint.digest}`;
  if (draftId !== expectedDraftId) {
    throw new TypeError(
      `${path}.draft.draftId must be derived from its exact project and document fingerprint.`,
    );
  }
  if (draftProjectId !== threadProjectId) {
    throw new TypeError(
      `${path}.draft.projectId must equal the exact Thread basis projectId.`,
    );
  }
  if (documentFingerprint.digest !== compilationFingerprint.digest) {
    throw new TypeError(
      `${path}.draft.documentFingerprint must equal the final compilation fingerprint.`,
    );
  }

  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
    draft: {
      draftId,
      projectId: draftProjectId,
      documentFingerprint,
      envelopeFingerprint: parseFingerprint(
        draft.envelopeFingerprint,
        `${path}.draft.envelopeFingerprint`,
      ),
    },
    basis: {
      fingerprint: parseFingerprint(
        basis.fingerprint,
        `${path}.basis.fingerprint`,
      ),
      thread: {
        projectId: threadProjectId,
        subjectId: safeId(
          thread.subjectId,
          `${path}.basis.thread.subjectId`,
        ),
        snapshotId: exactSnapshotId(
          thread.snapshotId,
          `${path}.basis.thread.snapshotId`,
        ),
        revision: positiveInteger(
          thread.revision,
          `${path}.basis.thread.revision`,
        ),
        fingerprint: parseFingerprint(
          thread.fingerprint,
          `${path}.basis.thread.fingerprint`,
        ),
      },
      sysml: {
        artifactId: safeId(
          sysml.artifactId,
          `${path}.basis.sysml.artifactId`,
        ),
        artifactFingerprint: parseFingerprint(
          sysml.artifactFingerprint,
          `${path}.basis.sysml.artifactFingerprint`,
        ),
        captureId: safeId(
          sysml.captureId,
          `${path}.basis.sysml.captureId`,
        ),
        editingContextId: safeId(
          sysml.editingContextId,
          `${path}.basis.sysml.editingContextId`,
        ),
        rootElementId: safeId(
          sysml.rootElementId,
          `${path}.basis.sysml.rootElementId`,
        ),
        rootElementKind: (() => {
          literalValue(
            sysml.rootElementKind,
            "Package",
            `${path}.basis.sysml.rootElementKind`,
          );
          return "Package" as const;
        })(),
        anchorFingerprint: parseFingerprint(
          sysml.anchorFingerprint,
          `${path}.basis.sysml.anchorFingerprint`,
        ),
      },
    },
    sources,
    bindings,
    compilationProfileRequests,
    compilation: {
      fingerprint: compilationFingerprint,
      status: "ready-for-review",
    },
  });
}

function parameterSpecs(admission: TechnicalCompilationAdmission): ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  const p = (key: string, label: string, value: ParameterValue) =>
    specs.push({ key, label, value });
  p(
    "compile.admission.schemaVersion",
    "Admission schema version",
    admission.schemaVersion,
  );
  p(
    "compile.admission.operation",
    "Reviewed operation",
    `${COMPILE_SEAL_ADMISSION_OPERATION.id}@${COMPILE_SEAL_ADMISSION_OPERATION.version}`,
  );
  p(
    "compile.admission.draft.draftId",
    "Compilation draft ID",
    admission.draft.draftId,
  );
  p(
    "compile.admission.draft.projectId",
    "Compilation draft project ID",
    admission.draft.projectId,
  );
  p(
    "compile.admission.draft.documentSha256",
    "Compilation draft document SHA-256",
    admission.draft.documentFingerprint.digest,
  );
  p(
    "compile.admission.draft.envelopeSha256",
    "Compilation draft envelope SHA-256",
    admission.draft.envelopeFingerprint.digest,
  );
  p(
    "compile.admission.basis.sha256",
    "Compilation basis SHA-256",
    admission.basis.fingerprint.digest,
  );
  p(
    "compile.admission.basis.thread.projectId",
    "Base Thread project ID",
    admission.basis.thread.projectId,
  );
  p(
    "compile.admission.basis.thread.subjectId",
    "Base Thread subject ID",
    admission.basis.thread.subjectId,
  );
  p(
    "compile.admission.basis.thread.snapshotId",
    "Base Thread snapshot ID",
    admission.basis.thread.snapshotId,
  );
  p(
    "compile.admission.basis.thread.revision",
    "Base Thread snapshot revision",
    admission.basis.thread.revision,
  );
  p(
    "compile.admission.basis.thread.sha256",
    "Base Thread snapshot SHA-256",
    admission.basis.thread.fingerprint.digest,
  );
  p(
    "compile.admission.basis.sysml.artifactId",
    "SysML artifact ID",
    admission.basis.sysml.artifactId,
  );
  p(
    "compile.admission.basis.sysml.artifactSha256",
    "SysML artifact SHA-256",
    admission.basis.sysml.artifactFingerprint.digest,
  );
  p(
    "compile.admission.basis.sysml.captureId",
    "SysML capture ID",
    admission.basis.sysml.captureId,
  );
  p(
    "compile.admission.basis.sysml.editingContextId",
    "SysML editing context ID",
    admission.basis.sysml.editingContextId,
  );
  p(
    "compile.admission.basis.sysml.rootElementId",
    "SysML semantic root element ID",
    admission.basis.sysml.rootElementId,
  );
  p(
    "compile.admission.basis.sysml.rootElementKind",
    "SysML semantic root element kind",
    admission.basis.sysml.rootElementKind,
  );
  p(
    "compile.admission.basis.sysml.anchorSha256",
    "SysML anchor SHA-256",
    admission.basis.sysml.anchorFingerprint.digest,
  );
  p(
    "compile.admission.sources.count",
    "Technical source count",
    admission.sources.length,
  );
  admission.sources.forEach((source, index) => {
    p(`compile.admission.sources.${index}.id`, `Source ${index} ID`, source.id);
    p(
      `compile.admission.sources.${index}.role`,
      `Source ${index} role`,
      source.role,
    );
    p(
      `compile.admission.sources.${index}.language`,
      `Source ${index} language`,
      source.language,
    );
    p(
      `compile.admission.sources.${index}.profileId`,
      `Source ${index} profile ID`,
      source.profileId,
    );
    p(
      `compile.admission.sources.${index}.profileVersion`,
      `Source ${index} profile version`,
      source.profileVersion,
    );
    p(
      `compile.admission.sources.${index}.profileSha256`,
      `Source ${index} profile SHA-256`,
      source.profileFingerprint.digest,
    );
    p(
      `compile.admission.sources.${index}.analyzerId`,
      `Source ${index} analyzer ID`,
      source.analyzer.id,
    );
    p(
      `compile.admission.sources.${index}.analyzerVersion`,
      `Source ${index} analyzer version`,
      source.analyzer.version,
    );
    p(
      `compile.admission.sources.${index}.sourceSha256`,
      `Source ${index} SHA-256`,
      source.sourceFingerprint.digest,
    );
    p(
      `compile.admission.sources.${index}.captureSha256`,
      `Source ${index} capture SHA-256`,
      source.captureFingerprint.digest,
    );
    p(
      `compile.admission.sources.${index}.analysisSha256`,
      `Source ${index} analysis SHA-256`,
      source.analysisFingerprint.digest,
    );
  });
  p(
    "compile.admission.bindings.count",
    "Semantic binding count",
    admission.bindings.length,
  );
  admission.bindings.forEach((binding, index) => {
    p(
      `compile.admission.bindings.${index}.id`,
      `Binding ${index} ID`,
      binding.id,
    );
    p(
      `compile.admission.bindings.${index}.sourceId`,
      `Binding ${index} source ID`,
      binding.sourceId,
    );
    p(
      `compile.admission.bindings.${index}.sourceSymbolId`,
      `Binding ${index} source symbol ID`,
      binding.sourceSymbolId,
    );
    p(
      `compile.admission.bindings.${index}.sysmlElementId`,
      `Binding ${index} SysML element ID`,
      binding.sysmlElementId,
    );
    p(
      `compile.admission.bindings.${index}.sysmlElementKind`,
      `Binding ${index} SysML element kind`,
      binding.sysmlElementKind,
    );
    p(
      `compile.admission.bindings.${index}.relation`,
      `Binding ${index} relation`,
      binding.relation,
    );
  });
  p(
    "compile.admission.compilationProfileRequests.count",
    "Compilation profile request count",
    admission.compilationProfileRequests.length,
  );
  admission.compilationProfileRequests.forEach((request, index) => {
    p(
      `compile.admission.compilationProfileRequests.${index}.profileId`,
      `Compilation profile request ${index} profile ID`,
      request.profileId,
    );
    p(
      `compile.admission.compilationProfileRequests.${index}.profileVersion`,
      `Compilation profile request ${index} profile version`,
      request.profileVersion,
    );
    p(
      `compile.admission.compilationProfileRequests.${index}.target`,
      `Compilation profile request ${index} target`,
      request.target,
    );
    p(
      `compile.admission.compilationProfileRequests.${index}.profileSha256`,
      `Compilation profile request ${index} profile SHA-256`,
      request.profileFingerprint.digest,
    );
    p(
      `compile.admission.compilationProfileRequests.${index}.sourceIds.count`,
      `Compilation profile request ${index} source count`,
      request.sourceIds.length,
    );
    request.sourceIds.forEach((sourceId, sourceIndex) =>
      p(
        `compile.admission.compilationProfileRequests.${index}.sourceIds.${sourceIndex}`,
        `Compilation profile request ${index} source ${sourceIndex} ID`,
        sourceId,
      )
    );
  });
  p(
    "compile.admission.compilation.sha256",
    "Final compilation SHA-256",
    admission.compilation.fingerprint.digest,
  );
  p(
    "compile.admission.compilation.status",
    "Final compilation status",
    admission.compilation.status,
  );
  return specs;
}

function boundedArray(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): unknown[] {
  const array = arrayOf(value, path);
  if (array.length < minimum || array.length > maximum) {
    throw new TypeError(
      `${path} must contain between ${minimum} and ${maximum} entries.`,
    );
  }
  return array;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (typeof fingerprint.digest !== "string" || !SHA256_HEX.test(fingerprint.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function parseAnalyzer(
  value: unknown,
  path: string,
): { readonly id: string; readonly version: string } {
  const analyzer = exactRecord(value, ["id", "version"], path);
  return {
    id: safeId(analyzer.id, `${path}.id`),
    version: safeVersion(analyzer.version, `${path}.version`),
  };
}

function requireParameterValue(value: unknown, path: string): ParameterValue {
  if (
    (typeof value !== "string" && typeof value !== "number" &&
      typeof value !== "boolean") ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new TypeError(`${path} must be a finite MRTR scalar.`);
  }
  return value;
}

function requireLabel(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > 128
  ) {
    throw new TypeError(
      `${path} must be a non-empty label of at most 128 characters without edge whitespace.`,
    );
  }
  return value;
}

function requireValue(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ParameterValue {
  if (!values.has(key)) throw new TypeError(`$parameters is missing key ${key}.`);
  return values.get(key)!;
}

function requireId(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return safeId(requireValue(values, key), `$parameters.${key}`);
}

function requireVersion(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return safeVersion(requireValue(values, key), `$parameters.${key}`);
}

function requireExactSnapshotId(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return exactSnapshotId(requireValue(values, key), `$parameters.${key}`);
}

function requireSourceRole(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): TechnicalCompilationProfile["sourceRole"] {
  return technicalSourceRole(requireValue(values, key), `$parameters.${key}`);
}

function requireSourceLanguage(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): TechnicalCompilationProfile["language"] {
  return technicalSourceLanguage(requireValue(values, key), `$parameters.${key}`);
}

function requireCompilationTarget(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): TechnicalCompilationTarget {
  return compilationTarget(requireValue(values, key), `$parameters.${key}`);
}

function exactSnapshotId(value: unknown, path: string): string {
  const snapshotId = safeId(value, path);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${path} must not use a latest alias.`);
  }
  return snapshotId;
}

function technicalSourceRole(
  value: unknown,
  path: string,
): TechnicalCompilationProfile["sourceRole"] {
  if (
    value !== "cad-script" && value !== "modelica-model" &&
    value !== "spice-circuit"
  ) {
    throw new TypeError(`${path} must be a supported technical source role.`);
  }
  return value;
}

function technicalSourceLanguage(
  value: unknown,
  path: string,
): TechnicalCompilationProfile["language"] {
  if (value !== "python" && value !== "modelica" && value !== "spice") {
    throw new TypeError(`${path} must be a supported technical source language.`);
  }
  return value;
}

function compilationTarget(
  value: unknown,
  path: string,
): TechnicalCompilationTarget {
  if (
    value !== "build123d-source" && value !== "calculix-source-candidate" &&
    value !== "modelica-source-qualification" &&
    value !== "spice-circuit-source"
  ) {
    throw new TypeError(`${path} must be a supported compilation target.`);
  }
  return value;
}

function requireText(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return nonEmptyText(requireValue(values, key), `$parameters.${key}`);
}

function requireLiteralString<const T extends string>(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
  expected: T,
): T {
  const value = requireValue(values, key);
  literalValue(value, expected, `$parameters.${key}`);
  return expected;
}

function requirePositiveInteger(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): number {
  return positiveInteger(requireValue(values, key), `$parameters.${key}`);
}

function requireBoundedCount(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = requireValue(values, key);
  if (
    !Number.isSafeInteger(value) || Object.is(value, -0) ||
    Number(value) < minimum || Number(value) > maximum
  ) {
    throw new TypeError(
      `$parameters.${key} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return Number(value);
}

function requireFingerprint(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ContentFingerprint {
  const value = requireValue(values, key);
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new TypeError(`$parameters.${key} must be a lowercase SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest: value };
}

function bindingRelation(value: unknown, path: string): TechnicalBindingRelation {
  if (
    typeof value !== "string" ||
    !BINDING_RELATIONS.has(value as TechnicalBindingRelation)
  ) {
    throw new TypeError(`${path} must be an approved semantic binding relation.`);
  }
  return value as TechnicalBindingRelation;
}

function requireBindingRelation(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): TechnicalBindingRelation {
  return bindingRelation(requireValue(values, key), `$parameters.${key}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(
  left: TechnicalCompilationAdmissionSource,
  right: TechnicalCompilationAdmissionSource,
): number {
  return compareText(left.id, right.id);
}

function compareProfiles(
  left: TechnicalCompilationAdmissionProfileRequest,
  right: TechnicalCompilationAdmissionProfileRequest,
): number {
  return compareText(
    `${left.profileId}@${left.profileVersion}`,
    `${right.profileId}@${right.profileVersion}`,
  );
}

function compareBindings(
  left: TechnicalCompilationAdmissionBinding,
  right: TechnicalCompilationAdmissionBinding,
): number {
  return compareText(
    [
      left.id,
      left.sourceId,
      left.sourceSymbolId,
      left.sysmlElementId,
      left.sysmlElementKind,
      left.relation,
    ].join("\u0000"),
    [
      right.id,
      right.sourceId,
      right.sourceSymbolId,
      right.sysmlElementId,
      right.sysmlElementKind,
      right.relation,
    ].join("\u0000"),
  );
}
