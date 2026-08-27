/**
 * Exact completed FEA @3 fixture for the provider-free static-mechanical L5
 * tests. It materializes the existing sealed proof branch, local execution
 * evidence and canonical L4 capture, but deliberately exposes no solver or
 * SysON client to the closeout resolver/executor.
 */

import type { CalculixIsolatedExecutionEvidence } from "../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import { CALCULIX_ISOLATED_OUTPUT_MANIFEST } from "../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  buildStaticProofSuccessor,
  exactStaticProofEvidenceRefs,
} from "../domain/fea/isolated-v3/static-proof-thread-evidence.ts";
import type { ContentFingerprint } from "../domain/kernel/primitives.ts";
import { sha256Fingerprint } from "../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type { EngineeringThreadSnapshotBasis } from "../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../domain/thread/thread-snapshot.ts";
import { fingerprintResourceBytes } from "../domain/compile/source/provider-resource-reader.ts";
import { FileByteStore } from "../adapters/shared/cas/file-byte-store.ts";
import { FixedCalculixIsolatedExecutionProfileCatalog } from "../adapters/fea/isolated-v3/fixed-calculix-isolated-execution-profile.ts";
import {
  createIsolatedCalculixV3Fixture,
  ISOLATED_CALCULIX_FIXTURE_AGENT,
  type IsolatedCalculixV3Fixture,
} from "./isolated-calculix-v3-fixture.ts";
import {
  buildOracleValues,
  parseCapturedFeaConstraintOracleOutcome,
  prepareFeaConstraintOracleCall,
} from "../adapters/fea/isolated-v3/fea-oracle-adapter.ts";
import {
  canonicalFeaSysonEvaluationCaptureText,
  validateFeaSysonEvaluationCapture,
} from "../adapters/fea/isolated-v3/fea-syson-evaluation-capture.ts";
import type { StaticMechanicalCloseoutEvidenceResolverDependencies } from "../adapters/fea/evaluation-closeout/static-mechanical-closeout-evidence-resolver.ts";
import {
  EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../adapters/shared/cas/file-capture-store.ts";

const COMMAND_AT = "2026-08-22T00:00:00.000Z";

export const STATIC_MECHANICAL_CLOSEOUT_FIXTURE_HUMAN = {
  kind: "human" as const,
  actorId: "human:static-mechanical-closeout-fixture",
};

export const STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT = {
  kind: "agent" as const,
  actorId: "agent:static-mechanical-closeout-fixture",
};

export interface StaticMechanicalCloseoutFixture {
  readonly directory: string;
  readonly fea: IsolatedCalculixV3Fixture;
  readonly project: EngineeringProjectSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly snapshot: ThreadSnapshot;
  readonly dependencies: StaticMechanicalCloseoutEvidenceResolverDependencies;
  readonly closeoutCaptures: FileCaptureStore<"evaluation-closeout-capture">;
  readonly counts: {
    artifactReads: number;
    canonicalStepReads: number;
    executionEvidenceReads: number;
    evaluationCaptureReads: number;
  };
  dispose(): Promise<void>;
}

/**
 * The `status` is an L4 result recorded before closeout. The fixture never
 * makes a provider call while resolving or deciding the L5 consequence.
 */
export async function createCompletedStaticMechanicalCloseoutFixture(options: {
  readonly status?: "pass" | "fail" | "unresolved" | "error";
} = {}): Promise<StaticMechanicalCloseoutFixture> {
  const directory = await Deno.makeTempDir({ prefix: "static-mechanical-closeout-" });
  try {
    const profiles = new FixedCalculixIsolatedExecutionProfileCatalog({
      imageReference: `casys/calculix@sha256:${"a".repeat(64)}`,
      wrapperSha256: "b".repeat(64),
      policy: {
        id: "static-mechanical-closeout-fixture",
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
    });
    const fea = await createIsolatedCalculixV3Fixture(
      directory,
      await profiles.initial(),
    );
    let project = await requiredProject(fea);
    project = await fea.commands.claimRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
      commandId: "fixture:static-mechanical-closeout:fea-claim",
      projectId: fea.projectId,
      expectedRevision: project.revision,
      issuedAt: COMMAND_AT,
      runId: fea.runId,
      summary: "Claim the completed static-mechanical FEA fixture.",
    });
    const claimed = project.agentRuns.find((run) => run.id === fea.runId);
    if (!claimed?.startedAt) throw new Error("The FEA fixture run did not start.");

    const metrics = {
      maximumDisplacement: {
        value: 0.1,
        unit: "mm" as const,
        nodeId: 2,
        vectorMm: [0, 0, -0.1] as const,
      },
      maximumVonMises: {
        value: 2,
        unit: "MPa" as const,
        elementId: 1,
      },
    };
    const proofFingerprint = await sha256Fingerprint(fea.proofCase);
    const executionFingerprint = await sha256Fingerprint({
      kind: "static-mechanical-closeout-test-execution",
      projectId: fea.projectId,
      runId: fea.runId,
      proofFingerprint,
    });
    const execution = {
      projectId: fea.projectId,
      agentRunId: fea.runId,
      fingerprint: executionFingerprint,
      proofFingerprint,
      result: { metrics },
    } as unknown as CalculixIsolatedExecutionEvidence;
    const outputs = await Promise.all(
      CALCULIX_ISOLATED_OUTPUT_MANIFEST.map(async (output) => {
        const sha256 = output.role === "input.step"
          ? fea.proofCase.expectedCadArtifact.sha256
          : await fingerprintResourceBytes(
            new TextEncoder().encode(`static-mechanical-closeout:${output.role}`),
          );
        return {
          role: output.role,
          sha256,
          casUri: `casys://static-mechanical-closeout-output/sha256/${sha256}`,
          mediaType: output.mediaType,
        };
      }),
    );
    const request = prepareFeaConstraintOracleCall(
      fea.proofCase.requirements,
      buildOracleValues({
        maxDisplacement: metrics.maximumDisplacement,
        maxVonMises: metrics.maximumVonMises,
      }, fea.proofCase.requirements),
    );
    const status = options.status ?? "pass";
    const response = {
      structuredContent: {
        results: fea.proofCase.requirements.map((requirement) =>
          status === "error" || status === "unresolved"
            ? { constraintId: requirement.id, status }
            : {
              constraintId: requirement.id,
              status,
              computedValue: 1,
              threshold: 2,
              margin: status === "pass" ? 1 : -1,
              marginPercent: status === "pass" ? 50 : -50,
              unit: requirement.limit.unit,
            }
        ),
      },
    };
    const evaluationCapture = validateFeaSysonEvaluationCapture({
      schemaVersion: "fea-syson-evaluation-capture/1.0",
      request,
      response,
    });
    const evaluationText = canonicalFeaSysonEvaluationCaptureText(evaluationCapture);
    const evaluationFingerprint: ContentFingerprint = {
      algorithm: "sha256",
      digest: await fingerprintResourceBytes(new TextEncoder().encode(evaluationText)),
    };
    const evaluationStore = new FileByteStore({
      kind: "calculix-isolated-syson-evaluation",
      directory: `${directory}/evaluation-captures`,
      uriNamespace: "calculix-isolated-syson-evaluation",
      label: "Static mechanical closeout L4 capture",
    });
    await evaluationStore.save(
      evaluationFingerprint,
      new TextEncoder().encode(evaluationText),
    );
    const outcomes = parseCapturedFeaConstraintOracleOutcome(
      response.structuredContent,
      fea.proofCase.requirements,
    );
    const localOperation = {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: fea.runId,
    } as const;
    const snapshot = buildStaticProofSuccessor({
      basis: fea.basis,
      capturedAt: claimed.startedAt,
      localOperation,
      oracleOperation: {
        serverId: "syson",
        tool: "syson_constraint_evaluate",
        runId: `capture:${evaluationFingerprint.digest}`,
      },
      proofArtifact: fea.proofArtifact,
      geometryArtifact: fea.geometryArtifact,
      requirementsArtifact: fea.requirementsArtifact,
      proofRequirements: fea.proofCase.requirements,
      evidence: {
        fingerprint: executionFingerprint,
        uri:
          `casys://calculix-isolated-execution-evidence/sha256/${executionFingerprint.digest}`,
        outputs,
        metrics,
      },
      evaluation: {
        sha256: evaluationFingerprint.digest,
        uri: evaluationStore.uriFor(evaluationFingerprint),
        outcomes,
      },
    });
    await fea.snapshots.save(snapshot);
    project = await requiredProject(fea);
    project = await fea.commands.publishRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
      commandId: "fixture:static-mechanical-closeout:fea-publish",
      projectId: fea.projectId,
      expectedRevision: project.revision,
      issuedAt: COMMAND_AT,
      runId: fea.runId,
      summary: "Publish the completed static-mechanical FEA fixture.",
    });
    project = await fea.commands.completeRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
      commandId: "fixture:static-mechanical-closeout:fea-complete",
      projectId: fea.projectId,
      expectedRevision: project.revision,
      issuedAt: COMMAND_AT,
      runId: fea.runId,
      summary: "Complete the static-mechanical FEA fixture.",
      resultSnapshot: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subject.id,
      },
      evidenceRefs: exactStaticProofEvidenceRefs(snapshot, localOperation),
    });
    const completedRun = project.agentRuns.find((run) => run.id === fea.runId);
    if (!completedRun?.resultSnapshot) {
      throw new Error("The FEA fixture did not complete.");
    }
    const basis: EngineeringThreadSnapshotBasis = {
      kind: "thread-snapshot",
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    };
    const counts = {
      artifactReads: 0,
      canonicalStepReads: 0,
      executionEvidenceReads: 0,
      evaluationCaptureReads: 0,
    };
    const dependencies: StaticMechanicalCloseoutEvidenceResolverDependencies = {
      artifacts: {
        readArtifact: (artifact) => {
          counts.artifactReads++;
          if (artifact.id !== fea.proofArtifact.id) return Promise.resolve(undefined);
          return Promise.resolve({
            uri: fea.proofArtifact.uri!,
            mediaType: fea.proofArtifact.mediaType!,
            byteCount: fea.proofBytes.byteLength,
            sha256: fea.proofArtifact.fingerprint.digest,
            bytes: Uint8Array.from(fea.proofBytes),
          });
        },
      },
      canonicalAssets: {
        read: (digest) => {
          counts.canonicalStepReads++;
          if (digest !== fea.proofCase.expectedCadArtifact.sha256) {
            throw new Error("The fixture has no other canonical asset.");
          }
          return Promise.resolve(Uint8Array.from(fea.stepBytes));
        },
      },
      executionEvidence: {
        read: (fingerprint) => {
          counts.executionEvidenceReads++;
          return Promise.resolve(
            fingerprint.digest === executionFingerprint.digest ? execution : undefined,
          );
        },
        uriFor: (fingerprint) =>
          `casys://calculix-isolated-execution-evidence/sha256/${fingerprint.digest}`,
      },
      evaluationCaptures: {
        read: async (fingerprint) => {
          counts.evaluationCaptureReads++;
          return await evaluationStore.read(fingerprint);
        },
        uriFor: (fingerprint) => evaluationStore.uriFor(fingerprint),
      },
    };
    const closeoutCaptures = new FileCaptureStore({
      ...EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
      directory: `${directory}/closeout-captures`,
      syncBoundary: directory,
    });
    return {
      directory,
      fea,
      project,
      basis,
      snapshot,
      dependencies,
      closeoutCaptures,
      counts,
      dispose: () => Deno.remove(directory, { recursive: true }),
    };
  } catch (error) {
    await Deno.remove(directory, { recursive: true });
    throw error;
  }
}

async function requiredProject(
  fixture: IsolatedCalculixV3Fixture,
): Promise<EngineeringProjectSnapshot> {
  const project = await fixture.projects.get(fixture.projectId);
  if (!project) {
    throw new Error("The static-mechanical closeout fixture project is absent.");
  }
  return project;
}
