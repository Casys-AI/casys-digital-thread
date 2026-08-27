import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  briefSourceIdFor,
  ProjectBriefSourceAnalyzer,
} from "../../src/adapters/compile/source/project-brief-source-analyzer.ts";
import { PythonCadSourceAnalyzer } from "../../src/adapters/cad/source/python-cad-source-analyzer.ts";
import {
  RenderedArchitectureSysmlAnalyzer,
  sysmlRenderedSourceIdFor,
} from "../../src/adapters/architecture/renderer/rendered-architecture-sysml-analyzer.ts";
import type { SourceAnalysisBundle } from "../../src/domain/compile/source/source-analysis.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../../src/domain/architecture/renderer/architecture-proposal.ts";
import {
  canonicalAdmissionCompilationText,
  compileAdmissionSpike,
  fingerprintAdmissionCompilation,
  type ServerOwnedLoweringProfile,
} from "./compiler.ts";
import { SpikeCalculixFrontend, SpikeModelicaFrontend } from "./mini-frontends.ts";

const PROFILES: readonly ServerOwnedLoweringProfile[] = [
  {
    id: "lowering.build123d.box-v1",
    version: "1.0.0",
    target: "build123d",
    sourceRole: "cad-script",
    outputContract: "spike-only/build123d-projection/0.1",
  },
  {
    id: "lowering.modelica.source-linkage-v0",
    version: "1.0.0",
    target: "modelica",
    sourceRole: "modelica-model",
    outputContract: "spike-only/modelica-conformance-projection/0.1",
  },
  {
    id: "lowering.calculix.source-linkage-v0",
    version: "1.0.0",
    target: "calculix",
    sourceRole: "calculix-input",
    outputContract: "spike-only/calculix-deck-projection/0.1",
  },
];

Deno.test("real native fixture remains unresolved until provider-profile review and readback", async () => {
  const fixture = await makeFixture();
  const compiled = await compileAdmissionSpike(fixture.request, PROFILES);

  assertEquals(compiled.status, "unresolved");
  assertEquals(compiled.intentSource.kind, "brief-source-review-claim");
  assertEquals(compiled.semanticAnchor.kind, "sysml-source-draft");
  assertEquals(compiled.sourceRefs.map((source) => source.role).sort(), [
    "brief",
    "cad-script",
    "calculix-input",
    "modelica-model",
    "sysml-model",
  ]);
  assertEquals(
    compiled.projections.map((projection) => ({
      target: projection.target,
      readiness: projection.readiness,
    })),
    [
      { target: "build123d", readiness: "unresolved" },
      { target: "modelica", readiness: "resolved" },
      { target: "calculix", readiness: "resolved" },
    ],
  );
  assertEquals(
    compiled.diagnostics.some((diagnostic) =>
      diagnostic.code === "source-unresolved-construct" && diagnostic.blocking
    ),
    true,
  );
  assertEquals(Object.isFrozen(compiled), true);
});

Deno.test("one missing CAD binding is unresolved and cannot describe a dispatch", async () => {
  const fixture = await makeFixture();
  const cadSourceId =
    fixture.bundles.find((bundle) => bundle.source.role === "cad-script")!.source.id;
  const request = structuredClone(fixture.request);
  const index = request.bindings.findIndex((binding) =>
    binding.sourceId === cadSourceId
  );
  request.bindings.splice(index, 1);

  const compiled = await compileAdmissionSpike(request, PROFILES);
  assertEquals(compiled.status, "unresolved");
  assertEquals(
    compiled.projections.find((projection) => projection.target === "build123d")
      ?.readiness,
    "unresolved",
  );
  assertEquals(
    compiled.diagnostics.some((diagnostic) =>
      diagnostic.code === "missing-explicit-binding" && diagnostic.blocking
    ),
    true,
  );
  assertEquals("dispatches" in compiled, false);
  assertEquals("runner" in compiled, false);
});

Deno.test("exact source byte or claimed fingerprint tamper is rejected", async () => {
  const fixture = await makeFixture();
  const changedText = structuredClone(fixture.request);
  changedText.sources[0]!.sourceText += "\n";
  await assertRejects(
    () => compileAdmissionSpike(changedText, PROFILES),
    TypeError,
    "exact source bytes",
  );

  const changedFingerprint = structuredClone(fixture.request);
  changedFingerprint.sources[0]!.bundle.source.fingerprint.digest = "f".repeat(64);
  await assertRejects(
    () => compileAdmissionSpike(changedFingerprint, PROFILES),
    TypeError,
    "exact source bytes",
  );
});

Deno.test("a source-analysis policy rejection is fail-closed", async () => {
  const fixture = await makeFixture();
  const request = structuredClone(fixture.request);
  request.sources[3]!.bundle = {
    ...request.sources[3]!.bundle,
    policy: {
      profile: request.sources[3]!.bundle.policy.profile,
      status: "rejected",
      findings: [{
        id: "finding:blocked",
        code: "blocked",
        severity: "error",
        message: "Native source is not admitted.",
      }],
    },
  };
  await assertRejects(
    () => compileAdmissionSpike(request, PROFILES),
    TypeError,
    "policy must have passed",
  );
});

Deno.test("brief review claim rejects agent, pending, or mismatched review data", async () => {
  const fixture = await makeFixture();
  const agent = structuredClone(fixture.request);
  agent.briefReviewClaim.review.decidedBy.origin = "agent" as "human";
  await assertRejects(
    () => compileAdmissionSpike(agent, PROFILES),
    TypeError,
    'must equal "human"',
  );

  const pending = structuredClone(fixture.request) as unknown as Record<
    string,
    unknown
  >;
  (pending.briefReviewClaim as Record<string, unknown>).review = {
    ...(pending.briefReviewClaim as { review: Record<string, unknown> }).review,
    status: "pending",
  };
  await assertRejects(
    () => compileAdmissionSpike(pending, PROFILES),
    TypeError,
    'must equal "approved"',
  );

  const mismatch = structuredClone(fixture.request);
  mismatch.briefReviewClaim.approvedBriefBasis.briefSnapshotId = "other-brief";
  await assertRejects(
    () => compileAdmissionSpike(mismatch, PROFILES),
    TypeError,
    "exact native brief revision",
  );
});

Deno.test("any unresolved native construct blocks the spike compilation", async () => {
  const fixture = await makeFixture();
  const request = structuredClone(fixture.request);
  const modelicaIndex = request.sources.findIndex((source) =>
    source.bundle.source.role === "modelica-model"
  );
  request.sources[modelicaIndex]!.bundle = {
    ...request.sources[modelicaIndex]!.bundle,
    unresolvedConstructs: [{
      id: "unresolved:fixture",
      kind: "fixture-unresolved",
      message: "The fixture deliberately retains an unresolved construct.",
    }],
  };
  const compiled = await compileAdmissionSpike(request, PROFILES);
  assertEquals(compiled.status, "unresolved");
  assertEquals(
    compiled.diagnostics.some((diagnostic) =>
      diagnostic.code === "source-unresolved-construct" && diagnostic.blocking
    ),
    true,
  );
});

Deno.test("a wrong SysML anchor or non-anchor target symbol is rejected", async () => {
  const fixture = await makeFixture();
  const wrongAnchor = structuredClone(fixture.request);
  wrongAnchor.semanticAnchor.sourceFingerprint = {
    algorithm: "sha256",
    digest: "b".repeat(64),
  };
  await assertRejects(
    () => compileAdmissionSpike(wrongAnchor, PROFILES),
    TypeError,
    "exact analyzed SysML source",
  );

  const wrongTarget = structuredClone(fixture.request);
  wrongTarget.bindings[0]!.targetSysmlSymbolId = "component:not-in-anchor";
  await assertRejects(
    () => compileAdmissionSpike(wrongTarget, PROFILES),
    TypeError,
    "exact SysML anchor",
  );
});

Deno.test("agent provider, tool, args and profile injection are structurally rejected", async () => {
  const fixture = await makeFixture();
  const injected = {
    ...fixture.request,
    provider: "attacker-provider",
    tool: "shell.exec",
    args: { command: "uname" },
  };
  await assertRejects(
    () => compileAdmissionSpike(injected, PROFILES),
    TypeError,
    "unsupported field provider",
  );

  const injectedProfiles = structuredClone(PROFILES) as Array<
    ServerOwnedLoweringProfile & { provider?: string }
  >;
  injectedProfiles[0]!.provider = "caller-selected";
  await assertRejects(
    () => compileAdmissionSpike(fixture.request, injectedProfiles),
    TypeError,
    "unsupported field provider",
  );

  const productionContract = structuredClone(PROFILES).map((profile, index) =>
    index === 1 ? { ...profile, outputContract: "simulation-case-v2/2.0" } : profile
  );
  await assertRejects(
    () => compileAdmissionSpike(fixture.request, productionContract),
    TypeError,
    "spike-only/modelica-conformance-projection/0.1",
  );
});

Deno.test("ordering and compilation fingerprint are deterministic", async () => {
  const fixture = await makeFixture();
  const shuffled = structuredClone(fixture.request);
  shuffled.sources.reverse();
  shuffled.bindings.reverse();
  const first = await compileAdmissionSpike(fixture.request, PROFILES);
  const second = await compileAdmissionSpike(shuffled, [...PROFILES].reverse());

  assertEquals(
    canonicalAdmissionCompilationText(first),
    canonicalAdmissionCompilationText(second),
  );
  assertEquals(
    await fingerprintAdmissionCompilation(first),
    await fingerprintAdmissionCompilation(second),
  );
});

Deno.test("mini-frontends fail closed outside their explicit native subsets", async () => {
  const modelica = await new SpikeModelicaFrontend().analyze({
    sourceId: "modelica:bad",
    role: "modelica-model",
    language: "modelica",
    sourceText: "model Bad\nalgorithm\nend Bad;",
  });
  const calculix = await new SpikeCalculixFrontend().analyze({
    sourceId: "calculix:bad",
    role: "calculix-input",
    language: "calculix-inp",
    sourceText: "*UNSUPPORTED\n1,2,3",
  });
  const unparsedCalculixPayload = await new SpikeCalculixFrontend().analyze({
    sourceId: "calculix:unparsed-data",
    role: "calculix-input",
    language: "calculix-inp",
    sourceText:
      "*HEADING\nUnparsed payload repro\n*NODE,NSET=BASE\nTOTALLY_UNPARSED_PAYLOAD",
  });
  const incompleteCalculixDeck = await new SpikeCalculixFrontend().analyze({
    sourceId: "calculix:incomplete-linkage",
    role: "calculix-input",
    language: "calculix-inp",
    sourceText: "*HEADING\nIncomplete source",
  });
  assertEquals(modelica.policy.status, "rejected");
  assertEquals(calculix.policy.status, "rejected");
  assertEquals(unparsedCalculixPayload.policy.status, "rejected");
  assertEquals(incompleteCalculixDeck.policy.status, "rejected");
});

interface FixtureRequest {
  compilationId: string;
  briefReviewClaim: {
    approvedBriefBasis: {
      kind: "approved-brief";
      projectId: string;
      projectSnapshotId: string;
      projectRevision: number;
      briefId: string;
      briefSnapshotId: string;
      briefRevision: number;
      approvedBriefFingerprint: { algorithm: "sha256"; digest: string };
    };
    review: {
      briefSnapshotId: string;
      briefRevision: number;
      status: "approved";
      inputFingerprint: { algorithm: "sha256"; digest: string };
      requestedAt: string;
      decidedAt: string;
      decidedBy: { id: string; origin: "human" };
      rationale: string;
    };
  };
  semanticAnchor: {
    sourceId: string;
    sourceFingerprint: { algorithm: "sha256"; digest: string };
  };
  sources: Array<{ sourceText: string; bundle: SourceAnalysisBundle }>;
  bindings: Array<{
    id: string;
    sourceId: string;
    sourceSymbolId: string;
    targetSysmlSymbolId: string;
  }>;
  loweringProfileIds: {
    build123d: string;
    modelica: string;
    calculix: string;
  };
}

async function makeFixture(): Promise<{
  request: FixtureRequest;
  bundles: SourceAnalysisBundle[];
}> {
  const brief = {
    contractVersion: "2.0",
    briefId: "generic-support:brief",
    id: "brief-snapshot-1",
    revision: 1,
    items: [
      {
        id: "objective",
        kind: "objective",
        statement: "Create a generic mechanical support specimen.",
        sourceRefs: [{ kind: "intent", reference: "conversation:1" }],
      },
      {
        id: "mission",
        kind: "mission-scenario",
        statement: "Exercise the admission compiler with a bounded support block.",
        sourceRefs: [{ kind: "intent", reference: "conversation:1" }],
      },
      {
        id: "gate-static",
        kind: "success-criterion",
        statement: "The support block has a declared static verification activity.",
        sourceRefs: [{ kind: "document", reference: "spec:static" }],
        dependsOnItemIds: ["objective", "mission"],
      },
    ],
    proposedAt: "2026-08-13T05:00:00.000Z",
    proposedBy: { id: "agent:spike", origin: "agent" },
  };
  const briefText = deterministicJson(brief);
  const briefSourceId = await briefSourceIdFor(
    brief.briefId,
    brief.id,
    brief.revision,
  );
  const briefBundle = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId: briefSourceId,
    role: "brief",
    language: "plain-text",
    sourceText: briefText,
  });

  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "GenericSupport" },
    { key: "system.name", label: "System", value: "GenericSupportSystem" },
    {
      key: "component.support.name",
      label: "Support block",
      value: "SupportBlock",
    },
    {
      key: "component.support.usage",
      label: "Support usage",
      value: "supportBlock",
    },
  ]);
  const rendered = renderArchitectureSysmlWithManifest(proposal);
  const sysmlSourceId = await sysmlRenderedSourceIdFor(
    rendered.manifest.selector,
    "run-spike",
    { id: "model.write-architecture", version: "1" },
  );
  const sysmlBundle = await new RenderedArchitectureSysmlAnalyzer().analyzeRendered({
    sourceId: sysmlSourceId,
    rendered,
  });

  const cadText = [
    "from build123d import Box",
    "width = 40",
    "height = 12",
    "depth = 8",
    "result = Box(width, height, depth)",
  ].join("\n");
  const cadBundle = await new PythonCadSourceAnalyzer().analyze({
    sourceId: "cad:generic-support-block",
    role: "cad-script",
    language: "python",
    sourceText: cadText,
  });

  const modelicaText = [
    "model SolverConformanceRamp",
    "  parameter Real inputSignal = 1;",
    "  Real normalizedResponse;",
    "equation",
    "  normalizedResponse = inputSignal;",
    "end SolverConformanceRamp;",
  ].join("\n");
  const modelicaBundle = await new SpikeModelicaFrontend().analyze({
    sourceId: "modelica:solver-conformance-ramp",
    role: "modelica-model",
    language: "modelica",
    sourceText: modelicaText,
  });

  const calculixText = [
    "*HEADING",
    "Generic support block static conformance deck",
    "*NODE,NSET=BASE",
    "1,0,0,0",
    "2,1,0,0",
    "3,0,1,0",
    "4,0,0,1",
    "*ELEMENT,TYPE=C3D4,ELSET=SUPPORT_BLOCK",
    "1,1,2,3,4",
    "*MATERIAL,NAME=GENERIC_LINEAR",
    "*ELASTIC",
    "70000,0.33",
    "*STEP",
    "*STATIC",
    "*BOUNDARY",
    "BASE,1,3,0",
    "*CLOAD",
    "2,3,-10",
    "*END STEP",
  ].join("\n");
  const calculixBundle = await new SpikeCalculixFrontend().analyze({
    sourceId: "calculix:generic-support-static",
    role: "calculix-input",
    language: "calculix-inp",
    sourceText: calculixText,
  });

  const bundles = [
    briefBundle,
    sysmlBundle,
    cadBundle,
    modelicaBundle,
    calculixBundle,
  ];
  assertEquals(bundles.every((bundle) => bundle.policy.status === "passed"), true);
  const target =
    sysmlBundle.symbols.find((symbol) => symbol.name === "GenericSupportSystem") ??
      sysmlBundle.symbols[0];
  assert(target);
  let ordinal = 1;
  const bindings = bundles
    .filter((bundle) => bundle.source.role !== "sysml-model")
    .flatMap((bundle) =>
      bundle.symbols.map((symbol) => ({
        id: `binding-${String(ordinal++).padStart(3, "0")}`,
        sourceId: bundle.source.id,
        sourceSymbolId: symbol.id,
        targetSysmlSymbolId: target.id,
      }))
    );

  return {
    bundles,
    request: {
      compilationId: "generic-support-admission-spike",
      briefReviewClaim: {
        approvedBriefBasis: {
          kind: "approved-brief",
          projectId: "generic-support",
          projectSnapshotId: "project-snapshot-approved-1",
          projectRevision: 2,
          briefId: brief.briefId,
          briefSnapshotId: brief.id,
          briefRevision: brief.revision,
          approvedBriefFingerprint: briefBundle.source.fingerprint,
        },
        review: {
          briefSnapshotId: brief.id,
          briefRevision: brief.revision,
          status: "approved",
          inputFingerprint: briefBundle.source.fingerprint,
          requestedAt: "2026-08-13T05:01:00.000Z",
          decidedAt: "2026-08-13T05:02:00.000Z",
          decidedBy: { id: "human:fixture-reviewer", origin: "human" },
          rationale: "Fixture review claim for structural consistency testing only.",
        },
      },
      semanticAnchor: {
        sourceId: sysmlBundle.source.id,
        sourceFingerprint: sysmlBundle.source.fingerprint,
      },
      sources: [
        { sourceText: briefText, bundle: briefBundle },
        { sourceText: rendered.sourceText, bundle: sysmlBundle },
        { sourceText: cadText, bundle: cadBundle },
        { sourceText: modelicaText, bundle: modelicaBundle },
        { sourceText: calculixText, bundle: calculixBundle },
      ],
      bindings,
      loweringProfileIds: {
        build123d: "lowering.build123d.box-v1",
        modelica: "lowering.modelica.source-linkage-v0",
        calculix: "lowering.calculix.source-linkage-v0",
      },
    },
  };
}
