import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  canonicalModelicaQualifiedManifestDocumentText,
  canonicalModelicaResumableProviderJson,
  fingerprintModelicaResumableProviderJson,
} from "../../domain/modelica/recorded/resumable-capabilities.ts";
import { fingerprintResourceBytes } from "../../domain/analysis/provider-resource-reader.ts";
import { validateResolvedOperationPlanV2 } from "../../domain/analysis/resolved-operation-plan-v2.ts";
import {
  canonicalProofText,
  encodeFeaProofDecisionParameters,
} from "../../domain/analysis/fea-proof-proposal.ts";
import { validateMechanicalProofCase } from "../../domain/analysis/mechanical-proof-case.ts";
import {
  canonicalSimulationCaseV2Text,
  validateSimulationCaseV2,
} from "../../domain/modelica/recorded/simulation-case-v2.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { RegisteredRunPlanSealInput } from "../../domain/project/resolved-run-plan-sealer.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  canonicalModelicaQualifiedSourceCaptureText,
} from "../modelica/recorded/v2/qualified-source-capture.ts";
import {
  canonicalModelicaSimulationCaseQualificationCaptureText,
} from "../modelica/recorded/v2/simulation-case-qualification-capture.ts";
import type { CanonicalAssetReader } from "../../application/ports/out/canonical-asset-reader.ts";
import {
  RecordedOperationPlanResolver,
  type RecordedPlanArtifactReader,
} from "./recorded-operation-plan-resolver.ts";
import { FixedCalculixIsolatedExecutionProfileCatalog } from "../execution-profiles/fixed-calculix-isolated-execution-profile.ts";

const AT = "2026-08-12T00:00:00.000Z";

Deno.test("RecordedOperationPlanResolver resolves canonical Modelica evidence on a true successor lineage deterministically", async () => {
  const fixture = await modelicaFixture();
  assertEquals(validateThreadSnapshot(fixture.ancestor), fixture.ancestor);
  assertEquals(validateThreadSnapshot(fixture.basis), fixture.basis);
  const resolver = new RecordedOperationPlanResolver(fixture.dependencies);
  const first = await resolver.resolve(fixture.input);
  const second = await resolver.resolve(fixture.input);

  assertEquals(first, second);
  validateResolvedOperationPlanV2(first);
  assertEquals(first.basis.snapshotId, fixture.basis.id);
  assertEquals(first.action.kind, "dynamic-system-simulation");
  assertEquals(first.action.requestId.startsWith("rop2-modelica-"), true);
  assertEquals(first.sources.map((source) => source.artifact.casUri), [
    fixture.artifacts.case.uri,
    fixture.artifacts.manifest.uri,
    fixture.artifacts.authority.uri,
    fixture.artifacts.model.uri,
    fixture.artifacts.scenario.uri,
  ]);
  assertEquals(
    first.authorization.methodQualification.fingerprint,
    fixture.artifacts.authority.fingerprint,
  );
});

Deno.test("RecordedOperationPlanResolver rejects the historical structured Uint8Array hash false-green", async () => {
  const fixture = await modelicaFixture({ legacyStructuredCaseFingerprint: true });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    Error,
    "raw CAS bytes do not match",
  );
});

Deno.test("RecordedOperationPlanResolver rejects noncanonical normalized manifest bytes", async () => {
  const fixture = await modelicaFixture({ noncanonicalManifest: true });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not canonical JSON",
  );
});

Deno.test("RecordedOperationPlanResolver never interprets persisted provider snake-case wire JSON as the qualified document", async () => {
  const fixture = await modelicaFixture({ wireManifestBytes: true });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "$qualifiedManifest",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a Thread artifact URI that aliases another CAS object", async () => {
  const fixture = await modelicaFixture({ mismatchedManifestUri: true });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "URI is not its exact canonical",
  );
});

Deno.test("RecordedOperationPlanResolver rejects out-of-range Modelica values after canonical manifest validation", async () => {
  const fixture = await modelicaFixture({ parameterValue: 1_001 });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "parameters do not exactly fit",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a simulation case from an unrelated Thread lineage", async () => {
  const fixture = await modelicaFixture({ unrelatedCaseBasis: true });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not an ancestor",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a run fingerprint transplanted across registered inputs", async () => {
  const fixture = await modelicaFixture();
  (fixture.input.run as { inputFingerprint?: ContentFingerprint }).inputFingerprint = {
    algorithm: "sha256",
    digest: "9".repeat(64),
  };
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "does not seal its exact work item",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a qualification authority manifest CAS transplant", async () => {
  const fixture = await modelicaFixture({ authorityManifestMismatch: true });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "authority manifest does not name the exact Thread CAS artifact",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a transplanted MRTR approval", async () => {
  const fixture = await modelicaFixture();
  const approval =
    (fixture.input.project.approvals as unknown as Array<Record<string, unknown>>)[0];
  approval.baseSnapshot = {
    snapshotId: fixture.ancestor.id,
    revision: fixture.ancestor.revision,
    subjectId: fixture.ancestor.subject.id,
  };
  (
    fixture.input.queueBasisProject as {
      fingerprint: ContentFingerprint;
    }
  ).fingerprint = await sha256Fingerprint(fixture.input.project);
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "does not attest",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a completed Modelica seal without its result snapshot and evidence", async () => {
  const fixture = await modelicaFixture();
  const sealRun = recordedSealRun(fixture.input);
  delete sealRun.resultSnapshot;
  sealRun.evidenceRefs = [];
  await refreshQueueBasisProjectFingerprint(fixture.input);

  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not backed by its completed registered @2 seal run",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a completed Modelica seal result snapshot transplanted from another lineage", async () => {
  const fixture = await modelicaFixture();
  const transplantedBase = baseSnapshot(
    "transplanted-seal-base",
    1,
    fixture.ancestor.subject.id,
  );
  const transplantedResult = successor(
    transplantedBase,
    Object.values(fixture.artifacts),
    "transplanted-seal-result",
  );
  fixture.stores.set(transplantedBase.id, transplantedBase);
  fixture.stores.set(transplantedResult.id, transplantedResult);
  const sealRun = recordedSealRun(fixture.input);
  sealRun.resultSnapshot = snapshotReference(transplantedResult);
  sealRun.evidenceRefs = artifactEvidenceRefs(
    transplantedResult,
    Object.values(fixture.artifacts),
  );
  await refreshQueueBasisProjectFingerprint(fixture.input);

  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not the direct immutable child of its exact seal basis",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a tampered completed Modelica seal result snapshot", async () => {
  const fixture = await modelicaFixture();
  const tampered = structuredClone(fixture.sealResult) as MutableFixture<
    ThreadSnapshot
  >;
  const authority = tampered.artifacts.find((artifact) =>
    artifact.id === fixture.artifacts.authority.id
  );
  if (!authority) throw new Error("Missing test authority artifact.");
  const mutableAuthority = authority as unknown as { uri?: string };
  mutableAuthority.uri = casUri("simulation-case-qualification", "f".repeat(64));
  fixture.stores.set(tampered.id, tampered);

  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "completed seal result snapshot does not retain exact seal artifact",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a completed Modelica seal with a missing result evidence ref", async () => {
  const fixture = await modelicaFixture();
  const sealRun = recordedSealRun(fixture.input);
  sealRun.evidenceRefs.pop();
  await refreshQueueBasisProjectFingerprint(fixture.input);

  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "evidenceRefs do not exactly cover its result artifacts",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a Modelica seal result ordered before its declared basis on the same lineage", async () => {
  const fixture = await modelicaFixture({ invertedSealResultOrder: true });

  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not the direct immutable child of its exact seal basis",
  );
});

Deno.test("RecordedOperationPlanResolver resolves the public CalculiX STEP route to an exact internal CAS after rereading bytes", async () => {
  const fixture = await calculixFixture();
  const reads: string[] = [];
  fixture.dependencies.stepAssets = {
    read: (digest) => {
      reads.push(digest);
      return Promise.resolve(fixture.stepBytes);
    },
  };
  const plan = await new RecordedOperationPlanResolver(fixture.dependencies).resolve(
    fixture.input,
  );
  validateResolvedOperationPlanV2(plan);
  assertEquals(plan.action.kind, "static-structural-analysis");
  assertEquals(
    fixture.stepArtifact.uri,
    `/api/thread/assets/${fixture.stepArtifact.fingerprint.digest}.step`,
  );
  assertEquals(
    plan.sources[1].artifact.casUri,
    `casys://thread-asset/sha256/${fixture.stepArtifact.fingerprint.digest}`,
  );
  assertEquals(reads, [fixture.stepArtifact.fingerprint.digest]);
  assertEquals(plan.expectedProviderResources.resourceProfile, {
    id: "mcp-calculix.recorded-static-artifacts",
    version: "1.0",
  });
  assertEquals(plan.authorization.methodQualification, {
    id: "qualified-static-structural-proof-case",
    version: "1.0",
    fingerprint: fixture.proofArtifact.fingerprint,
  });
  assertEquals(fixture.proofCase.authorization, {
    workItemId: "seal-work-fea",
    decisionId: "seal-decision-fea",
  });
  assertEquals(plan.authorization.mrtr.decisionId, "decision-fea");
});

Deno.test("RecordedOperationPlanResolver seals only @3 with the exact local CalculiX profile", async () => {
  const profile = await new FixedCalculixIsolatedExecutionProfileCatalog({
    imageReference: `casys/calculix@sha256:${"a".repeat(64)}`,
    wrapperSha256: "b".repeat(64),
    policy: {
      id: "calculix-local-test",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    },
    limits: {
      maxWallTimeMs: 120_000,
      maxCpuTimeMs: 100_000,
      maxMemoryBytes: 1_073_741_824,
      maxProcesses: 32,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      maxOutputFileBytes: 134_217_728,
      maxOutputTotalBytes: 268_435_456,
    },
  }).initial();
  const fixture = await calculixFixture({ operationVersion: "3" });
  const plan = await new RecordedOperationPlanResolver({
    ...fixture.dependencies,
    calculix: { localProfile: profile },
  }).resolve(fixture.input);
  assertEquals(plan.action.kind, "isolated-static-structural-analysis");
  if (plan.action.kind !== "isolated-static-structural-analysis") throw new Error();
  assertEquals(plan.action.executor.profileFingerprint, profile.profileFingerprint);
  assertEquals(Object.hasOwn(plan.action, "provider"), false);
  assertEquals(plan.workItem.operation.version, "3");
  assertEquals(plan.recovery.policy, "calculix-isolated-generation-recovery@1.0");

  const missing = await calculixFixture({ operationVersion: "3" });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(missing.dependencies).resolve(missing.input),
    TypeError,
    "requires an exact server-composed isolated profile",
  );
});

Deno.test("RecordedOperationPlanResolver rejects a transplanted CalculiX proof authority", async () => {
  const fixture = await calculixFixture({ transplantedProofAuthority: true });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "FEA proof authority is not backed",
  );
});

Deno.test("RecordedOperationPlanResolver rejects missing or foreign CalculiX proof-seal lifecycle authority", async () => {
  for (
    const mutation of [
      "missing-run",
      "foreign-work",
      "unapproved-decision",
      "nonhuman-approval",
    ] as const
  ) {
    const fixture = await calculixFixture();
    const project = fixture.input.project as unknown as MutableProject;
    if (mutation === "missing-run") {
      project.agentRuns = project.agentRuns.filter((run: { id: string }) =>
        run.id !== "seal-fea"
      );
    } else if (mutation === "foreign-work") {
      requireProjectEntry(project.workItems, "seal-work-fea", "seal work item")
        .operation.id = "foreign.seal";
    } else if (mutation === "unapproved-decision") {
      requireProjectEntry(project.decisions, "seal-decision-fea", "seal decision")
        .status = "proposed";
    } else {
      requireProjectEntry(project.approvals, "seal-approval-fea", "seal approval")
        .decidedByOrigin = "agent";
    }
    await refreshQueueBasisProjectFingerprint(fixture.input);
    await assertRejects(
      () =>
        new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
      TypeError,
      "FEA proof authority",
      mutation,
    );
  }
});

Deno.test("RecordedOperationPlanResolver rejects a CalculiX proof-seal result without exact evidence or direct lineage", async () => {
  for (const mutation of ["evidence", "result-reference"] as const) {
    const fixture = await calculixFixture();
    const project = fixture.input.project as unknown as MutableProject;
    if (mutation === "evidence") {
      requireProjectEntry(project.agentRuns, "seal-fea", "seal run").evidenceRefs = [];
    } else {
      requireProjectEntry(project.agentRuns, "seal-fea", "seal run").resultSnapshot = {
        snapshotId: "proof-base",
        revision: 1,
        subjectId: "subject-fea",
      };
    }
    await refreshQueueBasisProjectFingerprint(fixture.input);
    await assertRejects(
      () =>
        new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
      TypeError,
      mutation === "evidence" ? "FEA proof authority" : "direct immutable child",
      mutation,
    );
  }
});

Deno.test("RecordedOperationPlanResolver rejects a CalculiX proof case from an unrelated Thread lineage", async () => {
  const fixture = await calculixFixture({ unrelatedProofBasis: true });
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not an ancestor",
  );
});

Deno.test("resolved CalculiX plans reject a free method fingerprint detached from the proof case", async () => {
  const fixture = await calculixFixture();
  const plan = await new RecordedOperationPlanResolver(fixture.dependencies).resolve(
    fixture.input,
  );
  const tampered = structuredClone(plan) as unknown as {
    authorization: {
      methodQualification: { fingerprint: ContentFingerprint };
    };
  };
  tampered.authorization.methodQualification.fingerprint = {
    algorithm: "sha256",
    digest: "7".repeat(64),
  };
  assertThrows(
    () => validateResolvedOperationPlanV2(tampered),
    TypeError,
    "must equal the exact proof-case authority artifact",
  );
});

Deno.test("RecordedOperationPlanResolver rejects an aliased CalculiX STEP before asset access", async () => {
  const fixture = await calculixFixture({ aliasStepId: true });
  let reads = 0;
  fixture.dependencies.stepAssets = {
    read: () => {
      reads += 1;
      return Promise.resolve(fixture.stepBytes);
    },
  };
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not the same exact STEP artifact",
  );
  assertEquals(reads, 0);
});

Deno.test("RecordedOperationPlanResolver rejects noncanonical CalculiX STEP addresses before asset access", async () => {
  for (
    const [label, stepUri] of [
      [
        "internal CAS used as Thread URI",
        (digest: string) => `casys://thread-asset/sha256/${digest}`,
      ],
      [
        "alias namespace",
        (digest: string) => `casys://thread-asset-alias/sha256/${digest}`,
      ],
      [
        "wrong public digest",
        (_digest: string) => `/api/thread/assets/${"0".repeat(64)}.step`,
      ],
      [
        "wrong public extension",
        (digest: string) => `/api/thread/assets/${digest}.stp`,
      ],
      [
        "public query",
        (digest: string) => `/api/thread/assets/${digest}.step?download=1`,
      ],
      [
        "public fragment",
        (digest: string) => `/api/thread/assets/${digest}.step#asset`,
      ],
      [
        "external origin",
        (digest: string) => `https://example.invalid/api/thread/assets/${digest}.step`,
      ],
      [
        "traversal",
        (digest: string) => `/api/thread/assets/../${digest}.step`,
      ],
    ] as const
  ) {
    const fixture = await calculixFixture({ stepUri });
    let reads = 0;
    fixture.dependencies.stepAssets = {
      read: () => {
        reads += 1;
        return Promise.resolve(fixture.stepBytes);
      },
    };
    await assertRejects(
      () =>
        new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
      TypeError,
      "not its exact canonical public STEP asset",
      label,
    );
    assertEquals(reads, 0, label);
  }
});

Deno.test("RecordedOperationPlanResolver rejects a CalculiX geometry with another kind or media type before asset access", async () => {
  for (
    const [label, options] of [
      ["wrong kind", { stepKind: "document" as const }],
      ["wrong media type", { stepMediaType: "application/step" }],
    ] as const
  ) {
    const fixture = await calculixFixture(options);
    let reads = 0;
    fixture.dependencies.stepAssets = {
      read: () => {
        reads += 1;
        return Promise.resolve(fixture.stepBytes);
      },
    };
    await assertRejects(
      () =>
        new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
      TypeError,
      "exact proof JSON document and STEP Thread artifact",
      label,
    );
    assertEquals(reads, 0, label);
  }
});

Deno.test("RecordedOperationPlanResolver rejects STEP bytes whose raw digest differs", async () => {
  const fixture = await calculixFixture();
  fixture.dependencies.stepAssets = {
    read: () => Promise.resolve(new TextEncoder().encode("different STEP")),
  };
  await assertRejects(
    () =>
      new RecordedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    Error,
    "does not match the proof capture byte identity",
  );
});

async function modelicaFixture(
  options: {
    legacyStructuredCaseFingerprint?: boolean;
    noncanonicalManifest?: boolean;
    wireManifestBytes?: boolean;
    mismatchedManifestUri?: boolean;
    parameterValue?: number;
    unrelatedCaseBasis?: boolean;
    authorityManifestMismatch?: boolean;
    invertedSealResultOrder?: boolean;
  } = {},
) {
  const modelBytes = new TextEncoder().encode("model ThermalKit end ThermalKit;");
  const scenarioBytes = new TextEncoder().encode('{"scenario":"heat-up"}');
  const modelSha = await fingerprintResourceBytes(modelBytes);
  const scenarioSha = await fingerprintResourceBytes(scenarioBytes);
  const selection = {
    modelId: "thermal-kit",
    modelVersion: "1.0.0",
    scenarioId: "heat-up",
  };
  const publicScenario = {
    id: selection.scenarioId,
    description: "Heat up",
    start_time_s: 0,
    stop_time_s: 10,
    number_of_intervals: 10,
    solver: "dassl",
    target_temperature: { value: 90, unit: "degC" },
  };
  const providerUnsigned = {
    schemaVersion: "2.1",
    model: {
      id: selection.modelId,
      version: selection.modelVersion,
      name: "ThermalKit",
      source: providerResource(
        `casys://modelica/kits/${selection.modelId}/${selection.modelVersion}/model.mo`,
        "text/x-modelica",
        modelBytes,
        modelSha,
        "qualified-kit",
      ),
    },
    scenario: {
      id: selection.scenarioId,
      source: providerResource(
        `casys://modelica/kits/${selection.modelId}/${selection.modelVersion}/scenarios/${selection.scenarioId}.json`,
        "application/json",
        scenarioBytes,
        scenarioSha,
        "qualified-kit",
      ),
      public: publicScenario,
      projection_sha256: await fingerprintModelicaResumableProviderJson(
        publicScenario,
      ),
    },
    parameters: [{
      id: "power",
      modelica_name: "power",
      modelica_type: "Real",
      description: "Heater power",
      unit: "W",
      minimum: 0,
      maximum: 1_000,
      conversion: { from: "W", to: "W", factor: 1, offset: 0 },
    }],
    produced_metrics: [{
      id: "temperature",
      unit: "degC",
      description: "Maximum temperature",
      required: true,
    }],
    result_normalizer: { id: "csv", version: "1.0" },
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    engine: { name: "OpenModelica", version: "1.23", msl_version: "4.0" },
  };
  const providerFingerprint = await fingerprintModelicaResumableProviderJson(
    providerUnsigned,
  );
  const providerManifest = {
    ...providerUnsigned,
    fingerprint: providerFingerprint,
    manifest_sha256: providerFingerprint,
  };
  const normalizedManifest = {
    schemaVersion: "modelica-qualified-manifest/1.0",
    contractVersion: "2.1",
    selection,
    fingerprint: providerFingerprint,
    modelName: "ThermalKit",
    model: normalizedResource(providerUnsigned.model.source),
    scenario: normalizedResource(providerUnsigned.scenario.source),
    scenarioPublic: {
      id: publicScenario.id,
      description: publicScenario.description,
      startTimeS: publicScenario.start_time_s,
      stopTimeS: publicScenario.stop_time_s,
      numberOfIntervals: publicScenario.number_of_intervals,
      solver: publicScenario.solver,
      targetTemperature: publicScenario.target_temperature,
    },
    scenarioProjectionSha256: providerUnsigned.scenario.projection_sha256,
    parameters: [{
      id: "power",
      modelicaName: "power",
      modelicaType: "Real",
      description: "Heater power",
      unit: "W",
      minimum: 0,
      maximum: 1_000,
      conversion: { from: "W", to: "W", factor: 1, offset: 0 },
    }],
    producedMetrics: providerUnsigned.produced_metrics,
    resultNormalizer: providerUnsigned.result_normalizer,
    lowering: providerUnsigned.lowering,
    engine: { name: "OpenModelica", version: "1.23", mslVersion: "4.0" },
  };
  const canonicalManifestText = await canonicalModelicaQualifiedManifestDocumentText(
    normalizedManifest,
  );
  const manifestText = options.wireManifestBytes
    ? canonicalModelicaResumableProviderJson(providerManifest)
    : options.noncanonicalManifest
    ? `${canonicalManifestText}\n`
    : canonicalManifestText;
  const manifestBytes = new TextEncoder().encode(manifestText);
  const manifestFp = await rawFingerprint(manifestBytes);
  const manifestUri = options.mismatchedManifestUri
    ? casUri("modelica-qualified-provider-manifest", "f".repeat(64))
    : casUri("modelica-qualified-provider-manifest", manifestFp.digest);

  const ancestor = baseSnapshot("thread-root", 1, "subject-1");
  const unrelated = options.unrelatedCaseBasis
    ? baseSnapshot("thread-unrelated", 1, ancestor.subject.id)
    : undefined;
  const caseBasis = unrelated ?? ancestor;
  const simulationCase = validateSimulationCaseV2({
    schemaVersion: "simulation-case/2.0",
    id: "case-1",
    revision: 1,
    scope: "test",
    evidenceBoundary: "qualification test only",
    project: {
      id: "project-1",
      subjectId: ancestor.subject.id,
      baseThreadSnapshot: {
        id: caseBasis.id,
        revision: caseBasis.revision,
        subjectId: caseBasis.subject.id,
      },
    },
    kit: {
      modelId: selection.modelId,
      modelVersion: selection.modelVersion,
      modelSha256: modelSha,
    },
    scenario: {
      id: selection.scenarioId,
      sourceSha256: providerUnsigned.scenario.source.sha256,
      projectionSha256: providerUnsigned.scenario.projection_sha256,
    },
    parameters: [{ id: "power", value: options.parameterValue ?? 250, unit: "W" }],
    expectedMetrics: [{ id: "temperature", unit: "degC" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 30_000,
  });
  const caseText = canonicalSimulationCaseV2Text(simulationCase);
  const caseBytes = new TextEncoder().encode(caseText);
  const caseFp = options.legacyStructuredCaseFingerprint
    ? await legacyStructuredFingerprint(caseBytes)
    : await rawFingerprint(caseBytes);
  const modelFp = await rawFingerprint(modelBytes);
  const scenarioFp = await rawFingerprint(scenarioBytes);
  const sealBasis = options.invertedSealResultOrder
    ? {
      snapshotId: `${ancestor.subject.id}:r3:declared-seal-basis`,
      revision: 3,
      subjectId: ancestor.subject.id,
    }
    : snapshotReference(ancestor);
  const sealProposal = {
    summary: "Seal the exact qualified Modelica case and method.",
    parameters: [{
      key: "simulationCaseId",
      label: "Simulation case",
      value: simulationCase.id,
    }],
  };
  const sealInputFingerprint = await sha256Fingerprint({
    baseSnapshot: sealBasis,
    inputEvidenceRefs: [],
    proposal: sealProposal,
  });
  const sealApproval = {
    id: "seal-approval",
    decisionId: "seal-decision",
    status: "approved",
    requestedAt: AT,
    decidedAt: AT,
    decidedBy: "human-1",
    decidedByOrigin: "human",
    inputFingerprint: sealInputFingerprint,
    inputEvidenceRefs: [],
    baseSnapshot: sealBasis,
  };
  const sealProducer = {
    serverId: "digital-thread",
    tool: "simulate.seal-simulation-case@2",
    runId: "seal-run",
  };
  const caseArtifact = threadArtifact(
    "case-artifact",
    "document",
    caseFp,
    casUri("simulation-case", caseFp.digest),
    "application/json",
    [],
    sealProducer,
  );
  const modelArtifact = threadArtifact(
    "model-artifact",
    "simulation-model",
    modelFp,
    casUri("modelica-qualified-source", modelFp.digest),
    "text/x-modelica",
    [],
    sealProducer,
  );
  const scenarioArtifact = threadArtifact(
    "scenario-artifact",
    "document",
    scenarioFp,
    casUri("modelica-qualified-source", scenarioFp.digest),
    "application/json",
    [],
    sealProducer,
  );
  const manifestArtifact = threadArtifact(
    "manifest-artifact",
    "document",
    manifestFp,
    manifestUri,
    "application/json",
    [modelArtifact.id, scenarioArtifact.id],
    sealProducer,
  );
  const sourceCaptureText = canonicalModelicaQualifiedSourceCaptureText({
    schemaVersion: "modelica-qualified-source-capture/1.0",
    selection,
    manifestFingerprint: providerFingerprint,
    artifacts: [{
      role: "model",
      resource: expectedResource(providerUnsigned.model.source),
      cas: casReference(modelArtifact, modelBytes),
    }, {
      role: "scenario",
      resource: expectedResource(providerUnsigned.scenario.source),
      cas: casReference(scenarioArtifact, scenarioBytes),
    }],
  });
  const sourceCaptureBytes = new TextEncoder().encode(sourceCaptureText);
  const sourceCaptureFp = await rawFingerprint(sourceCaptureBytes);
  const sourceCaptureArtifact = threadArtifact(
    "source-capture-artifact",
    "evidence",
    sourceCaptureFp,
    casUri("modelica-qualified-source-capture", sourceCaptureFp.digest),
    "application/json",
    [modelArtifact.id, scenarioArtifact.id],
    sealProducer,
  );
  const authorityManifest = casReference(manifestArtifact, manifestBytes);
  if (options.authorityManifestMismatch) {
    authorityManifest.sha256 = "f".repeat(64);
    authorityManifest.uri = casUri(
      "modelica-qualified-provider-manifest",
      authorityManifest.sha256,
    );
  }
  const authorityDocument = {
    schemaVersion: "simulation-case-qualification-capture/2.0",
    operation: { id: "simulate.seal-simulation-case", version: "2" },
    trustedRunId: "seal-run",
    sealBasis,
    caseDigest: caseArtifact.fingerprint.digest,
    simulationCase: casReference(caseArtifact, caseBytes),
    manifest: authorityManifest,
    sourceCapture: casReference(sourceCaptureArtifact, sourceCaptureBytes),
    sources: [{
      role: "model",
      mediaType: providerUnsigned.model.source.mediaType,
      resourceUri: providerUnsigned.model.source.uri,
      cas: casReference(modelArtifact, modelBytes),
    }, {
      role: "scenario",
      mediaType: providerUnsigned.scenario.source.mediaType,
      resourceUri: providerUnsigned.scenario.source.uri,
      cas: casReference(scenarioArtifact, scenarioBytes),
    }],
    mrtr: {
      decisionId: "seal-decision",
      inputFingerprint: sealInputFingerprint.digest,
      approvalId: sealApproval.id,
      approvalFingerprint: (await sha256Fingerprint(sealApproval)).digest,
      workItemId: "seal-work",
    },
    sealedAt: AT,
  };
  const authorityText = options.mismatchedManifestUri
    ? deterministicJson(authorityDocument)
    : canonicalModelicaSimulationCaseQualificationCaptureText(authorityDocument);
  const authorityBytes = new TextEncoder().encode(authorityText);
  const authorityFp = await rawFingerprint(authorityBytes);
  const authorityArtifact = threadArtifact(
    "qualification-authority-artifact",
    "evidence",
    authorityFp,
    casUri("simulation-case-qualification", authorityFp.digest),
    "application/json",
    [
      caseArtifact.id,
      manifestArtifact.id,
      sourceCaptureArtifact.id,
      modelArtifact.id,
      scenarioArtifact.id,
    ],
    sealProducer,
  );
  const artifacts = {
    case: caseArtifact,
    manifest: manifestArtifact,
    authority: authorityArtifact,
    model: modelArtifact,
    scenario: scenarioArtifact,
    sourceCapture: sourceCaptureArtifact,
  };
  const sealResult = successor(
    ancestor,
    Object.values(artifacts),
    "qualified-seal",
  );
  const declaredSealBasis = options.invertedSealResultOrder
    ? successor(sealResult, [], "declared-seal-basis")
    : ancestor;
  const basis = successor(
    options.invertedSealResultOrder ? declaredSealBasis : sealResult,
    [],
    "recorded-plan-basis",
  );
  const stores = new Map([
    [ancestor.id, ancestor],
    [sealResult.id, sealResult],
    [declaredSealBasis.id, declaredSealBasis],
    [basis.id, basis],
  ]);
  if (unrelated) stores.set(unrelated.id, unrelated);
  const bytesByUri = new Map<string, Uint8Array>([
    [artifacts.case.uri!, caseBytes],
    [artifacts.manifest.uri!, manifestBytes],
    [artifacts.model.uri!, modelBytes],
    [artifacts.scenario.uri!, scenarioBytes],
    [artifacts.sourceCapture.uri!, sourceCaptureBytes],
    [artifacts.authority.uri!, authorityBytes],
  ]);
  const input = await planInput({
    basis,
    projectId: "project-1",
    workItemId: "work-1",
    decisionId: "decision-1",
    operationId: "simulate.run-modelica-scenario",
    bindings: [
      binding("simulationCase", basis, artifacts.case.id),
      binding("methodManifest", basis, artifacts.manifest.id),
    ],
    history: {
      workItem: {
        id: "seal-work",
        phaseId: "phase-1",
        title: "Seal Modelica case",
        description: "Seal exact qualified inputs.",
        kind: "simulate",
        status: "completed",
        owner: "agent",
        dependsOnWorkItemIds: [],
        evidenceRefs: [],
        blockerIds: [],
        operation: {
          id: "simulate.seal-simulation-case",
          version: "2",
          bindings: [{
            name: "approvedBrief",
            source: { kind: "approved-brief" },
          }],
        },
        decisionIds: ["seal-decision"],
      },
      run: {
        id: "seal-run",
        workItemId: "seal-work",
        status: "completed",
        summary: "Sealed Modelica case.",
        queuedAt: AT,
        startedAt: AT,
        completedAt: AT,
        basis: { kind: "thread-snapshot", ...sealBasis },
        inputFingerprint: sealInputFingerprint,
        resultSnapshot: snapshotReference(sealResult),
        evidenceRefs: artifactEvidenceRefs(sealResult, Object.values(artifacts)),
      },
      decision: {
        id: "seal-decision",
        phaseId: "phase-1",
        title: "Approve Modelica seal",
        question: "Seal these exact inputs?",
        status: "approved",
        requestedAt: AT,
        inputFingerprint: sealInputFingerprint,
        approvalIds: [sealApproval.id],
        inputEvidenceRefs: [],
        baseSnapshot: sealBasis,
        proposal: {
          ...sealProposal,
          proposedAt: AT,
          proposedBy: { id: "agent-1", origin: "agent" },
        },
      },
      approval: sealApproval,
    },
  });
  return {
    ancestor,
    sealResult,
    basis,
    artifacts,
    input,
    stores,
    dependencies: {
      snapshots: exactSnapshotReader(stores),
      artifacts: artifactReader(bytesByUri),
      stepAssets: {
        read: () => Promise.reject(new Error("STEP must not be read for Modelica.")),
      },
    },
  };
}

async function calculixFixture(
  options: {
    aliasStepId?: boolean;
    transplantedProofAuthority?: boolean;
    unrelatedProofBasis?: boolean;
    stepUri?: (digest: string) => string;
    stepKind?: ThreadArtifact["kind"];
    stepMediaType?: string;
    operationVersion?: "2" | "3";
  } = {},
) {
  const rawProof = JSON.parse(
    await Deno.readTextFile(
      "config/mechanical-proof-cases/desk-lamp-dl01-articulated-arm-cantilever.json",
    ),
  );
  const stepBytes = new TextEncoder().encode("ISO-10303-21; synthetic exact STEP");
  const stepFp = await rawFingerprint(stepBytes);
  const ancestor = baseSnapshot("proof-base", 1, "subject-fea");
  const unrelated = options.unrelatedProofBasis
    ? baseSnapshot("proof-unrelated", 1, ancestor.subject.id)
    : undefined;
  const proofBasis = unrelated ?? ancestor;
  rawProof.project = {
    id: "project-fea",
    subjectId: ancestor.subject.id,
    baseThreadSnapshot: {
      id: proofBasis.id,
      revision: proofBasis.revision,
      subjectId: proofBasis.subject.id,
    },
  };
  rawProof.authorization = {
    workItemId: "seal-work-fea",
    decisionId: options.transplantedProofAuthority
      ? "decision-transplanted"
      : "seal-decision-fea",
  };
  rawProof.expectedCadArtifact = {
    format: "step",
    sha256: stepFp.digest,
    bytes: stepBytes.byteLength,
  };
  const proofCase = validateMechanicalProofCase(rawProof);
  const proofText = canonicalProofText(proofCase);
  const boundStepId = options.aliasStepId ? "alias-step" : "expected-step";
  const captureStepId = "expected-step";
  const geometryProducer = {
    serverId: "digital-thread",
    tool: "design.write-geometry@1",
    runId: "cad-run",
  };
  const requirementsProducer = {
    serverId: "digital-thread",
    tool: "model.write-requirements@1",
    runId: "requirements-run",
  };
  const proofProducer = {
    serverId: "digital-thread",
    tool: "verify.seal-proof-case@1",
    runId: "seal-fea",
  };
  const geometryCapture = threadArtifact(
    "geometry-capture",
    "cad-model",
    { algorithm: "sha256", digest: "b".repeat(64) },
    casUri("geometry-capture", "b".repeat(64)),
    "application/json",
    [],
    geometryProducer,
  );
  const requirementsArtifact = threadArtifact(
    "requirements-artifact",
    "document",
    { algorithm: "sha256", digest: "c".repeat(64) },
    casUri("requirements", "c".repeat(64)),
    "application/json",
    [],
    requirementsProducer,
  );
  const capturedStepArtifact = threadArtifact(
    captureStepId,
    options.stepKind ?? "step",
    stepFp,
    options.stepUri?.(stepFp.digest) ??
      `/api/thread/assets/${stepFp.digest}.step`,
    options.stepMediaType ?? "model/step",
    [],
    geometryProducer,
  );
  const proofCaptureText = deterministicJson({
    schemaVersion: "fea-proof-case-capture/1.0",
    operation: { id: "verify.seal-proof-case", version: "1" },
    trustedRunId: "seal-fea",
    proofDigest: (await sha256Fingerprint(proofCase)).digest,
    canonicalProofText: proofText,
    geometryArtifact: {
      id: geometryCapture.id,
      fingerprint: geometryCapture.fingerprint,
      producerRunId: geometryCapture.producer.runId,
    },
    stepArtifact: {
      id: capturedStepArtifact.id,
      fingerprint: stepFp,
      producerRunId: capturedStepArtifact.producer.runId,
      bytes: stepBytes.byteLength,
    },
    requirementsArtifact: {
      id: requirementsArtifact.id,
      fingerprint: requirementsArtifact.fingerprint,
      producerRunId: requirementsArtifact.producer.runId,
    },
    requirementsElementId: "requirement-1",
    seedIdentity: {
      editingContextId: "editing-context-1",
      elementId: "requirement-1",
    },
    sealedAt: AT,
  });
  const proofBytes = new TextEncoder().encode(proofCaptureText);
  const proofFp = await rawFingerprint(proofBytes);
  const proofArtifact = threadArtifact(
    "proof-artifact",
    "document",
    proofFp,
    casUri("fea-proof-case-capture", proofFp.digest),
    "application/json",
    [geometryCapture.id, requirementsArtifact.id, capturedStepArtifact.id],
    proofProducer,
  );
  const stepArtifact = options.aliasStepId
    ? threadArtifact(
      boundStepId,
      "step",
      stepFp,
      casUri("thread-asset-alias", stepFp.digest),
      "model/step",
      [],
      { ...geometryProducer, runId: "cad-run-alias" },
    )
    : capturedStepArtifact;
  const basisArtifacts = [
    geometryCapture,
    requirementsArtifact,
    capturedStepArtifact,
    ...(stepArtifact === capturedStepArtifact ? [] : [stepArtifact]),
    proofArtifact,
  ];
  const basis = successor(ancestor, basisArtifacts, "proof-seal");
  const stores = new Map([[ancestor.id, ancestor], [basis.id, basis]]);
  if (unrelated) stores.set(unrelated.id, unrelated);
  const sealBasis = snapshotReference(ancestor);
  const sealProposal = {
    summary: "Seal the exact reviewed FEA proof case.",
    parameters: encodeFeaProofDecisionParameters(
      (await sha256Fingerprint(proofCase)).digest,
      proofCase,
      { id: geometryCapture.id, fingerprint: geometryCapture.fingerprint },
      { id: requirementsArtifact.id, fingerprint: requirementsArtifact.fingerprint },
    ),
  };
  const sealDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: sealBasis,
    inputEvidenceRefs: [],
    proposal: sealProposal,
  });
  const sealDecision = {
    id: "seal-decision-fea",
    phaseId: "seal-phase-fea",
    title: "Approve exact FEA proof seal",
    question: "Seal this reviewed proof case?",
    status: "approved",
    requestedAt: AT,
    baseSnapshot: sealBasis,
    inputFingerprint: sealDecisionFingerprint,
    inputEvidenceRefs: [],
    approvalIds: ["seal-approval-fea"],
    proposal: sealProposal,
  };
  const sealApproval = {
    id: "seal-approval-fea",
    decisionId: sealDecision.id,
    status: "approved",
    requestedAt: AT,
    decidedAt: AT,
    decidedBy: "human-1",
    decidedByOrigin: "human",
    inputFingerprint: sealDecisionFingerprint,
    inputEvidenceRefs: [],
    baseSnapshot: sealBasis,
  };
  const sealOperation = {
    id: "verify.seal-proof-case",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  };
  const sealRunFingerprint = await sha256Fingerprint({
    workItemId: "seal-work-fea",
    basis: { kind: "thread-snapshot", ...sealBasis },
    operation: sealOperation,
    approvedDecisions: [{
      id: sealDecision.id,
      inputFingerprint: sealDecisionFingerprint,
    }],
  });
  const history = {
    workItem: {
      id: "seal-work-fea",
      phaseId: "seal-phase-fea",
      title: "Seal FEA proof",
      description: "Seal the exact reviewed FEA proof case.",
      kind: "verify",
      operation: sealOperation,
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: artifactEvidenceRefs(basis, [proofArtifact]),
      decisionIds: [sealDecision.id],
      blockerIds: [],
    },
    run: {
      id: "seal-fea",
      workItemId: "seal-work-fea",
      status: "completed",
      summary: "Seal the exact reviewed FEA proof case.",
      queuedAt: AT,
      startedAt: AT,
      completedAt: AT,
      basis: { kind: "thread-snapshot", ...sealBasis },
      inputFingerprint: sealRunFingerprint,
      evidenceRefs: artifactEvidenceRefs(basis, [proofArtifact]),
      resultSnapshot: snapshotReference(basis),
    },
    decision: sealDecision,
    approval: sealApproval,
  };
  const input = await planInput({
    basis,
    projectId: proofCase.project.id,
    workItemId: "work-fea",
    decisionId: "decision-fea",
    operationId: "verify.run-fea-static-proof",
    operationVersion: options.operationVersion,
    bindings: [
      binding("proofCase", basis, proofArtifact.id),
      binding("geometry", basis, stepArtifact.id),
    ],
    history,
  });
  return {
    proofCase,
    proofArtifact,
    stepArtifact,
    stepBytes,
    input,
    stores,
    dependencies: {
      snapshots: exactSnapshotReader(stores),
      artifacts: artifactReader(new Map([[proofArtifact.uri!, proofBytes]])),
      stepAssets: {
        read: (_digest: string) => Promise.resolve(stepBytes),
      } satisfies CanonicalAssetReader,
    },
  };
}

function baseSnapshot(id: string, revision: number, subjectId: string): ThreadSnapshot {
  const modelFp = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id,
    revision,
    generatedAt: AT,
    subject: {
      id: subjectId,
      name: "Test subject",
      kind: "system",
      version: String(revision),
      modelArtifactId: "subject-model",
    },
    freshness: fresh(),
    changeSet: {
      id: `change-${id}`,
      name: "Initial state",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts: [threadArtifact(
      "subject-model",
      "sysml-model",
      modelFp,
      casUri("subject-model", modelFp.digest),
      "application/json",
      [],
    )],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  });
}

function successor(
  ancestor: ThreadSnapshot,
  artifacts: ThreadArtifact[],
  extensionId: string,
): ThreadSnapshot {
  const available = new Map(
    [...ancestor.artifacts, ...artifacts].map((artifact) => [artifact.id, artifact]),
  );
  const consumptions = artifacts.flatMap((artifact) =>
    artifact.inputArtifactIds.map((inputId) => {
      const input = available.get(inputId);
      if (!input) throw new Error(`Missing test input artifact ${inputId}.`);
      return {
        id: `${extensionId}:consume:${artifact.id}:${inputId}`,
        artifactId: inputId,
        consumer: artifact.producer,
        observedFingerprint: input.fingerprint,
        verifiedAt: AT,
        status: "verified" as const,
      };
    })
  );
  const provenance = artifacts.flatMap((artifact) =>
    artifact.inputArtifactIds.flatMap((inputId) => {
      const consumptionId = `${extensionId}:consume:${artifact.id}:${inputId}`;
      return [{
        id: `${extensionId}:derived:${artifact.id}:${inputId}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifact.id },
        to: { kind: "artifact" as const, id: inputId },
        rationale: "The seal derives this artifact from the exact captured input.",
      }, {
        id: `${extensionId}:uses:${artifact.id}:${inputId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumptionId },
        to: { kind: "artifact" as const, id: inputId },
        rationale: "The seal consumed and verified the exact captured input bytes.",
      }];
    })
  );
  return applyThreadSnapshotExtensionIfNew(ancestor, {
    id: extensionId,
    name: extensionId,
    subjectId: ancestor.subject.id,
    capturedAt: AT,
    artifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  }, { appliedAt: AT }).snapshot;
}

async function planInput(options: {
  basis: ThreadSnapshot;
  projectId: string;
  workItemId: string;
  decisionId: string;
  operationId: string;
  operationVersion?: string;
  bindings: unknown[];
  history?: {
    workItem: Record<string, unknown>;
    run: Record<string, unknown>;
    decision: Record<string, unknown>;
    approval: Record<string, unknown>;
  };
}): Promise<RegisteredRunPlanSealInput> {
  const decisionFingerprint = {
    algorithm: "sha256" as const,
    digest: "1".repeat(64),
  };
  const basis = {
    snapshotId: options.basis.id,
    revision: options.basis.revision,
    subjectId: options.basis.subject.id,
  };
  const evidence: never[] = [];
  const operation = {
    id: options.operationId,
    version: options.operationVersion ?? "2",
    bindings: options.bindings,
  };
  const workItem = {
    id: options.workItemId,
    phaseId: "phase-1",
    title: options.workItemId,
    description: `Run ${options.operationId}.`,
    kind: options.operationId.startsWith("simulate") ? "simulate" : "verify",
    operation,
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [options.decisionId],
    blockerIds: [],
  };
  const decision = {
    id: options.decisionId,
    phaseId: "phase-1",
    title: "Approve recorded run",
    question: "Run this exact recorded operation?",
    status: "approved",
    requestedAt: AT,
    inputFingerprint: decisionFingerprint,
    approvalIds: ["approval-1"],
    inputEvidenceRefs: evidence,
    baseSnapshot: basis,
  };
  const approval = {
    id: "approval-1",
    decisionId: options.decisionId,
    status: "approved",
    requestedAt: AT,
    decidedAt: AT,
    decidedBy: "human-1",
    decidedByOrigin: "human",
    inputFingerprint: decisionFingerprint,
    inputEvidenceRefs: evidence,
    baseSnapshot: basis,
  };
  const project = {
    schemaVersion: "3.0",
    id: "project-snapshot-1",
    revision: 3,
    generatedAt: AT,
    project: {
      id: options.projectId,
      name: options.projectId,
      subjectId: options.basis.subject.id,
      objective: { title: "Test", statement: "Test recorded plan." },
    },
    threadSnapshots: [basis],
    phases: [],
    workItems: [workItem, ...(options.history ? [options.history.workItem] : [])],
    agentRuns: options.history ? [options.history.run] : [],
    decisions: [decision, ...(options.history ? [options.history.decision] : [])],
    approvals: [approval, ...(options.history ? [options.history.approval] : [])],
    blockers: [],
  };
  const runBasis = { kind: "thread-snapshot" as const, ...basis };
  const inputFingerprint = await sha256Fingerprint({
    workItemId: options.workItemId,
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: options.decisionId,
      inputFingerprint: decisionFingerprint,
    }],
  });
  return {
    project: project as unknown as RegisteredRunPlanSealInput["project"],
    workItem: workItem as unknown as RegisteredRunPlanSealInput["workItem"],
    run: {
      id: `run-${options.workItemId}`,
      workItemId: options.workItemId,
      status: "queued",
      summary: "Queued recorded plan test.",
      queuedAt: AT,
      inputFingerprint,
      basis: runBasis,
      evidenceRefs: [],
    } as unknown as RegisteredRunPlanSealInput["run"],
    queueBasisProject: {
      snapshotId: project.id,
      revision: project.revision,
      fingerprint: await sha256Fingerprint(project),
    },
  };
}

function binding(name: string, basis: ThreadSnapshot, id: string) {
  return {
    name,
    source: {
      kind: "thread-entity",
      reference: {
        snapshotId: basis.id,
        snapshotRevision: basis.revision,
        kind: "artifact",
        id,
      },
    },
  };
}

function threadArtifact(
  id: string,
  kind: ThreadArtifact["kind"],
  fingerprint: ContentFingerprint,
  uri: string,
  mediaType: string,
  inputArtifactIds: string[],
  producer = {
    serverId: "digital-thread",
    tool: "test-seal",
    runId: "seal-run",
  },
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: "1",
    fingerprint,
    uri,
    mediaType,
    producer,
    inputArtifactIds,
    freshness: fresh(),
  };
}

function casReference(artifact: ThreadArtifact, bytes: Uint8Array) {
  return {
    uri: artifact.uri!,
    byteCount: bytes.byteLength,
    sha256: artifact.fingerprint.digest,
  };
}

function expectedResource(resource: {
  uri: string;
  mediaType: string;
  bytes: number;
  sha256: string;
}) {
  return {
    uri: resource.uri,
    mediaType: resource.mediaType,
    byteCount: resource.bytes,
    sha256: resource.sha256,
  };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [],
  };
}

function providerResource(
  uri: string,
  mediaType: string,
  bytes: Uint8Array,
  sha256: string,
  qualification: string,
) {
  return { uri, mediaType, bytes: bytes.byteLength, sha256, qualification };
}

function normalizedResource(resource: {
  uri: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  qualification: string;
}) {
  return {
    uri: resource.uri,
    mediaType: resource.mediaType,
    byteCount: resource.bytes,
    sha256: resource.sha256,
    qualification: resource.qualification,
  };
}

async function rawFingerprint(bytes: Uint8Array): Promise<ContentFingerprint> {
  return { algorithm: "sha256", digest: await fingerprintResourceBytes(bytes) };
}

async function legacyStructuredFingerprint(
  bytes: Uint8Array,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({ indexedBytes: Array.from(bytes) });
}

function casUri(namespace: string, digest: string): string {
  return `casys://${namespace}/sha256/${digest}`;
}

type MutableFixture<T> = T extends readonly (infer Item)[] ? MutableFixture<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: MutableFixture<T[Key]> }
  : T;

type MutableSealRun = {
  resultSnapshot?: {
    snapshotId: string;
    revision: number;
    subjectId: string;
  };
  evidenceRefs: Array<{
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }>;
};

type MutableProject = {
  agentRuns: Array<{
    id: string;
    status: string;
    resultSnapshot?: {
      snapshotId: string;
      revision: number;
      subjectId: string;
    };
    evidenceRefs: Array<{
      snapshotId: string;
      snapshotRevision: number;
      kind: string;
      id: string;
    }>;
  }>;
  workItems: Array<{
    id: string;
    operation: { id: string };
  }>;
  decisions: Array<{ id: string; status: string }>;
  approvals: Array<{ id: string; decidedByOrigin: string }>;
};

function requireProjectEntry<T extends { id: string }>(
  entries: readonly T[],
  id: string,
  label: string,
): T {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Fixture ${label} ${id} is absent.`);
  return entry;
}

function recordedSealRun(input: RegisteredRunPlanSealInput): MutableSealRun {
  const run = input.project.agentRuns.find((candidate) =>
    candidate.id === "seal-run"
  ) as unknown as MutableSealRun | undefined;
  if (!run) throw new Error("Missing test seal run.");
  return run;
}

function snapshotReference(snapshot: ThreadSnapshot) {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function artifactEvidenceRefs(
  snapshot: ThreadSnapshot,
  artifacts: readonly ThreadArtifact[],
) {
  return artifacts.map((artifact) => ({
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  }));
}

async function refreshQueueBasisProjectFingerprint(
  input: RegisteredRunPlanSealInput,
): Promise<void> {
  (
    input.queueBasisProject as {
      fingerprint: ContentFingerprint;
    }
  ).fingerprint = await sha256Fingerprint(input.project);
}

function exactSnapshotReader(snapshots: Map<string, ThreadSnapshot>) {
  return {
    get: (id: string) => Promise.resolve(snapshots.get(id)),
  };
}

function artifactReader(bytes: Map<string, Uint8Array>): RecordedPlanArtifactReader {
  return {
    read: (artifact) =>
      Promise.resolve(artifact.uri ? bytes.get(artifact.uri) : undefined),
  };
}
