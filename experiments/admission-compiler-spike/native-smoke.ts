/**
 * Native-provider smoke for the admission-compiler experiment.
 *
 * This is deliberately a fixed, code-owned recipe. It is not wired into the
 * project runtime, writes no Thread/CAS/project state, performs no SysON
 * mutation, and accepts no provider/tool/argument selection from an agent.
 *
 * Mechanical path:
 *   exact, cross-linked SysON evidence supplied by the integrated smoke
 *   -> build123d sandbox export of one fixed 20 mm SupportBlock
 *   -> exact STEP handoff through an injected NativeAssetBridge
 *   -> one recorded CalculiX solve and request-id readback
 */

import type { McpToolClient } from "../../src/application/ports/out/mcp-tool-client.ts";
import {
  McpCalculixRecordedStaticAdapter,
} from "./mcp-calculix-recorded-static-adapter.ts";
import type {
  CalculixRecordedStaticCapturedEvidence,
  CalculixRecordedStaticCapturedResource,
  CalculixRecordedStaticCompleted,
  CalculixRecordedStaticInput,
  CalculixRecordedStaticPlan,
  CalculixRecordedStaticRecovery,
} from "./calculix-recorded-capabilities.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../../src/domain/fea/seal-case/mechanical-proof-case.ts";
import {
  fingerprintResourceBytes,
  type ProviderResourceReader,
} from "../../src/domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../src/domain/kernel/deterministic-json.ts";
import {
  validateGeometryScript,
} from "../../src/domain/cad/source/geometry-script-validation.ts";

const ENDPOINTS = Object.freeze({
  syson: "http://127.0.0.1:3009/mcp",
  build123dSandbox: "http://127.0.0.1:3024/mcp",
  calculix: "http://127.0.0.1:3015/mcp",
});

export const NATIVE_MECHANICAL_BUILD123D_SCRIPT = "from build123d import Align, Box\n" +
  "result = Box(20, 20, 20, align=(Align.MIN, Align.MIN, Align.MIN))\n";

const CALCULIX_RESOURCE_PROFILE = Object.freeze(
  [
    "input.step",
    "request.json",
    "mesh.geo",
    "mesh.inp",
    "gmsh.log",
    "job.inp",
    "ccx.log",
    "job.dat",
    "result.json",
  ] as const,
);

const GENERATED_EXPORT_NAME = /^native-smoke-support-block-[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface NativeMechanicalSmokeClients {
  readonly build123dSandbox: McpToolClient;
  readonly calculix: McpToolClient;
  readonly calculixResources: ProviderResourceReader;
}

/**
 * Minimal provider-readback evidence required to bind the mechanical smoke to
 * SysML identities. This value does not carry project or Thread authority.
 */
export interface NativeSysmlMechanicalAnchor {
  readonly editingContextId: string;
  readonly supportBlockPartDefinitionId: string;
  readonly supportBlockPartUsageId: string;
  readonly supportBlockPartUsageTargetId: string;
  readonly requirementUsageId: string;
  readonly subjectReferenceUsageId: string;
  readonly subjectTargetPartDefinitionId: string;
  readonly criteria: readonly NativeSysmlMechanicalCriterion[];
}

export interface NativeSysmlMechanicalCriterion {
  readonly constraintUsageId: string;
  readonly requirementId:
    | "support_block_max_displacement"
    | "support_block_max_von_mises";
  readonly metric:
    | "support_block_max_displacement"
    | "support_block_max_von_mises";
  readonly operator: "<=";
  readonly limitValue: number;
  readonly unit: "mm" | "Pa";
}

export interface NativeCalculixAdapter {
  resolve(input: CalculixRecordedStaticInput): CalculixRecordedStaticPlan;
  solve(plan: CalculixRecordedStaticPlan): Promise<CalculixRecordedStaticCompleted>;
  getByRequestId(requestId: string): Promise<CalculixRecordedStaticRecovery>;
  verifyCapturedEvidence(
    plan: CalculixRecordedStaticPlan,
    completed: CalculixRecordedStaticCompleted,
    resources: readonly CalculixRecordedStaticCapturedResource[],
  ): Promise<CalculixRecordedStaticCapturedEvidence>;
}

export interface NativeMechanicalSmokeAdapterOverrides {
  readonly calculix?: NativeCalculixAdapter;
  readonly pollDelay?: (milliseconds: number) => Promise<void>;
}

export interface NativeStepExport {
  readonly exportName: string;
  readonly containerPath: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface StagedNativeStep {
  readonly containerPath: string;
  readonly byteCount: number;
  readonly sha256: string;
  /** Exact bytes read back from the CalculiX container before the callback. */
  readonly bytes: Uint8Array;
}

/**
 * Private byte handoff. The bridge owns materialization, staging, verification,
 * and cleanup; the caller receives the staged provider path only inside the
 * callback lifetime.
 */
export interface NativeAssetBridge {
  withStagedStep<T>(
    exportName: string,
    resolveExport: () => Promise<NativeStepExport>,
    use: (asset: StagedNativeStep) => Promise<T>,
  ): Promise<T>;
}

export interface NativeMechanicalSmokeSummary {
  readonly schemaVersion: "native-mechanical-admission-smoke/0.1";
  readonly authorityBoundary: {
    readonly kind: "experimental-non-authoritative";
    readonly admissionStatus: "provider-conformance-only";
    readonly projectStateWritten: false;
    readonly threadStateWritten: false;
    readonly sysonMode: "validated-external-readback-anchor-no-provider-call";
  };
  readonly recipe: {
    readonly subject: "GenericSupport/SupportBlock";
    readonly geometry: "Box(20 mm, 20 mm, 20 mm)";
    readonly material: { readonly youngModulusMPa: 70000; readonly poissonRatio: 0.33 };
    readonly boundary: "fixed-bottom/load-top";
    readonly forceN: readonly [0, 0, -10];
  };
  readonly sysmlAnchor: {
    readonly fingerprint: string;
    readonly editingContextId: string;
    readonly supportBlockPartDefinitionId: string;
    readonly supportBlockPartUsageId: string;
    readonly requirementUsageId: string;
    readonly displacementConstraintUsageId: string;
    readonly vonMisesConstraintUsageId: string;
  };
  readonly geometry: {
    readonly sourceSha256: string;
    readonly sourceBytes: number;
    readonly stepSha256: string;
    readonly stepBytes: number;
  };
  readonly calculix: {
    readonly requestId: string;
    readonly requestSha256: string;
    readonly runId: string;
    readonly resourceProfile: typeof CALCULIX_RESOURCE_PROFILE;
    readonly resourceLedgerSha256: string;
    readonly resourceBytesVerified: true;
    readonly inputStepBytesMatched: true;
    readonly executionIdentitySha256: string;
    readonly normalizedResultSha256: string;
    readonly solveAcknowledged: boolean;
  };
}

export interface NativeAssetBridgeRuntime {
  readonly cwd: () => string;
  readonly makeTempDir: () => Promise<string>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly removeDirectory: (path: string) => Promise<void>;
  readonly runDocker: (
    args: readonly string[],
    label: string,
  ) => Promise<Uint8Array>;
}

/** Production spike bridge. It invokes only fixed Docker Compose services. */
export class DockerComposeNativeAssetBridge implements NativeAssetBridge {
  readonly #runtime: NativeAssetBridgeRuntime;

  constructor(runtime: NativeAssetBridgeRuntime = defaultNativeAssetBridgeRuntime()) {
    this.#runtime = runtime;
  }

  async withStagedStep<T>(
    exportName: string,
    resolveExport: () => Promise<NativeStepExport>,
    use: (asset: StagedNativeStep) => Promise<T>,
  ): Promise<T> {
    if (!GENERATED_EXPORT_NAME.test(exportName)) {
      throw new TypeError("Native bridge export name was not code-generated.");
    }
    // Known before the provider call: even a lost/malformed export ACK reaches
    // the exact generated source cleanup in the common finally path.
    const sourcePath = `/exports/${exportName}.step`;
    let targetPath: string | undefined;
    let temporaryDirectory: string | undefined;
    let value: T | undefined;
    let failure: unknown;

    try {
      const input = await resolveExport();
      validateStepExportIdentity(input);
      if (input.exportName !== exportName || input.containerPath !== sourcePath) {
        throw new TypeError(
          "Native bridge resolved export does not match its predeclared generated path.",
        );
      }
      targetPath = `/inputs/fea-${input.sha256}.step`;
      temporaryDirectory = await this.#runtime.makeTempDir();
      const localPath = `${temporaryDirectory}/support-block.step`;
      await this.#runtime.runDocker([
        "compose",
        "--project-directory",
        this.#runtime.cwd(),
        "cp",
        `mcp-build123d-sandbox:${sourcePath}`,
        localPath,
      ], "pull exact build123d STEP");
      const localBytes = await this.#runtime.readFile(localPath);
      await assertBytes(localBytes, input.byteCount, input.sha256, "pulled STEP");

      await this.#runtime.runDocker([
        "compose",
        "--project-directory",
        this.#runtime.cwd(),
        "cp",
        localPath,
        `mcp-calculix:${targetPath}`,
      ], "stage exact CalculiX STEP");
      const stagedBytes = await this.#runtime.runDocker([
        "compose",
        "--project-directory",
        this.#runtime.cwd(),
        "exec",
        "-T",
        "mcp-calculix",
        "cat",
        targetPath,
      ], "read back staged CalculiX STEP");
      await assertBytes(stagedBytes, input.byteCount, input.sha256, "staged STEP");

      value = await use(Object.freeze({
        containerPath: targetPath,
        byteCount: input.byteCount,
        sha256: input.sha256,
        bytes: Uint8Array.from(stagedBytes),
      }));
    } catch (error) {
      failure = error;
    }

    const cleanupErrors: unknown[] = [];
    const cleanupTargets: Array<readonly [string, string, string]> = [];
    if (targetPath !== undefined) {
      cleanupTargets.push(["CalculiX staged STEP", "mcp-calculix", targetPath]);
    }
    cleanupTargets.push([
      "build123d sandbox STEP",
      "mcp-build123d-sandbox",
      sourcePath,
    ]);
    for (const [label, service, path] of cleanupTargets) {
      try {
        await this.#runtime.runDocker([
          "compose",
          "--project-directory",
          this.#runtime.cwd(),
          "exec",
          "-T",
          service,
          "rm",
          "-f",
          path,
        ], `remove ${label}`);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (temporaryDirectory !== undefined) {
      try {
        await this.#runtime.removeDirectory(temporaryDirectory);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (failure !== undefined || cleanupErrors.length > 0) {
      const causes = [failure, ...cleanupErrors].filter((cause) => cause !== undefined);
      throw new AggregateError(
        causes,
        failure === undefined
          ? "Native STEP handoff succeeded but fail-closed cleanup did not."
          : "Native STEP handoff failed; cleanup results are attached.",
      );
    }
    return value as T;
  }
}

export async function runNativeMechanicalSmoke(
  clients: NativeMechanicalSmokeClients,
  bridge: NativeAssetBridge,
  anchorInput: NativeSysmlMechanicalAnchor,
  overrides: NativeMechanicalSmokeAdapterOverrides = {},
): Promise<NativeMechanicalSmokeSummary> {
  // Validate every semantic identity and requirement before the first provider
  // call. The validated copy is the sole source for the proof-case bindings.
  const anchor = validateNativeSysmlMechanicalAnchor(anchorInput);
  validateGeometryScript(NATIVE_MECHANICAL_BUILD123D_SCRIPT);
  const scriptBytes = new TextEncoder().encode(NATIVE_MECHANICAL_BUILD123D_SCRIPT);
  const scriptSha256 = await sha256Hex(scriptBytes);

  const exportName = `native-smoke-support-block-${
    crypto.randomUUID().replaceAll("-", "")
  }`;
  const calculixRequestId = `native-smoke-calculix-${crypto.randomUUID()}`;
  const calculixAdapter = overrides.calculix ??
    new McpCalculixRecordedStaticAdapter(clients.calculix);
  const pollDelay = overrides.pollDelay ?? delay;
  const calculix = await bridge.withStagedStep(
    exportName,
    async () => {
      const exportResult = await clients.build123dSandbox.callTool({
        name: "build123d_export",
        arguments: {
          script: NATIVE_MECHANICAL_BUILD123D_SCRIPT,
          formats: ["step"],
          name: exportName,
          timeout_ms: 120000,
        },
      });
      return parseBuild123dStepExport(exportResult.structuredContent, exportName);
    },
    async (staged) => {
      const proof = anchoredMechanicalProofCase(
        anchor,
        scriptSha256,
        scriptBytes.byteLength,
        staged.sha256,
        staged.byteCount,
      );
      const plan = calculixAdapter.resolve({
        requestId: calculixRequestId,
        proof,
        inputArtifact: {
          fingerprint: { algorithm: "sha256", digest: staged.sha256 },
          byteCount: staged.byteCount,
          stagedAsset: { location: staged.containerPath },
        },
        elementOrder: 1,
        timeoutMs: 120000,
      });

      let solveAck: CalculixRecordedStaticCompleted | undefined;
      let solveFailure: unknown;
      try {
        // Exactly one non-idempotent solve. Recovery below is run_get only.
        solveAck = await calculixAdapter.solve(plan);
        assertExactCalculixResourceProfile(solveAck);
      } catch (error) {
        solveFailure = error;
      }
      let readback: CalculixRecordedStaticCompleted;
      try {
        readback = await awaitCalculixReadback(
          calculixAdapter,
          calculixRequestId,
          pollDelay,
        );
      } catch (readFailure) {
        throw new AggregateError(
          [solveFailure, readFailure].filter((cause) => cause !== undefined),
          "CalculiX solve/readback did not close without redispatch.",
        );
      }
      assertExactCalculixResourceProfile(readback);
      if (
        solveAck &&
        (solveAck.requestId !== readback.requestId ||
          solveAck.requestSha256 !== readback.requestSha256 ||
          solveAck.runId !== readback.runId ||
          deterministicJson(solveAck.resources) !==
            deterministicJson(readback.resources))
      ) {
        throw new Error("CalculiX solve ACK and exact request-id readback diverged.");
      }
      const evidence = await acquireAndVerifyCalculixEvidence(
        calculixAdapter,
        clients.calculixResources,
        plan,
        readback,
        staged,
      );
      return {
        step: {
          sha256: staged.sha256,
          byteCount: staged.byteCount,
        },
        readback,
        evidence,
        solveAcknowledged: solveAck !== undefined,
      };
    },
  );

  const resourceLedgerSha256 =
    (await sha256Fingerprint(calculix.readback.resources)).digest;
  const executionIdentitySha256 =
    (await sha256Fingerprint(calculix.evidence.executionIdentity)).digest;
  const normalizedResultSha256 =
    (await sha256Fingerprint(calculix.evidence.result)).digest;
  const anchorFingerprint = (await sha256Fingerprint(anchor)).digest;
  const displacement = anchor.criteria.find((criterion) =>
    criterion.metric === "support_block_max_displacement"
  )!;
  const vonMises = anchor.criteria.find((criterion) =>
    criterion.metric === "support_block_max_von_mises"
  )!;

  const summary: NativeMechanicalSmokeSummary = {
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
      fingerprint: anchorFingerprint,
      editingContextId: anchor.editingContextId,
      supportBlockPartDefinitionId: anchor.supportBlockPartDefinitionId,
      supportBlockPartUsageId: anchor.supportBlockPartUsageId,
      requirementUsageId: anchor.requirementUsageId,
      displacementConstraintUsageId: displacement.constraintUsageId,
      vonMisesConstraintUsageId: vonMises.constraintUsageId,
    },
    geometry: {
      sourceSha256: scriptSha256,
      sourceBytes: scriptBytes.byteLength,
      stepSha256: calculix.step.sha256,
      stepBytes: calculix.step.byteCount,
    },
    calculix: {
      requestId: calculix.readback.requestId,
      requestSha256: calculix.readback.requestSha256,
      runId: calculix.readback.runId,
      resourceProfile: CALCULIX_RESOURCE_PROFILE,
      resourceLedgerSha256,
      resourceBytesVerified: true,
      inputStepBytesMatched: true,
      executionIdentitySha256,
      normalizedResultSha256,
      solveAcknowledged: calculix.solveAcknowledged,
    },
  };
  return Object.freeze(summary);
}

export function parseBuild123dStepExport(
  value: unknown,
  expectedExportName: string,
): NativeStepExport {
  if (!GENERATED_EXPORT_NAME.test(expectedExportName)) {
    throw new TypeError("build123d export name is not the generated smoke identity.");
  }
  const root = exactRecord(
    value,
    ["schemaVersion", "kind", "metrics", "files"],
    "build123d export",
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "export") {
    throw new TypeError("build123d export has an unsupported contract.");
  }
  exactRecord(
    root.metrics,
    Object.keys(asRecord(root.metrics, "build123d metrics")),
    "build123d metrics",
  );
  if (!Array.isArray(root.files) || root.files.length !== 1) {
    throw new TypeError("build123d export must contain exactly one STEP file.");
  }
  const file = exactRecord(
    root.files[0],
    ["format", "path", "bytes", "sha256"],
    "build123d STEP file",
  );
  if (file.format !== "step") {
    throw new TypeError("build123d file format must be step.");
  }
  const expectedPath = `/exports/${expectedExportName}.step`;
  if (file.path !== expectedPath) {
    throw new TypeError(`build123d STEP path must equal ${expectedPath}.`);
  }
  const byteCount = positiveInteger(file.bytes, "build123d STEP bytes");
  const sha256 = sha256Value(file.sha256, "build123d STEP sha256");
  return Object.freeze({
    exportName: expectedExportName,
    containerPath: expectedPath,
    byteCount,
    sha256,
  });
}

export function assertExactCalculixResourceProfile(
  completed: CalculixRecordedStaticCompleted,
): void {
  const roles = completed.resources.map((resource) => resource.role);
  if (deterministicJson(roles) !== deterministicJson(CALCULIX_RESOURCE_PROFILE)) {
    throw new TypeError(
      `CalculiX recorded resource profile must contain the exact nine roles; got ${
        roles.join(", ")
      }.`,
    );
  }
}

/**
 * Reads the closed nine-item ledger one URI at a time. ProviderResourceReader
 * rechecks media type, byte count and SHA-256; this helper additionally proves
 * the provider's input.step bytes equal the bytes read back after staging,
 * then delegates semantic/canonical evidence checks to the CalculiX adapter.
 */
export async function acquireAndVerifyCalculixEvidence(
  adapter: Pick<NativeCalculixAdapter, "verifyCapturedEvidence">,
  reader: ProviderResourceReader,
  plan: CalculixRecordedStaticPlan,
  completed: CalculixRecordedStaticCompleted,
  staged: StagedNativeStep,
): Promise<CalculixRecordedStaticCapturedEvidence> {
  assertExactCalculixResourceProfile(completed);
  const captured: CalculixRecordedStaticCapturedResource[] = [];
  for (const resource of completed.resources) {
    const read = await reader.read({
      uri: resource.uri,
      mediaType: resource.mediaType,
      byteCount: resource.byteCount,
      sha256: resource.sha256,
    });
    const bytes = read.bytes.copy();
    const attestation = read.attestation;
    if (
      bytes.byteLength !== resource.byteCount ||
      await fingerprintResourceBytes(bytes) !== resource.sha256 ||
      attestation.verification !== "exact-content-match" ||
      attestation.uri !== resource.uri ||
      attestation.mediaType !== resource.mediaType ||
      attestation.byteCount !== resource.byteCount ||
      attestation.sha256 !== resource.sha256
    ) {
      throw new TypeError(
        `CalculiX resources/read did not exactly re-attest ${resource.role}.`,
      );
    }
    captured.push({ role: resource.role, bytes });
  }
  if (captured.length !== CALCULIX_RESOURCE_PROFILE.length) {
    throw new TypeError("CalculiX acquisition did not retain all nine resources.");
  }
  const inputTuple = completed.resources[0];
  const inputBytes = captured[0]?.bytes;
  if (
    inputTuple.role !== "input.step" || inputBytes === undefined ||
    inputTuple.byteCount !== staged.byteCount ||
    inputTuple.sha256 !== staged.sha256 ||
    !bytesEqual(inputBytes, staged.bytes)
  ) {
    throw new TypeError(
      "CalculiX input.step resource does not equal the exact staged STEP bytes.",
    );
  }
  return await adapter.verifyCapturedEvidence(plan, completed, captured);
}

export function dryRunSummary(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: "native-admission-smoke-dry-run/1.0",
    executes: false,
    endpoints: ENDPOINTS,
    writes: {
      projectState: false,
      threadState: false,
      syson: false,
      temporaryHostDirectory: true,
      privateProviderVolumes: true,
    },
    recipe: {
      subject: "GenericSupport/SupportBlock",
      build123d: "fixed Box(20,20,20), STEP only, sandbox endpoint",
      calculix: "fixed-bottom/load-top, E=70000 MPa, nu=0.33, force=[0,0,-10] N",
    },
    providerSelectionAcceptedFromCaller: false,
  });
}

async function awaitCalculixReadback(
  adapter: Pick<NativeCalculixAdapter, "getByRequestId">,
  requestId: string,
  pollDelay: (milliseconds: number) => Promise<void>,
): Promise<CalculixRecordedStaticCompleted> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const recovery: CalculixRecordedStaticRecovery = await adapter.getByRequestId(
      requestId,
    );
    if (recovery.status === "completed") return recovery;
    if (recovery.status !== "dispatched") {
      throw new Error(`CalculiX run_get closed as ${recovery.status}.`);
    }
    await pollDelay(1000);
  }
  throw new Error("CalculiX run_get did not complete inside the 120 s smoke bound.");
}

export function validateNativeSysmlMechanicalAnchor(
  input: NativeSysmlMechanicalAnchor,
): NativeSysmlMechanicalAnchor {
  const root = exactRecord(
    input,
    [
      "editingContextId",
      "supportBlockPartDefinitionId",
      "supportBlockPartUsageId",
      "supportBlockPartUsageTargetId",
      "requirementUsageId",
      "subjectReferenceUsageId",
      "subjectTargetPartDefinitionId",
      "criteria",
    ],
    "native SysML mechanical anchor",
  );
  const editingContextId = stableId(
    root.editingContextId,
    "native SysML mechanical anchor editingContextId",
  );
  const supportBlockPartDefinitionId = stableId(
    root.supportBlockPartDefinitionId,
    "native SysML mechanical anchor supportBlockPartDefinitionId",
  );
  const supportBlockPartUsageId = stableId(
    root.supportBlockPartUsageId,
    "native SysML mechanical anchor supportBlockPartUsageId",
  );
  const supportBlockPartUsageTargetId = stableId(
    root.supportBlockPartUsageTargetId,
    "native SysML mechanical anchor supportBlockPartUsageTargetId",
  );
  const requirementUsageId = stableId(
    root.requirementUsageId,
    "native SysML mechanical anchor requirementUsageId",
  );
  const subjectReferenceUsageId = stableId(
    root.subjectReferenceUsageId,
    "native SysML mechanical anchor subjectReferenceUsageId",
  );
  const subjectTargetPartDefinitionId = stableId(
    root.subjectTargetPartDefinitionId,
    "native SysML mechanical anchor subjectTargetPartDefinitionId",
  );
  if (
    supportBlockPartUsageTargetId !== supportBlockPartDefinitionId ||
    subjectTargetPartDefinitionId !== supportBlockPartDefinitionId
  ) {
    throw new TypeError(
      "Native SysML mechanical anchor PartUsage and requirement subject must target the exact SupportBlock PartDefinition ID.",
    );
  }
  const identityIds = [
    supportBlockPartDefinitionId,
    supportBlockPartUsageId,
    requirementUsageId,
    subjectReferenceUsageId,
  ];
  if (new Set(identityIds).size !== identityIds.length) {
    throw new TypeError(
      "Native SysML mechanical anchor element identities must be pairwise distinct.",
    );
  }
  if (!Array.isArray(root.criteria) || root.criteria.length !== 2) {
    throw new TypeError(
      "Native SysML mechanical anchor must contain exactly two criteria.",
    );
  }
  const criteria = root.criteria.map((raw, index) => {
    const criterion = exactRecord(
      raw,
      [
        "constraintUsageId",
        "requirementId",
        "metric",
        "operator",
        "limitValue",
        "unit",
      ],
      `native SysML mechanical criterion ${index}`,
    );
    const constraintUsageId = stableId(
      criterion.constraintUsageId,
      `native SysML mechanical criterion ${index} constraintUsageId`,
    );
    const requirementId = nonEmptyString(
      criterion.requirementId,
      `native SysML mechanical criterion ${index} requirementId`,
    );
    const metric = nonEmptyString(
      criterion.metric,
      `native SysML mechanical criterion ${index} metric`,
    );
    if (criterion.operator !== "<=") {
      throw new TypeError(
        `native SysML mechanical criterion ${index} operator must equal <=.`,
      );
    }
    if (
      typeof criterion.limitValue !== "number" ||
      !Number.isFinite(criterion.limitValue)
    ) {
      throw new TypeError(
        `native SysML mechanical criterion ${index} limitValue must be finite.`,
      );
    }
    return {
      constraintUsageId,
      requirementId,
      metric,
      operator: "<=" as const,
      limitValue: criterion.limitValue,
      unit: criterion.unit,
    };
  });
  const expected = [{
    requirementId: "support_block_max_displacement",
    metric: "support_block_max_displacement",
    operator: "<=",
    limitValue: 2,
    unit: "mm",
  }, {
    requirementId: "support_block_max_von_mises",
    metric: "support_block_max_von_mises",
    operator: "<=",
    limitValue: 100_000_000,
    unit: "Pa",
  }];
  const semanticCriteria = criteria.map(({ constraintUsageId: _, ...criterion }) =>
    criterion
  );
  if (deterministicJson(semanticCriteria) !== deterministicJson(expected)) {
    throw new TypeError(
      "Native SysML mechanical anchor must carry exactly the reviewed 2 mm and 100000000 Pa criteria in canonical order.",
    );
  }
  const constraintIds = criteria.map((criterion) => criterion.constraintUsageId);
  if (
    new Set(constraintIds).size !== 2 ||
    constraintIds.some((id) => identityIds.includes(id))
  ) {
    throw new TypeError(
      "Native SysML mechanical anchor ConstraintUsage identities must be distinct from each other and the structural elements.",
    );
  }
  return Object.freeze({
    editingContextId,
    supportBlockPartDefinitionId,
    supportBlockPartUsageId,
    supportBlockPartUsageTargetId,
    requirementUsageId,
    subjectReferenceUsageId,
    subjectTargetPartDefinitionId,
    criteria: Object.freeze(criteria.map((criterion) => Object.freeze(criterion))),
  }) as NativeSysmlMechanicalAnchor;
}

export function anchoredMechanicalProofCase(
  anchorInput: NativeSysmlMechanicalAnchor,
  scriptSha256: string,
  scriptBytes: number,
  stepSha256: string,
  stepBytes: number,
): MechanicalProofCase {
  const anchor = validateNativeSysmlMechanicalAnchor(anchorInput);
  const displacement = anchor.criteria[0]!;
  const vonMises = anchor.criteria[1]!;
  return validateMechanicalProofCase({
    schemaVersion: "mechanical-proof-case/1.0",
    id: "native-smoke-generic-support-block-v1",
    revision: 1,
    scope: "GenericSupport/SupportBlock fixed 20 mm cube recorded-static smoke",
    evidenceBoundary:
      "Experimental provider-conformance evidence only. It is not project, product, release, material, manufacturing, certification, convergence, or requirement-verdict evidence.",
    project: {
      id: "spike-only-non-authoritative-project",
      subjectId: "spike-only-non-authoritative-subject",
      baseThreadSnapshot: {
        id: "spike-only-non-authoritative-no-thread-snapshot",
        revision: 1,
        subjectId: "spike-only-non-authoritative-subject",
      },
    },
    target: {
      id: anchor.supportBlockPartUsageId,
      modelElementId: anchor.supportBlockPartDefinitionId,
    },
    authorization: {
      workItemId: "native-smoke-only",
      decisionId: "native-smoke-no-project-authority",
    },
    requirementsSource: {
      provider: "syson",
      editingContextId: anchor.editingContextId,
      elementId: anchor.requirementUsageId,
    },
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
    },
    cadSource: {
      kind: "parametric",
      generator: {
        provider: "build123d",
        tool: "build123d_export",
        definition: {
          mediaType: "text/x-python",
          sha256: scriptSha256,
          bytes: scriptBytes,
        },
      },
      engineeringBoundary: {
        designIntent: "partial",
        editableCad: "native",
        manufacturability: "not-established",
        limitations: [
          "This fixed cube exists only to exercise the native provider handoff.",
          "The material, mesh, support and load are code-owned smoke inputs, not approved product data.",
          "No mesh-convergence, contact, fatigue, thermal coupling or manufacturing claim is established.",
        ],
      },
    },
    expectedCadArtifact: {
      format: "step",
      sha256: stepSha256,
      bytes: stepBytes,
    },
    analysis: {
      kind: "linear-static",
      material: {
        model: "isotropic-linear-elastic",
        basis: "Code-owned native smoke input; not a material certificate.",
        youngModulus: { value: 70000, unit: "MPa" },
        poissonRatio: { value: 0.33, unit: "1" },
      },
      mesh: {
        kind: "tetrahedral-volume",
        targetSize: { value: 4, unit: "mm" },
      },
      supports: [{
        id: "support-block-bottom-fixed",
        kind: "fixed",
        selection: {
          name: "SUPPORT_BLOCK_BOTTOM",
          box: { min: [-1, -1, -1], max: [21, 21, 1], unit: "mm" },
        },
      }],
      loads: [{
        id: "support-block-top-load",
        kind: "force",
        selection: {
          name: "SUPPORT_BLOCK_TOP",
          box: { min: [-1, -1, 19], max: [21, 21, 21], unit: "mm" },
        },
        force: { value: [0, 0, -10], unit: "N" },
      }],
    },
    requirements: [{
      id: displacement.constraintUsageId,
      name: displacement.requirementId,
      metric: "maximum-displacement",
      feature: "maximumDisplacement",
      operator: "<=",
      limit: { value: displacement.limitValue, unit: "mm" },
    }, {
      id: vonMises.constraintUsageId,
      name: vonMises.requirementId,
      metric: "maximum-von-mises-stress",
      feature: "maximumVonMisesStress",
      operator: "<=",
      limit: { value: vonMises.limitValue, unit: "Pa" },
    }],
  });
}

export function parseSysonProjectList(
  value: unknown,
): { readonly projectCount: number } {
  const root = exactRecord(value, ["projects", "pageInfo"], "SysON project list");
  if (!Array.isArray(root.projects)) {
    throw new TypeError("SysON project list projects must be an array.");
  }
  for (const [index, project] of root.projects.entries()) {
    const item = exactRecord(
      project,
      ["id", "name", "natures"],
      `SysON project ${index}`,
    );
    nonEmptyString(item.id, `SysON project ${index} id`);
    nonEmptyString(item.name, `SysON project ${index} name`);
    if (
      !Array.isArray(item.natures) ||
      !item.natures.every((nature) => typeof nature === "string")
    ) {
      throw new TypeError(`SysON project ${index} natures must be strings.`);
    }
  }
  const pageInfo = asRecord(root.pageInfo, "SysON pageInfo");
  const allowed = new Set([
    "count",
    "hasNextPage",
    "endCursor",
    "startCursor",
    "hasPreviousPage",
  ]);
  for (const key of Object.keys(pageInfo)) {
    if (!allowed.has(key)) {
      throw new TypeError(`SysON pageInfo has unsupported field ${key}.`);
    }
  }
  const projectCount = nonNegativeInteger(pageInfo.count, "SysON pageInfo count");
  if (typeof pageInfo.hasNextPage !== "boolean") {
    throw new TypeError("SysON pageInfo hasNextPage must be boolean.");
  }
  for (const cursor of ["endCursor", "startCursor"] as const) {
    if (
      pageInfo[cursor] !== undefined && pageInfo[cursor] !== null &&
      typeof pageInfo[cursor] !== "string"
    ) {
      throw new TypeError(
        `SysON pageInfo ${cursor} must be a string or null when present.`,
      );
    }
  }
  if (
    pageInfo.hasPreviousPage !== undefined &&
    typeof pageInfo.hasPreviousPage !== "boolean"
  ) {
    throw new TypeError(
      "SysON pageInfo hasPreviousPage must be boolean when present.",
    );
  }
  return Object.freeze({ projectCount });
}

function validateStepExportIdentity(input: NativeStepExport): void {
  if (!GENERATED_EXPORT_NAME.test(input.exportName)) {
    throw new TypeError("Native bridge export name was not code-generated.");
  }
  if (input.containerPath !== `/exports/${input.exportName}.step`) {
    throw new TypeError(
      "Native bridge source path does not match its generated export name.",
    );
  }
  positiveInteger(input.byteCount, "Native bridge STEP bytes");
  sha256Value(input.sha256, "Native bridge STEP sha256");
}

function defaultNativeAssetBridgeRuntime(): NativeAssetBridgeRuntime {
  return Object.freeze({
    cwd: () => Deno.cwd(),
    makeTempDir: () => Deno.makeTempDir({ prefix: "casys-native-smoke-step-" }),
    readFile: (path: string) => Deno.readFile(path),
    removeDirectory: (path: string) => Deno.remove(path, { recursive: true }),
    runDocker,
  });
}

async function runDocker(args: readonly string[], label: string): Promise<Uint8Array> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command("docker", {
      args: [...args],
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    throw new Error(`${label}: docker command could not start.`, { cause: error });
  }
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim().slice(0, 512);
    throw new Error(`${label}: docker exited ${output.code}: ${stderr}`);
  }
  return output.stdout;
}

async function assertBytes(
  bytes: Uint8Array,
  expectedBytes: number,
  expectedSha256: string,
  label: string,
): Promise<void> {
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `${label} byte count mismatch: expected ${expectedBytes}, got ${bytes.byteLength}.`,
    );
  }
  const actual = await sha256Hex(bytes);
  if (actual !== expectedSha256) {
    throw new Error(
      `${label} SHA-256 mismatch: expected ${expectedSha256}, got ${actual}.`,
    );
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = asRecord(value, path);
  const expected = [...keys].sort();
  const actual = Object.keys(record).sort();
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new TypeError(`${path} must contain exactly: ${expected.join(", ")}.`);
  }
  return record;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return value as number;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function stableId(value: unknown, path: string): string {
  const text = nonEmptyString(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(text)) {
    throw new TypeError(
      `${path} must be a stable identifier (letters, digits, ._:-).`,
    );
  }
  return text;
}

function sha256Value(value: unknown, path: string): string {
  const text = nonEmptyString(value, path);
  if (!SHA256.test(text)) throw new TypeError(`${path} must be lowercase SHA-256 hex.`);
  return text;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.main) {
  const dryRun = Deno.args.length === 1 && Deno.args[0] === "--dry-run";
  if (!dryRun) {
    throw new TypeError(
      "native-smoke now requires a validated SysON anchor; run integrated-smoke for the live chain or pass --dry-run.",
    );
  }
  console.log(deterministicJson(dryRunSummary()));
}
