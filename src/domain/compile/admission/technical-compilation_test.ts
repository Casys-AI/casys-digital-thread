import { assert, assertEquals, assertRejects } from "@std/assert";
import { fingerprintSourceAnalysisBundle } from "../source/source-analysis.ts";
import {
  type CompilationAdmissionTargetFacts,
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalCompilationDocument,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  TECHNICAL_COMPILATION_SCHEMA,
  type TechnicalCompilationTarget,
  uniqueCompilationAdmissionTarget,
  uniqueCompilationDocumentTarget,
  validateTechnicalCompilationDocument,
} from "./technical-compilation.ts";

interface FixtureOptions {
  readonly cadUnresolved?: boolean;
  readonly cadRejected?: boolean;
}

interface Fixture {
  readonly input: Record<string, unknown>;
  readonly catalog: Record<string, unknown>;
}

const THREAD_FINGERPRINT = {
  algorithm: "sha256",
  digest: "1".repeat(64),
} as const;
const CAD_UNIT_ID = `technical-unit:${"c".repeat(64)}`;
const MODELICA_UNIT_ID = `technical-unit:${"d".repeat(64)}`;
const SPICE_UNIT_ID = `technical-unit:${"e".repeat(64)}`;
const ORPHAN_UNIT_ID = `technical-unit:${"f".repeat(64)}`;
const SECONDARY_CAD_UNIT_ID = `technical-unit:${"a".repeat(64)}`;
const REAL_CAD_UNIT_ID = `technical-unit:${"b".repeat(64)}`;

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const cadText = [
    "from build123d import Box",
    "thickness_a = 2.0",
    "thickness_b = 3.0",
    "result = Box(20, 10, thickness_a + thickness_b)",
    "",
  ].join("\n");
  const modelicaText = [
    "model ThermalPlant",
    "  parameter Real power = 100;",
    "  Real temperature;",
    "equation",
    "  temperature = power;",
    "end ThermalPlant;",
    "",
  ].join("\n");

  const cad = await sourceUnit({
    sourceId: CAD_UNIT_ID,
    role: "cad-script",
    language: "python",
    sourceText: cadText,
    policyProfile: "policy.python-safe",
    policyStatus: options.cadRejected ? "rejected" : "passed",
    findings: options.cadRejected
      ? [{
        id: "forbidden-call",
        code: "forbidden-call",
        severity: "error",
        message: "A forbidden call was detected.",
      }]
      : [],
    symbols: [
      {
        id: "cad.param.a",
        kind: "parameter",
        name: "thickness_a",
        span: {
          start: { line: 2, column: 0 },
          end: { line: 2, column: 11 },
        },
      },
      {
        id: "cad.param.b",
        kind: "parameter",
        name: "thickness_b",
        span: {
          start: { line: 3, column: 0 },
          end: { line: 3, column: 11 },
        },
      },
      { id: "cad.result", kind: "artifact", name: "result" },
    ],
    dependencies: [
      {
        id: "dependency.cad.a.result",
        kind: "structural-incidence",
        fromSymbolId: "cad.param.a",
        toSymbolId: "cad.result",
      },
      {
        id: "dependency.cad.b.result",
        kind: "structural-incidence",
        fromSymbolId: "cad.param.b",
        toSymbolId: "cad.result",
      },
    ],
    unresolvedConstructs: options.cadUnresolved
      ? [{
        id: "cad.dynamic.lookup",
        kind: "dynamic-reference",
        message: "A dynamic reference remains unresolved.",
      }]
      : [],
  });
  const modelica = await sourceUnit({
    sourceId: MODELICA_UNIT_ID,
    role: "modelica-model",
    language: "modelica",
    sourceText: modelicaText,
    policyProfile: "policy.modelica-safe",
    policyStatus: "passed",
    findings: [],
    symbols: [
      { id: "modelica.power", kind: "parameter", name: "power" },
      { id: "modelica.balance", kind: "equation", name: "balance" },
    ],
    dependencies: [],
    unresolvedConstructs: [],
  });

  const sysmlArtifactFingerprint = {
    algorithm: "sha256" as const,
    digest: "2".repeat(64),
  };
  const sysmlProvenance = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlArtifactFingerprint,
    captureId: "capture.syson",
  };
  const sysmlAnchor = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlArtifactFingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.root.package",
    rootElementKind: "Package",
    elements: [
      { id: "sysml.root.package", kind: "Package", provenance: sysmlProvenance },
      { id: "sysml.param.a", kind: "AttributeUsage", provenance: sysmlProvenance },
      { id: "sysml.param.b", kind: "AttributeUsage", provenance: sysmlProvenance },
      {
        id: "sysml.param.power",
        kind: "AttributeUsage",
        provenance: sysmlProvenance,
      },
    ],
  };
  const sysmlAnchorFingerprint = await fingerprintTechnicalSysmlAnchor(sysmlAnchor);
  const basis = {
    thread: {
      projectId: "project.drip-tray",
      subjectId: "subject.drip-tray",
      snapshotId: "snapshot.7",
      revision: 7,
      snapshotFingerprint: THREAD_FINGERPRINT,
    },
    sysmlAnchor,
    sysmlAnchorFingerprint,
  };
  const basisFingerprint = await fingerprintTechnicalCompilationBasis(basis);

  return {
    input: {
      schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
      basis,
      basisFingerprint,
      sources: [modelica, cad],
      bindings: [
        {
          id: "binding.cad.a",
          sourceId: CAD_UNIT_ID,
          sourceSymbolId: "cad.param.a",
          sysmlElementId: "sysml.param.b",
          sysmlElementKind: "AttributeUsage",
          relation: "parameterizes",
        },
        {
          id: "binding.cad.b",
          sourceId: CAD_UNIT_ID,
          sourceSymbolId: "cad.param.b",
          sysmlElementId: "sysml.param.a",
          sysmlElementKind: "AttributeUsage",
          relation: "parameterizes",
        },
        {
          id: "binding.modelica.power",
          sourceId: MODELICA_UNIT_ID,
          sourceSymbolId: "modelica.power",
          sysmlElementId: "sysml.param.power",
          sysmlElementKind: "AttributeUsage",
          relation: "parameterizes",
        },
      ],
      profileRequests: [
        {
          profileId: "profile.modelica",
          profileVersion: "1.0.0",
          sourceIds: [MODELICA_UNIT_ID],
        },
        {
          profileId: "profile.calculix",
          profileVersion: "1.0.0",
          sourceIds: [CAD_UNIT_ID],
        },
        {
          profileId: "profile.build123d",
          profileVersion: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
          sourceIds: [CAD_UNIT_ID],
        },
      ],
    },
    catalog: {
      schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
      profiles: [
        {
          id: "profile.modelica",
          version: "1.0.0",
          target: "modelica-source-qualification",
          sourceRole: "modelica-model",
          language: "modelica",
          analyzer: { id: "test.ast", version: "1.0.0" },
          analysisPolicyProfile: "policy.modelica-safe",
          requiredBindingSymbolKinds: ["parameter"],
        },
        {
          id: "profile.calculix",
          version: "1.0.0",
          target: "calculix-source-candidate",
          sourceRole: "cad-script",
          language: "python",
          analyzer: { id: "test.ast", version: "1.0.0" },
          analysisPolicyProfile: "policy.python-safe",
          requiredBindingSymbolKinds: ["parameter"],
        },
        {
          id: "profile.build123d",
          version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
          target: "build123d-source",
          sourceRole: "cad-script",
          language: "python",
          analyzer: { id: "test.ast", version: "1.0.0" },
          analysisPolicyProfile: "policy.python-safe",
          requiredBindingSymbolKinds: ["parameter"],
        },
      ],
    },
  };
}

async function sourceUnit(options: {
  readonly sourceId: string;
  readonly role: string;
  readonly language: string;
  readonly sourceText: string;
  readonly policyProfile: string;
  readonly policyStatus: string;
  readonly findings: readonly unknown[];
  readonly symbols: readonly unknown[];
  readonly dependencies: readonly unknown[];
  readonly unresolvedConstructs: readonly unknown[];
}): Promise<Record<string, unknown>> {
  const sourceFingerprint = await fingerprintTechnicalSourceText(options.sourceText);
  const closureDigest = options.sourceId.slice("technical-unit:".length);
  const analysis = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: options.sourceId,
      role: options.role,
      language: options.language,
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "test.ast", version: "1.0.0" },
    policy: {
      profile: options.policyProfile,
      status: options.policyStatus,
      findings: options.findings,
    },
    symbols: options.symbols,
    dependencies: options.dependencies,
    unresolvedConstructs: options.unresolvedConstructs,
  };
  return {
    sourceText: options.sourceText,
    analysis,
    analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
    effectiveUnit: {
      kind: "authored-root",
      closureKind: "root-only",
      unitId: options.sourceId,
      closureFingerprint: { algorithm: "sha256", digest: closureDigest },
      scriptFingerprint: sourceFingerprint,
    },
  };
}

function rootOnlyEffectiveUnit(unitId: string, scriptFingerprint: unknown) {
  return {
    kind: "authored-root" as const,
    closureKind: "root-only" as const,
    unitId,
    closureFingerprint: {
      algorithm: "sha256" as const,
      digest: unitId.slice("technical-unit:".length),
    },
    scriptFingerprint,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function values(value: unknown): unknown[] {
  return value as unknown[];
}

Deno.test("technical compiler emits frozen review projections and an external fingerprint", async () => {
  const { input, catalog } = await fixture();
  const result = await compileTechnicalSources(input, catalog);

  assertEquals(result.document.status, "ready-for-review");
  assertEquals(result.document.projections.length, 3);
  assertEquals(result.fingerprint.algorithm, "sha256");
  assertEquals(result.fingerprint.digest.length, 64);
  assert(!Object.hasOwn(result.document, "fingerprint"));
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.document));
  assert(Object.isFrozen(result.document.projections[0].sources[0].analysis));

  const forbiddenAuthorityKeys = new Set([
    "provider",
    "tool",
    "args",
    "path",
    "endpoint",
    "execution",
  ]);
  const observedKeys = recursiveKeys(result.document);
  for (const key of forbiddenAuthorityKeys) assert(!observedKeys.has(key));
});

Deno.test("technical compilation V2 is a clean breaking schema cut", async () => {
  const { input, catalog } = await fixture();
  assertEquals(TECHNICAL_COMPILATION_INPUT_SCHEMA, "technical-compilation-input/2.0");
  assertEquals(TECHNICAL_COMPILATION_SCHEMA, "technical-compilation/2.0");

  const compiled = await compileTechnicalSources(input, catalog);

  const legacyInput = structuredClone(input);
  legacyInput.schemaVersion = "technical-compilation-input/1.0";
  await assertRejects(
    () => compileTechnicalSources(legacyInput, catalog),
    TypeError,
    '"technical-compilation-input/2.0"',
  );

  const legacyDocument = {
    ...compiled.document,
    schemaVersion: "technical-compilation/1.0",
  };
  await assertRejects(
    () => validateTechnicalCompilationDocument(legacyDocument),
    TypeError,
    '"technical-compilation/2.0"',
  );
});

Deno.test("technical compiler rejects prose, solver input, and surplus execution authority", async () => {
  const { input, catalog } = await fixture();
  await assertRejects(
    () => compileTechnicalSources({ ...input, brief: "make it strong" }, catalog),
    TypeError,
    "unsupported field brief",
  );

  const withProvider = structuredClone(input);
  const firstSource = record(values(withProvider.sources)[0]);
  firstSource.provider = "arbitrary-provider";
  await assertRejects(
    () => compileTechnicalSources(withProvider, catalog),
    TypeError,
    "unsupported field provider",
  );

  for (
    const [role, language] of [
      ["brief", "plain-text"],
      ["calculix-input", "calculix-inp"],
    ]
  ) {
    const unsupported = structuredClone(input);
    const source = record(values(unsupported.sources)[0]);
    const analysis = record(source.analysis);
    const analysisSource = record(analysis.source);
    analysisSource.role = role;
    analysisSource.language = language;
    await assertRejects(
      () => compileTechnicalSources(unsupported, catalog),
      TypeError,
      "brief, plain-text, and solver input are not compilable sources",
    );
  }

  const catalogWithTool = structuredClone(catalog);
  record(values(catalogWithTool.profiles)[0]).tool = "run-anything";
  await assertRejects(
    () => compileTechnicalSources(input, catalogWithTool),
    TypeError,
    "unsupported field tool",
  );
});

Deno.test("technical compiler preserves exact source ids and display names", async () => {
  const { input, catalog } = await fixture();
  const result = await compileTechnicalSources(input, catalog);
  const projection = result.document.projections.find((item) =>
    item.target === "build123d-source"
  );
  assert(projection);
  const bindings = projection.sources[0].bindings;

  assertEquals(bindings.map((binding) => binding.sourceSymbolId), [
    "cad.param.a",
    "cad.param.b",
  ]);
  assertEquals(bindings.map((binding) => binding.sysmlElementId), [
    "sysml.param.b",
    "sysml.param.a",
  ]);
  assertEquals(
    projection.sources[0].analysis.symbols
      .filter((symbol) => symbol.kind === "parameter")
      .map((symbol) => symbol.name),
    ["thickness_a", "thickness_b"],
  );
});

Deno.test("technical compiler detects basis, anchor, source, and analysis fingerprint drift", async () => {
  const { input, catalog } = await fixture();

  const changedBasis = structuredClone(input);
  record(record(record(changedBasis).basis).thread).revision = 8;
  await assertRejects(
    () => compileTechnicalSources(changedBasis, catalog),
    TypeError,
    "$input.basisFingerprint does not match",
  );

  const changedAnchor = structuredClone(input);
  const anchor = record(record(changedAnchor.basis).sysmlAnchor);
  const parameterElement = values(anchor.elements).map(record).find((element) =>
    element.id === "sysml.param.a"
  );
  assert(parameterElement);
  parameterElement.kind = "PartUsage";
  await assertRejects(
    () => compileTechnicalSources(changedAnchor, catalog),
    TypeError,
    "sysmlAnchorFingerprint does not match",
  );

  const changedElementProvenance = structuredClone(input);
  const provenanceAnchor = record(
    record(changedElementProvenance.basis).sysmlAnchor,
  );
  const provenanceElement = values(provenanceAnchor.elements).map(record).find(
    (element) => element.id === "sysml.param.a",
  );
  assert(provenanceElement);
  record(provenanceElement.provenance).captureId = "capture.requirements.foreign";
  await assertRejects(
    () => compileTechnicalSources(changedElementProvenance, catalog),
    TypeError,
    "root Package provenance must equal the anchor capture identity",
  );

  const artifactFingerprintDrift = structuredClone(input);
  const artifactAnchor = record(record(artifactFingerprintDrift.basis).sysmlAnchor);
  record(artifactAnchor.artifactFingerprint).digest = "9".repeat(64);
  await assertRejects(
    () => compileTechnicalSources(artifactFingerprintDrift, catalog),
    TypeError,
    "sysmlAnchorFingerprint does not match",
  );

  const missingArtifactFingerprint = structuredClone(input);
  const incompleteAnchor = record(record(missingArtifactFingerprint.basis).sysmlAnchor);
  delete incompleteAnchor.artifactFingerprint;
  await assertRejects(
    () => compileTechnicalSources(missingArtifactFingerprint, catalog),
    TypeError,
    "artifactFingerprint is required",
  );

  const malformedArtifactFingerprint = structuredClone(input);
  const malformedAnchor = record(
    record(malformedArtifactFingerprint.basis).sysmlAnchor,
  );
  malformedAnchor.artifactFingerprint = {
    algorithm: "sha256",
    digest: "A".repeat(64),
  };
  await assertRejects(
    () => compileTechnicalSources(malformedArtifactFingerprint, catalog),
    TypeError,
    "artifactFingerprint.digest must be a lowercase",
  );

  const missingRoot = structuredClone(input);
  const missingRootAnchor = record(record(missingRoot.basis).sysmlAnchor);
  delete missingRootAnchor.rootElementId;
  await assertRejects(
    () => compileTechnicalSources(missingRoot, catalog),
    TypeError,
    "rootElementId is required",
  );

  const wrongRootMetaclass = structuredClone(input);
  const wrongRootAnchor = record(record(wrongRootMetaclass.basis).sysmlAnchor);
  wrongRootAnchor.rootElementKind = "PartDefinition";
  await assertRejects(
    () => compileTechnicalSources(wrongRootMetaclass, catalog),
    TypeError,
    'rootElementKind must equal "Package"',
  );

  const foreignRoot = structuredClone(input);
  const foreignRootAnchor = record(record(foreignRoot.basis).sysmlAnchor);
  foreignRootAnchor.rootElementId = "sysml.foreign.package";
  await assertRejects(
    () => compileTechnicalSources(foreignRoot, catalog),
    TypeError,
    "rootElementId must name exactly one Package",
  );

  const nonPackageRoot = structuredClone(input);
  const nonPackageRootAnchor = record(record(nonPackageRoot.basis).sysmlAnchor);
  nonPackageRootAnchor.rootElementId = "sysml.param.a";
  await assertRejects(
    () => compileTechnicalSources(nonPackageRoot, catalog),
    TypeError,
    "rootElementId must name exactly one Package",
  );

  const changedSource = structuredClone(input);
  const cad = values(changedSource.sources).map(record).find((source) =>
    record(source.analysis).source &&
    record(record(source.analysis).source).id === CAD_UNIT_ID
  );
  assert(cad);
  cad.sourceText = `${cad.sourceText as string}\n`;
  await assertRejects(
    () => compileTechnicalSources(changedSource, catalog),
    TypeError,
    "analysis.source.fingerprint does not match",
  );

  const changedAnalysis = structuredClone(input);
  const modelica = values(changedAnalysis.sources).map(record).find((source) =>
    record(record(source.analysis).source).id === MODELICA_UNIT_ID
  );
  assert(modelica);
  record(record(modelica.analysis).analyzer).version = "1.0.1";
  await assertRejects(
    () => compileTechnicalSources(changedAnalysis, catalog),
    TypeError,
    "analysisFingerprint does not match",
  );
});

Deno.test("SysML root identity is engaged by the normalized anchor fingerprint", async () => {
  const { input } = await fixture();
  const first = structuredClone(record(input.basis).sysmlAnchor) as Record<
    string,
    unknown
  >;
  values(first.elements).push({
    id: "sysml.root.alternate",
    kind: "Package",
    provenance: structuredClone(record(values(first.elements)[0]).provenance),
  });
  const second = structuredClone(first);
  second.rootElementId = "sysml.root.alternate";

  const firstFingerprint = await fingerprintTechnicalSysmlAnchor(first);
  const secondFingerprint = await fingerprintTechnicalSysmlAnchor(second);
  assert(firstFingerprint.digest !== secondFingerprint.digest);

  const duplicate = structuredClone(first);
  values(duplicate.elements).push({
    id: "sysml.root.package",
    kind: "Package",
    provenance: structuredClone(record(values(first.elements)[0]).provenance),
  });
  await assertRejects(
    async () => await fingerprintTechnicalSysmlAnchor(duplicate),
    TypeError,
    "elements ids must not contain duplicates",
  );
});

Deno.test(
  "sealed AttributeUsage ownership is exact, provenance-bound, and backward compatible",
  async () => {
    const { input } = await fixture();
    const historical = structuredClone(record(input.basis).sysmlAnchor) as Record<
      string,
      unknown
    >;
    const historicalFingerprint = await fingerprintTechnicalSysmlAnchor(historical);

    const withOwner = structuredClone(historical);
    const ownerElements = values(withOwner.elements);
    const provenance = structuredClone(record(ownerElements[0]).provenance);
    ownerElements.push({
      id: "sysml.part.frame",
      kind: "PartDefinition",
      provenance,
    });
    const ownedAttribute = ownerElements.map(record).find((element) =>
      element.id === "sysml.param.a"
    );
    assert(ownedAttribute);
    ownedAttribute.parentElementId = "sysml.part.frame";

    const withOwnerWithoutRelation = structuredClone(withOwner);
    const unownedAttribute = values(withOwnerWithoutRelation.elements)
      .map(record)
      .find((element) => element.id === "sysml.param.a");
    assert(unownedAttribute);
    delete unownedAttribute.parentElementId;

    const ownerlessFingerprint = await fingerprintTechnicalSysmlAnchor(
      withOwnerWithoutRelation,
    );
    const ownedFingerprint = await fingerprintTechnicalSysmlAnchor(withOwner);
    assert(historicalFingerprint.digest !== ownedFingerprint.digest);
    assert(ownerlessFingerprint.digest !== ownedFingerprint.digest);

    const nonPartParent = structuredClone(withOwner);
    const nonPartAttribute = values(nonPartParent.elements).map(record).find(
      (element) => element.id === "sysml.param.a",
    );
    assert(nonPartAttribute);
    nonPartAttribute.parentElementId = "sysml.root.package";
    await assertRejects(
      async () => await fingerprintTechnicalSysmlAnchor(nonPartParent),
      TypeError,
      "parentElementId must name an exact PartDefinition",
    );

    const foreignProvenance = structuredClone(withOwner);
    const foreignAttribute = values(foreignProvenance.elements).map(record).find(
      (element) => element.id === "sysml.param.a",
    );
    assert(foreignAttribute);
    record(foreignAttribute.provenance).captureId = "capture.foreign";
    await assertRejects(
      async () => await fingerprintTechnicalSysmlAnchor(foreignProvenance),
      TypeError,
      "parentElementId provenance must equal its PartDefinition owner",
    );

    const nonAttributeOwner = structuredClone(withOwner);
    const owner = values(nonAttributeOwner.elements).map(record).find((element) =>
      element.id === "sysml.part.frame"
    );
    assert(owner);
    owner.parentElementId = "sysml.root.package";
    await assertRejects(
      async () => await fingerprintTechnicalSysmlAnchor(nonAttributeOwner),
      TypeError,
      "parentElementId is only valid for AttributeUsage",
    );
  },
);

Deno.test("technical compiler rejects foreign, kind-drifted, and duplicate bindings", async () => {
  const { input, catalog } = await fixture();
  const mutations: Array<{
    readonly change: (binding: Record<string, unknown>) => void;
    readonly message: string;
  }> = [
    {
      change: (binding) => binding.sourceId = "source.foreign",
      message: "sourceId must name a source",
    },
    {
      change: (binding) => binding.sourceSymbolId = "symbol.foreign",
      message: "must name an exact symbol id",
    },
    {
      change: (binding) => binding.sysmlElementId = "sysml.foreign",
      message: "must name an exact element id",
    },
    {
      change: (binding) => binding.sysmlElementKind = "PartUsage",
      message: "must equal the captured kind",
    },
  ];
  for (const mutation of mutations) {
    const candidate = structuredClone(input);
    mutation.change(record(values(candidate.bindings)[0]));
    await assertRejects(
      () => compileTechnicalSources(candidate, catalog),
      TypeError,
      mutation.message,
    );
  }

  const duplicate = structuredClone(input);
  const bindings = values(duplicate.bindings);
  const second = record(bindings[1]);
  second.sourceId = record(bindings[0]).sourceId;
  second.sourceSymbolId = record(bindings[0]).sourceSymbolId;
  await assertRejects(
    () => compileTechnicalSources(duplicate, catalog),
    TypeError,
    "binding source/symbol pairs must not contain duplicates",
  );
});

Deno.test(
  "photo CAD without a named numeric lever stays unresolved on build123d-source only",
  async () => {
    const base = await fixture();
    const input = structuredClone(base.input);
    const cad = values(input.sources).map(record).find((source) =>
      record(record(source.analysis).source).id === CAD_UNIT_ID
    );
    assert(cad);
    const photo = "from build123d import Box\nresult = Box(20, 10, 5)\n";
    cad.sourceText = photo;
    const analysis = record(cad.analysis);
    record(analysis.source).fingerprint = await fingerprintTechnicalSourceText(
      photo,
    );
    cad.effectiveUnit = rootOnlyEffectiveUnit(
      CAD_UNIT_ID,
      record(analysis.source).fingerprint,
    );
    cad.analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);

    const result = await compileTechnicalSources(input, base.catalog);
    assertEquals(result.document.status, "unresolved");
    assert(
      result.document.diagnostics.some((diagnostic) =>
        diagnostic.code === "source.no-named-numeric-lever" &&
        diagnostic.profileRef ===
          `profile.build123d@${PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION}` &&
        diagnostic.subjectRef === CAD_UNIT_ID
      ),
    );
    const build123d = result.document.projections.find((item) =>
      item.target === "build123d-source"
    );
    const calculix = result.document.projections.find((item) =>
      item.target === "calculix-source-candidate"
    );
    const modelica = result.document.projections.find((item) =>
      item.target === "modelica-source-qualification"
    );
    assert(build123d);
    assert(calculix);
    assert(modelica);
    assertEquals(build123d.status, "unresolved");
    assertEquals(calculix.status, "ready-for-review");
    assertEquals(modelica.status, "ready-for-review");
  },
);

Deno.test(
  "a sealed build123d profile 1 document keeps its historical photo replay semantics",
  async () => {
    const base = await fixture();
    const input = structuredClone(base.input);
    const catalog = structuredClone(base.catalog);
    const request = values(input.profileRequests).map(record).find((item) =>
      item.profileId === "profile.build123d"
    );
    const profile = values(catalog.profiles).map(record).find((item) =>
      item.id === "profile.build123d"
    );
    assert(request);
    assert(profile);
    request.profileVersion = "1.0.0";
    profile.version = "1.0.0";

    const cad = values(input.sources).map(record).find((source) =>
      record(record(source.analysis).source).id === CAD_UNIT_ID
    );
    assert(cad);
    const photo = "from build123d import Box\nresult = Box(20, 10, 5)\n";
    cad.sourceText = photo;
    const analysis = record(cad.analysis);
    record(analysis.source).fingerprint = await fingerprintTechnicalSourceText(
      photo,
    );
    cad.effectiveUnit = rootOnlyEffectiveUnit(
      CAD_UNIT_ID,
      record(analysis.source).fingerprint,
    );
    analysis.symbols = [{ id: "cad.result", kind: "artifact", name: "result" }];
    analysis.dependencies = [];
    cad.analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
    input.bindings = values(input.bindings).filter((binding) =>
      record(binding).sourceId !== CAD_UNIT_ID
    );

    const compiled = await compileTechnicalSources(input, catalog);
    assertEquals(compiled.document.status, "ready-for-review");
    const reopened = await validateTechnicalCompilationDocument(compiled.document);
    assertEquals(reopened.status, "ready-for-review");
    assertEquals(
      reopened.diagnostics.some((item) =>
        item.code === "source.no-named-numeric-lever"
      ),
      false,
    );
  },
);

Deno.test(
  "a bound numeric literal that cannot reach result does not satisfy the CAD lever invariant",
  async () => {
    const base = await fixture();
    const input = structuredClone(base.input);
    const cad = values(input.sources).map(record).find((source) =>
      record(record(source.analysis).source).id === CAD_UNIT_ID
    );
    assert(cad);
    const sourceText = [
      "from build123d import Box",
      "unused = 1",
      "result = Box(20, 10, 5)",
      "",
    ].join("\n");
    cad.sourceText = sourceText;
    const analysis = record(cad.analysis);
    record(analysis.source).fingerprint = await fingerprintTechnicalSourceText(
      sourceText,
    );
    cad.effectiveUnit = rootOnlyEffectiveUnit(
      CAD_UNIT_ID,
      record(analysis.source).fingerprint,
    );
    analysis.symbols = [{
      id: "cad.param.a",
      kind: "parameter",
      name: "unused",
      span: {
        start: { line: 2, column: 0 },
        end: { line: 2, column: 6 },
      },
    }, {
      id: "cad.result",
      kind: "artifact",
      name: "result",
    }];
    analysis.dependencies = [];
    cad.analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
    input.bindings = values(input.bindings).filter((binding) =>
      record(binding).sourceSymbolId !== "cad.param.b"
    );

    const compiled = await compileTechnicalSources(input, base.catalog);
    assertEquals(compiled.document.status, "unresolved");
    assert(
      compiled.document.diagnostics.some((diagnostic) =>
        diagnostic.code === "source.no-named-numeric-lever"
      ),
    );
  },
);

Deno.test(
  "a reachable named literal without parameterizes is binding.missing, not a missing lever",
  async () => {
    const base = await fixture();
    const input = structuredClone(base.input);
    const cad = values(input.sources).map(record).find((source) =>
      record(record(source.analysis).source).id === CAD_UNIT_ID
    );
    assert(cad);
    const sourceText = [
      "from build123d import Box",
      "thickness = 2",
      "result = Box(20, 10, thickness)",
      "",
    ].join("\n");
    cad.sourceText = sourceText;
    const analysis = record(cad.analysis);
    record(analysis.source).fingerprint = await fingerprintTechnicalSourceText(
      sourceText,
    );
    cad.effectiveUnit = rootOnlyEffectiveUnit(
      CAD_UNIT_ID,
      record(analysis.source).fingerprint,
    );
    analysis.symbols = [{
      id: "cad.param.a",
      kind: "parameter",
      name: "thickness",
      span: {
        start: { line: 2, column: 0 },
        end: { line: 2, column: 9 },
      },
    }, {
      id: "cad.result",
      kind: "artifact",
      name: "result",
    }];
    analysis.dependencies = [{
      id: "dependency.cad.a.result",
      kind: "structural-incidence",
      fromSymbolId: "cad.param.a",
      toSymbolId: "cad.result",
    }];
    cad.analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
    input.bindings = values(input.bindings).filter((binding) =>
      record(binding).sourceId !== CAD_UNIT_ID ||
      record(binding).sourceSymbolId === "cad.result"
    );

    const compiled = await compileTechnicalSources(input, base.catalog);
    assertEquals(compiled.document.status, "unresolved");
    assertEquals(
      compiled.document.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        profileRef: diagnostic.profileRef,
        subjectRef: diagnostic.subjectRef,
      })).sort((left, right) =>
        left.profileRef < right.profileRef
          ? -1
          : left.profileRef > right.profileRef
          ? 1
          : 0
      ),
      [{
        code: "binding.missing",
        profileRef:
          `profile.build123d@${PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION}`,
        subjectRef: `${CAD_UNIT_ID}:cad.param.a`,
      }, {
        code: "binding.missing",
        profileRef: "profile.calculix@1.0.0",
        subjectRef: `${CAD_UNIT_ID}:cad.param.a`,
      }],
    );
  },
);

Deno.test(
  "Modelica admission is ready without represents when unique parameterizes have distinct owners",
  async () => {
    const sourceText = "model Root end Root;";
    const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
    const analysis = {
      schemaVersion: "source-analysis/1.0",
      source: {
        id: MODELICA_UNIT_ID,
        role: "modelica-model",
        language: "modelica",
        fingerprint: sourceFingerprint,
      },
      analyzer: { id: "test.ast", version: "1.0.0" },
      policy: {
        profile: "policy.modelica-safe",
        status: "passed",
        findings: [],
      },
      symbols: [
        { id: "artifact.Root", kind: "artifact", name: "Root" },
        { id: "parameter.state", kind: "parameter", name: "state" },
        { id: "parameter.power", kind: "parameter", name: "power" },
      ],
      dependencies: [{
        id: "dependency.state.Root",
        kind: "structural-incidence",
        fromSymbolId: "parameter.state",
        toSymbolId: "artifact.Root",
      }, {
        id: "dependency.power.Root",
        kind: "structural-incidence",
        fromSymbolId: "parameter.power",
        toSymbolId: "artifact.Root",
      }],
      unresolvedConstructs: [],
    };
    const sysmlProvenance = {
      artifactId: "artifact.sysml",
      artifactFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
      captureId: "capture.syson",
    };
    const sysmlAnchor = {
      artifactId: "artifact.sysml",
      artifactFingerprint: sysmlProvenance.artifactFingerprint,
      captureId: "capture.syson",
      editingContextId: "editing-context.main",
      rootElementId: "sysml.root.package",
      rootElementKind: "Package",
      elements: [
        { id: "sysml.root.package", kind: "Package", provenance: sysmlProvenance },
        {
          id: "sysml.head",
          kind: "PartDefinition",
          name: "Head",
          provenance: sysmlProvenance,
        },
        {
          id: "sysml.driver",
          kind: "PartDefinition",
          name: "Driver",
          provenance: sysmlProvenance,
        },
        {
          id: "sysml.head.state",
          kind: "AttributeUsage",
          name: "state",
          parentElementId: "sysml.head",
          provenance: sysmlProvenance,
        },
        {
          id: "sysml.driver.power",
          kind: "AttributeUsage",
          name: "power",
          parentElementId: "sysml.driver",
          provenance: sysmlProvenance,
        },
      ],
    };
    const basis = {
      thread: {
        projectId: "project.plant",
        subjectId: "subject.plant",
        snapshotId: "snapshot.7",
        revision: 7,
        snapshotFingerprint: THREAD_FINGERPRINT,
      },
      sysmlAnchor,
      sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
    };
    const compiled = await compileTechnicalSources({
      schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
      basis,
      basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
      sources: [{
        sourceText,
        analysis,
        analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
        effectiveUnit: rootOnlyEffectiveUnit(MODELICA_UNIT_ID, sourceFingerprint),
      }],
      bindings: [{
        id: "binding:modelica:parameter.power:parameterizes",
        sourceId: MODELICA_UNIT_ID,
        sourceSymbolId: "parameter.power",
        sysmlElementId: "sysml.driver.power",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }, {
        id: "binding:modelica:parameter.state:parameterizes",
        sourceId: MODELICA_UNIT_ID,
        sourceSymbolId: "parameter.state",
        sysmlElementId: "sysml.head.state",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }],
      profileRequests: [{
        profileId: "profile.modelica",
        profileVersion: "2.0.0",
        sourceIds: [MODELICA_UNIT_ID],
      }],
    }, {
      schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
      profiles: [{
        id: "profile.modelica",
        version: "2.0.0",
        target: "modelica-source-qualification",
        sourceRole: "modelica-model",
        language: "modelica",
        analyzer: { id: "test.ast", version: "1.0.0" },
        analysisPolicyProfile: "policy.modelica-safe",
        requiredBindingSymbolKinds: ["parameter"],
      }],
    });
    assertEquals(compiled.document.status, "ready-for-review");
    assertEquals(
      compiled.document.inputManifest.bindings.map((binding) => binding.relation),
      ["parameterizes", "parameterizes"],
    );
    assertEquals(compiled.document.diagnostics, []);
  },
);

Deno.test("CAD admission stays unresolved when the result artifact is unbound", async () => {
  const { input, catalog } = await fixture();
  const build123d = values(catalog.profiles).map(record).find((profile) =>
    profile.id === "profile.build123d"
  );
  assert(build123d);
  build123d.requiredBindingSymbolKinds = ["artifact", "parameter"];
  const compiled = await compileTechnicalSources(input, catalog);
  assertEquals(compiled.document.status, "unresolved");
  assert(
    compiled.document.diagnostics.some((diagnostic) =>
      diagnostic.code === "binding.missing" &&
      diagnostic.profileRef ===
        `profile.build123d@${PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION}` &&
      diagnostic.subjectRef === `${CAD_UNIT_ID}:cad.result`
    ),
  );
});

Deno.test("missing explicit binding and analyzer uncertainty remain unresolved", async () => {
  const base = await fixture({ cadUnresolved: true });
  const input = structuredClone(base.input);
  input.bindings = values(input.bindings).filter((binding) =>
    record(binding).sourceSymbolId !== "cad.param.b"
  );
  const result = await compileTechnicalSources(input, base.catalog);

  assertEquals(result.document.status, "unresolved");
  const codes = result.document.diagnostics.map((item) => item.code);
  assert(codes.includes("binding.missing"));
  assert(codes.includes("source.unresolved-construct"));
  assert(
    result.document.projections
      .filter((item) => item.target !== "modelica-source-qualification")
      .every((item) => item.status === "unresolved"),
  );
});

Deno.test("rejected analyzer policy and qualification-policy mismatch reject admission", async () => {
  const rejected = await fixture({ cadRejected: true });
  const rejectedResult = await compileTechnicalSources(
    rejected.input,
    rejected.catalog,
  );
  assertEquals(rejectedResult.document.status, "rejected");
  assert(
    rejectedResult.document.diagnostics.some((item) =>
      item.code === "source.policy-rejected"
    ),
  );

  const mismatch = await fixture();
  const catalog = structuredClone(mismatch.catalog);
  const buildProfile = values(catalog.profiles).map(record).find((profile) =>
    profile.id === "profile.build123d"
  );
  assert(buildProfile);
  buildProfile.analysisPolicyProfile = "policy.other";
  const mismatchResult = await compileTechnicalSources(mismatch.input, catalog);
  assertEquals(mismatchResult.document.status, "rejected");
  assert(
    mismatchResult.document.diagnostics.some((item) =>
      item.code === "source.analysis-policy-mismatch"
    ),
  );
});

Deno.test("server-owned profile rejects an exact analyzer id or version mismatch", async () => {
  for (const [field, mismatch] of [["id", "other.ast"], ["version", "9.9.9"]]) {
    const { input, catalog } = await fixture();
    const candidate = structuredClone(input);
    const cad = values(candidate.sources).map(record).find((source) =>
      record(record(source.analysis).source).id === CAD_UNIT_ID
    );
    assert(cad);
    const analysis = record(cad.analysis);
    record(analysis.analyzer)[field] = mismatch;
    cad.analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);

    const result = await compileTechnicalSources(candidate, catalog);
    assertEquals(result.document.status, "rejected");
    assert(
      result.document.diagnostics.some((diagnostic) =>
        diagnostic.code === "source.analyzer-mismatch" &&
        diagnostic.subjectRef === CAD_UNIT_ID
      ),
    );
  }
});

Deno.test("orphan technical sources and their bindings are rejected", async () => {
  const { input, catalog } = await fixture();
  const orphanSourceInput = structuredClone(input);
  const cad = values(orphanSourceInput.sources).map(record).find((source) =>
    record(record(source.analysis).source).id === CAD_UNIT_ID
  );
  assert(cad);
  const orphan = structuredClone(cad);
  const orphanAnalysis = record(orphan.analysis);
  record(orphanAnalysis.source).id = ORPHAN_UNIT_ID;
  orphan.effectiveUnit = rootOnlyEffectiveUnit(
    ORPHAN_UNIT_ID,
    record(orphanAnalysis.source).fingerprint,
  );
  orphan.analysisFingerprint = await fingerprintSourceAnalysisBundle(orphanAnalysis);
  values(orphanSourceInput.sources).push(orphan);

  await assertRejects(
    () => compileTechnicalSources(orphanSourceInput, catalog),
    TypeError,
    `${ORPHAN_UNIT_ID} must be referenced by at least one profile request`,
  );

  const orphanBindingInput = structuredClone(orphanSourceInput);
  values(orphanBindingInput.bindings).push({
    id: "binding.cad.orphan",
    sourceId: ORPHAN_UNIT_ID,
    sourceSymbolId: "cad.param.a",
    sysmlElementId: "sysml.param.a",
    sysmlElementKind: "AttributeUsage",
    relation: "parameterizes",
  });
  await assertRejects(
    () => compileTechnicalSources(orphanBindingInput, catalog),
    TypeError,
    "binding.cad.orphan must concern a source requested by at least one profile request",
  );
});

Deno.test("different unknown-profile requests remain different documents and fingerprints", async () => {
  const { input, catalog } = await fixture();
  const cadRequest = structuredClone(input);
  values(cadRequest.profileRequests).push({
    profileId: "profile.unknown",
    profileVersion: "9.9.9",
    sourceIds: [CAD_UNIT_ID],
  });
  const modelicaRequest = structuredClone(input);
  values(modelicaRequest.profileRequests).push({
    profileId: "profile.unknown",
    profileVersion: "9.9.9",
    sourceIds: [MODELICA_UNIT_ID],
  });

  const cadResult = await compileTechnicalSources(cadRequest, catalog);
  const modelicaResult = await compileTechnicalSources(modelicaRequest, catalog);
  assert(cadResult.fingerprint.digest !== modelicaResult.fingerprint.digest);
  assertEquals(
    cadResult.document.inputManifest === modelicaResult.document.inputManifest,
    false,
  );
  assertEquals(cadResult.document === modelicaResult.document, false);
  assertEquals(
    cadResult.document.inputManifest.profileRequests ===
      modelicaResult.document.inputManifest.profileRequests,
    false,
  );
  assert(
    JSON.stringify(cadResult.document) !== JSON.stringify(modelicaResult.document),
  );
});

Deno.test("unknown profile is a stable rejected result, not an execution fallback", async () => {
  const { input, catalog } = await fixture();
  const candidate = structuredClone(input);
  values(candidate.profileRequests).push({
    profileId: "profile.unknown",
    profileVersion: "9.9.9",
    sourceIds: [CAD_UNIT_ID],
  });
  const result = await compileTechnicalSources(candidate, catalog);

  assertEquals(result.document.status, "rejected");
  assertEquals(result.document.diagnostics[0], {
    code: "profile.not-found",
    profileRef: "profile.unknown@9.9.9",
    subjectRef: "profile.unknown@9.9.9",
  });
  assertEquals(result.document.projections.length, 3);
});

Deno.test("target projections never mix CAD and Modelica sources", async () => {
  const { input, catalog } = await fixture();
  const result = await compileTechnicalSources(input, catalog);

  assert(
    result.document.projections.some((projection) =>
      projection.target === "calculix-source-candidate"
    ),
  );
  assert(
    !result.document.projections.some((projection) =>
      (projection.target as string) === "calculix-static-proof"
    ),
  );

  for (const projection of result.document.projections) {
    const sourceFacts = projection.sources.map((source) => source.analysis.source);
    if (projection.target === "modelica-source-qualification") {
      assertEquals(sourceFacts.map((source) => [source.role, source.language]), [[
        "modelica-model",
        "modelica",
      ]]);
    } else {
      assertEquals(sourceFacts.map((source) => [source.role, source.language]), [[
        "cad-script",
        "python",
      ]]);
    }
    assert(sourceFacts.every((source) => source.language !== "calculix-inp"));
  }
});

Deno.test("document and fingerprint are deterministic under set permutations", async () => {
  const { input, catalog } = await fixture();
  const permutedInput = structuredClone(input);
  permutedInput.sources = values(permutedInput.sources).reverse();
  permutedInput.bindings = values(permutedInput.bindings).reverse();
  permutedInput.profileRequests = values(permutedInput.profileRequests).reverse();
  const basis = record(permutedInput.basis);
  const anchor = record(basis.sysmlAnchor);
  anchor.elements = values(anchor.elements).reverse();
  for (const source of values(permutedInput.sources).map(record)) {
    const analysis = record(source.analysis);
    analysis.symbols = values(analysis.symbols).reverse();
  }
  const permutedCatalog = structuredClone(catalog);
  permutedCatalog.profiles = values(permutedCatalog.profiles).reverse();

  const first = await compileTechnicalSources(input, catalog);
  const second = await compileTechnicalSources(permutedInput, permutedCatalog);
  assertEquals(second, first);
});

Deno.test("projection source order is deterministic inside a multi-source profile", async () => {
  const { input, catalog } = await fixture();
  const candidate = structuredClone(input);
  const cad = values(candidate.sources).map(record).find((source) =>
    record(record(source.analysis).source).id === CAD_UNIT_ID
  );
  assert(cad);
  const secondCad = structuredClone(cad);
  const secondAnalysis = record(secondCad.analysis);
  const secondSource = record(secondAnalysis.source);
  secondSource.id = SECONDARY_CAD_UNIT_ID;
  const secondText = `${secondCad.sourceText as string}secondary = 1\n`;
  secondCad.sourceText = secondText;
  secondSource.fingerprint = await fingerprintTechnicalSourceText(secondText);
  secondCad.effectiveUnit = rootOnlyEffectiveUnit(
    SECONDARY_CAD_UNIT_ID,
    secondSource.fingerprint,
  );
  secondCad.analysisFingerprint = await fingerprintSourceAnalysisBundle(
    secondAnalysis,
  );
  values(candidate.sources).push(secondCad);

  const buildRequest = values(candidate.profileRequests).map(record).find((request) =>
    request.profileId === "profile.build123d"
  );
  assert(buildRequest);
  buildRequest.sourceIds = [SECONDARY_CAD_UNIT_ID, CAD_UNIT_ID];

  const reversed = structuredClone(candidate);
  reversed.sources = values(reversed.sources).reverse();
  const reversedRequest = values(reversed.profileRequests).map(record).find((request) =>
    request.profileId === "profile.build123d"
  );
  assert(reversedRequest);
  reversedRequest.sourceIds = values(reversedRequest.sourceIds).reverse();

  assertEquals(
    await compileTechnicalSources(candidate, catalog),
    await compileTechnicalSources(reversed, catalog),
  );
});

Deno.test({
  name: "real Python CAD frontend keeps current build123d source unresolved honestly",
  async fn() {
    const {
      PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
      PYTHON_CAD_SOURCE_ANALYZER_ID,
      PYTHON_CAD_SOURCE_ANALYZER_VERSION,
      PythonCadSourceAnalyzer,
    } = await import("../../../adapters/cad/source/python-cad-source-analyzer.ts");
    const sourceText = `from build123d import Box
width = 10
height = width * 2
result = Box(width, height, 3)
`;
    const analysis = await new PythonCadSourceAnalyzer().analyze({
      sourceId: REAL_CAD_UNIT_ID,
      role: "cad-script",
      language: "python",
      sourceText,
    });
    assertEquals(analysis.policy.status, "passed");
    assert(analysis.unresolvedConstructs.length > 0);

    const variables = analysis.symbols.filter((symbol) => symbol.kind === "variable");
    const sysmlArtifactFingerprint = {
      algorithm: "sha256" as const,
      digest: "3".repeat(64),
    };
    const sysmlProvenance = {
      artifactId: "artifact.sysml.real",
      artifactFingerprint: sysmlArtifactFingerprint,
      captureId: "capture.syson.real",
    };
    const sysmlAnchor = {
      artifactId: "artifact.sysml.real",
      artifactFingerprint: sysmlArtifactFingerprint,
      captureId: "capture.syson.real",
      editingContextId: "editing-context.real",
      rootElementId: "sysml.real.root",
      rootElementKind: "Package",
      elements: variables.map((_, index) => ({
        id: `sysml.real.parameter.${index + 1}`,
        kind: "AttributeUsage",
        provenance: sysmlProvenance,
      })).concat([{
        id: "sysml.real.root",
        kind: "Package",
        provenance: sysmlProvenance,
      }]),
    };
    const sysmlAnchorFingerprint = await fingerprintTechnicalSysmlAnchor(sysmlAnchor);
    const basis = {
      thread: {
        projectId: "project.real",
        subjectId: "subject.real",
        snapshotId: "snapshot.real.1",
        revision: 1,
        snapshotFingerprint: THREAD_FINGERPRINT,
      },
      sysmlAnchor,
      sysmlAnchorFingerprint,
    };
    const input = {
      schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
      basis,
      basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
      sources: [{
        sourceText,
        analysis,
        analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
        effectiveUnit: rootOnlyEffectiveUnit(
          REAL_CAD_UNIT_ID,
          analysis.source.fingerprint,
        ),
      }],
      bindings: variables.map((symbol, index) => ({
        id: `binding.real.${index + 1}`,
        sourceId: analysis.source.id,
        sourceSymbolId: symbol.id,
        sysmlElementId: sysmlAnchor.elements[index]!.id,
        sysmlElementKind: sysmlAnchor.elements[index]!.kind,
        relation: "parameterizes",
      })),
      profileRequests: [{
        profileId: "profile.build123d.real",
        profileVersion: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
        sourceIds: [analysis.source.id],
      }],
    };
    const catalog = {
      schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
      profiles: [{
        id: "profile.build123d.real",
        version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
        target: "build123d-source",
        sourceRole: "cad-script",
        language: "python",
        analyzer: {
          id: PYTHON_CAD_SOURCE_ANALYZER_ID,
          version: PYTHON_CAD_SOURCE_ANALYZER_VERSION,
        },
        analysisPolicyProfile: PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
        requiredBindingSymbolKinds: ["variable"],
      }],
    };

    const result = await compileTechnicalSources(input, catalog);
    assertEquals(result.document.status, "unresolved");
    assertEquals(result.document.projections[0].status, "unresolved");
    assert(
      result.document.diagnostics.some((diagnostic) =>
        diagnostic.code === "source.unresolved-construct"
      ),
    );
    assert(
      !result.document.diagnostics.some((diagnostic) =>
        diagnostic.code === "source.analyzer-mismatch" ||
        diagnostic.code === "source.analysis-policy-mismatch"
      ),
    );
  },
});

Deno.test("exact UTF-8 hashing detects byte drift and rejects unpaired surrogates", async () => {
  const composed = await fingerprintTechnicalSourceText("é");
  const decomposed = await fingerprintTechnicalSourceText("e\u0301");
  assert(composed.digest !== decomposed.digest);

  await assertRejects(
    () => fingerprintTechnicalSourceText("bad\ud800source"),
    TypeError,
    "unpaired UTF-16 surrogate",
  );
});

Deno.test("profile catalog cannot redefine fixed target source contracts", async () => {
  const { input, catalog } = await fixture();
  const candidate = structuredClone(catalog);
  const calculix = values(candidate.profiles).map(record).find((profile) =>
    profile.id === "profile.calculix"
  );
  assert(calculix);
  calculix.sourceRole = "modelica-model";
  calculix.language = "modelica";

  await assertRejects(
    () => compileTechnicalSources(input, candidate),
    TypeError,
    "fixed calculix-source-candidate admission contract",
  );
});

Deno.test("compiled document round-trips through strict CAS reopening", async () => {
  const { input, catalog } = await fixture();
  const compiled = await compileTechnicalSources(input, catalog);
  const reopened = await validateTechnicalCompilationDocument(
    structuredClone(compiled.document),
  );

  assertEquals(reopened, compiled.document);
  assertEquals(
    await fingerprintTechnicalCompilationDocument(reopened),
    compiled.fingerprint,
  );
  assert(Object.isFrozen(reopened));
  assert(Object.isFrozen(reopened.inputManifest.sources[0].analysis));
});

Deno.test("CAS reopening rejects SysML artifact fingerprint tamper independently", async () => {
  const { input, catalog } = await fixture();
  const compiled = await compileTechnicalSources(input, catalog);
  const tampered = structuredClone(compiled.document) as unknown as Record<
    string,
    unknown
  >;
  const basis = record(tampered.basis);
  const anchor = record(basis.sysmlAnchor);
  record(anchor.artifactFingerprint).digest = "8".repeat(64);

  await assertRejects(
    () => validateTechnicalCompilationDocument(tampered),
    TypeError,
    "root Package provenance must equal the anchor capture identity",
  );
});

Deno.test("CAS reopening rejects a changed or non-Package SysML root", async () => {
  const { input, catalog } = await fixture();
  const compiled = await compileTechnicalSources(input, catalog);
  const changedRoot = structuredClone(compiled.document) as unknown as Record<
    string,
    unknown
  >;
  const anchor = record(record(changedRoot.basis).sysmlAnchor);
  anchor.rootElementId = "sysml.param.a";

  await assertRejects(
    () => validateTechnicalCompilationDocument(changedRoot),
    TypeError,
    "rootElementId must name exactly one Package",
  );
});

Deno.test("CAS reopening detects nested surplus fields and recomputed hash drift", async () => {
  const { input, catalog } = await fixture();
  const compiled = await compileTechnicalSources(input, catalog);

  const surplus = structuredClone(compiled.document) as unknown as Record<
    string,
    unknown
  >;
  record(values(record(surplus.inputManifest).sources)[0]).extra = true;
  await assertRejects(
    () => validateTechnicalCompilationDocument(surplus),
    TypeError,
    "unsupported field extra",
  );

  const sourceDrift = structuredClone(compiled.document) as unknown as Record<
    string,
    unknown
  >;
  const source = record(values(record(sourceDrift.inputManifest).sources)[0]);
  source.sourceText = `${source.sourceText as string}# tamper\n`;
  await assertRejects(
    () => validateTechnicalCompilationDocument(sourceDrift),
    TypeError,
    "analysis.source.fingerprint does not match",
  );

  const profileHashDrift = structuredClone(compiled.document) as unknown as Record<
    string,
    unknown
  >;
  const firstProjection = record(values(profileHashDrift.projections)[0]);
  record(firstProjection.profileFingerprint).digest = "f".repeat(64);
  await assertRejects(
    () => validateTechnicalCompilationDocument(profileHashDrift),
    TypeError,
    "profileFingerprint does not match",
  );

  const diagnosticDrift = structuredClone(compiled.document) as unknown as Record<
    string,
    unknown
  >;
  diagnosticDrift.status = "unresolved";
  await assertRejects(
    () => validateTechnicalCompilationDocument(diagnosticDrift),
    TypeError,
    "must equal ready-for-review",
  );
});

Deno.test("binding tuple identity is injective for exact ids containing colons", async () => {
  const { input, catalog } = await fixture();
  const compiled = await compileTechnicalSources(input, catalog);
  const document = structuredClone(compiled.document) as unknown as Record<
    string,
    unknown
  >;
  const manifest = record(document.inputManifest);
  const bindings = values(manifest.bindings);
  const first = record(bindings[0]);
  const second = record(bindings[1]);
  first.sourceId = "source:cad";
  first.sourceSymbolId = "symbol";
  second.sourceId = "source";
  second.sourceSymbolId = "cad:symbol";

  await assertRejects(
    () => validateTechnicalCompilationDocument(document),
    TypeError,
    "must name a source",
  );
});

Deno.test("unique compilation admission target joins SPICE by target/source only", () => {
  const spice = compilationTargetFacts(
    "spice-circuit-source",
    "spice",
    "spice-circuit",
  );
  assertEquals(uniqueCompilationAdmissionTarget(spice), "spice-circuit-source");
  assertEquals(
    uniqueCompilationDocumentTarget(spice.document),
    "spice-circuit-source",
  );
  const mixed = compilationTargetFacts(
    "spice-circuit-source",
    "python",
    "spice-circuit",
  );
  assertEquals(uniqueCompilationAdmissionTarget(mixed), undefined);
  assertEquals(uniqueCompilationDocumentTarget(mixed.document), undefined);
  assertEquals(
    uniqueCompilationAdmissionTarget(
      compilationTargetFacts(
        "modelica-source-qualification",
        "modelica",
        "modelica-model",
      ),
    ),
    "modelica-source-qualification",
  );
  assertEquals(
    uniqueCompilationDocumentTarget(
      compilationTargetFacts(
        "modelica-source-qualification",
        "modelica",
        "modelica-model",
      ).document,
    ),
    "modelica-source-qualification",
  );
  assertEquals(
    uniqueCompilationAdmissionTarget(
      compilationTargetFacts("build123d-source", "python", "cad-script"),
    ),
    "build123d-source",
  );
  assertEquals(
    uniqueCompilationDocumentTarget(
      compilationTargetFacts("build123d-source", "python", "cad-script")
        .document,
    ),
    "build123d-source",
  );
});

Deno.test(
  "SPICE admission is ready without named levers when .param symbols are unbound-free",
  async () => {
    const sourceText = "Vin in 0 5\nRload in 0 1k\n";
    const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
    const analysis = {
      schemaVersion: "source-analysis/1.0",
      source: {
        id: SPICE_UNIT_ID,
        role: "spice-circuit",
        language: "spice",
        fingerprint: sourceFingerprint,
      },
      analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
      policy: {
        profile: "spice-circuit-closed-subset-v1",
        status: "passed",
        findings: [],
      },
      symbols: [
        { id: "artifact.circuit", kind: "artifact", name: "circuit" },
        { id: "component.Vin", kind: "component", name: "Vin" },
      ],
      dependencies: [],
      unresolvedConstructs: [],
    };
    const sysmlProvenance = {
      artifactId: "artifact.sysml",
      artifactFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
      captureId: "capture.syson",
    };
    const sysmlAnchor = {
      artifactId: "artifact.sysml",
      artifactFingerprint: sysmlProvenance.artifactFingerprint,
      captureId: "capture.syson",
      editingContextId: "editing-context.main",
      rootElementId: "sysml.root.package",
      rootElementKind: "Package",
      elements: [
        { id: "sysml.root.package", kind: "Package", provenance: sysmlProvenance },
      ],
    };
    const basis = {
      thread: {
        projectId: "project.clamp",
        subjectId: "subject.clamp",
        snapshotId: "snapshot.3",
        revision: 3,
        snapshotFingerprint: THREAD_FINGERPRINT,
      },
      sysmlAnchor,
      sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
    };
    const compiled = await compileTechnicalSources({
      schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
      basis,
      basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
      sources: [{
        sourceText,
        analysis,
        analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
        effectiveUnit: rootOnlyEffectiveUnit(SPICE_UNIT_ID, sourceFingerprint),
      }],
      bindings: [],
      profileRequests: [{
        profileId: "spice-circuit-closed-subset-v1",
        profileVersion: "1.0.0",
        sourceIds: [SPICE_UNIT_ID],
      }],
    }, {
      schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
      profiles: [{
        id: "spice-circuit-closed-subset-v1",
        version: "1.0.0",
        target: "spice-circuit-source",
        sourceRole: "spice-circuit",
        language: "spice",
        analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
        analysisPolicyProfile: "spice-circuit-closed-subset-v1",
        requiredBindingSymbolKinds: ["parameter"],
      }],
    });
    assertEquals(compiled.document.status, "ready-for-review");
    assertEquals(compiled.document.diagnostics, []);
    assertEquals(compiled.document.projections[0]?.target, "spice-circuit-source");
  },
);

Deno.test("SPICE .param without unique parameterizes stays binding.missing", async () => {
  const sourceText = "Vin in 0 5\nRload in 0 {rload}\n.param rload=1000\n";
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const analysis = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: SPICE_UNIT_ID,
      role: "spice-circuit",
      language: "spice",
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
    policy: {
      profile: "spice-circuit-closed-subset-v1",
      status: "passed",
      findings: [],
    },
    symbols: [
      { id: "artifact.circuit", kind: "artifact", name: "circuit" },
      { id: "parameter.rload", kind: "parameter", name: "rload" },
    ],
    dependencies: [],
    unresolvedConstructs: [],
  };
  const sysmlProvenance = {
    artifactId: "artifact.sysml",
    artifactFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
    captureId: "capture.syson",
  };
  const sysmlAnchor = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlProvenance.artifactFingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.root.package",
    rootElementKind: "Package",
    elements: [
      { id: "sysml.root.package", kind: "Package", provenance: sysmlProvenance },
    ],
  };
  const basis = {
    thread: {
      projectId: "project.clamp",
      subjectId: "subject.clamp",
      snapshotId: "snapshot.3",
      revision: 3,
      snapshotFingerprint: THREAD_FINGERPRINT,
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{
      sourceText,
      analysis,
      analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
      effectiveUnit: rootOnlyEffectiveUnit(SPICE_UNIT_ID, sourceFingerprint),
    }],
    bindings: [],
    profileRequests: [{
      profileId: "spice-circuit-closed-subset-v1",
      profileVersion: "1.0.0",
      sourceIds: [SPICE_UNIT_ID],
    }],
  }, {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [{
      id: "spice-circuit-closed-subset-v1",
      version: "1.0.0",
      target: "spice-circuit-source",
      sourceRole: "spice-circuit",
      language: "spice",
      analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
      analysisPolicyProfile: "spice-circuit-closed-subset-v1",
      requiredBindingSymbolKinds: ["parameter"],
    }],
  });
  assertEquals(compiled.document.status, "unresolved");
  assertEquals(
    compiled.document.diagnostics.some((diagnostic) =>
      diagnostic.code === "binding.missing" &&
      diagnostic.subjectRef === `${SPICE_UNIT_ID}:parameter.rload`
    ),
    true,
  );
  assertEquals(
    compiled.document.diagnostics.some((diagnostic) =>
      diagnostic.code === "source.no-named-numeric-lever"
    ),
    false,
  );
});

function compilationTargetFacts(
  target: TechnicalCompilationTarget,
  language: string,
  role: string,
): CompilationAdmissionTargetFacts {
  return {
    admission: {
      sources: [{ language, role }],
      compilationProfileRequests: [{ target }],
    },
    document: {
      projections: [{
        target,
        profile: {
          target,
          language,
          sourceRole: role,
        },
      }],
      inputManifest: {
        sources: [{
          analysis: {
            source: { language, role },
          },
        }],
      },
    },
  };
}

function recursiveKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) recursiveKeys(item, into);
    return into;
  }
  if (value === null || typeof value !== "object") return into;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    into.add(key);
    recursiveKeys(child, into);
  }
  return into;
}
