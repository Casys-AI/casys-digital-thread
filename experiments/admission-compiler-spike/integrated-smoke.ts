/**
 * One fixture-only, non-authoritative causal smoke:
 * ProjectBrief -> proposal compilation -> unresolved cross-source compilation
 * -> exact code-owned CAD qualification -> ephemeral native SysON anchor
 * -> build123d/CalculiX evidence -> proven SysON cleanup.
 */

import {
  briefSourceIdFor,
  ProjectBriefSourceAnalyzer,
} from "../../src/adapters/compile/source/project-brief-source-analyzer.ts";
import { PythonCadSourceAnalyzer } from "../../src/adapters/cad/source/python-cad-source-analyzer.ts";
import {
  RenderedArchitectureSysmlAnalyzer,
  sysmlRenderedSourceIdFor,
} from "../../src/adapters/architecture/renderer/rendered-architecture-sysml-analyzer.ts";
import { HttpMcpResourceReader } from "../../src/adapters/shared/mcp/http-mcp-resource-reader.ts";
import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import type { SourceAnalysisBundle } from "../../src/domain/compile/source/source-analysis.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import { parseArchitectureProposalParameters } from "../../src/domain/architecture/renderer/architecture-proposal.ts";
import {
  compileExplicitBriefProposals,
  SUPPORT_BLOCK_EXPLICIT_BRIEF_FIXTURE,
} from "./brief-proposal-compiler.ts";
import {
  compileAdmissionSpike,
  fingerprintAdmissionCompilation,
  type ServerOwnedLoweringProfile,
} from "./compiler.ts";
import {
  NATIVE_MECHANICAL_BUILD123D_SOURCE_ID,
  qualifyExactNativeBuild123dFixture,
} from "./exact-fixture-qualification.ts";
import {
  INTEGRATED_SUPPORT_BLOCK_BRIEF,
  INTEGRATED_SUPPORT_BLOCK_BRIEF_SOURCE_TEXT,
} from "./integrated-fixture.ts";
import { SpikeCalculixFrontend, SpikeModelicaFrontend } from "./mini-frontends.ts";
import {
  DockerComposeNativeAssetBridge,
  NATIVE_MECHANICAL_BUILD123D_SCRIPT,
  type NativeAssetBridge,
  type NativeCalculixAdapter,
  type NativeMechanicalSmokeClients,
  type NativeMechanicalSmokeSummary,
  type NativeSysmlMechanicalAnchor,
  runNativeMechanicalSmoke,
} from "./native-smoke.ts";
import {
  type EphemeralSysonAnchor,
  type SysonSmokeCompiledInput,
  type SysonSmokeTestSeam,
  withEphemeralSysonAnchor,
} from "./syson-smoke.ts";

export const INTEGRATED_ADMISSION_SMOKE_SCHEMA =
  "integrated-admission-smoke/0.1" as const;

const MODELICA_SOURCE = [
  "model SolverConformanceRamp",
  "  parameter Real inputSignal = 1;",
  "  Real normalizedResponse;",
  "equation",
  "  normalizedResponse = inputSignal;",
  "end SolverConformanceRamp;",
].join("\n");

/** Linkage-only candidate: it is analyzed but never sent to CalculiX. */
export const INTEGRATED_CALCULIX_CANDIDATE = [
  "*HEADING",
  "Generic support block static linkage candidate",
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

const PROFILES: readonly ServerOwnedLoweringProfile[] = Object.freeze([
  Object.freeze({
    id: "lowering.build123d.box-v1",
    version: "1.0.0",
    target: "build123d",
    sourceRole: "cad-script",
    outputContract: "spike-only/build123d-projection/0.1",
  }),
  Object.freeze({
    id: "lowering.modelica.source-linkage-v0",
    version: "1.0.0",
    target: "modelica",
    sourceRole: "modelica-model",
    outputContract: "spike-only/modelica-conformance-projection/0.1",
  }),
  Object.freeze({
    id: "lowering.calculix.source-linkage-v0",
    version: "1.0.0",
    target: "calculix",
    sourceRole: "calculix-input",
    outputContract: "spike-only/calculix-deck-projection/0.1",
  }),
]);

export interface IntegratedAdmissionSmokeDependencies {
  readonly syson?: SysonSmokeTestSeam;
  readonly mechanicalClients: NativeMechanicalSmokeClients;
  readonly bridge: NativeAssetBridge;
  readonly calculixAdapter?: NativeCalculixAdapter;
  readonly pollDelay?: (milliseconds: number) => Promise<void>;
  /** Test-only orchestration seam; liveIntegratedDependencies never sets it. */
  readonly testStages?: {
    readonly withSysonAnchor: typeof withEphemeralSysonAnchor;
    readonly runMechanical: typeof runNativeMechanicalSmoke;
  };
  readonly observeStage?: (
    stage: "compilation-closed" | "syson-cleanup-proven",
  ) => void;
}

export interface IntegratedAdmissionSmokeSummary {
  readonly schemaVersion: typeof INTEGRATED_ADMISSION_SMOKE_SCHEMA;
  readonly authority: "experimental-fixture-only-non-authoritative";
  readonly fixtureOnly: true;
  readonly admissionStatus: "not-admitted";
  readonly compilationStatus: "unresolved";
  readonly engineeringProjectStateWritten: false;
  readonly threadStateWritten: false;
  readonly ephemeralSysonProject: {
    readonly lifecycle: "created-and-deleted";
    readonly persistentAfterRun: false;
  };
  readonly brief: {
    readonly sourceId: string;
    readonly sourceSha256: string;
    readonly proposalCompilationSha256: string;
    readonly proposalStatus: "resolved";
    readonly fieldItemMappings: readonly {
      readonly proposalField: string;
      readonly sourceItemId: string;
    }[];
  };
  readonly crossSource: {
    readonly compilationSha256: string;
    readonly unresolvedDiagnosticIds: readonly string[];
    readonly candidateCalculixSentToProvider: false;
  };
  readonly fixtureQualification: {
    readonly admitted: false;
    readonly compilationStatusEffect: "none";
    readonly sourceSha256: string;
    readonly analysisSha256: string;
  };
  readonly syson: {
    readonly projectId: string;
    readonly editingContextId: string;
    readonly supportBlockPartDefinitionId: string;
    readonly supportBlockPartUsageId: string;
    readonly requirementUsageId: string;
    readonly constraintUsageIds: readonly [string, string];
    readonly cleanup: "deleted-and-absent";
    readonly deleteAttempts: 1;
  };
  readonly geometry: {
    readonly sourceSha256: string;
    readonly stepSha256: string;
    readonly stepBytes: number;
  };
  readonly calculix: {
    readonly requestId: string;
    readonly requestSha256: string;
    readonly runId: string;
    readonly resourceLedgerSha256: string;
    readonly executionIdentitySha256: string;
    readonly normalizedResultSha256: string;
    readonly resourceReadsVerified: 9;
  };
}

export async function runIntegratedAdmissionSmoke(
  dependencies: IntegratedAdmissionSmokeDependencies,
): Promise<IntegratedAdmissionSmokeSummary> {
  // No provider exists before both compiler layers and exact fixture
  // qualification have closed.
  const prepared = await prepareIntegratedCompilation();
  const compiledInput: SysonSmokeCompiledInput = {
    architecture: prepared.architectureProposal,
    requirements: prepared.proposals.requirements!.oracleRequirements,
  };
  dependencies.observeStage?.("compilation-closed");
  const withAnchor = dependencies.testStages?.withSysonAnchor ??
    withEphemeralSysonAnchor;
  const runMechanical = dependencies.testStages?.runMechanical ??
    runNativeMechanicalSmoke;

  const anchorRun = await withAnchor(
    async (anchor) => {
      assertCompiledRequirementsEqualAnchor(
        prepared.proposals.requirements!.oracleRequirements,
        anchor,
      );
      const mechanical: NativeMechanicalSmokeSummary = await runMechanical(
        dependencies.mechanicalClients,
        dependencies.bridge,
        nativeAnchorFrom(anchor),
        {
          ...(dependencies.calculixAdapter
            ? { calculix: dependencies.calculixAdapter }
            : {}),
          ...(dependencies.pollDelay ? { pollDelay: dependencies.pollDelay } : {}),
        },
      );
      return Object.freeze({ mechanical, anchor });
    },
    compiledInput,
    dependencies.syson,
  );
  if (
    anchorRun.result.status !== "passed" ||
    anchorRun.result.cleanup.status !== "deleted-and-absent" ||
    !anchorRun.useResult
  ) {
    throw new Error(
      `Integrated SysON/mechanical phase failed: ${
        anchorRun.result.failure?.message ?? "missing successful consumer result"
      }`,
    );
  }
  dependencies.observeStage?.("syson-cleanup-proven");

  const { mechanical, anchor } = anchorRun.useResult;
  const criteria = anchor.requirements.criteria;
  const summary: IntegratedAdmissionSmokeSummary = {
    schemaVersion: INTEGRATED_ADMISSION_SMOKE_SCHEMA,
    authority: "experimental-fixture-only-non-authoritative",
    fixtureOnly: true,
    admissionStatus: "not-admitted",
    compilationStatus: "unresolved",
    engineeringProjectStateWritten: false,
    threadStateWritten: false,
    ephemeralSysonProject: {
      lifecycle: "created-and-deleted",
      persistentAfterRun: false,
    },
    brief: {
      sourceId: prepared.brief.source.id,
      sourceSha256: prepared.brief.source.fingerprint.digest,
      proposalCompilationSha256: prepared.proposals.compilationFingerprint.digest,
      proposalStatus: "resolved",
      fieldItemMappings: prepared.proposals.fieldProvenance.map((item) => ({
        proposalField: item.proposalField,
        sourceItemId: item.sourceItemId,
      })),
    },
    crossSource: {
      compilationSha256: prepared.compilationFingerprint,
      unresolvedDiagnosticIds: prepared.compilation.diagnostics.map((item) => item.id),
      candidateCalculixSentToProvider: false,
    },
    fixtureQualification: {
      admitted: false,
      compilationStatusEffect: "none",
      sourceSha256: prepared.qualification.sourceFingerprint.digest,
      analysisSha256: prepared.qualification.analysisFingerprint.digest,
    },
    syson: {
      projectId: anchor.project.id,
      editingContextId: anchor.project.editingContextId,
      supportBlockPartDefinitionId: anchor.architecture.supportBlockPartDefinitionId,
      supportBlockPartUsageId: anchor.architecture.supportBlockPartUsageId,
      requirementUsageId: anchor.requirements.requirementUsageId,
      constraintUsageIds: [
        criteria[0]!.constraintUsageId,
        criteria[1]!.constraintUsageId,
      ],
      cleanup: "deleted-and-absent",
      deleteAttempts: 1,
    },
    geometry: {
      sourceSha256: mechanical.geometry.sourceSha256,
      stepSha256: mechanical.geometry.stepSha256,
      stepBytes: mechanical.geometry.stepBytes,
    },
    calculix: {
      requestId: mechanical.calculix.requestId,
      requestSha256: mechanical.calculix.requestSha256,
      runId: mechanical.calculix.runId,
      resourceLedgerSha256: mechanical.calculix.resourceLedgerSha256,
      executionIdentitySha256: mechanical.calculix.executionIdentitySha256,
      normalizedResultSha256: mechanical.calculix.normalizedResultSha256,
      resourceReadsVerified: 9,
    },
  };
  return Object.freeze(summary);
}

async function prepareIntegratedCompilation() {
  const briefSourceId = await briefSourceIdFor(
    INTEGRATED_SUPPORT_BLOCK_BRIEF.briefId,
    INTEGRATED_SUPPORT_BLOCK_BRIEF.id,
    INTEGRATED_SUPPORT_BLOCK_BRIEF.revision,
  );
  const brief = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId: briefSourceId,
    role: "brief",
    language: "plain-text",
    sourceText: INTEGRATED_SUPPORT_BLOCK_BRIEF_SOURCE_TEXT,
  });
  const proposals = await compileExplicitBriefProposals({
    ...SUPPORT_BLOCK_EXPLICIT_BRIEF_FIXTURE,
    brief: INTEGRATED_SUPPORT_BLOCK_BRIEF,
  });
  if (
    proposals.status !== "resolved" || !proposals.architecture ||
    !proposals.requirements
  ) {
    throw new TypeError("The exact brief declarations did not compile to proposals.");
  }
  assertExactFieldItemMappings(proposals.fieldProvenance);
  const architectureProposal = parseArchitectureProposalParameters(
    proposals.architecture.parameters,
  );
  if (
    proposals.briefSource.id !== brief.source.id ||
    proposals.briefSource.fingerprint.digest !== brief.source.fingerprint.digest
  ) {
    throw new TypeError(
      "The explicit proposal compiler is not bound to the exact analyzed ProjectBrief bytes.",
    );
  }

  const sysmlSourceId = await sysmlRenderedSourceIdFor(
    proposals.architecture.rendered.manifest.selector,
    "integrated-admission-smoke",
    proposals.architecture.operation,
  );
  const sysml = await new RenderedArchitectureSysmlAnalyzer().analyzeRendered({
    sourceId: sysmlSourceId,
    rendered: proposals.architecture.rendered,
  });
  const cad = await new PythonCadSourceAnalyzer().analyze({
    sourceId: NATIVE_MECHANICAL_BUILD123D_SOURCE_ID,
    role: "cad-script",
    language: "python",
    sourceText: NATIVE_MECHANICAL_BUILD123D_SCRIPT,
  });
  const modelica = await new SpikeModelicaFrontend().analyze({
    sourceId: "modelica:solver-conformance-ramp",
    role: "modelica-model",
    language: "modelica",
    sourceText: MODELICA_SOURCE,
  });
  const calculix = await new SpikeCalculixFrontend().analyze({
    sourceId: "calculix:generic-support-static-candidate",
    role: "calculix-input",
    language: "calculix-inp",
    sourceText: INTEGRATED_CALCULIX_CANDIDATE,
  });
  assertPoliciesPassed([brief, sysml, cad, modelica, calculix]);

  const qualification = await qualifyExactNativeBuild123dFixture(
    NATIVE_MECHANICAL_BUILD123D_SCRIPT,
    cad,
  );
  const sources = [
    { sourceText: INTEGRATED_SUPPORT_BLOCK_BRIEF_SOURCE_TEXT, bundle: brief },
    { sourceText: proposals.architecture.rendered.sourceText, bundle: sysml },
    { sourceText: NATIVE_MECHANICAL_BUILD123D_SCRIPT, bundle: cad },
    { sourceText: MODELICA_SOURCE, bundle: modelica },
    { sourceText: INTEGRATED_CALCULIX_CANDIDATE, bundle: calculix },
  ];
  const target = sysml.symbols.find((symbol) => symbol.name === "SupportBlock");
  if (!target) throw new TypeError("Rendered SysML lacks SupportBlock target symbol.");
  let ordinal = 1;
  const bindings = sources
    .filter(({ bundle }) => bundle.source.role !== "sysml-model")
    .flatMap(({ bundle }) =>
      bundle.symbols.map((symbol) => ({
        id: `integrated-binding-${String(ordinal++).padStart(3, "0")}`,
        sourceId: bundle.source.id,
        sourceSymbolId: symbol.id,
        targetSysmlSymbolId: target.id,
      }))
    );
  const compilation = await compileAdmissionSpike({
    compilationId: "generic-support-integrated-admission-smoke",
    briefReviewClaim: {
      approvedBriefBasis: {
        kind: "approved-brief",
        projectId: "spike-only-generic-support",
        projectSnapshotId: "spike-only-project-snapshot-1",
        projectRevision: 1,
        briefId: INTEGRATED_SUPPORT_BLOCK_BRIEF.briefId,
        briefSnapshotId: INTEGRATED_SUPPORT_BLOCK_BRIEF.id,
        briefRevision: INTEGRATED_SUPPORT_BLOCK_BRIEF.revision,
        approvedBriefFingerprint: brief.source.fingerprint,
      },
      review: {
        briefSnapshotId: INTEGRATED_SUPPORT_BLOCK_BRIEF.id,
        briefRevision: INTEGRATED_SUPPORT_BLOCK_BRIEF.revision,
        status: "approved",
        inputFingerprint: brief.source.fingerprint,
        requestedAt: "2026-08-13T05:01:00.000Z",
        decidedAt: "2026-08-13T05:02:00.000Z",
        decidedBy: { id: "human:fixture-review-claim", origin: "human" },
        rationale:
          "Fixture-local structural review claim only; not server-resolved authority.",
      },
    },
    semanticAnchor: {
      sourceId: sysml.source.id,
      sourceFingerprint: sysml.source.fingerprint,
    },
    sources,
    bindings,
    loweringProfileIds: {
      build123d: "lowering.build123d.box-v1",
      modelica: "lowering.modelica.source-linkage-v0",
      calculix: "lowering.calculix.source-linkage-v0",
    },
  }, PROFILES);
  if (
    compilation.status !== "unresolved" ||
    !compilation.diagnostics.some((diagnostic) =>
      diagnostic.code === "source-unresolved-construct" &&
      diagnostic.sourceId === cad.source.id && diagnostic.blocking
    )
  ) {
    throw new TypeError(
      "The main cross-source compilation must retain blocking Python diagnostics.",
    );
  }
  return {
    brief,
    proposals,
    architectureProposal,
    qualification,
    compilation,
    compilationFingerprint: (await fingerprintAdmissionCompilation(compilation)).digest,
  };
}

function assertExactFieldItemMappings(
  provenance: readonly {
    readonly proposalField: string;
    readonly sourceItemId: string;
    readonly sourceRefs: readonly unknown[];
  }[],
): void {
  const expected = [
    ["architecture.package", "architecture"],
    ["system.name", "system"],
    ["component.support.name", "support-block"],
    ["component.support.usage", "support-block"],
    ["requirements.containerComponent", "mechanical-verification"],
    ["requirement.displacement.name", "max-displacement"],
    ["requirement.displacement.metric", "max-displacement"],
    ["requirement.displacement.operator", "max-displacement"],
    ["requirement.displacement.threshold", "max-displacement"],
    ["requirement.vonMises.name", "max-von-mises"],
    ["requirement.vonMises.metric", "max-von-mises"],
    ["requirement.vonMises.operator", "max-von-mises"],
    ["requirement.vonMises.threshold", "max-von-mises"],
  ].map(([proposalField, sourceItemId]) => ({ proposalField, sourceItemId }));
  const observed = provenance.map(({ proposalField, sourceItemId, sourceRefs }) => {
    const item = INTEGRATED_SUPPORT_BLOCK_BRIEF.items.find((candidate) =>
      candidate.id === sourceItemId
    );
    if (!item || deterministicJson(sourceRefs) !== deterministicJson(item.sourceRefs)) {
      throw new TypeError(
        `Compiled field ${proposalField} is not bound to the exact ProjectBrief item sources.`,
      );
    }
    return { proposalField, sourceItemId };
  });
  if (deterministicJson(observed) !== deterministicJson(expected)) {
    throw new TypeError(
      "The proposal compiler field-to-ProjectBrief-item mapping is not the closed SupportBlock mapping.",
    );
  }
}

function assertPoliciesPassed(bundles: readonly SourceAnalysisBundle[]): void {
  if (bundles.some((bundle) => bundle.policy.status !== "passed")) {
    throw new TypeError(
      "Every exact source frontend policy must pass before composition.",
    );
  }
}

function assertCompiledRequirementsEqualAnchor(
  requirements: readonly {
    id: string;
    metric: string;
    operator: string;
    limit: { value: number; unit: string };
  }[],
  anchor: EphemeralSysonAnchor,
): void {
  const compiled = requirements.map((item) => ({
    requirementId: item.id,
    metric: item.metric,
    operator: item.operator,
    limitValue: item.limit.value,
    unit: item.limit.unit,
  }));
  const native = anchor.requirements.criteria.map((item) => ({
    requirementId: item.requirementId,
    metric: item.metric,
    operator: item.operator,
    limitValue: item.limitValue,
    unit: item.unit,
  }));
  if (deterministicJson(compiled) !== deterministicJson(native)) {
    throw new TypeError(
      "The native SysON requirement identities or limits diverged from the compiled brief proposals.",
    );
  }
}

function nativeAnchorFrom(
  anchor: EphemeralSysonAnchor,
): NativeSysmlMechanicalAnchor {
  return {
    editingContextId: anchor.project.editingContextId,
    supportBlockPartDefinitionId: anchor.architecture.supportBlockPartDefinitionId,
    supportBlockPartUsageId: anchor.architecture.supportBlockPartUsageId,
    supportBlockPartUsageTargetId: anchor.architecture.supportBlockPartUsageTargetId,
    requirementUsageId: anchor.requirements.requirementUsageId,
    subjectReferenceUsageId: anchor.requirements.subjectReferenceUsageId,
    subjectTargetPartDefinitionId: anchor.requirements.subjectTargetPartDefinitionId,
    criteria: anchor.requirements.criteria.map((criterion) => ({
      ...criterion,
      requirementId: criterion.requirementId as
        | "support_block_max_displacement"
        | "support_block_max_von_mises",
      metric: criterion.metric as
        | "support_block_max_displacement"
        | "support_block_max_von_mises",
    })),
  };
}

export function liveIntegratedDependencies(): IntegratedAdmissionSmokeDependencies {
  const calculixEndpoint = "http://127.0.0.1:3015/mcp";
  return {
    mechanicalClients: {
      build123dSandbox: new HttpMcpToolClient({
        mcpUrl: "http://127.0.0.1:3024/mcp",
        timeoutMs: 180_000,
      }),
      calculix: new HttpMcpToolClient({ mcpUrl: calculixEndpoint, timeoutMs: 180_000 }),
      calculixResources: new HttpMcpResourceReader({
        mcpUrl: calculixEndpoint,
        timeoutMs: 60_000,
      }),
    },
    bridge: new DockerComposeNativeAssetBridge(),
  };
}

if (import.meta.main) {
  if (Deno.args.length !== 0) {
    throw new TypeError("integrated-smoke accepts no provider or recipe arguments.");
  }
  const summary = await runIntegratedAdmissionSmoke(liveIntegratedDependencies());
  console.log(JSON.stringify(summary, null, 2));
}
