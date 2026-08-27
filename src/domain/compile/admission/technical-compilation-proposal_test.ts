import { assert, assertEquals, assertThrows } from "@std/assert";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  sampleAdmissionSourceWorkspaceFields,
  sampleTechnicalSourceAttachmentProvenance,
  sampleTechnicalSourceClosureProvenance,
} from "../../../testing/technical-source-capture-test-support.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_LIMITS,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "./technical-compilation-proposal.ts";

function fingerprint(character: string) {
  return { algorithm: "sha256", digest: character.repeat(64) } as const;
}

const MODELICA_UNIT_ID = `technical-unit:${"d".repeat(64)}`;
const CAD_UNIT_ID = `technical-unit:${"e".repeat(64)}`;
const SPICE_UNIT_ID = `technical-unit:${"f".repeat(64)}`;

function admission(): Record<string, unknown> {
  const projectId = "project.drip-tray";
  const documentFingerprint = fingerprint("a");
  return {
    schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
    draft: {
      draftId: `technical-compilation:${projectId}:${documentFingerprint.digest}`,
      projectId,
      documentFingerprint,
      envelopeFingerprint: fingerprint("b"),
    },
    basis: {
      fingerprint: fingerprint("c"),
      thread: {
        projectId,
        subjectId: "subject.drip-tray",
        snapshotId: "thread.snapshot.7",
        revision: 7,
        fingerprint: fingerprint("2"),
      },
      sysml: {
        artifactId: "artifact.sysml.architecture.4",
        artifactFingerprint: fingerprint("3"),
        captureId: "capture.syson.architecture.4",
        editingContextId: "editing-context.main",
        rootElementId: "sysml.package.architecture",
        rootElementKind: "Package",
        anchorFingerprint: fingerprint("d"),
      },
    },
    sources: [
      {
        id: MODELICA_UNIT_ID,
        role: "modelica-model",
        language: "modelica",
        profileId: "source-profile.modelica",
        profileVersion: "1.2.0",
        profileFingerprint: fingerprint("e"),
        analyzer: { id: "modelica-parser", version: "1.0.0" },
        sourceFingerprint: fingerprint("7"),
        captureFingerprint: fingerprint("8"),
        analysisFingerprint: fingerprint("9"),
        effectiveUnit: {
          kind: "authored-root",
          closureKind: "root-only",
          unitId: MODELICA_UNIT_ID,
          closureFingerprint: fingerprint("d"),
          scriptFingerprint: fingerprint("7"),
        },
        ...sampleAdmissionSourceWorkspaceFields("source.modelica", {
          projectId,
          locatorDigest: "8".repeat(64),
        }),
      },
      {
        id: CAD_UNIT_ID,
        role: "cad-script",
        language: "python",
        profileId: "source-profile.python",
        profileVersion: "2.0.0",
        profileFingerprint: fingerprint("f"),
        analyzer: { id: "python-ast", version: "2.1.0" },
        sourceFingerprint: fingerprint("4"),
        captureFingerprint: fingerprint("5"),
        analysisFingerprint: fingerprint("6"),
        effectiveUnit: {
          kind: "authored-root",
          closureKind: "root-only",
          unitId: CAD_UNIT_ID,
          closureFingerprint: fingerprint("e"),
          scriptFingerprint: fingerprint("4"),
        },
        ...sampleAdmissionSourceWorkspaceFields("source.cad", {
          projectId,
          locatorDigest: "5".repeat(64),
        }),
        sourceClosure: sampleTechnicalSourceClosureProvenance("source.cad", {
          projectId,
          fingerprint: fingerprint("e"),
        }),
      },
    ],
    bindings: [
      {
        id: "binding.modelica.power",
        sourceId: MODELICA_UNIT_ID,
        sourceSymbolId: "modelica.power",
        sysmlElementId: "sysml.power",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      },
      {
        id: "binding.cad.result",
        sourceId: CAD_UNIT_ID,
        sourceSymbolId: "cad.result",
        sysmlElementId: "sysml.enclosure",
        sysmlElementKind: "PartUsage",
        relation: "represents",
      },
    ],
    compilationProfileRequests: [
      {
        profileId: "profile.modelica",
        profileVersion: "1.0.0",
        target: "modelica-source-qualification",
        sourceIds: [MODELICA_UNIT_ID],
        profileFingerprint: fingerprint("1"),
      },
      {
        profileId: "profile.build123d",
        profileVersion: "1.0.0",
        target: "build123d-source",
        sourceIds: [CAD_UNIT_ID],
        profileFingerprint: fingerprint("2"),
      },
      {
        profileId: "profile.calculix",
        profileVersion: "1.0.0",
        target: "calculix-source-candidate",
        sourceIds: [CAD_UNIT_ID],
        profileFingerprint: fingerprint("3"),
      },
    ],
    compilation: {
      fingerprint: documentFingerprint,
      status: "ready-for-review",
    },
  };
}

function mutableParameters(): EngineeringDecisionProposalParameter[] {
  return structuredClone(
    encodeTechnicalCompilationAdmissionParameters(admission()),
  ) as EngineeringDecisionProposalParameter[];
}

function parameter(
  parameters: readonly EngineeringDecisionProposalParameter[],
  key: string,
): EngineeringDecisionProposalParameter {
  const result = parameters.find((candidate) => candidate.key === key);
  if (!result) throw new Error(`Fixture has no parameter ${key}.`);
  return result;
}

function replaceValue(
  parameters: EngineeringDecisionProposalParameter[],
  key: string,
  value: string | number | boolean,
): void {
  const index = parameters.findIndex((candidate) => candidate.key === key);
  if (index < 0) throw new Error(`Fixture has no parameter ${key}.`);
  parameters[index] = { ...parameters[index], value };
}

function swapValues(
  parameters: EngineeringDecisionProposalParameter[],
  leftKey: string,
  rightKey: string,
): void {
  const leftIndex = parameters.findIndex((candidate) => candidate.key === leftKey);
  const rightIndex = parameters.findIndex((candidate) => candidate.key === rightKey);
  if (leftIndex < 0 || rightIndex < 0) throw new Error("Fixture swap key is absent.");
  const left = parameters[leftIndex];
  const right = parameters[rightIndex];
  parameters[leftIndex] = { ...left, value: right.value };
  parameters[rightIndex] = { ...right, value: left.value };
}

Deno.test("technical compilation admission round-trip is canonical and provider-free", () => {
  const encoded = encodeTechnicalCompilationAdmissionParameters(admission());
  const parsed = parseTechnicalCompilationAdmissionParameters(encoded);

  assertEquals(
    parsed.sources.map((source) => source.id),
    [MODELICA_UNIT_ID, CAD_UNIT_ID],
  );
  assertEquals(
    parsed.bindings.map((binding) => `${binding.sourceId}:${binding.sourceSymbolId}`),
    [`${CAD_UNIT_ID}:cad.result`, `${MODELICA_UNIT_ID}:modelica.power`],
  );
  assertEquals(
    parsed.compilationProfileRequests.map((request) =>
      `${request.profileId}@${request.profileVersion}:${request.sourceIds.join(",")}`
    ),
    [
      `profile.build123d@1.0.0:${CAD_UNIT_ID}`,
      `profile.calculix@1.0.0:${CAD_UNIT_ID}`,
      `profile.modelica@1.0.0:${MODELICA_UNIT_ID}`,
    ],
  );
  assertEquals(encodeTechnicalCompilationAdmissionParameters(parsed), encoded);
  assertEquals(
    parameter(encoded, "compile.admission.operation").value,
    `${COMPILE_SEAL_ADMISSION_OPERATION.id}@${COMPILE_SEAL_ADMISSION_OPERATION.version}`,
  );
  assert(Object.isFrozen(encoded));
  assert(Object.isFrozen(encoded[0]));
  assert(Object.isFrozen(parsed));

  const serialized = JSON.stringify(encoded);
  for (
    const forbidden of [
      "brief",
      "prose",
      "provider",
      "tool",
      "args",
      "endpoint",
      "execution",
    ]
  ) {
    assert(!serialized.includes(forbidden));
  }
});

Deno.test("technical compilation admission round-trips safe build-metadata versions", () => {
  const candidate = structuredClone(admission());
  const sources = candidate.sources as Array<{
    profileVersion: string;
    analyzer: { version: string };
  }>;
  const requests = candidate.compilationProfileRequests as Array<{
    profileVersion: string;
  }>;
  const modelicaSource = sources.find((source) =>
    (source as unknown as { profileId: string }).profileId ===
      "source-profile.modelica"
  )!;
  modelicaSource.profileVersion = "1.0.0+occt";
  modelicaSource.analyzer.version = "1.0.0+occt";
  const modelicaRequest = requests.find((request) =>
    (request as unknown as { profileId: string }).profileId === "profile.modelica"
  )!;
  modelicaRequest.profileVersion = "1.0.0+occt";

  const encoded = encodeTechnicalCompilationAdmissionParameters(candidate);
  const parsed = parseTechnicalCompilationAdmissionParameters(encoded);
  const parsedSource = parsed.sources.find((source) =>
    source.profileId === "source-profile.modelica"
  )!;
  assertEquals(parsedSource.profileVersion, "1.0.0+occt");
  assertEquals(parsedSource.analyzer.version, "1.0.0+occt");
  assertEquals(
    parsed.compilationProfileRequests.find((request) =>
      request.profileId === "profile.modelica"
    )?.profileVersion,
    "1.0.0+occt",
  );
  assertEquals(encodeTechnicalCompilationAdmissionParameters(parsed), encoded);
});

Deno.test("technical compilation admission rejects every malformed signed digest", () => {
  const digestKeys = mutableParameters()
    .filter((item) => item.key.endsWith("sha256") || item.key.endsWith("Sha256"))
    .map((item) => item.key);
  assertEquals(digestKeys.length, 38);

  for (const key of digestKeys) {
    const parameters = mutableParameters();
    replaceValue(parameters, key, "f".repeat(63));
    assertThrows(
      () => parseTechnicalCompilationAdmissionParameters(parameters),
      TypeError,
      "lowercase SHA-256 digest",
      `Digest mutation for ${key} must fail closed.`,
    );
  }
});

Deno.test("technical compilation admission rejects mutated basis and identity references", () => {
  const invalidMutations: ReadonlyArray<readonly [string, string | number]> = [
    ["compile.admission.operation", "compile.seal-admission@1"],
    ["compile.admission.draft.draftId", "draft with prose"],
    ["compile.admission.draft.projectId", "project with prose"],
    ["compile.admission.basis.thread.projectId", "project with prose"],
    ["compile.admission.basis.thread.subjectId", "subject with prose"],
    ["compile.admission.basis.thread.snapshotId", "latest"],
    ["compile.admission.basis.thread.revision", 0],
    ["compile.admission.basis.sysml.artifactId", "artifact with space"],
    ["compile.admission.basis.sysml.captureId", "capture with space"],
    [
      "compile.admission.basis.sysml.editingContextId",
      "context with space",
    ],
    ["compile.admission.basis.sysml.rootElementId", "root with space"],
    ["compile.admission.basis.sysml.rootElementKind", "PartUsage"],
    ["compile.admission.sources.0.id", "source with space"],
    ["compile.admission.sources.0.role", "brief"],
    ["compile.admission.sources.0.language", "typescript"],
    ["compile.admission.sources.0.profileId", "profile with space"],
    ["compile.admission.sources.0.profileVersion", "version with space"],
    ["compile.admission.sources.0.analyzerId", "analyzer with space"],
    ["compile.admission.sources.0.analyzerVersion", "version with space"],
    ["compile.admission.bindings.0.id", "binding with space"],
    ["compile.admission.bindings.0.sourceSymbolId", "symbol with space"],
    ["compile.admission.bindings.0.sysmlElementId", "element with space"],
    ["compile.admission.bindings.0.sysmlElementKind", "kind with space"],
    ["compile.admission.bindings.0.relation", "executes"],
    [
      "compile.admission.compilationProfileRequests.0.profileId",
      "profile with space",
    ],
    [
      "compile.admission.compilationProfileRequests.0.profileVersion",
      "version with space",
    ],
    [
      "compile.admission.compilationProfileRequests.0.target",
      "provider-execution",
    ],
    [
      "compile.admission.compilationProfileRequests.0.sourceIds.0",
      "source with space",
    ],
  ];

  for (const [key, value] of invalidMutations) {
    const parameters = mutableParameters();
    replaceValue(parameters, key, value);
    assertThrows(
      () => parseTechnicalCompilationAdmissionParameters(parameters),
      TypeError,
      undefined,
      `Reference mutation for ${key} must fail closed.`,
    );
  }

  const latestAdmission = structuredClone(admission());
  const latestBasis = latestAdmission.basis as Record<string, unknown>;
  (latestBasis.thread as Record<string, unknown>).snapshotId = "latest";
  assertThrows(
    () => encodeTechnicalCompilationAdmissionParameters(latestAdmission),
    TypeError,
    "latest alias",
  );

  const foreignBinding = mutableParameters();
  replaceValue(
    foreignBinding,
    "compile.admission.bindings.0.sourceId",
    "source.not-captured",
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(foreignBinding),
    TypeError,
    "must name an exact local source",
  );
});

Deno.test("technical compilation admission binds the exact draft reference to compilation and basis", () => {
  const derivedIdDrift = mutableParameters();
  replaceValue(
    derivedIdDrift,
    "compile.admission.draft.draftId",
    `technical-compilation:project.drip-tray:${"f".repeat(64)}`,
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(derivedIdDrift),
    TypeError,
    "must be derived",
  );

  const projectDrift = mutableParameters();
  replaceValue(
    projectDrift,
    "compile.admission.basis.thread.projectId",
    "project.foreign",
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(projectDrift),
    TypeError,
    "must equal the exact Thread basis projectId",
  );

  const documentDrift = mutableParameters();
  replaceValue(
    documentDrift,
    "compile.admission.compilation.sha256",
    "0".repeat(64),
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(documentDrift),
    TypeError,
    "must equal the final compilation fingerprint",
  );
});

Deno.test("technical compilation admission exposes exact profile analyzers and source scopes", () => {
  const encoded = encodeTechnicalCompilationAdmissionParameters(admission());
  assertEquals(
    parameter(encoded, "compile.admission.sources.1.analyzerId").value,
    "python-ast",
  );
  assertEquals(
    parameter(encoded, "compile.admission.sources.1.role").value,
    "cad-script",
  );
  assertEquals(
    parameter(encoded, "compile.admission.sources.1.language").value,
    "python",
  );
  assertEquals(
    parameter(encoded, "compile.admission.sources.1.profileSha256").value,
    "f".repeat(64),
  );
  assertEquals(
    parameter(
      encoded,
      "compile.admission.compilationProfileRequests.0.sourceIds.0",
    ).value,
    CAD_UNIT_ID,
  );
  assertEquals(
    parameter(
      encoded,
      "compile.admission.compilationProfileRequests.0.target",
    ).value,
    "build123d-source",
  );

  const foreignRequest = mutableParameters();
  replaceValue(
    foreignRequest,
    "compile.admission.compilationProfileRequests.0.sourceIds.0",
    "source.foreign",
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(foreignRequest),
    TypeError,
    "must name exact local sources",
  );
});

Deno.test("technical compilation admission rejects extra missing duplicate reordered and misleading parameters", () => {
  const extra = mutableParameters();
  extra.push({
    key: "compile.admission.provider",
    label: "Provider",
    value: "arbitrary-provider",
  });
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(extra),
    TypeError,
    "exactly",
  );

  const missing = mutableParameters().filter((item) =>
    item.key !== "compile.admission.sources.0.analysisSha256"
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(missing),
    TypeError,
    "missing key compile.admission.sources.0.analysisSha256",
  );

  const duplicate = mutableParameters();
  duplicate.push({ ...duplicate[0] });
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(duplicate),
    TypeError,
    "duplicate key",
  );

  const reordered = mutableParameters();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(reordered),
    TypeError,
    "$parameters[0].key must equal",
  );

  const misleadingLabel = mutableParameters();
  const first = misleadingLabel[0];
  misleadingLabel[0] = { ...first, label: "Execute arbitrary provider" };
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(misleadingLabel),
    TypeError,
    "label",
  );

  const withUnit = mutableParameters() as Array<
    EngineeringDecisionProposalParameter & { unit?: string }
  >;
  withUnit[0] = { ...withUnit[0], unit: "provider" };
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(withUnit),
    TypeError,
    "unsupported field unit",
  );

  const negativeZeroCount = mutableParameters();
  replaceValue(
    negativeZeroCount,
    "compile.admission.bindings.count",
    -0,
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(negativeZeroCount),
    TypeError,
    "must be an integer between",
  );
});

Deno.test("technical compilation admission rejects value permutations hidden behind canonical keys", () => {
  for (
    const [leftKey, rightKey] of [
      [
        "compile.admission.sources.0.id",
        "compile.admission.sources.1.id",
      ],
      [
        "compile.admission.bindings.0.id",
        "compile.admission.bindings.1.id",
      ],
      [
        "compile.admission.compilationProfileRequests.0.profileId",
        "compile.admission.compilationProfileRequests.1.profileId",
      ],
      [
        "compile.admission.sources.0.role",
        "compile.admission.sources.1.role",
      ],
      [
        "compile.admission.sources.0.language",
        "compile.admission.sources.1.language",
      ],
      [
        "compile.admission.compilationProfileRequests.0.target",
        "compile.admission.compilationProfileRequests.2.target",
      ],
    ] as const
  ) {
    const parameters = mutableParameters();
    swapValues(parameters, leftKey, rightKey);
    assertThrows(
      () => parseTechnicalCompilationAdmissionParameters(parameters),
      TypeError,
      undefined,
    );
  }

  const multipleSourceIds = structuredClone(admission());
  const candidateSources = multipleSourceIds.sources as Array<Record<string, unknown>>;
  const cadSource = structuredClone(
    candidateSources.find((source) => source.id === CAD_UNIT_ID)!,
  );
  const secondCadUnitId = `technical-unit:${"f".repeat(64)}`;
  cadSource.id = secondCadUnitId;
  Object.assign(
    cadSource,
    sampleAdmissionSourceWorkspaceFields("source.cad.second", {
      projectId: "project.drip-tray",
    }),
  );
  cadSource.sourceClosure = sampleTechnicalSourceClosureProvenance(
    "source.cad.second",
    {
      projectId: "project.drip-tray",
      fingerprint: fingerprint("f"),
    },
  );
  cadSource.effectiveUnit = {
    kind: "authored-root",
    closureKind: "root-only",
    unitId: secondCadUnitId,
    closureFingerprint: fingerprint("f"),
    scriptFingerprint: fingerprint("4"),
  };
  candidateSources.push(cadSource);
  const requests = multipleSourceIds.compilationProfileRequests as Array<
    { profileId: string; sourceIds: string[] }
  >;
  requests.find((request) => request.profileId === "profile.build123d")!.sourceIds = [
    secondCadUnitId,
    CAD_UNIT_ID,
  ];
  const sourceIdParameters = structuredClone(
    encodeTechnicalCompilationAdmissionParameters(multipleSourceIds),
  ) as EngineeringDecisionProposalParameter[];
  swapValues(
    sourceIdParameters,
    "compile.admission.compilationProfileRequests.0.sourceIds.0",
    "compile.admission.compilationProfileRequests.0.sourceIds.1",
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(sourceIdParameters),
    TypeError,
    "canonical identity order",
  );
});

Deno.test("technical compilation admission rejects opaque payload and execution authority fields", () => {
  for (
    const forbiddenKey of [
      "brief",
      "payload",
      "provider",
      "tool",
      "args",
      "endpoint",
      "execution",
    ]
  ) {
    const parameters = mutableParameters();
    parameters.push({
      key: `compile.admission.${forbiddenKey}`,
      label: "Forbidden field",
      value: forbiddenKey === "payload" ? '{"provider":"x"}' : "x",
    });
    assertThrows(
      () => parseTechnicalCompilationAdmissionParameters(parameters),
      TypeError,
      "exactly",
    );
  }

  const objectWithProvider = { ...admission(), provider: "arbitrary-provider" };
  assertThrows(
    () => encodeTechnicalCompilationAdmissionParameters(objectWithProvider),
    TypeError,
    "unsupported field provider",
  );
});

Deno.test("technical compilation admission refuses unresolved and rejected compiler results", () => {
  for (const status of ["unresolved", "rejected"]) {
    const object = structuredClone(admission());
    (object.compilation as Record<string, unknown>).status = status;
    assertThrows(
      () => encodeTechnicalCompilationAdmissionParameters(object),
      TypeError,
      "ready-for-review",
    );

    const parameters = mutableParameters();
    replaceValue(
      parameters,
      "compile.admission.compilation.status",
      status,
    );
    assertThrows(
      () => parseTechnicalCompilationAdmissionParameters(parameters),
      TypeError,
      "ready-for-review",
    );
  }
});

Deno.test("technical compilation admission enforces duplicate and cardinality bounds", () => {
  const duplicateSource = structuredClone(admission());
  const sources = duplicateSource.sources as unknown[];
  sources.push(structuredClone(sources[0]));
  assertThrows(
    () => encodeTechnicalCompilationAdmissionParameters(duplicateSource),
    TypeError,
    "must not contain duplicates",
  );

  const duplicateBinding = structuredClone(admission());
  const bindings = duplicateBinding.bindings as unknown[];
  bindings.push(structuredClone(bindings[0]));
  assertThrows(
    () => encodeTechnicalCompilationAdmissionParameters(duplicateBinding),
    TypeError,
    "must not contain duplicates",
  );

  const duplicateProfile = structuredClone(admission());
  const profiles = duplicateProfile.compilationProfileRequests as unknown[];
  profiles.push(structuredClone(profiles[0]));
  assertThrows(
    () => encodeTechnicalCompilationAdmissionParameters(duplicateProfile),
    TypeError,
    "must not contain duplicates",
  );

  const excessiveCount = mutableParameters();
  replaceValue(
    excessiveCount,
    "compile.admission.sources.count",
    TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSources + 1,
  );
  assertThrows(
    () => parseTechnicalCompilationAdmissionParameters(excessiveCount),
    TypeError,
    "must be an integer between",
  );
});

Deno.test("technical compilation admission profile requests exactly cover all sources", () => {
  const uncovered = structuredClone(admission());
  uncovered.compilationProfileRequests = (
    uncovered.compilationProfileRequests as Array<{ target: string }>
  ).filter((request) => request.target !== "modelica-source-qualification");
  assertThrows(
    () => encodeTechnicalCompilationAdmissionParameters(uncovered),
    TypeError,
    "exactly cover every admitted source",
  );

  const multiplyRequested = structuredClone(admission());
  const encoded = encodeTechnicalCompilationAdmissionParameters(multiplyRequested);
  assertEquals(
    encodeTechnicalCompilationAdmissionParameters(
      parseTechnicalCompilationAdmissionParameters(encoded),
    ),
    encoded,
  );
});

Deno.test("technical compilation admission round-trips spice-circuit-source", () => {
  const candidate = structuredClone(admission());
  candidate.sources = [{
    id: SPICE_UNIT_ID,
    role: "spice-circuit",
    language: "spice",
    profileId: "spice-circuit-closed-subset-v1",
    profileVersion: "1.0.0",
    profileFingerprint: fingerprint("e"),
    analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
    sourceFingerprint: fingerprint("7"),
    captureFingerprint: fingerprint("8"),
    analysisFingerprint: fingerprint("9"),
    effectiveUnit: {
      kind: "authored-root",
      closureKind: "root-only",
      unitId: SPICE_UNIT_ID,
      closureFingerprint: fingerprint("f"),
      scriptFingerprint: fingerprint("7"),
    },
    ...sampleAdmissionSourceWorkspaceFields("source.spice", {
      projectId: "project.drip-tray",
      locatorDigest: "8".repeat(64),
    }),
    sourceClosure: sampleTechnicalSourceClosureProvenance("source.spice", {
      projectId: "project.drip-tray",
      fingerprint: fingerprint("f"),
    }),
  }];
  candidate.bindings = [{
    id: "binding.spice.rseries",
    sourceId: SPICE_UNIT_ID,
    sourceSymbolId: "parameter.rseries",
    sysmlElementId: "sysml.rseries",
    sysmlElementKind: "AttributeUsage",
    relation: "parameterizes",
  }];
  candidate.compilationProfileRequests = [{
    profileId: "spice-circuit-closed-subset-v1",
    profileVersion: "1.0.0",
    target: "spice-circuit-source",
    sourceIds: [SPICE_UNIT_ID],
    profileFingerprint: fingerprint("1"),
  }];
  const encoded = encodeTechnicalCompilationAdmissionParameters(candidate);
  assertEquals(
    encodeTechnicalCompilationAdmissionParameters(
      parseTechnicalCompilationAdmissionParameters(encoded),
    ),
    encoded,
  );
  assertEquals(
    parseTechnicalCompilationAdmissionParameters(encoded)
      .compilationProfileRequests[0]?.target,
    "spice-circuit-source",
  );
});

Deno.test("technical compilation admission treats colon-bearing binding tuples injectively", () => {
  const candidate = structuredClone(admission());
  const sources = candidate.sources as Array<{
    id: string;
    attachment: ReturnType<typeof sampleTechnicalSourceAttachmentProvenance>;
    sourceClosure: ReturnType<typeof sampleTechnicalSourceClosureProvenance>;
    sourceFingerprint: ReturnType<typeof fingerprint>;
    effectiveUnit: unknown;
  }>;
  const firstUnitId = `technical-unit:${"a".repeat(64)}`;
  const secondUnitId = `technical-unit:${"b".repeat(64)}`;
  sources[0].id = firstUnitId;
  sources[0].sourceClosure = sampleTechnicalSourceClosureProvenance(
    sources[0].attachment.fileId,
    { projectId: "project.drip-tray", fingerprint: fingerprint("a") },
  );
  sources[0].effectiveUnit = {
    kind: "authored-root",
    closureKind: "root-only",
    unitId: firstUnitId,
    closureFingerprint: fingerprint("a"),
    scriptFingerprint: sources[0].sourceFingerprint,
  };
  sources[1].id = secondUnitId;
  sources[1].sourceClosure = sampleTechnicalSourceClosureProvenance(
    sources[1].attachment.fileId,
    { projectId: "project.drip-tray", fingerprint: fingerprint("b") },
  );
  sources[1].effectiveUnit = {
    kind: "authored-root",
    closureKind: "root-only",
    unitId: secondUnitId,
    closureFingerprint: fingerprint("b"),
    scriptFingerprint: sources[1].sourceFingerprint,
  };
  const bindings = candidate.bindings as Array<{
    sourceId: string;
    sourceSymbolId: string;
  }>;
  bindings[0].sourceId = firstUnitId;
  bindings[0].sourceSymbolId = "c";
  bindings[1].sourceId = secondUnitId;
  bindings[1].sourceSymbolId = "b:c";
  const requests = candidate.compilationProfileRequests as Array<{
    sourceIds: string[];
  }>;
  requests[0].sourceIds = [firstUnitId];
  requests[1].sourceIds = [secondUnitId];
  requests[2].sourceIds = [secondUnitId];

  const encoded = encodeTechnicalCompilationAdmissionParameters(candidate);
  assertEquals(
    encodeTechnicalCompilationAdmissionParameters(
      parseTechnicalCompilationAdmissionParameters(encoded),
    ),
    encoded,
  );
});

Deno.test("technical compilation admission supports the full project-id bound in derived draft ids", () => {
  const candidate = structuredClone(admission());
  const projectId = `p${"x".repeat(255)}`;
  const draft = candidate.draft as Record<string, unknown>;
  const basis = candidate.basis as Record<string, unknown>;
  const thread = basis.thread as Record<string, unknown>;
  draft.projectId = projectId;
  thread.projectId = projectId;
  for (
    const source of candidate.sources as Array<{
      sourceClosure: { projectId: string };
    }>
  ) {
    source.sourceClosure.projectId = projectId;
  }
  draft.draftId = `technical-compilation:${projectId}:${
    (draft.documentFingerprint as { digest: string }).digest
  }`;

  const encoded = encodeTechnicalCompilationAdmissionParameters(candidate);
  const parsed = parseTechnicalCompilationAdmissionParameters(encoded);
  assertEquals(parsed.draft.draftId, draft.draftId);
  assert(parsed.draft.draftId.length > 256);

  const tooLong = structuredClone(candidate);
  const tooLongProjectId = `p${"x".repeat(256)}`;
  const tooLongDraft = tooLong.draft as Record<string, unknown>;
  const tooLongThread = (tooLong.basis as Record<string, unknown>).thread as Record<
    string,
    unknown
  >;
  tooLongDraft.projectId = tooLongProjectId;
  tooLongThread.projectId = tooLongProjectId;
  tooLongDraft.draftId = `technical-compilation:${tooLongProjectId}:${
    (tooLongDraft.documentFingerprint as { digest: string }).digest
  }`;
  assertThrows(
    () => encodeTechnicalCompilationAdmissionParameters(tooLong),
    TypeError,
    "stable identifier",
  );
});
