import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { validateResolvedOperationPlanV2 } from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import {
  canonicalProofText,
  encodeFeaProofDecisionParameters,
} from "../../../domain/fea/seal-case/fea-proof-proposal.ts";
import { validateMechanicalProofCase } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  compileSensitivityCatalogOffer,
  SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
  SENSITIVITY_CATALOG_OFFER_SCHEMA,
} from "../../../domain/sensitivity/study/sensitivity-catalog-from-proof.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { RegisteredRunPlanSealInput } from "../../../domain/project/resolved-run-plan-sealer.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import {
  type RecordedPlanArtifactReader,
  ResolvedOperationPlanResolver,
} from "./resolved-operation-plan-resolver.ts";
import { FixedCalculixIsolatedExecutionProfileCatalog } from "../../fea/isolated-v3/fixed-calculix-isolated-execution-profile.ts";

const AT = "2026-08-12T00:00:00.000Z";

Deno.test("ResolvedOperationPlanResolver resolves the public CalculiX STEP route to an exact internal CAS after rereading bytes", async () => {
  const fixture = await calculixFixture();
  const reads: string[] = [];
  fixture.dependencies.stepAssets = {
    read: (digest) => {
      reads.push(digest);
      return Promise.resolve(fixture.stepBytes);
    },
  };
  const plan = await new ResolvedOperationPlanResolver(fixture.dependencies).resolve(
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

Deno.test("ResolvedOperationPlanResolver seals only @3 with the exact local CalculiX profile", async () => {
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
  const plan = await new ResolvedOperationPlanResolver({
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
      new ResolvedOperationPlanResolver(missing.dependencies).resolve(missing.input),
    TypeError,
    "requires an exact server-composed isolated profile",
  );
});

Deno.test("ResolvedOperationPlanResolver rejects a transplanted CalculiX proof authority", async () => {
  const fixture = await calculixFixture({ transplantedProofAuthority: true });
  await assertRejects(
    () =>
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "FEA proof authority is not backed",
  );
});

Deno.test("ResolvedOperationPlanResolver rejects missing or foreign CalculiX proof-seal lifecycle authority", async () => {
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
        new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
      TypeError,
      "FEA proof authority",
      mutation,
    );
  }
});

Deno.test("ResolvedOperationPlanResolver rejects a CalculiX proof-seal result without exact evidence or direct lineage", async () => {
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
        new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
      TypeError,
      mutation === "evidence" ? "FEA proof authority" : "direct immutable child",
      mutation,
    );
  }
});

Deno.test("ResolvedOperationPlanResolver accepts a CalculiX proof-seal that also recorded the signed catalog offer", async () => {
  const fixture = await calculixFixture({ sensitivityCatalogOffer: "exact" });
  const plan = await new ResolvedOperationPlanResolver(fixture.dependencies)
    .resolve(fixture.input);
  validateResolvedOperationPlanV2(plan);
  assertEquals(plan.authorization.methodQualification.fingerprint, {
    algorithm: "sha256",
    digest: fixture.proofArtifact.fingerprint.digest,
  });
  assertEquals(
    fixture.input.project.agentRuns.find((run) => run.id === "seal-fea")
      ?.evidenceRefs.map((reference) => reference.id),
    [fixture.proofArtifact.id, fixture.sensitivityCatalogOffer?.id],
  );
});

Deno.test("ResolvedOperationPlanResolver rejects a catalog offer that was not signed in the proof-seal MRTR", async () => {
  const fixture = await calculixFixture({
    sensitivityCatalogOffer: "unsigned",
  });
  await assertRejects(
    () =>
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(
        fixture.input,
      ),
    TypeError,
    "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
  );
});

Deno.test("ResolvedOperationPlanResolver rejects an unsigned catalog offer hidden outside completed evidenceRefs", async () => {
  const fixture = await calculixFixture({
    sensitivityCatalogOffer: "unsigned",
  });
  const project = fixture.input.project as unknown as MutableProject;
  const run = requireProjectEntry(project.agentRuns, "seal-fea", "seal run");
  run.evidenceRefs = run.evidenceRefs.slice(0, 1);
  await refreshQueueBasisProjectFingerprint(fixture.input);
  await assertRejects(
    () =>
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(
        fixture.input,
      ),
    TypeError,
    "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
  );
});

Deno.test("ResolvedOperationPlanResolver rejects a signed catalog opt-in whose completed run omits the offer evidence", async () => {
  const fixture = await calculixFixture({ sensitivityCatalogOffer: "exact" });
  const project = fixture.input.project as unknown as MutableProject;
  const run = requireProjectEntry(project.agentRuns, "seal-fea", "seal run");
  run.evidenceRefs = run.evidenceRefs.slice(0, 1);
  await refreshQueueBasisProjectFingerprint(fixture.input);
  await assertRejects(
    () =>
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(
        fixture.input,
      ),
    TypeError,
    "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
  );
});

Deno.test("ResolvedOperationPlanResolver rejects a phantom prefixed catalog-offer evidence ref", async () => {
  const fixture = await calculixFixture();
  const project = fixture.input.project as unknown as MutableProject;
  const run = requireProjectEntry(project.agentRuns, "seal-fea", "seal run");
  const proofRef = run.evidenceRefs[0];
  if (!proofRef) throw new Error("Missing test proof evidence ref.");
  run.evidenceRefs = [
    proofRef,
    {
      snapshotId: proofRef.snapshotId,
      snapshotRevision: proofRef.snapshotRevision,
      kind: "artifact",
      id: `sensitivity-catalog-offer-${"a".repeat(64)}`,
    },
  ];
  await refreshQueueBasisProjectFingerprint(fixture.input);
  await assertRejects(
    () =>
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
  );
});

Deno.test("ResolvedOperationPlanResolver rejects a proof capture published under a noncanonical artifact id", async () => {
  const fixture = await calculixFixture({ aliasProofId: true });
  await assertRejects(
    () =>
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(
        fixture.input,
      ),
    TypeError,
    "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
  );
});

Deno.test("ResolvedOperationPlanResolver rejects a catalog offer from the wrong producer or run", async () => {
  for (const mutation of ["wrong-producer", "wrong-run"] as const) {
    const fixture = await calculixFixture({ sensitivityCatalogOffer: mutation });
    await assertRejects(
      () =>
        new ResolvedOperationPlanResolver(fixture.dependencies).resolve(
          fixture.input,
        ),
      TypeError,
      "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
      mutation,
    );
  }
});

Deno.test("ResolvedOperationPlanResolver rejects a signed catalog offer whose closed authority tuple drifts", async () => {
  for (
    const mutation of [
      "wrong-inputs",
      "wrong-admission-input",
      "wrong-signed-admission",
      "wrong-version",
      "wrong-proof-authority",
      "missing-capture",
      "corrupt-capture",
      "admission-unavailable",
    ] as const
  ) {
    const fixture = await calculixFixture({ sensitivityCatalogOffer: mutation });
    await assertRejects(
      () =>
        new ResolvedOperationPlanResolver(fixture.dependencies).resolve(
          fixture.input,
        ),
      TypeError,
      "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
      mutation,
    );
  }
});

Deno.test("ResolvedOperationPlanResolver rejects a CalculiX proof case from an unrelated Thread lineage", async () => {
  const fixture = await calculixFixture({ unrelatedProofBasis: true });
  await assertRejects(
    () =>
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not an ancestor",
  );
});

Deno.test("resolved CalculiX plans reject a free method fingerprint detached from the proof case", async () => {
  const fixture = await calculixFixture();
  const plan = await new ResolvedOperationPlanResolver(fixture.dependencies).resolve(
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

Deno.test("ResolvedOperationPlanResolver rejects an aliased CalculiX STEP before asset access", async () => {
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
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    TypeError,
    "not the same exact STEP artifact",
  );
  assertEquals(reads, 0);
});

Deno.test("ResolvedOperationPlanResolver rejects noncanonical CalculiX STEP addresses before asset access", async () => {
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
        new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
      TypeError,
      "not its exact canonical public STEP asset",
      label,
    );
    assertEquals(reads, 0, label);
  }
});

Deno.test("ResolvedOperationPlanResolver rejects a CalculiX geometry with another kind or media type before asset access", async () => {
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
        new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
      TypeError,
      "exact proof JSON document and STEP Thread artifact",
      label,
    );
    assertEquals(reads, 0, label);
  }
});

Deno.test("ResolvedOperationPlanResolver rejects STEP bytes whose raw digest differs", async () => {
  const fixture = await calculixFixture();
  fixture.dependencies.stepAssets = {
    read: () => Promise.resolve(new TextEncoder().encode("different STEP")),
  };
  await assertRejects(
    () =>
      new ResolvedOperationPlanResolver(fixture.dependencies).resolve(fixture.input),
    Error,
    "does not match the proof capture byte identity",
  );
});

async function calculixFixture(
  options: {
    aliasStepId?: boolean;
    aliasProofId?: boolean;
    transplantedProofAuthority?: boolean;
    unrelatedProofBasis?: boolean;
    stepUri?: (digest: string) => string;
    stepKind?: ThreadArtifact["kind"];
    stepMediaType?: string;
    operationVersion?: "2" | "3";
    sensitivityCatalogOffer?:
      | "exact"
      | "unsigned"
      | "wrong-producer"
      | "wrong-run"
      | "wrong-inputs"
      | "wrong-admission-input"
      | "wrong-signed-admission"
      | "wrong-version"
      | "wrong-proof-authority"
      | "missing-capture"
      | "corrupt-capture"
      | "admission-unavailable";
  } = {},
) {
  const rawProof = JSON.parse(
    await Deno.readTextFile(
      options.sensitivityCatalogOffer
        ? "src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json"
        : "src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl01-articulated-arm-cantilever.json",
    ),
  );
  const stepBytes = new TextEncoder().encode("ISO-10303-21; synthetic exact STEP");
  const stepFp = await rawFingerprint(stepBytes);
  const initialAncestor = baseSnapshot("proof-base", 1, "subject-fea");
  const admissionDigest = "f".repeat(64);
  const sensitivityCatalogAdmission = options.sensitivityCatalogOffer
    ? {
      ...threadArtifact(
        `technical-compilation-admission-${admissionDigest}`,
        "document",
        { algorithm: "sha256", digest: admissionDigest },
        `casys://technical-compilation-admission-capture/sha256/${admissionDigest}`,
        "application/json",
        [],
        {
          serverId: "digital-thread",
          tool: "compile.seal-admission@3",
          runId: "seal-admission",
        },
      ),
      version: admissionDigest,
    }
    : undefined;
  const ancestor = sensitivityCatalogAdmission
    ? successor(
      initialAncestor,
      [sensitivityCatalogAdmission],
      "catalog-offer-admission-seal",
    )
    : initialAncestor;
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
  const proofDigest = (await sha256Fingerprint(proofCase)).digest;
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
    proofDigest,
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
  const proofArtifact = {
    ...threadArtifact(
      options.aliasProofId ? "proof-artifact-alias" : `fea-proof-${proofFp.digest}`,
      "document",
      proofFp,
      casUri("fea-proof-case-capture", proofFp.digest),
      "application/json",
      [geometryCapture.id, requirementsArtifact.id, capturedStepArtifact.id],
      proofProducer,
    ),
    version: proofDigest,
  };
  const compiledCatalogOffer = options.sensitivityCatalogOffer &&
      sensitivityCatalogAdmission
    ? compileSensitivityCatalogOffer(
      proofCase,
      [{
        semanticKey: "arm_thickness",
        value: 10,
        sourceId: "source.arm",
        sourceSymbolId: "parameter.arm-thickness",
        parameterBindingId: "binding.arm-thickness",
        parameterSysmlElementId: "sysml.arm-thickness",
        resultSymbolId: "artifact.result",
      }],
      {
        proofDigest: options.sensitivityCatalogOffer === "wrong-proof-authority"
          ? "0".repeat(64)
          : proofDigest,
        admissionArtifact: {
          id: sensitivityCatalogAdmission.id,
          fingerprint: sensitivityCatalogAdmission.fingerprint,
        },
        source: {
          id: "source.arm",
          fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
        },
        resultBinding: {
          id: "binding.result",
          sourceSymbolId: "artifact.result",
          modelElementId: proofCase.target.modelElementId,
        },
      },
    )
    : undefined;
  if (compiledCatalogOffer && compiledCatalogOffer.status !== "ready-for-opt-in") {
    throw new Error(
      `Expected a ready sensitivity catalog offer, got ${compiledCatalogOffer.status}.`,
    );
  }
  const catalogOfferDigest = compiledCatalogOffer
    ? (await sha256Fingerprint(compiledCatalogOffer)).digest
    : undefined;
  const catalogOfferCaptureText = compiledCatalogOffer && catalogOfferDigest
    ? deterministicJson({
      schemaVersion: SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
      operation: { id: "verify.seal-proof-case", version: "1" },
      trustedRunId: "seal-fea",
      sealedAt: AT,
      offerDigest: catalogOfferDigest,
      offer: compiledCatalogOffer,
    })
    : undefined;
  const catalogOfferCaptureBytes = catalogOfferCaptureText
    ? new TextEncoder().encode(catalogOfferCaptureText)
    : undefined;
  const catalogOfferCaptureFingerprint = catalogOfferCaptureBytes
    ? await rawFingerprint(catalogOfferCaptureBytes)
    : undefined;
  const sensitivityCatalogOffer = options.sensitivityCatalogOffer &&
      sensitivityCatalogAdmission && catalogOfferDigest &&
      catalogOfferCaptureFingerprint
    ? {
      ...threadArtifact(
        `sensitivity-catalog-offer-${catalogOfferCaptureFingerprint.digest}`,
        "document",
        catalogOfferCaptureFingerprint,
        `casys://sensitivity-catalog-offer-capture/sha256/${catalogOfferCaptureFingerprint.digest}`,
        "application/json",
        options.sensitivityCatalogOffer === "wrong-inputs"
          ? [
            proofArtifact.id,
            sensitivityCatalogAdmission.id,
            geometryCapture.id,
          ]
          : options.sensitivityCatalogOffer === "wrong-admission-input"
          ? [proofArtifact.id, geometryCapture.id]
          : [proofArtifact.id, sensitivityCatalogAdmission.id],
        {
          serverId: options.sensitivityCatalogOffer === "wrong-producer"
            ? "foreign-thread"
            : "digital-thread",
          tool: options.sensitivityCatalogOffer === "wrong-producer"
            ? "foreign.seal@1"
            : "verify.seal-proof-case@1",
          runId: options.sensitivityCatalogOffer === "wrong-run"
            ? "foreign-seal-run"
            : "seal-fea",
        },
      ),
      version: options.sensitivityCatalogOffer === "wrong-version"
        ? "2".repeat(64)
        : catalogOfferDigest,
    }
    : undefined;
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
    ...(sensitivityCatalogOffer ? [sensitivityCatalogOffer] : []),
  ];
  const basis = successor(ancestor, basisArtifacts, "proof-seal");
  const stores = new Map([
    [initialAncestor.id, initialAncestor],
    [ancestor.id, ancestor],
    [basis.id, basis],
  ]);
  if (unrelated) stores.set(unrelated.id, unrelated);
  const sealBasis = snapshotReference(ancestor);
  const sealProposal = {
    summary: "Seal the exact reviewed FEA proof case.",
    parameters: encodeFeaProofDecisionParameters(
      proofDigest,
      proofCase,
      { id: geometryCapture.id, fingerprint: geometryCapture.fingerprint },
      { id: requirementsArtifact.id, fingerprint: requirementsArtifact.fingerprint },
      "1".repeat(64),
      sensitivityCatalogOffer && catalogOfferDigest &&
        options.sensitivityCatalogOffer !== "unsigned"
        ? {
          schemaVersion: SENSITIVITY_CATALOG_OFFER_SCHEMA,
          digest: catalogOfferDigest,
          admissionArtifact: {
            id: sensitivityCatalogAdmission!.id,
            fingerprint: options.sensitivityCatalogOffer ===
                "wrong-signed-admission"
              ? { algorithm: "sha256", digest: "3".repeat(64) }
              : sensitivityCatalogAdmission!.fingerprint,
          },
        }
        : undefined,
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
      activityId: "activity:seal-work-fea",
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
      evidenceRefs: artifactEvidenceRefs(basis, [
        proofArtifact,
        ...(sensitivityCatalogOffer ? [sensitivityCatalogOffer] : []),
      ]),
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
  const bytesByUri = new Map<string, Uint8Array>([[proofArtifact.uri!, proofBytes]]);
  if (
    sensitivityCatalogOffer?.uri && catalogOfferCaptureBytes &&
    options.sensitivityCatalogOffer !== "missing-capture"
  ) {
    bytesByUri.set(
      sensitivityCatalogOffer.uri,
      options.sensitivityCatalogOffer === "corrupt-capture"
        ? new TextEncoder().encode("corrupt capture")
        : catalogOfferCaptureBytes,
    );
  }
  return {
    proofCase,
    proofArtifact,
    sensitivityCatalogOffer,
    stepArtifact,
    stepBytes,
    input,
    stores,
    dependencies: {
      snapshots: exactSnapshotReader(stores),
      artifacts: artifactReader(bytesByUri),
      ...(sensitivityCatalogAdmission
        ? {
          admissions: {
            read: (request: {
              projectId: string;
              basis: {
                snapshotId: string;
                revision: number;
                subjectId: string;
              };
              artifactId: string;
              artifactFingerprint: ContentFingerprint;
            }) =>
              Promise.resolve(
                options.sensitivityCatalogOffer === "admission-unavailable" ||
                  request.projectId !== proofCase.project.id ||
                  request.basis.snapshotId !== ancestor.id ||
                  request.basis.revision !== ancestor.revision ||
                  request.basis.subjectId !== ancestor.subject.id ||
                  request.artifactId !== sensitivityCatalogAdmission.id ||
                  request.artifactFingerprint.algorithm !==
                    sensitivityCatalogAdmission.fingerprint.algorithm ||
                  request.artifactFingerprint.digest !==
                    sensitivityCatalogAdmission.fingerprint.digest
                  ? undefined
                  : ({
                    trustedRunId: sensitivityCatalogAdmission.producer.runId,
                  } as never),
              ),
          },
        }
        : {}),
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
    activityId: `activity:${options.workItemId}`,
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
    schemaVersion: "4.0",
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

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [],
  };
}

async function rawFingerprint(bytes: Uint8Array): Promise<ContentFingerprint> {
  return { algorithm: "sha256", digest: await fingerprintResourceBytes(bytes) };
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
