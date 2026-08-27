import { assert, assertEquals } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
} from "../../src/application/ports/out/mcp-tool-client.ts";
import type { NativeAssetBridge } from "./native-smoke.ts";
import {
  INTEGRATED_CALCULIX_CANDIDATE,
  runIntegratedAdmissionSmoke,
} from "./integrated-smoke.ts";
import type {
  EphemeralSysonAnchor,
  EphemeralSysonAnchorConsumer,
  EphemeralSysonAnchorRun,
  SysonSmokeCompiledInput,
  SysonSmokeTestSeam,
} from "./syson-smoke.ts";
import { runNativeMechanicalSmoke } from "./native-smoke.ts";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

Deno.test("integrated fake E2E preserves causal order, exact native IDs and non-admission", async () => {
  const events: string[] = [];
  let candidateSent = false;

  const fakeWithSyson = async <T>(
    use: EphemeralSysonAnchorConsumer<T>,
    input: SysonSmokeCompiledInput,
    _seam?: SysonSmokeTestSeam,
  ): Promise<EphemeralSysonAnchorRun<T>> => {
    assertEquals(input.architecture.packageName, "GenericSupport");
    assertEquals(input.architecture.components[0]?.name, "SupportBlock");
    assertEquals(
      input.requirements.map((item) => ({
        id: item.id,
        name: item.name,
        limit: item.limit,
      })),
      [{
        id: "support_block_max_displacement",
        name: "SupportBlock maximum displacement limit",
        limit: { value: 2, unit: "mm" },
      }, {
        id: "support_block_max_von_mises",
        name: "SupportBlock maximum von Mises stress limit",
        limit: { value: 100_000_000, unit: "Pa" },
      }],
    );
    events.push("syson:create", "syson:exact-readback");
    const anchor = exactAnchor();
    let useResult: T;
    try {
      useResult = await use(anchor);
    } finally {
      events.push("syson:delete-1", "syson:absence-readback");
    }
    return {
      result: {
        schemaVersion: "syson-native-smoke/0.1",
        status: "passed",
        endpoint: "http://127.0.0.1:3009/mcp",
        projectName: "admission-syson-smoke-test",
        project: anchor.project,
        architecture: anchor.architecture,
        requirement: anchor.requirements,
        cleanup: {
          status: "deleted-and-absent",
          deleteAttempts: 1,
          preReadVerified: true,
          postconditionVerified: true,
        },
      },
      useResult,
    };
  };

  const fakeMechanical: typeof runNativeMechanicalSmoke = async (
    _clients,
    _bridge,
    anchor,
  ) => {
    await Promise.resolve();
    assertEquals(anchor.supportBlockPartDefinitionId, "part-def-support");
    assertEquals(anchor.supportBlockPartUsageId, "part-usage-support");
    assertEquals(anchor.requirementUsageId, "requirement-usage-support");
    assertEquals(
      anchor.criteria.map((item) => ({
        id: item.constraintUsageId,
        limit: { value: item.limitValue, unit: item.unit },
      })),
      [{
        id: "constraint-displacement",
        limit: { value: 2, unit: "mm" },
      }, {
        id: "constraint-von-mises",
        limit: { value: 100_000_000, unit: "Pa" },
      }],
    );
    candidateSent = JSON.stringify(anchor).includes(INTEGRATED_CALCULIX_CANDIDATE);
    events.push("build123d:export", "calculix:solve-1", "calculix:get-only");
    for (let index = 0; index < 9; index++) events.push(`resource:read-${index + 1}`);
    return {
      schemaVersion: "native-mechanical-admission-smoke/0.1",
      authorityBoundary: {
        kind: "experimental-non-authoritative",
        admissionStatus: "provider-conformance-only",
        projectStateWritten: false,
        threadStateWritten: false,
        sysonMode: "validated-external-readback-anchor-no-provider-call",
      },
      recipe: {
        subject: "GenericSupport/SupportBlock",
        geometry: "Box(20 mm, 20 mm, 20 mm)",
        material: { youngModulusMPa: 70000, poissonRatio: 0.33 },
        boundary: "fixed-bottom/load-top",
        forceN: [0, 0, -10],
      },
      sysmlAnchor: {
        fingerprint: SHA_A,
        editingContextId: anchor.editingContextId,
        supportBlockPartDefinitionId: anchor.supportBlockPartDefinitionId,
        supportBlockPartUsageId: anchor.supportBlockPartUsageId,
        requirementUsageId: anchor.requirementUsageId,
        displacementConstraintUsageId: anchor.criteria[0]!.constraintUsageId,
        vonMisesConstraintUsageId: anchor.criteria[1]!.constraintUsageId,
      },
      geometry: {
        sourceSha256: SHA_A,
        sourceBytes: 99,
        stepSha256: SHA_B,
        stepBytes: 15354,
      },
      calculix: {
        requestId: "calculix-request-test",
        requestSha256: SHA_C,
        runId: "r-test",
        resourceProfile: [
          "input.step",
          "request.json",
          "mesh.geo",
          "mesh.inp",
          "gmsh.log",
          "job.inp",
          "ccx.log",
          "job.dat",
          "result.json",
        ],
        resourceLedgerSha256: SHA_A,
        resourceBytesVerified: true,
        inputStepBytesMatched: true,
        executionIdentitySha256: SHA_B,
        normalizedResultSha256: SHA_C,
        solveAcknowledged: true,
      },
    };
  };

  const summary = await runIntegratedAdmissionSmoke({
    mechanicalClients: forbiddenMechanicalClients(),
    bridge: forbiddenBridge(),
    testStages: {
      withSysonAnchor: fakeWithSyson,
      runMechanical: fakeMechanical,
    },
    observeStage: (stage) => events.push(`stage:${stage}`),
  });

  assertEquals(events, [
    "stage:compilation-closed",
    "syson:create",
    "syson:exact-readback",
    "build123d:export",
    "calculix:solve-1",
    "calculix:get-only",
    ...Array.from({ length: 9 }, (_, index) => `resource:read-${index + 1}`),
    "syson:delete-1",
    "syson:absence-readback",
    "stage:syson-cleanup-proven",
  ]);
  assertEquals(candidateSent, false);
  assertEquals(summary.schemaVersion, "integrated-admission-smoke/0.1");
  assertEquals(summary.admissionStatus, "not-admitted");
  assertEquals(summary.compilationStatus, "unresolved");
  assertEquals(summary.engineeringProjectStateWritten, false);
  assertEquals(summary.threadStateWritten, false);
  assertEquals(summary.ephemeralSysonProject, {
    lifecycle: "created-and-deleted",
    persistentAfterRun: false,
  });
  assertEquals(summary.brief.fieldItemMappings, [{
    proposalField: "architecture.package",
    sourceItemId: "architecture",
  }, {
    proposalField: "system.name",
    sourceItemId: "system",
  }, {
    proposalField: "component.support.name",
    sourceItemId: "support-block",
  }, {
    proposalField: "component.support.usage",
    sourceItemId: "support-block",
  }, {
    proposalField: "requirements.containerComponent",
    sourceItemId: "mechanical-verification",
  }, {
    proposalField: "requirement.displacement.name",
    sourceItemId: "max-displacement",
  }, {
    proposalField: "requirement.displacement.metric",
    sourceItemId: "max-displacement",
  }, {
    proposalField: "requirement.displacement.operator",
    sourceItemId: "max-displacement",
  }, {
    proposalField: "requirement.displacement.threshold",
    sourceItemId: "max-displacement",
  }, {
    proposalField: "requirement.vonMises.name",
    sourceItemId: "max-von-mises",
  }, {
    proposalField: "requirement.vonMises.metric",
    sourceItemId: "max-von-mises",
  }, {
    proposalField: "requirement.vonMises.operator",
    sourceItemId: "max-von-mises",
  }, {
    proposalField: "requirement.vonMises.threshold",
    sourceItemId: "max-von-mises",
  }]);
  assert(summary.crossSource.unresolvedDiagnosticIds.length >= 5);
  assertEquals(summary.crossSource.candidateCalculixSentToProvider, false);
  assertEquals(summary.fixtureQualification.admitted, false);
  assertEquals(summary.syson.cleanup, "deleted-and-absent");
  assertEquals(summary.calculix.resourceReadsVerified, 9);
});

function exactAnchor(): EphemeralSysonAnchor {
  return Object.freeze({
    project: Object.freeze({
      id: "project-syson-test",
      name: "admission-syson-smoke-test",
      editingContextId: "editing-context-test",
    }),
    architecture: Object.freeze({
      documentId: "document-test",
      documentName: "AdmissionSmokeModel.sysml",
      rootPackageId: "root-test",
      rootPackageLabel: "Package1",
      architecturePackageId: "package-generic-support",
      systemPartDefinitionId: "part-def-system",
      supportBlockPartDefinitionId: "part-def-support",
      supportBlockPartUsageId: "part-usage-support",
      supportBlockPartUsageTargetId: "part-def-support",
    }),
    requirements: Object.freeze({
      requirementUsageId: "requirement-usage-support",
      subjectReferenceUsageId: "subject-reference-support",
      subjectTargetPartDefinitionId: "part-def-support",
      criteria: Object.freeze([
        Object.freeze({
          constraintUsageId: "constraint-displacement",
          requirementId: "support_block_max_displacement",
          metric: "support_block_max_displacement",
          operator: "<=",
          limitValue: 2,
          unit: "mm",
        }),
        Object.freeze({
          constraintUsageId: "constraint-von-mises",
          requirementId: "support_block_max_von_mises",
          metric: "support_block_max_von_mises",
          operator: "<=",
          limitValue: 100_000_000,
          unit: "Pa",
        }),
      ]),
    }),
  });
}

function forbiddenClient(): McpToolClient {
  const fail = (call?: McpToolCall) =>
    Promise.reject(new Error(`Unexpected real client call ${call?.name ?? "text"}`));
  return { callTool: fail, callToolTextResult: () => fail() };
}

function forbiddenMechanicalClients() {
  return {
    build123dSandbox: forbiddenClient(),
    calculix: forbiddenClient(),
    calculixResources: {
      read: () => Promise.reject(new Error("Unexpected resource read")),
    },
  };
}

function forbiddenBridge(): NativeAssetBridge {
  return {
    withStagedStep: () => Promise.reject(new Error("Unexpected native bridge call")),
  };
}
