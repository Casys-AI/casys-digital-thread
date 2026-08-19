/**
 * Read-only, code-owned resolver for the two recorded-operation-plan/2.0
 * verticals.  It consumes only exact immutable Thread artifacts and canonical
 * CAS bytes; it has no provider capability and performs no mutation.
 */

import {
  CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE,
  CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE,
  MODELICA_RESUMABLE_RESOURCE_PROFILE,
  RESOLVED_OPERATION_PLAN_V2_SCHEMA,
  resolvedOperationPlanIdForRun,
  type ResolvedOperationPlanSource,
  type ResolvedOperationPlanV2,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { CalculixIsolatedExecutionProfile } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import { canonicalCalculixStepAssetCasUri } from "../../../domain/fea/isolated-v3/calculix-step-asset-uri.ts";
import {
  canonicalModelicaQualifiedManifestDocumentText,
  type ModelicaQualifiedManifestDocument,
  type ModelicaResumableResource,
  validateModelicaQualifiedManifestDocument,
} from "../../../domain/modelica/recorded/resumable-capabilities.ts";
import {
  fingerprintResourceBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  type FeaProofCaseCapture,
  parseFeaProofCaseCapture,
} from "../../../domain/fea/seal-case/fea-proof-case-capture.ts";
import {
  feaProofDecisionParametersToMap,
  parseFeaProofDecisionParameters,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  verifyFeaProofParametersMatchCase,
} from "../../../domain/fea/seal-case/fea-proof-proposal.ts";
import { isolatedCalculixBindingRejectionMessage } from "../../../domain/fea/isolated-v3/isolated-calculix-bindings.ts";
import type { MechanicalProofCase } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  canonicalSimulationCaseV2Text,
  type SimulationCaseV2,
  validateSimulationCaseV2,
} from "../../../domain/modelica/recorded/simulation-case-v2.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringOperationInputBinding,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { RegisteredRunPlanSealInput } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import type {
  FeaIsolatedRunAdmissionReview,
  FeaIsolatedRunAdmissionReviewer,
} from "../../../application/ports/out/fea/isolated-v3/fea-isolated-run-admission-reviewer.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../../orchestration/operations/fea-isolated-static-proof.ts";
import { SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION } from "../../../domain/modelica/recorded/simulation-case-v2-proposal.ts";
import type { ExactThreadSnapshotReader } from "../../shared/stores/engineering-thread-snapshot-resolver.ts";
import { threadSnapshotDescendsFrom } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  canonicalModelicaQualifiedSourceCaptureText,
  type ModelicaQualifiedSourceCaptureDocument,
  type ModelicaQualifiedSourceRole,
  validateModelicaQualifiedSourceCaptureDocument,
} from "../../modelica/recorded/v2/qualified-source-capture.ts";
import {
  canonicalModelicaSimulationCaseQualificationCaptureText,
  decodeExactUtf8,
  type ModelicaQualificationCasReference,
  type ModelicaSimulationCaseQualificationCapture,
  validateModelicaSimulationCaseQualificationCapture,
} from "../../modelica/recorded/v2/simulation-case-qualification-capture.ts";

const MODELICA_OPERATION = SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION;
const CALCULIX_OPERATION = VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION;
const CALCULIX_LOCAL_OPERATION = VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION;
const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_CAS_URI =
  /^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/([a-f0-9]{64})$/;

/**
 * The reader receives the complete immutable Thread artifact identity.  An
 * implementation may route by URI, but cannot be asked for an unbound digest
 * or a caller-selected filesystem path.
 */
export interface RecordedPlanArtifactReader {
  read(artifact: Readonly<ThreadArtifact>): Promise<Uint8Array | undefined>;
}

export interface ResolvedOperationPlanResolverOptions {
  readonly snapshots: ExactThreadSnapshotReader;
  readonly artifacts: RecordedPlanArtifactReader;
  readonly stepAssets: CanonicalAssetReader;
  readonly calculix?: {
    readonly elementOrder?: 1 | 2;
    readonly timeoutMs?: number;
    /** Exact server-composed profile required to seal the provider-free @3 plan. */
    readonly localProfile?: CalculixIsolatedExecutionProfile;
  };
}

export class ResolvedOperationPlanResolver implements FeaIsolatedRunAdmissionReviewer {
  readonly #elementOrder: 1 | 2;
  readonly #calculixTimeoutMs: number;

  constructor(private readonly options: ResolvedOperationPlanResolverOptions) {
    this.#elementOrder = options.calculix?.elementOrder ?? 1;
    this.#calculixTimeoutMs = options.calculix?.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.#calculixTimeoutMs) || this.#calculixTimeoutMs < 1) {
      throw new TypeError("CalculiX recorded-plan timeout must be a positive integer.");
    }
  }

  async resolve(input: RegisteredRunPlanSealInput): Promise<ResolvedOperationPlanV2> {
    await assertQueuedCandidate(input);
    const operation = input.workItem.operation;
    if (!operation) {
      throw new TypeError("Recorded plan requires a registered operation.");
    }
    const basis = input.run.basis;
    if (!basis || basis.kind !== "thread-snapshot") {
      throw new TypeError("Recorded plan requires an exact ThreadSnapshot run basis.");
    }
    const resolved = await this.options.snapshots.get(basis.snapshotId);
    if (
      !resolved || resolved.id !== basis.snapshotId ||
      resolved.revision !== basis.revision ||
      resolved.subject.id !== basis.subjectId
    ) {
      throw new Error(
        "Recorded plan basis is absent or does not exactly match the queued run.",
      );
    }
    const snapshot = validateThreadSnapshot(resolved);
    const authorization = await authorizationFor(input);
    const common: PlanCommon = {
      schemaVersion: RESOLVED_OPERATION_PLAN_V2_SCHEMA,
      id: resolvedOperationPlanIdForRun(input.run.id),
      run: {
        projectId: input.project.project.id,
        runId: input.run.id,
        workItemId: input.workItem.id,
        inputFingerprint: requiredFingerprint(
          input.run.inputFingerprint,
          "run.inputFingerprint",
        ),
        queueBasisProject: {
          snapshotId: input.queueBasisProject.snapshotId,
          revision: input.queueBasisProject.revision,
          fingerprint: input.queueBasisProject.fingerprint,
        },
      },
      workItem: {
        id: input.workItem.id,
        operation: { id: operation.id, version: operation.version },
        operationFingerprint: await sha256Fingerprint(operation),
      },
      authorization,
      basis: {
        kind: "thread-snapshot",
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subject.id,
        fingerprint: await sha256Fingerprint(snapshot),
      },
    };
    if (sameOperation(operation.id, operation.version, MODELICA_OPERATION)) {
      return await this.#modelicaPlan(input, snapshot, common);
    }
    if (
      sameOperation(operation.id, operation.version, CALCULIX_OPERATION) ||
      sameOperation(operation.id, operation.version, CALCULIX_LOCAL_OPERATION)
    ) {
      return await this.#calculixPlan(input, snapshot, common);
    }
    throw new TypeError(
      "resolved-operation-plan/2.0 is not defined for this operation.",
    );
  }

  async #modelicaPlan(
    input: RegisteredRunPlanSealInput,
    snapshot: ThreadSnapshot,
    common: PlanCommon,
  ): Promise<ResolvedOperationPlanV2> {
    const bindings = exactBindings(input.workItem.operation!.bindings, [
      "simulationCase",
      "methodManifest",
    ], snapshot);
    const caseArtifact = bindings.simulationCase;
    const manifestArtifact = bindings.methodManifest;
    if (
      caseArtifact.kind !== "document" ||
      caseArtifact.mediaType !== "application/json" ||
      manifestArtifact.kind !== "document" ||
      manifestArtifact.mediaType !== "application/json"
    ) {
      throw new TypeError(
        "Modelica case and method bindings must be distinct JSON documents.",
      );
    }
    assertExactArtifactInputs(caseArtifact, [], "Modelica simulation case");
    const simulationCase = await this.#simulationCase(caseArtifact);
    if (
      simulationCase.project.id !== input.project.project.id ||
      simulationCase.project.subjectId !== snapshot.subject.id
    ) {
      throw new TypeError(
        "Simulation case does not bind the recorded-plan project subject.",
      );
    }
    await this.#assertCaseBasisIsAncestor(
      snapshot,
      simulationCase.project.baseThreadSnapshot,
      "Simulation case",
    );

    const manifestBytes = await this.#artifactBytes(manifestArtifact);
    const manifestText = decodeUtf8(manifestBytes, "Modelica qualified manifest");
    const manifest = await validateModelicaQualifiedManifestDocument(
      parseJson(manifestText, "Modelica qualified manifest"),
    );
    if (
      await canonicalModelicaQualifiedManifestDocumentText(manifest) !== manifestText
    ) {
      throw new TypeError(
        "Modelica qualified manifest CAS bytes are not canonical JSON.",
      );
    }
    assertManifestMatchesCase(manifest, simulationCase);
    const manifestResources: ModelicaBoundSource["entry"][] = [
      {
        bindingName: "modelSource",
        role: "model-source",
        captureRole: "model",
        resource: manifest.model,
      },
      {
        bindingName: "scenarioSource",
        role: "scenario-source",
        captureRole: "scenario",
        resource: manifest.scenario,
      },
    ];
    if (manifest.parameterSchema) {
      manifestResources.push({
        bindingName: "parameterSchema",
        role: "parameter-schema",
        captureRole: "parameter_schema",
        resource: manifest.parameterSchema,
      });
    }
    if (
      new Set(manifestArtifact.inputArtifactIds).size !== manifestResources.length ||
      manifestArtifact.inputArtifactIds.length !== manifestResources.length
    ) {
      throw new TypeError(
        "Modelica method manifest inputArtifactIds must be exactly its qualified source artifacts.",
      );
    }
    const sourceArtifacts = manifestResources.map((entry) => ({
      entry,
      artifact: exactManifestSourceArtifact(
        snapshot,
        manifestArtifact,
        entry.resource,
        entry.bindingName,
      ),
    }));
    if (
      sourceArtifacts.some(({ artifact }) =>
        !manifestArtifact.inputArtifactIds.includes(artifact.id)
      ) || new Set(sourceArtifacts.map(({ artifact }) => artifact.id)).size !==
        manifestResources.length
    ) {
      throw new TypeError(
        "Modelica method manifest does not bind each qualified source exactly once.",
      );
    }
    for (const { entry, artifact } of sourceArtifacts) {
      assertExactArtifactInputs(
        artifact,
        [],
        `Modelica ${entry.bindingName} source`,
      );
    }
    const qualification = await this.#qualificationAuthority(
      input,
      snapshot,
      caseArtifact,
      manifestArtifact,
      simulationCase,
      manifest,
      sourceArtifacts,
    );

    const sources: ResolvedOperationPlanSource[] = [
      await this.#artifactSource(
        snapshot,
        "simulationCase",
        "simulation-case",
        caseArtifact,
      ),
      await this.#artifactSource(
        snapshot,
        "methodManifest",
        "provider-manifest",
        manifestArtifact,
      ),
      sourceFromBytes(
        snapshot,
        "qualificationAuthority",
        "qualification-authority",
        qualification.artifact,
        qualification.bytes,
      ),
    ];
    for (const { entry, artifact } of sourceArtifacts) {
      const bytes = await this.#artifactBytes(artifact);
      assertResourceMatchesArtifact(entry.resource, artifact, bytes, entry.bindingName);
      sources.push(sourceFromBytes(
        snapshot,
        entry.bindingName,
        entry.role,
        artifact,
        bytes,
      ));
    }

    const requestId = await requestIdFor(input.run.id, "modelica");
    return {
      ...common,
      authorization: {
        ...common.authorization,
        methodQualification: {
          id: "qualified-modelica-resumable",
          version: "2.1",
          fingerprint: qualification.artifact.fingerprint,
        },
      },
      sources,
      action: {
        kind: "dynamic-system-simulation",
        provider: {
          id: "mcp-modelica",
          contract: { id: "resumable", version: "2.1" },
        },
        lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
        normalizer: {
          ...manifest.resultNormalizer,
          authority: "exact-provider-manifest",
        },
        requestId,
        input: {
          simulationCase: {
            id: simulationCase.id,
            fingerprint: caseArtifact.fingerprint,
            sourceBinding: "simulationCase",
          },
          providerManifestFingerprint: {
            algorithm: "sha256",
            digest: manifest.fingerprint,
          },
          methodManifestSourceBinding: "methodManifest",
          scenarioStartTimeSeconds: manifest.scenarioPublic.startTimeS,
          effectiveTimeoutMs: simulationCase.timeoutMs,
        },
      },
      expectedProviderResources: {
        ledgerSchema: "provider-resource-acquisition-ledger/1.0",
        captureManifestSchema: "provider-artifact-capture-manifest/1.0",
        resourceProfile: {
          id: MODELICA_RESUMABLE_RESOURCE_PROFILE.id,
          version: MODELICA_RESUMABLE_RESOURCE_PROFILE.version,
        },
        parameterSchema: manifest.parameterSchema ? "required" : "absent",
      },
      recovery: {
        policy: "mcp-modelica.resumable-recovery@2.1",
        requestId,
        mode: "same-request-readback-no-blind-redispatch",
        ambiguousOutcome: "quarantine-for-human-review",
        capturedOutcome: "cas-only-recovery",
      },
    };
  }

  async #calculixPlan(
    input: RegisteredRunPlanSealInput,
    snapshot: ThreadSnapshot,
    common: PlanCommon,
  ): Promise<ResolvedOperationPlanV2> {
    const local = sameOperation(
      input.workItem.operation!.id,
      input.workItem.operation!.version,
      CALCULIX_LOCAL_OPERATION,
    );
    const localProfile = this.options.calculix?.localProfile;
    if (local && localProfile === undefined) {
      throw new TypeError(
        "The local CalculiX operation requires an exact server-composed isolated profile.",
      );
    }
    const bindings = exactBindings(input.workItem.operation!.bindings, [
      "proofCase",
      "geometry",
    ], snapshot);
    const proofArtifact = bindings.proofCase;
    const geometry = bindings.geometry;
    if (
      proofArtifact.kind !== "document" ||
      proofArtifact.mediaType !== "application/json" ||
      geometry.kind !== "step" || geometry.mediaType !== "model/step"
    ) {
      throw new TypeError(
        isolatedCalculixBindingRejectionMessage({
          proofKind: proofArtifact.kind,
          proofMediaType: proofArtifact.mediaType,
          geometryKind: geometry.kind,
          geometryMediaType: geometry.mediaType,
        }),
      );
    }
    const admission = await this.reviewIsolatedCalculixAdmission({
      project: input.project,
      snapshot,
      proofArtifact,
      geometryArtifact: geometry,
    });
    const proof = proofCaptureView(admission.capture);
    const geometryCasUri = canonicalCalculixStepAssetCasUri(geometry);
    const stepBytes = admission.stepBytes;
    const requestId = await requestIdFor(input.run.id, "calculix");
    const commonPlan = {
      ...common,
      authorization: {
        ...common.authorization,
        methodQualification: local
          ? {
            id: "qualified-calculix-isolated-static-proof",
            version: "1.0",
            fingerprint: localProfile!.profileFingerprint,
          }
          : {
            id: "qualified-static-structural-proof-case",
            version: "1.0",
            fingerprint: proofArtifact.fingerprint,
          },
      },
      sources: [
        await this.#artifactSource(snapshot, "proofCase", "proof-case", proofArtifact),
        sourceFromBytes(
          snapshot,
          "geometry",
          "geometry-source",
          geometry,
          stepBytes,
          geometryCasUri,
        ),
      ],
    };
    const actionInput = {
      proofCase: {
        id: proof.case.id,
        fingerprint: proofArtifact.fingerprint,
        sourceBinding: "proofCase",
      },
      geometrySourceBinding: "geometry",
      effectiveElementOrder: this.#elementOrder,
      effectiveTimeoutMs: this.#calculixTimeoutMs,
    } as const;
    if (local) {
      return {
        ...commonPlan,
        action: {
          kind: "isolated-static-structural-analysis",
          executor: {
            id: "casys-local-microsandbox",
            contract: { id: "calculix-static-proof-v1", version: "1.0.0" },
            profileFingerprint: localProfile!.profileFingerprint,
          },
          lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
          requestId,
          input: actionInput,
        },
        expectedProviderResources: {
          receiptSchema: "isolated-code-execution-receipt-record/1.0",
          evidenceSchema: "calculix-isolated-static-evidence/1.0",
          resourceProfile: {
            id: CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.id,
            version: CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.version,
          },
        },
        recovery: {
          policy: "calculix-isolated-generation-recovery@1.0",
          requestId,
          mode: "same-request-readback-no-blind-redispatch",
          ambiguousOutcome: "quarantine-for-human-review",
          capturedOutcome: "cas-only-recovery",
        },
      };
    }
    return {
      ...commonPlan,
      action: {
        kind: "static-structural-analysis",
        provider: {
          id: "mcp-calculix",
          contract: { id: "calculix_solve_static_recorded", version: "1.0" },
          executionIdentitySchema: "1.0",
          runSchema: "2.0",
          resultSchema: "2.0",
        },
        lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
        requestId,
        input: actionInput,
      },
      expectedProviderResources: {
        ledgerSchema: "provider-resource-acquisition-ledger/1.0",
        captureManifestSchema: "provider-artifact-capture-manifest/1.0",
        resourceProfile: {
          id: CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.id,
          version: CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.version,
        },
      },
      recovery: {
        policy: "mcp-calculix.recorded-static-recovery@1.0",
        requestId,
        mode: "same-request-readback-no-blind-redispatch",
        ambiguousOutcome: "quarantine-for-human-review",
        capturedOutcome: "cas-only-recovery",
      },
    };
  }

  async reviewIsolatedCalculixAdmission(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly snapshot: ThreadSnapshot;
    readonly proofArtifact: ThreadArtifact;
    readonly geometryArtifact?: ThreadArtifact;
  }): Promise<FeaIsolatedRunAdmissionReview> {
    const snapshot = validateThreadSnapshot(input.snapshot);
    const proofArtifact = artifactById(snapshot, input.proofArtifact.id);
    if (!sameExactArtifactIdentity(proofArtifact, input.proofArtifact)) {
      throw new TypeError(
        "FEA proof binding is not the exact artifact identity on the reviewed basis.",
      );
    }
    if (
      proofArtifact.kind !== "document" ||
      proofArtifact.mediaType !== "application/json"
    ) {
      throw new TypeError(
        isolatedCalculixBindingRejectionMessage({
          proofKind: proofArtifact.kind,
          proofMediaType: proofArtifact.mediaType,
          geometryKind: "step",
          geometryMediaType: "model/step",
        }),
      );
    }
    const capture = await this.#proofCase(proofArtifact);
    const proof = proofCaptureView(capture);
    const capturedGeometry = exactProofInputArtifact(
      snapshot,
      proof.geometry,
      "geometry capture",
    );
    const capturedRequirements = exactProofInputArtifact(
      snapshot,
      proof.requirements,
      "requirements",
    );
    const stepArtifact = exactProofInputArtifact(
      snapshot,
      proof.step,
      "STEP",
    );
    assertExactArtifactInputs(
      proofArtifact,
      [capturedGeometry.id, capturedRequirements.id, stepArtifact.id],
      "FEA proof capture",
    );
    if (
      proof.case.project.id !== input.project.project.id ||
      proof.case.project.subjectId !== snapshot.subject.id
    ) {
      throw new TypeError(
        "FEA proof case does not bind the recorded-plan project subject.",
      );
    }
    await this.#assertCaseBasisIsAncestor(
      snapshot,
      proof.case.project.baseThreadSnapshot,
      "FEA proof case",
    );
    await assertFeaProofSealProjectHistory(
      input.project,
      snapshot,
      proof,
      proofArtifact,
      this.options.snapshots,
    );
    if (
      stepArtifact.kind !== "step" ||
      stepArtifact.mediaType !== "model/step" ||
      proof.step.bytes !== proof.case.expectedCadArtifact.bytes ||
      proof.case.expectedCadArtifact.sha256 !== stepArtifact.fingerprint.digest ||
      proof.trustedRunId !== proofArtifact.producer.runId ||
      proofArtifact.producer.serverId !== "digital-thread" ||
      proofArtifact.producer.tool !== "verify.seal-proof-case@1"
    ) {
      throw new TypeError(
        "FEA proof capture, producer and canonical STEP identity are not exact.",
      );
    }
    if (
      input.geometryArtifact &&
      !sameBoundStepArtifact(stepArtifact, input.geometryArtifact)
    ) {
      throw new TypeError(
        "FEA proof capture and geometry binding are not the same exact STEP artifact.",
      );
    }
    canonicalCalculixStepAssetCasUri(stepArtifact);
    const stepBytes = await this.options.stepAssets.read(
      stepArtifact.fingerprint.digest,
    );
    if (
      await fingerprintResourceBytes(stepBytes) !== stepArtifact.fingerprint.digest ||
      stepBytes.byteLength !== proof.step.bytes
    ) {
      throw new Error(
        "Canonical STEP asset does not match the proof capture byte identity.",
      );
    }
    return { capture, stepArtifact, stepBytes };
  }

  async #assertCaseBasisIsAncestor(
    basis: ThreadSnapshot,
    declared: {
      readonly id: string;
      readonly revision: number;
      readonly subjectId: string;
    },
    label: string,
  ): Promise<void> {
    if (
      basis.id === declared.id && basis.revision === declared.revision &&
      basis.subject.id === declared.subjectId
    ) return;
    const rawAncestor = await this.options.snapshots.get(declared.id);
    if (
      !rawAncestor || rawAncestor.id !== declared.id ||
      rawAncestor.revision !== declared.revision ||
      rawAncestor.subject.id !== declared.subjectId
    ) {
      throw new TypeError(`${label} declared base is not exactly available.`);
    }
    const ancestor = validateThreadSnapshot(rawAncestor);
    if (!await threadSnapshotDescendsFrom(basis, ancestor, this.options.snapshots)) {
      throw new TypeError(
        `${label} declared base is not an ancestor of the run basis.`,
      );
    }
  }

  async #artifactSource(
    snapshot: ThreadSnapshot,
    bindingName: string,
    role: string,
    artifact: ThreadArtifact,
  ): Promise<ResolvedOperationPlanSource> {
    return sourceFromBytes(
      snapshot,
      bindingName,
      role,
      artifact,
      await this.#artifactBytes(artifact),
    );
  }

  async #qualificationAuthority(
    input: RegisteredRunPlanSealInput,
    snapshot: ThreadSnapshot,
    caseArtifact: ThreadArtifact,
    manifestArtifact: ThreadArtifact,
    simulationCase: SimulationCaseV2,
    manifest: ModelicaQualifiedManifestDocument,
    sourceArtifacts: readonly ModelicaBoundSource[],
  ): Promise<{ readonly artifact: ThreadArtifact; readonly bytes: Uint8Array }> {
    const candidates = snapshot.artifacts.filter((artifact) =>
      artifact.id !== caseArtifact.id && artifact.id !== manifestArtifact.id &&
      artifact.kind === "evidence" &&
      artifact.mediaType === "application/json" &&
      artifact.producer.tool === "simulate.seal-simulation-case@2" &&
      artifact.inputArtifactIds.includes(caseArtifact.id) &&
      artifact.inputArtifactIds.includes(manifestArtifact.id)
    );
    if (candidates.length !== 1) {
      throw new TypeError(
        "Modelica plan requires one unique qualification authority derived from case and manifest.",
      );
    }
    const artifact = candidates[0];
    const bytes = await this.#artifactBytes(artifact);
    const authorityText = decodeExactUtf8(
      bytes,
      "Modelica qualification authority",
    );
    const authority = validateModelicaSimulationCaseQualificationCapture(
      parseJson(authorityText, "Modelica qualification authority"),
    );
    if (
      canonicalModelicaSimulationCaseQualificationCaptureText(authority) !==
        authorityText
    ) {
      throw new TypeError(
        "Modelica qualification authority CAS bytes are not canonical JSON.",
      );
    }
    const sourceIds = sourceArtifacts.map(({ artifact }) => artifact.id);
    const sourceCaptureIds = artifact.inputArtifactIds.filter((id) =>
      id !== caseArtifact.id && id !== manifestArtifact.id &&
      !sourceIds.includes(id)
    );
    if (sourceCaptureIds.length !== 1) {
      throw new TypeError(
        "Modelica qualification authority must name one exact source-capture input.",
      );
    }
    const sourceCapture = artifactById(snapshot, sourceCaptureIds[0]);
    assertExactArtifactInputs(
      artifact,
      [caseArtifact.id, manifestArtifact.id, sourceCapture.id, ...sourceIds],
      "Modelica qualification authority",
    );
    assertExactArtifactInputs(
      sourceCapture,
      sourceIds,
      "Modelica qualified source capture",
    );
    const sealArtifacts = [
      caseArtifact,
      manifestArtifact,
      sourceCapture,
      ...sourceArtifacts.map(({ artifact }) => artifact),
    ];
    if (sealArtifacts.some((candidate) => !sameProducer(candidate, artifact))) {
      throw new TypeError(
        "Modelica qualification evidence does not share one exact trusted seal producer.",
      );
    }
    const [caseBytes, manifestBytes, sourceCaptureBytes] = await Promise.all([
      this.#artifactBytes(caseArtifact),
      this.#artifactBytes(manifestArtifact),
      this.#artifactBytes(sourceCapture),
    ]);
    assertAuthorityRef(
      authority.simulationCase,
      caseArtifact,
      caseBytes.byteLength,
      "simulationCase",
    );
    assertAuthorityRef(
      authority.manifest,
      manifestArtifact,
      manifestBytes.byteLength,
      "manifest",
    );
    assertAuthorityRef(
      authority.sourceCapture,
      sourceCapture,
      sourceCaptureBytes.byteLength,
      "sourceCapture",
    );
    const captureText = decodeUtf8(
      sourceCaptureBytes,
      "Modelica qualified source capture",
    );
    const capture = validateModelicaQualifiedSourceCaptureDocument(
      parseJson(captureText, "Modelica qualified source capture"),
    );
    if (canonicalModelicaQualifiedSourceCaptureText(capture) !== captureText) {
      throw new TypeError(
        "Modelica qualified source-capture CAS bytes are not canonical JSON.",
      );
    }
    assertSourceCaptureMatchesManifest(capture, manifest, sourceArtifacts);
    assertAuthoritySources(authority, capture, sourceArtifacts);
    if (
      authority.caseDigest !== await fingerprintResourceBytes(caseBytes) ||
      authority.caseDigest !== caseArtifact.fingerprint.digest ||
      canonicalSimulationCaseV2Text(simulationCase) !==
        decodeUtf8(caseBytes, "simulation case artifact") ||
      authority.trustedRunId !== artifact.producer.runId
    ) {
      throw new TypeError(
        "Modelica qualification authority case or trusted seal-run identity diverges.",
      );
    }
    await this.#assertCaseBasisIsAncestor(
      snapshot,
      {
        id: authority.sealBasis.snapshotId,
        revision: authority.sealBasis.revision,
        subjectId: authority.sealBasis.subjectId,
      },
      "Modelica qualification authority",
    );
    await assertAuthorityProjectHistory(
      input,
      authority,
      snapshot,
      this.options.snapshots,
      [
        caseArtifact,
        manifestArtifact,
        sourceCapture,
        ...sourceArtifacts.map(({ artifact }) => artifact),
        artifact,
      ],
    );
    return { artifact, bytes };
  }

  async #artifactBytes(artifact: ThreadArtifact): Promise<Uint8Array> {
    canonicalArtifactUri(artifact);
    const bytes = await this.options.artifacts.read(Object.freeze({ ...artifact }));
    if (!bytes) {
      throw new Error(
        `Thread artifact ${artifact.id} is absent from its exact CAS URI.`,
      );
    }
    const copy = Uint8Array.from(bytes);
    const actual = await fingerprintResourceBytes(copy);
    if (actual !== artifact.fingerprint.digest) {
      throw new Error(
        `Thread artifact ${artifact.id} raw CAS bytes do not match its fingerprint.`,
      );
    }
    return copy;
  }

  async #simulationCase(artifact: ThreadArtifact): Promise<SimulationCaseV2> {
    const bytes = await this.#artifactBytes(artifact);
    const caseText = decodeUtf8(bytes, "simulation case artifact");
    const simulationCase = validateSimulationCaseV2(
      parseJson(caseText, "canonical simulation case"),
    );
    if (canonicalSimulationCaseV2Text(simulationCase) !== caseText) {
      throw new TypeError(
        "Simulation case artifact does not contain canonical case bytes.",
      );
    }
    return simulationCase;
  }

  async #proofCase(artifact: ThreadArtifact): Promise<FeaProofCaseCapture> {
    const bytes = await this.#artifactBytes(artifact);
    const fullText = decodeUtf8(bytes, "FEA proof capture");
    return await parseFeaProofCaseCapture(fullText);
  }
}

type PlanCommon = Omit<
  ResolvedOperationPlanV2,
  "sources" | "action" | "expectedProviderResources" | "recovery"
>;
interface ProofCapture {
  readonly case: MechanicalProofCase;
  readonly trustedRunId: string;
  readonly sealedAt: string;
  readonly geometry: ProofArtifactRef;
  readonly requirements: ProofArtifactRef;
  readonly step: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
    readonly bytes: number;
  };
}

function proofCaptureView(capture: FeaProofCaseCapture): ProofCapture {
  return {
    case: capture.proofCase,
    trustedRunId: capture.trustedRunId,
    sealedAt: capture.sealedAt,
    geometry: capture.geometryArtifact,
    requirements: capture.requirementsArtifact,
    step: capture.stepArtifact,
  };
}
interface ProofArtifactRef {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}
interface ModelicaBoundSource {
  readonly entry: {
    readonly bindingName: string;
    readonly role: string;
    readonly captureRole: ModelicaQualifiedSourceRole;
    readonly resource: ModelicaResumableResource;
  };
  readonly artifact: ThreadArtifact;
}

function exactProofInputArtifact(
  snapshot: ThreadSnapshot,
  reference: ProofArtifactRef,
  label: string,
): ThreadArtifact {
  const artifact = artifactById(snapshot, reference.id);
  if (
    !fingerprintsEqual(artifact.fingerprint, reference.fingerprint) ||
    artifact.producer.runId !== reference.producerRunId
  ) {
    throw new TypeError(
      `FEA proof capture ${label} does not name its exact Thread artifact.`,
    );
  }
  return artifact;
}

function assertAuthorityRef(
  reference: ModelicaQualificationCasReference,
  artifact: ThreadArtifact,
  byteCount: number,
  label: string,
): void {
  if (
    reference.sha256 !== artifact.fingerprint.digest ||
    reference.uri !== canonicalArtifactUri(artifact) ||
    reference.byteCount !== byteCount
  ) {
    throw new TypeError(
      `Modelica qualification authority ${label} does not name the exact Thread CAS artifact.`,
    );
  }
}

function assertSourceCaptureMatchesManifest(
  capture: ModelicaQualifiedSourceCaptureDocument,
  manifest: ModelicaQualifiedManifestDocument,
  sources: readonly ModelicaBoundSource[],
): void {
  if (
    deterministicJson(capture.selection) !==
      deterministicJson(manifest.selection) ||
    capture.manifestFingerprint !== manifest.fingerprint ||
    capture.artifacts.length !== sources.length
  ) {
    throw new TypeError(
      "Modelica source capture does not bind the exact qualified manifest.",
    );
  }
  for (const source of sources) {
    const matches = capture.artifacts.filter((entry) =>
      entry.role === source.entry.captureRole
    );
    if (matches.length !== 1) {
      throw new TypeError(
        `Modelica source capture does not uniquely bind ${source.entry.captureRole}.`,
      );
    }
    const captured = matches[0];
    const expectedResource = {
      uri: source.entry.resource.uri,
      mediaType: source.entry.resource.mediaType,
      byteCount: source.entry.resource.byteCount,
      sha256: source.entry.resource.sha256,
    };
    if (
      deterministicJson(captured.resource) !== deterministicJson(expectedResource) ||
      captured.cas.uri !== canonicalArtifactUri(source.artifact) ||
      captured.cas.sha256 !== source.artifact.fingerprint.digest ||
      captured.cas.byteCount !== source.entry.resource.byteCount
    ) {
      throw new TypeError(
        `Modelica source capture ${source.entry.captureRole} tuple diverges from its manifest and Thread CAS artifact.`,
      );
    }
  }
}

function assertAuthoritySources(
  authority: ModelicaSimulationCaseQualificationCapture,
  capture: ModelicaQualifiedSourceCaptureDocument,
  sources: readonly ModelicaBoundSource[],
): void {
  if (
    authority.sources.length !== sources.length ||
    capture.artifacts.length !== sources.length
  ) {
    throw new TypeError(
      "Modelica qualification authority sources are not the closed capture profile.",
    );
  }
  for (const source of sources) {
    const authorityMatches = authority.sources.filter((entry) =>
      entry.role === source.entry.captureRole
    );
    const captureMatches = capture.artifacts.filter((entry) =>
      entry.role === source.entry.captureRole
    );
    if (authorityMatches.length !== 1 || captureMatches.length !== 1) {
      throw new TypeError(
        `Modelica qualification authority does not uniquely bind ${source.entry.captureRole}.`,
      );
    }
    const authoritySource = authorityMatches[0];
    const captured = captureMatches[0];
    if (
      authoritySource.mediaType !== captured.resource.mediaType ||
      authoritySource.resourceUri !== captured.resource.uri
    ) {
      throw new TypeError(
        `Modelica qualification authority ${source.entry.captureRole} metadata diverges from its source capture.`,
      );
    }
    assertAuthorityRef(
      authoritySource.cas,
      source.artifact,
      captured.cas.byteCount,
      `sources.${source.entry.captureRole}`,
    );
  }
}

function assertExactArtifactInputs(
  artifact: ThreadArtifact,
  expectedIds: readonly string[],
  label: string,
): void {
  const actual = artifact.inputArtifactIds;
  if (
    new Set(actual).size !== actual.length ||
    new Set(expectedIds).size !== expectedIds.length ||
    actual.length !== expectedIds.length ||
    expectedIds.some((id) => !actual.includes(id))
  ) {
    throw new TypeError(`${label} inputArtifactIds are not exact.`);
  }
}

function sameProducer(left: ThreadArtifact, right: ThreadArtifact): boolean {
  return left.producer.serverId === right.producer.serverId &&
    left.producer.tool === right.producer.tool &&
    left.producer.runId === right.producer.runId;
}

async function assertAuthorityProjectHistory(
  input: RegisteredRunPlanSealInput,
  authority: ModelicaSimulationCaseQualificationCapture,
  currentBasis: ThreadSnapshot,
  snapshots: ExactThreadSnapshotReader,
  requiredSealArtifacts: readonly ThreadArtifact[],
): Promise<void> {
  const workItem = input.project.workItems.find((item) =>
    item.id === authority.mrtr.workItemId
  );
  const run = input.project.agentRuns.find((item) =>
    item.id === authority.trustedRunId
  );
  if (
    !workItem || workItem.operation?.id !== "simulate.seal-simulation-case" ||
    workItem.operation.version !== "2" ||
    deterministicJson(workItem.operation.bindings) !==
      deterministicJson([{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }]) ||
    !workItem.decisionIds.includes(authority.mrtr.decisionId) ||
    !run || run.workItemId !== workItem.id || run.status !== "completed" ||
    !run.resultSnapshot || run.evidenceRefs.length === 0 ||
    run.basis?.kind !== "thread-snapshot" ||
    !sameDeclaredBasis(run.basis, authority.sealBasis) ||
    run.startedAt !== authority.sealedAt
  ) {
    throw new TypeError(
      "Modelica qualification authority is not backed by its completed registered @2 seal run.",
    );
  }
  const resultReference = run.resultSnapshot;
  const rawResult = await snapshots.get(resultReference.snapshotId);
  if (
    !rawResult || rawResult.id !== resultReference.snapshotId ||
    rawResult.revision !== resultReference.revision ||
    rawResult.subject.id !== resultReference.subjectId
  ) {
    throw new TypeError(
      "Modelica qualification authority completed seal result snapshot is absent or does not exactly match its reference.",
    );
  }
  const sealResult = validateThreadSnapshot(rawResult);
  const rawSealBasis = await snapshots.get(authority.sealBasis.snapshotId);
  if (
    !rawSealBasis || rawSealBasis.id !== authority.sealBasis.snapshotId ||
    rawSealBasis.revision !== authority.sealBasis.revision ||
    rawSealBasis.subject.id !== authority.sealBasis.subjectId
  ) {
    throw new TypeError(
      "Modelica qualification authority seal basis is absent or does not exactly match its reference.",
    );
  }
  const sealBasis = validateThreadSnapshot(rawSealBasis);
  if (
    sealResult.revision !== sealBasis.revision + 1 ||
    sealResult.previous?.snapshotId !== sealBasis.id ||
    sealResult.previous.revision !== sealBasis.revision ||
    !await threadSnapshotDescendsFrom(sealResult, sealBasis, snapshots)
  ) {
    throw new TypeError(
      "Modelica qualification authority completed seal result is not the direct immutable child of its exact seal basis.",
    );
  }
  assertSnapshotPreservesExactArtifacts(
    sealResult,
    requiredSealArtifacts,
    "completed seal result snapshot",
  );
  const producedBySeal = sealResult.artifacts.filter((artifact) =>
    isExactSealArtifact(artifact, run.id)
  );
  if (producedBySeal.length !== requiredSealArtifacts.length) {
    throw new TypeError(
      "Modelica qualification authority completed seal result does not contain exactly its authority, case, manifest, source capture and qualified sources.",
    );
  }
  assertExactSealEvidenceRefs(run.evidenceRefs, resultReference, producedBySeal);
  if (!await threadSnapshotDescendsFrom(currentBasis, sealResult, snapshots)) {
    throw new TypeError(
      "Modelica qualification authority current run basis does not descend from its completed seal result snapshot.",
    );
  }
  assertSnapshotPreservesExactArtifacts(
    currentBasis,
    producedBySeal,
    "current recorded-plan basis",
  );
  const decision = input.project.decisions.find((item) =>
    item.id === authority.mrtr.decisionId
  );
  const approval = input.project.approvals.find((item) =>
    item.id === authority.mrtr.approvalId
  );
  if (
    !decision || decision.status !== "approved" || !decision.inputFingerprint ||
    decision.inputFingerprint.algorithm !== "sha256" ||
    decision.inputFingerprint.digest !== authority.mrtr.inputFingerprint ||
    !sameDeclaredBasis(decision.baseSnapshot, authority.sealBasis) ||
    !decision.approvalIds.includes(authority.mrtr.approvalId) ||
    !decision.proposal ||
    !approval || approval.status !== "approved" ||
    approval.decisionId !== decision.id ||
    approval.decidedByOrigin !== "human" ||
    !approval.inputFingerprint ||
    approval.inputFingerprint.algorithm !== "sha256" ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) ||
    !sameDeclaredBasis(approval.baseSnapshot, authority.sealBasis) ||
    !sameEvidence(decision, approval.inputEvidenceRefs) ||
    (await sha256Fingerprint(approval)).digest !==
      authority.mrtr.approvalFingerprint ||
    !fingerprintsEqual(
      await sha256Fingerprint({
        baseSnapshot: decision.baseSnapshot,
        inputEvidenceRefs: decision.inputEvidenceRefs,
        proposal: {
          summary: decision.proposal.summary,
          parameters: decision.proposal.parameters,
        },
      }),
      decision.inputFingerprint,
    )
  ) {
    throw new TypeError(
      "Modelica qualification authority MRTR does not match the immutable project history.",
    );
  }
}

/**
 * Resolve the distinct human authority that produced a sealed FEA proof before
 * a later ROP2 run may bind it.  The run's own MRTR was already selected by
 * authorizationFor(); this history check deliberately never compares those
 * two decision or work-item IDs.
 */
async function assertFeaProofSealProjectHistory(
  project: EngineeringProjectSnapshot,
  currentBasis: ThreadSnapshot,
  proof: ProofCapture,
  proofArtifact: ThreadArtifact,
  snapshots: ExactThreadSnapshotReader,
): Promise<void> {
  const workItem = project.workItems.find((item) =>
    item.id === proof.case.authorization.workItemId
  );
  const run = project.agentRuns.find((item) => item.id === proof.trustedRunId);
  const decision = project.decisions.find((item) =>
    item.id === proof.case.authorization.decisionId
  );
  if (
    !workItem ||
    workItem.operation?.id !== VERIFY_SEAL_PROOF_CASE_OPERATION.id ||
    workItem.operation.version !== VERIFY_SEAL_PROOF_CASE_OPERATION.version ||
    deterministicJson(workItem.operation.bindings) !== deterministicJson([{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }]) ||
    !workItem.decisionIds.includes(proof.case.authorization.decisionId) ||
    !run ||
    run.workItemId !== workItem.id ||
    run.status !== "completed" ||
    !run.resultSnapshot ||
    run.evidenceRefs.length === 0 ||
    run.basis?.kind !== "thread-snapshot" ||
    run.startedAt !== proof.sealedAt ||
    !decision ||
    decision.status !== "approved" ||
    !decision.proposal ||
    !decision.inputFingerprint ||
    !sameDeclaredBasis(decision.baseSnapshot, run.basis)
  ) {
    throw new TypeError(
      "FEA proof authority is not backed by its completed registered verify.seal-proof-case@1 run.",
    );
  }
  const approval = await exactHumanApproval(project, decision, run.basis);
  if (!approval) {
    throw new TypeError(
      "FEA proof authority does not retain one exact human MRTR approval.",
    );
  }
  await assertFeaSealRunInputFingerprint(project, run, workItem);
  await assertFeaSealDecisionMatchesProof(decision, proof);

  const resultReference = run.resultSnapshot;
  const rawResult = await snapshots.get(resultReference.snapshotId);
  const rawBasis = await snapshots.get(run.basis.snapshotId);
  if (
    !rawResult ||
    rawResult.id !== resultReference.snapshotId ||
    rawResult.revision !== resultReference.revision ||
    rawResult.subject.id !== resultReference.subjectId ||
    !rawBasis ||
    rawBasis.id !== run.basis.snapshotId ||
    rawBasis.revision !== run.basis.revision ||
    rawBasis.subject.id !== run.basis.subjectId
  ) {
    throw new TypeError(
      "FEA proof authority completed seal result or exact seal basis is absent.",
    );
  }
  const sealResult = validateThreadSnapshot(rawResult);
  const sealBasis = validateThreadSnapshot(rawBasis);
  if (
    sealResult.revision !== sealBasis.revision + 1 ||
    sealResult.previous?.snapshotId !== sealBasis.id ||
    sealResult.previous.revision !== sealBasis.revision ||
    !await threadSnapshotDescendsFrom(sealResult, sealBasis, snapshots)
  ) {
    throw new TypeError(
      "FEA proof authority completed seal result is not the direct immutable child of its exact seal basis.",
    );
  }
  const sealedArtifact = artifactById(sealResult, proofArtifact.id);
  if (
    !sameExactArtifactIdentity(sealedArtifact, proofArtifact) ||
    !isExactFeaSealArtifact(sealedArtifact, run.id) ||
    !exactArtifactEvidence(run.evidenceRefs, resultReference, proofArtifact.id) ||
    !await threadSnapshotDescendsFrom(currentBasis, sealResult, snapshots)
  ) {
    throw new TypeError(
      "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
    );
  }
}

async function exactHumanApproval(
  project: EngineeringProjectSnapshot,
  decision: EngineeringDecision,
  basis: EngineeringThreadSnapshotBasis,
): Promise<EngineeringApproval | undefined> {
  const candidates = project.approvals.filter((approval) =>
    approval.decisionId === decision.id &&
    approval.status === "approved" &&
    approval.decidedByOrigin === "human" &&
    sameDeclaredBasis(approval.baseSnapshot, basis) &&
    sameEvidence(decision, approval.inputEvidenceRefs) &&
    fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  );
  const approval = candidates.length === 1 ? candidates[0] : undefined;
  if (!approval || !decision.approvalIds.includes(approval.id)) return undefined;
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal!.summary,
      parameters: decision.proposal!.parameters,
    },
  });
  return fingerprintsEqual(expectedDecisionFingerprint, decision.inputFingerprint)
    ? approval
    : undefined;
}

async function assertFeaSealRunInputFingerprint(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem,
): Promise<void> {
  if (!run.inputFingerprint || run.basis?.kind !== "thread-snapshot") {
    throw new TypeError(
      "FEA proof authority completed seal run has no exact queue fingerprint and basis.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((decisionId) => {
    const decision = project.decisions.find((candidate) => candidate.id === decisionId);
    if (!decision?.inputFingerprint || decision.status !== "approved") {
      throw new TypeError(
        "FEA proof authority seal work item has a decision that is not exactly approved.",
      );
    }
    return { id: decision.id, inputFingerprint: decision.inputFingerprint };
  });
  const expected = await sha256Fingerprint({
    workItemId: workItem.id,
    basis: run.basis,
    operation: {
      id: workItem.operation!.id,
      version: workItem.operation!.version,
      bindings: workItem.operation!.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expected)) {
    throw new TypeError(
      "FEA proof authority completed seal run input fingerprint is not exact.",
    );
  }
}

async function assertFeaSealDecisionMatchesProof(
  decision: EngineeringDecision,
  proof: ProofCapture,
): Promise<void> {
  try {
    const parameters = parseFeaProofDecisionParameters(
      feaProofDecisionParametersToMap(decision.proposal!.parameters),
    );
    verifyFeaProofParametersMatchCase(parameters, proof.case);
    const digest = (await sha256Fingerprint(proof.case)).digest;
    if (
      parameters.proofDigest !== digest ||
      parameters.geometryArtifact.id !== proof.geometry.id ||
      !fingerprintsEqual(
        parameters.geometryArtifact.fingerprint,
        proof.geometry.fingerprint,
      ) ||
      parameters.requirementsArtifact.id !== proof.requirements.id ||
      !fingerprintsEqual(
        parameters.requirementsArtifact.fingerprint,
        proof.requirements.fingerprint,
      )
    ) {
      throw new Error("sealed declaration or source artifact identity diverges");
    }
  } catch (cause) {
    throw new TypeError(
      `FEA proof authority MRTR does not match the sealed proof: ${
        cause instanceof Error ? cause.message : String(cause)
      }.`,
    );
  }
}

function isExactFeaSealArtifact(artifact: ThreadArtifact, runId: string): boolean {
  return artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === "verify.seal-proof-case@1" &&
    artifact.producer.runId === runId;
}

function exactArtifactEvidence(
  evidenceRefs: readonly EngineeringThreadEntityRef[],
  result: { readonly snapshotId: string; readonly revision: number },
  artifactId: string,
): boolean {
  return evidenceRefs.length === 1 &&
    evidenceRefs[0]?.snapshotId === result.snapshotId &&
    evidenceRefs[0]?.snapshotRevision === result.revision &&
    evidenceRefs[0]?.kind === "artifact" && evidenceRefs[0]?.id === artifactId;
}

function isExactSealArtifact(artifact: ThreadArtifact, runId: string): boolean {
  return artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === "simulate.seal-simulation-case@2" &&
    artifact.producer.runId === runId;
}

function assertSnapshotPreservesExactArtifacts(
  snapshot: ThreadSnapshot,
  expectedArtifacts: readonly ThreadArtifact[],
  label: string,
): void {
  for (const expected of expectedArtifacts) {
    const matches = snapshot.artifacts.filter((artifact) =>
      artifact.id === expected.id
    );
    if (
      matches.length !== 1 ||
      !sameExactArtifactIdentity(matches[0], expected)
    ) {
      throw new TypeError(
        `Modelica qualification authority ${label} does not retain exact seal artifact ${expected.id}.`,
      );
    }
  }
}

function sameExactArtifactIdentity(
  left: ThreadArtifact,
  right: ThreadArtifact,
): boolean {
  try {
    return left.id === right.id &&
      fingerprintsEqual(left.fingerprint, right.fingerprint) &&
      canonicalArtifactUri(left) === canonicalArtifactUri(right) &&
      sameProducer(left, right);
  } catch {
    return false;
  }
}

/**
 * Compare a public STEP binding without interpreting its route as a CAS URI.
 *
 * STEP routes are validated separately by canonicalCalculixStepAssetCasUri.
 */
function sameBoundStepArtifact(
  left: ThreadArtifact,
  right: ThreadArtifact,
): boolean {
  return left.id === right.id &&
    left.kind === right.kind &&
    left.mediaType === right.mediaType &&
    left.uri === right.uri &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    sameProducer(left, right);
}

function assertExactSealEvidenceRefs(
  evidenceRefs: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
  resultSnapshot: {
    readonly snapshotId: string;
    readonly revision: number;
  },
  producedArtifacts: readonly ThreadArtifact[],
): void {
  const expectedIds = new Set(producedArtifacts.map((artifact) => artifact.id));
  const seen = new Set<string>();
  for (const reference of evidenceRefs) {
    if (
      reference.snapshotId !== resultSnapshot.snapshotId ||
      reference.snapshotRevision !== resultSnapshot.revision ||
      reference.kind !== "artifact" || !expectedIds.has(reference.id) ||
      seen.has(reference.id)
    ) {
      throw new TypeError(
        "Modelica qualification authority completed seal run evidenceRefs do not exactly cover its result artifacts.",
      );
    }
    seen.add(reference.id);
  }
  if (seen.size !== expectedIds.size) {
    throw new TypeError(
      "Modelica qualification authority completed seal run evidenceRefs do not exactly cover its result artifacts.",
    );
  }
}

function assertManifestMatchesCase(
  manifest: ModelicaQualifiedManifestDocument,
  simulationCase: SimulationCaseV2,
): void {
  if (
    manifest.selection.modelId !== simulationCase.kit.modelId ||
    manifest.selection.modelVersion !== simulationCase.kit.modelVersion ||
    manifest.selection.scenarioId !== simulationCase.scenario.id ||
    manifest.model.sha256 !== simulationCase.kit.modelSha256 ||
    manifest.scenario.sha256 !== simulationCase.scenario.sourceSha256 ||
    manifest.scenarioProjectionSha256 !== simulationCase.scenario.projectionSha256
  ) {
    throw new TypeError(
      "Modelica qualified manifest diverges from the sealed simulation case.",
    );
  }
  if (
    manifest.lowering.id !== "modelica-omc-lowering" ||
    manifest.lowering.version !== "1.0.0"
  ) {
    throw new TypeError(
      "Modelica qualified manifest does not declare the code-owned lowering.",
    );
  }
  const parameters = new Map(
    manifest.parameters.map((parameter) => [parameter.id, parameter]),
  );
  if (
    parameters.size !== simulationCase.parameters.length ||
    simulationCase.parameters.some((parameter) => {
      const qualified = parameters.get(parameter.id);
      return !qualified || qualified.unit !== parameter.unit ||
        parameter.value < qualified.minimum || parameter.value > qualified.maximum;
    })
  ) {
    throw new TypeError(
      "Simulation case parameters do not exactly fit the qualified manifest.",
    );
  }
  const metrics = new Map(
    manifest.producedMetrics.map((metric) => [metric.id, metric]),
  );
  if (
    metrics.size !== simulationCase.expectedMetrics.length ||
    simulationCase.expectedMetrics.some((metric) =>
      metrics.get(metric.id)?.unit !== metric.unit
    )
  ) {
    throw new TypeError(
      "Simulation case metrics do not exactly match the qualified manifest.",
    );
  }
  if (
    !Number.isSafeInteger(simulationCase.timeoutMs) || simulationCase.timeoutMs < 1 ||
    simulationCase.timeoutMs > 120_000 || manifest.scenarioPublic.startTimeS < 0 ||
    manifest.scenarioPublic.stopTimeS <= manifest.scenarioPublic.startTimeS ||
    !manifest.resultNormalizer.id || !manifest.resultNormalizer.version
  ) {
    throw new TypeError(
      "Modelica timeout, time bounds, or normalizer identity is invalid.",
    );
  }
}

function exactManifestSourceArtifact(
  snapshot: ThreadSnapshot,
  manifestArtifact: ThreadArtifact,
  resource: ModelicaResumableResource,
  label: string,
): ThreadArtifact {
  const candidates = manifestArtifact.inputArtifactIds
    .map((id) => artifactById(snapshot, id))
    .filter((artifact) => artifact.fingerprint.digest === resource.sha256);
  if (candidates.length !== 1) {
    throw new TypeError(`Modelica manifest does not thread-bind one exact ${label}.`);
  }
  return candidates[0];
}

function assertResourceMatchesArtifact(
  resource: ModelicaResumableResource,
  artifact: ThreadArtifact,
  bytes: Uint8Array,
  label: string,
): void {
  const expectedKind = label === "modelSource" ? "simulation-model" : "document";
  if (
    resource.sha256 !== artifact.fingerprint.digest ||
    resource.byteCount !== bytes.byteLength ||
    resource.mediaType !== artifact.mediaType ||
    artifact.kind !== expectedKind ||
    (label === "parameterSchema"
      ? resource.qualification !== "compiler-derived-verified"
      : resource.qualification !== "qualified-kit")
  ) {
    throw new TypeError(
      `Modelica ${label} resource tuple diverges from its Thread CAS artifact.`,
    );
  }
}

function sourceFromBytes(
  snapshot: ThreadSnapshot,
  bindingName: string,
  role: string,
  artifact: ThreadArtifact,
  bytes: Uint8Array,
  sealedCasUri?: string,
): ResolvedOperationPlanSource {
  const uri = sealedCasUri ?? canonicalArtifactUri(artifact);
  if (bytes.byteLength < 1) {
    throw new TypeError(`Thread artifact ${artifact.id} is empty.`);
  }
  return {
    bindingName,
    role,
    threadRef: {
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    },
    artifact: {
      fingerprint: artifact.fingerprint,
      byteCount: bytes.byteLength,
      mediaType: requiredMediaType(artifact.mediaType, artifact.id),
      casUri: uri,
    },
  };
}

function canonicalArtifactUri(artifact: ThreadArtifact): string {
  if (!artifact.uri) {
    throw new TypeError(`Thread artifact ${artifact.id} has no CAS URI.`);
  }
  const match = CANONICAL_CAS_URI.exec(artifact.uri);
  if (!match || match[1] !== artifact.fingerprint.digest) {
    throw new TypeError(
      `Thread artifact ${artifact.id} URI is not its exact canonical casys SHA-256 URI.`,
    );
  }
  return artifact.uri;
}

async function assertQueuedCandidate(
  input: RegisteredRunPlanSealInput,
): Promise<void> {
  const operation = input.workItem.operation;
  const basis = input.run.basis;
  const workItems = input.project.workItems.filter((item) =>
    item.id === input.workItem.id
  );
  if (
    !operation || workItems.length !== 1 ||
    deterministicJson(workItems[0]) !== deterministicJson(input.workItem) ||
    input.workItem.status !== "ready" || input.run.status !== "queued" ||
    input.run.workItemId !== input.workItem.id ||
    input.run.resolvedOperationPlan !== undefined ||
    input.project.agentRuns.some((run) => run.id === input.run.id) ||
    !basis || basis.kind !== "thread-snapshot"
  ) {
    throw new TypeError(
      "Recorded plan candidate is not the exact pre-commit queued run and registered work item.",
    );
  }
  if (
    input.queueBasisProject.snapshotId !== input.project.id ||
    input.queueBasisProject.revision !== input.project.revision ||
    !fingerprintsEqual(
      input.queueBasisProject.fingerprint,
      await sha256Fingerprint(input.project),
    )
  ) {
    throw new TypeError(
      "Recorded plan queue basis is not the exact immutable project revision.",
    );
  }
  const approvedDecisions = input.workItem.decisionIds.map((id) => {
    const matches = input.project.decisions.filter((decision) => decision.id === id);
    const decision = matches[0];
    if (
      matches.length !== 1 || !decision || decision.status !== "approved" ||
      !decision.inputFingerprint
    ) {
      throw new TypeError(
        "Recorded plan work-item decisions are not uniquely approved.",
      );
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: input.workItem.id,
    basis,
    operation: {
      id: operation.id,
      version: operation.version,
      bindings: operation.bindings,
    },
    approvedDecisions,
  });
  if (
    !input.run.inputFingerprint ||
    !fingerprintsEqual(input.run.inputFingerprint, expectedRunFingerprint)
  ) {
    throw new TypeError(
      "Recorded plan run input fingerprint does not seal its exact work item, operation, basis, and approved decisions.",
    );
  }
}

async function authorizationFor(input: RegisteredRunPlanSealInput) {
  if (input.workItem.decisionIds.length !== 1) {
    throw new TypeError("Recorded plan requires exactly one direct MRTR decision.");
  }
  const decisions = input.project.decisions.filter((item) =>
    item.id === input.workItem.decisionIds[0]
  );
  const decision = decisions[0];
  if (
    decisions.length !== 1 || !decision || decision.status !== "approved" ||
    !decision.inputFingerprint ||
    decision.approvalIds.length === 0
  ) {
    throw new TypeError("Recorded plan requires a directly approved MRTR decision.");
  }
  const approvals = input.project.approvals.filter((item) =>
    item.id === decision.approvalIds.at(-1)
  );
  const approval = approvals[0];
  if (
    approvals.length !== 1 || !approval || approval.status !== "approved" ||
    approval.decidedByOrigin !== "human" ||
    approval.decisionId !== decision.id || !approval.inputFingerprint ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) ||
    !sameSnapshot(decision.baseSnapshot, input.run.basis) ||
    !sameSnapshot(approval.baseSnapshot, input.run.basis) ||
    !sameEvidence(decision, approval.inputEvidenceRefs)
  ) {
    throw new TypeError(
      "Recorded plan MRTR approval does not attest the exact decision evidence.",
    );
  }
  const method = sameOperation(
      input.workItem.operation!.id,
      input.workItem.operation!.version,
      MODELICA_OPERATION,
    )
    ? { id: "qualified-modelica-resumable", version: "2.1" }
    : { id: "qualified-static-structural-proof-case", version: "1.0" };
  return {
    kind: "human-mrtr-and-qualified-method" as const,
    mrtr: {
      decisionId: decision.id,
      decisionInputFingerprint: decision.inputFingerprint,
      approvalId: approval.id,
      approvalFingerprint: await sha256Fingerprint(approval),
    },
    methodQualification: {
      ...method,
      fingerprint: await sha256Fingerprint(method),
    },
  };
}

function exactBindings(
  bindings: readonly EngineeringOperationInputBinding[],
  names: readonly string[],
  snapshot: ThreadSnapshot,
): Record<string, ThreadArtifact> {
  if (
    bindings.length !== names.length ||
    new Set(bindings.map((binding) => binding.name)).size !== names.length
  ) {
    throw new TypeError(
      "Recorded operation must declare exactly its closed Thread artifact bindings.",
    );
  }
  const result: Record<string, ThreadArtifact> = {};
  for (const name of names) {
    const binding = bindings.find((candidate) => candidate.name === name);
    if (
      !binding || binding.source.kind !== "thread-entity" ||
      binding.source.reference.kind !== "artifact" ||
      binding.source.reference.snapshotId !== snapshot.id ||
      binding.source.reference.snapshotRevision !== snapshot.revision
    ) {
      throw new TypeError(
        `Recorded operation binding ${name} is not an exact artifact on its basis.`,
      );
    }
    result[name] = artifactById(snapshot, binding.source.reference.id);
  }
  return result;
}

function artifactById(snapshot: ThreadSnapshot, id: string): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === id);
  if (matches.length !== 1) {
    throw new TypeError(
      `Thread artifact ${id} is not uniquely present in the exact basis.`,
    );
  }
  return matches[0];
}

async function requestIdFor(runId: string, provider: string): Promise<string> {
  const digest = (await sha256Fingerprint({
    schema: "resolved-operation-plan/2.0",
    provider,
    runId,
  })).digest;
  return `rop2-${provider}-${digest.slice(0, 32)}`;
}

function sameOperation(
  id: string,
  version: string,
  expected: { readonly id: string; readonly version: string },
): boolean {
  return id === expected.id && version === expected.version;
}

function requiredFingerprint(
  value: ContentFingerprint | undefined,
  path: string,
): ContentFingerprint {
  if (!value || value.algorithm !== "sha256" || !SHA256.test(value.digest)) {
    throw new TypeError(`${path} must be a SHA-256 fingerprint.`);
  }
  return value;
}

function sameEvidence(
  decision: EngineeringDecision,
  approvalEvidence: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
): boolean {
  const key = (
    value: { snapshotId: string; snapshotRevision: number; kind: string; id: string },
  ) =>
    `${value.snapshotId}\u0000${value.snapshotRevision}\u0000${value.kind}\u0000${value.id}`;
  return decision.inputEvidenceRefs.length === approvalEvidence.length &&
    decision.inputEvidenceRefs.every((reference) =>
      approvalEvidence.some((candidate) => key(candidate) === key(reference))
    );
}

function sameSnapshot(
  value:
    | {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    }
    | undefined,
  basis: unknown,
): boolean {
  if (!value || !isObject(basis) || basis.kind !== "thread-snapshot") return false;
  return value.snapshotId === basis.snapshotId && value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}

function sameDeclaredBasis(
  value:
    | {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    }
    | undefined,
  expected: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
): boolean {
  return !!value && value.snapshotId === expected.snapshotId &&
    value.revision === expected.revision &&
    value.subjectId === expected.subjectId;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} is not valid UTF-8.`);
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${label} is not valid JSON.`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredMediaType(value: string | undefined, id: string): string {
  if (!value) throw new TypeError(`Thread artifact ${id} is missing its media type.`);
  return value;
}
