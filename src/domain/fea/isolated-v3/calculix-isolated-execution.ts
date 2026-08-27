/**
 * Closed input/output contract for a provider-free CalculiX static execution.
 *
 * The input is not an agent-authored Abaqus deck. It is a server-built binary
 * bundle containing one already-reviewed MechanicalProofCase and the exact STEP
 * bytes named by that proof. A fixed image-owned wrapper performs the lowering.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  fingerprintResourceBytes,
  type ImmutableBytes,
  immutableBytes,
  sha256Hex,
} from "../../compile/source/provider-resource-reader.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../seal-case/mechanical-proof-case.ts";
import type {
  IsolatedCodeExecutionReceiptRecord,
  IsolatedCodeOutputDeclaration,
  IsolatedCodeOutputReceiptRecord,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  isolatedCodeOutputManifestsEqual,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodeOutputReceiptRecord,
} from "../../compile/isolation/isolated-code-execution.ts";

export const CALCULIX_ISOLATED_INPUT_BUNDLE_SCHEMA =
  "calculix-isolated-static-input-bundle/1.0" as const;
export const CALCULIX_ISOLATED_REQUEST_SCHEMA =
  "calculix-isolated-static-request/1.0" as const;
export const CALCULIX_ISOLATED_RESULT_SCHEMA =
  "calculix-isolated-static-result/1.0" as const;
export const CALCULIX_ISOLATED_EVIDENCE_SCHEMA =
  "calculix-isolated-static-evidence/1.0" as const;
export const CALCULIX_ISOLATED_EXECUTION_PROFILE = Object.freeze({
  id: "calculix-static-proof-v1",
  version: "1.0.0",
});

const BUNDLE_MAGIC = new TextEncoder().encode(
  "CASYS-CALCULIX-STATIC-BUNDLE/1.0\n",
);
const MAXIMUM_MANIFEST_BYTES = 1_048_576;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const CALCULIX_ISOLATED_OUTPUT_MANIFEST:
  readonly IsolatedCodeOutputDeclaration[] = validateIsolatedCodeOutputManifest([
    output("input.step", "input.step", "model/step", "step"),
    output("request.json", "request.json", "application/json", "canonical-json"),
    output("mesh.geo", "mesh.geo", "text/plain", "gmsh-geo"),
    output("mesh.inp", "mesh.inp", "text/plain", "abaqus-inp"),
    output("gmsh.log", "gmsh.log", "text/plain", "utf8-log"),
    output("job.inp", "job.inp", "text/plain", "abaqus-inp"),
    output("ccx.log", "ccx.log", "text/plain", "utf8-log"),
    output("job.dat", "job.dat", "text/plain", "calculix-dat"),
    output("result.json", "result.json", "application/json", "canonical-json"),
  ]);

export interface CalculixIsolatedInputBundleManifest {
  readonly schemaVersion: typeof CALCULIX_ISOLATED_INPUT_BUNDLE_SCHEMA;
  readonly requestId: string;
  readonly proof: MechanicalProofCase;
  readonly proofFingerprint: ContentFingerprint;
  readonly effective: {
    readonly elementOrder: 1 | 2;
    readonly timeoutMs: number;
  };
  readonly step: {
    readonly basename: "input.step";
    readonly mediaType: "model/step";
    readonly byteCount: number;
    readonly sha256: string;
  };
}

export interface CalculixIsolatedInputBundle {
  readonly manifest: CalculixIsolatedInputBundleManifest;
  readonly bytes: ImmutableBytes;
  readonly fingerprint: ContentFingerprint;
  readonly stepBytes: ImmutableBytes;
}

export interface CalculixIsolatedExecutionIdentity {
  readonly schemaVersion: "1.0";
  readonly profile: typeof CALCULIX_ISOLATED_EXECUTION_PROFILE;
  readonly wrapper: {
    readonly id: "calculix-static-proof-v1";
    readonly version: "1.0.0";
  };
  readonly lowering: {
    readonly id: "calculix.static.abaqus-deck";
    readonly version: "1.0";
  };
  readonly engines: {
    readonly gmsh: { readonly command: "gmsh"; readonly version: string };
    readonly ccx: { readonly command: "ccx"; readonly version: string };
  };
  /** The OCI identity itself is attested by the runner receipt, not self-reported. */
  readonly image: { readonly status: "bound-by-isolated-runner-receipt" };
}

export interface CalculixIsolatedStaticResult {
  readonly schemaVersion: typeof CALCULIX_ISOLATED_RESULT_SCHEMA;
  readonly requestId: string;
  readonly executionIdentity: CalculixIsolatedExecutionIdentity;
  readonly inputArtifact: {
    readonly mediaType: "model/step";
    readonly byteCount: number;
    readonly sha256: string;
  };
  readonly mesh: {
    readonly nodes: number;
    readonly elements: number;
    readonly nodesPerSelection: Readonly<Record<string, number>>;
  };
  readonly constraints: {
    readonly fixedSelections: readonly string[];
    readonly loads: readonly {
      readonly selection: string;
      readonly forceN: readonly [number, number, number];
    }[];
  };
  readonly metrics: {
    readonly maximumDisplacement: {
      readonly value: number;
      readonly unit: "mm";
      readonly nodeId: number;
      readonly vectorMm: readonly [number, number, number];
    };
    readonly maximumVonMises: {
      readonly value: number;
      readonly unit: "MPa";
      readonly elementId: number;
    };
  };
}

export interface CalculixIsolatedRequestDocument {
  readonly schemaVersion: typeof CALCULIX_ISOLATED_REQUEST_SCHEMA;
  readonly requestId: string;
  readonly proofFingerprint: ContentFingerprint;
  readonly effective: CalculixIsolatedInputBundleManifest["effective"];
  readonly step: CalculixIsolatedInputBundleManifest["step"];
}

export interface CalculixIsolatedBatchInspector {
  buildMeshScript(input: {
    readonly stepPath: "input.step";
    readonly selections: readonly {
      readonly name: string;
      readonly box: {
        readonly min: readonly [number, number, number];
        readonly max: readonly [number, number, number];
      };
    }[];
    readonly meshSizeMm: number;
    readonly elementOrder: 1 | 2;
    readonly timeoutMs: number;
  }): string;
  inspectMesh(inpText: string): {
    readonly nodeCount: number;
    readonly elementCount: number;
    readonly maxNodeId: number;
    readonly nodesPerSet: Readonly<Record<string, number>>;
  };
  buildDeck(input: {
    readonly inpText: string;
    readonly maxNodeId: number;
    readonly material: { readonly eMpa: number; readonly nu: number };
    readonly fixed: readonly string[];
    readonly loads: readonly {
      readonly selection: string;
      readonly totalForceN: readonly [number, number, number];
    }[];
    readonly nodesPerSet: Readonly<Record<string, number>>;
  }): string;
  parseResult(datText: string): {
    readonly maxDisplacement: {
      readonly magnitudeMm: number;
      readonly nodeId: number;
      readonly vectorMm: readonly [number, number, number];
    };
    readonly maxVonMises: {
      readonly mpa: number;
      readonly elementId: number;
    };
  };
}

export interface CalculixIsolatedExecutionEvidence {
  readonly schemaVersion: typeof CALCULIX_ISOLATED_EVIDENCE_SCHEMA;
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly executedAt: string;
  readonly bundleFingerprint: ContentFingerprint;
  readonly proofFingerprint: ContentFingerprint;
  /** Exact server-owned wrapper/policy/runtime/output profile revision. */
  readonly executionProfileFingerprint: ContentFingerprint;
  /** Exact ROP2 identity retaining the reviewed MRTR and canonical input basis. */
  readonly authority: {
    readonly resolvedOperationPlanFingerprint: ContentFingerprint;
  };
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly executionIdentity: CalculixIsolatedExecutionIdentity;
  readonly result: CalculixIsolatedStaticResult;
  readonly outputs: readonly IsolatedCodeOutputReceiptRecord[];
  readonly fingerprint: ContentFingerprint;
}

export async function createCalculixIsolatedInputBundle(input: {
  readonly requestId: string;
  readonly proof: MechanicalProofCase;
  readonly stepBytes: Uint8Array;
  readonly elementOrder: 1 | 2;
  readonly timeoutMs: number;
}): Promise<CalculixIsolatedInputBundle> {
  const requestId = requestIdValue(input.requestId, "$bundle.requestId");
  const proof = validateMechanicalProofCase(input.proof);
  validateCalculixSelectionNames(proof);
  const stepBytes = copyBytes(input.stepBytes, "$bundle.stepBytes");
  validatePart21(stepBytes);
  const stepSha256 = await fingerprintResourceBytes(stepBytes);
  if (
    proof.expectedCadArtifact.format !== "step" ||
    proof.expectedCadArtifact.sha256 !== stepSha256 ||
    proof.expectedCadArtifact.bytes !== stepBytes.byteLength
  ) {
    throw new TypeError(
      "The isolated CalculiX bundle STEP must equal the reviewed proof-case artifact.",
    );
  }
  if (input.elementOrder !== 1 && input.elementOrder !== 2) {
    throw new TypeError("$bundle.elementOrder must be 1 or 2.");
  }
  const manifest: CalculixIsolatedInputBundleManifest = deepFreeze({
    schemaVersion: CALCULIX_ISOLATED_INPUT_BUNDLE_SCHEMA,
    requestId,
    proof,
    proofFingerprint: await sha256Fingerprint(proof),
    effective: {
      elementOrder: input.elementOrder,
      timeoutMs: positiveInteger(input.timeoutMs, "$bundle.timeoutMs"),
    },
    step: {
      basename: "input.step",
      mediaType: "model/step",
      byteCount: stepBytes.byteLength,
      sha256: stepSha256,
    },
  });
  const manifestBytes = new TextEncoder().encode(deterministicJson(manifest));
  if (manifestBytes.byteLength > MAXIMUM_MANIFEST_BYTES) {
    throw new TypeError("The isolated CalculiX bundle manifest is too large.");
  }
  const lengthBytes = new TextEncoder().encode(`${manifestBytes.byteLength}\n`);
  const bytes = concatBytes(BUNDLE_MAGIC, lengthBytes, manifestBytes, stepBytes);
  return deepFreeze({
    manifest,
    bytes: immutableBytes(bytes),
    fingerprint: {
      algorithm: "sha256",
      digest: await fingerprintResourceBytes(bytes),
    },
    stepBytes: immutableBytes(stepBytes),
  });
}

export async function parseCalculixIsolatedInputBundle(
  value: Uint8Array,
): Promise<CalculixIsolatedInputBundle> {
  const bytes = copyBytes(value, "$bundle.bytes");
  if (!startsWith(bytes, BUNDLE_MAGIC)) {
    throw new TypeError("The isolated CalculiX input bundle has an invalid magic.");
  }
  const lengthStart = BUNDLE_MAGIC.byteLength;
  const lengthEnd = bytes.indexOf(10, lengthStart);
  if (lengthEnd < 0 || lengthEnd - lengthStart > 10) {
    throw new TypeError("The isolated CalculiX bundle length header is invalid.");
  }
  const lengthText = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(lengthStart, lengthEnd),
  );
  if (!/^[1-9][0-9]*$/.test(lengthText)) {
    throw new TypeError("The isolated CalculiX bundle length is not canonical.");
  }
  const manifestLength = Number(lengthText);
  if (
    !Number.isSafeInteger(manifestLength) || manifestLength > MAXIMUM_MANIFEST_BYTES
  ) {
    throw new TypeError("The isolated CalculiX bundle manifest length is invalid.");
  }
  const manifestStart = lengthEnd + 1;
  const manifestEnd = manifestStart + manifestLength;
  if (manifestEnd >= bytes.byteLength) {
    throw new TypeError("The isolated CalculiX bundle has no exact STEP payload.");
  }
  const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(manifestStart, manifestEnd),
  );
  const manifest = await validateBundleManifest(JSON.parse(manifestText));
  if (deterministicJson(manifest) !== manifestText) {
    throw new TypeError("The isolated CalculiX bundle manifest is not canonical.");
  }
  const stepBytes = bytes.slice(manifestEnd);
  if (
    stepBytes.byteLength !== manifest.step.byteCount ||
    await fingerprintResourceBytes(stepBytes) !== manifest.step.sha256
  ) {
    throw new TypeError("The isolated CalculiX bundle STEP failed exact validation.");
  }
  validatePart21(stepBytes);
  return deepFreeze({
    manifest,
    bytes: immutableBytes(bytes),
    fingerprint: {
      algorithm: "sha256",
      digest: await fingerprintResourceBytes(bytes),
    },
    stepBytes: immutableBytes(stepBytes),
  });
}

export async function createCalculixIsolatedExecutionEvidence(input: {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly executedAt: string;
  readonly resolvedOperationPlanFingerprint: ContentFingerprint;
  readonly executionProfileFingerprint: ContentFingerprint;
  readonly bundle: CalculixIsolatedInputBundle;
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly outputBytes: ReadonlyMap<string, Uint8Array>;
  readonly inspector: CalculixIsolatedBatchInspector;
}): Promise<CalculixIsolatedExecutionEvidence> {
  const bundle = await parseCalculixIsolatedInputBundle(input.bundle.bytes.copy());
  if (!fingerprintsEqual(bundle.fingerprint, input.bundle.fingerprint)) {
    throw new TypeError("The isolated CalculiX bundle fingerprint changed.");
  }
  const receipt = await validateIsolatedCodeExecutionReceiptRecord(input.receipt);
  if (
    receipt.runId !== input.executionRunId ||
    receipt.sourceSha256 !== bundle.fingerprint.digest ||
    receipt.profile.id !== CALCULIX_ISOLATED_EXECUTION_PROFILE.id ||
    receipt.profile.version !== CALCULIX_ISOLATED_EXECUTION_PROFILE.version ||
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 ||
    receipt.termination.signal !== null ||
    receipt.destruction.status !== "proven" ||
    !isolatedCodeOutputManifestsEqual(
      receipt.outputs,
      CALCULIX_ISOLATED_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError(
      "The isolated CalculiX receipt does not bind the exact bundle and profile.",
    );
  }
  const outputs = receipt.outputs;
  const roles = outputs.map((output) => output.role);
  rejectDuplicates(roles, "$receipt.outputs roles");
  if (
    input.outputBytes.size !== outputs.length ||
    outputs.some((output) => !input.outputBytes.has(output.role))
  ) {
    throw new TypeError(
      "The isolated CalculiX evidence requires the complete output batch.",
    );
  }
  const exact = new Map<string, Uint8Array>();
  for (const output of outputs) {
    const bytes = copyBytes(
      input.outputBytes.get(output.role),
      `$outputs.${output.role}`,
    );
    if (
      bytes.byteLength !== output.byteCount ||
      await fingerprintResourceBytes(bytes) !== output.sha256
    ) {
      throw new TypeError(`The isolated CalculiX output ${output.role} is divergent.`);
    }
    exact.set(output.role, bytes);
  }
  if (!sameBytes(requiredOutput(exact, "input.step"), bundle.stepBytes.copy())) {
    throw new TypeError(
      "The isolated CalculiX wrapper did not preserve the exact STEP.",
    );
  }

  const request = validateCalculixIsolatedRequestDocument(parseCanonicalJson(
    requiredOutput(exact, "request.json"),
    "request.json",
  ));
  literalValue(request.requestId, bundle.manifest.requestId, "$request.requestId");
  if (!fingerprintsEqual(request.proofFingerprint, bundle.manifest.proofFingerprint)) {
    throw new TypeError(
      "request.json proof fingerprint differs from the input bundle.",
    );
  }
  if (
    deterministicJson(request.effective) !==
      deterministicJson(bundle.manifest.effective) ||
    deterministicJson(request.step) !== deterministicJson(bundle.manifest.step)
  ) {
    throw new TypeError("request.json differs from the exact bundle inputs.");
  }
  const result = validateCalculixIsolatedStaticResult(
    parseCanonicalJson(requiredOutput(exact, "result.json"), "result.json"),
    bundle.manifest,
  );
  validateCalculixIsolatedOutputBatch(
    bundle.manifest,
    exact,
    result,
    input.inspector,
  );
  const body = deepFreeze({
    schemaVersion: CALCULIX_ISOLATED_EVIDENCE_SCHEMA,
    projectId: safeId(input.projectId, "$evidence.projectId"),
    agentRunId: safeId(input.agentRunId, "$evidence.agentRunId"),
    executionRunId: safeId(input.executionRunId, "$evidence.executionRunId"),
    executedAt: iso(input.executedAt, "$evidence.executedAt"),
    bundleFingerprint: bundle.fingerprint,
    proofFingerprint: bundle.manifest.proofFingerprint,
    executionProfileFingerprint: validateContentFingerprint(
      input.executionProfileFingerprint,
      "$evidence.executionProfileFingerprint",
    ),
    authority: {
      resolvedOperationPlanFingerprint: validateContentFingerprint(
        input.resolvedOperationPlanFingerprint,
        "$evidence.authority.resolvedOperationPlanFingerprint",
      ),
    },
    receipt,
    executionIdentity: result.executionIdentity,
    result,
    outputs: deepFreeze([...outputs]),
  });
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export function validateCalculixIsolatedOutputBatch(
  bundle: CalculixIsolatedInputBundleManifest,
  outputBytes: ReadonlyMap<string, Uint8Array>,
  resultValue: unknown,
  inspector: CalculixIsolatedBatchInspector,
): void {
  const result = validateCalculixIsolatedStaticResult(resultValue, bundle);
  const meshGeo = exactUtf8(requiredOutput(outputBytes, "mesh.geo"), "mesh.geo");
  const meshInp = exactUtf8(requiredOutput(outputBytes, "mesh.inp"), "mesh.inp");
  const jobInp = exactUtf8(requiredOutput(outputBytes, "job.inp"), "job.inp");
  const jobDat = exactUtf8(requiredOutput(outputBytes, "job.dat"), "job.dat");
  const inspected = inspector.inspectMesh(meshInp);
  const expectedMeshGeo = inspector.buildMeshScript({
    stepPath: "input.step",
    selections: [
      ...bundle.proof.analysis.supports,
      ...bundle.proof.analysis.loads,
    ].map((item) => ({
      name: item.selection.name,
      box: {
        min: item.selection.box.min,
        max: item.selection.box.max,
      },
    })),
    meshSizeMm: bundle.proof.analysis.mesh.targetSize.value,
    elementOrder: bundle.effective.elementOrder,
    timeoutMs: bundle.effective.timeoutMs,
  });
  if (meshGeo !== expectedMeshGeo) {
    throw new TypeError(
      "mesh.geo is not the exact code-owned lowering of the proof selections.",
    );
  }
  const expectedMesh = {
    nodes: inspected.nodeCount,
    elements: inspected.elementCount,
    nodesPerSelection: inspected.nodesPerSet,
  };
  if (deterministicJson(result.mesh) !== deterministicJson(expectedMesh)) {
    throw new TypeError("result.json mesh differs from the exact mesh.inp.");
  }
  const proof = bundle.proof;
  const expectedDeck = inspector.buildDeck({
    inpText: meshInp,
    maxNodeId: inspected.maxNodeId,
    material: {
      eMpa: proof.analysis.material.youngModulus.value,
      nu: proof.analysis.material.poissonRatio.value,
    },
    fixed: proof.analysis.supports.map((item) => item.selection.name),
    loads: proof.analysis.loads.map((item) => ({
      selection: item.selection.name,
      totalForceN: item.force.value,
    })),
    nodesPerSet: inspected.nodesPerSet,
  });
  if (jobInp !== expectedDeck) {
    throw new TypeError(
      "job.inp is not the exact code-owned lowering of mesh.inp and the proof case.",
    );
  }
  const parsed = inspector.parseResult(jobDat);
  const expectedMetrics = {
    maximumDisplacement: {
      value: parsed.maxDisplacement.magnitudeMm,
      unit: "mm",
      nodeId: parsed.maxDisplacement.nodeId,
      vectorMm: parsed.maxDisplacement.vectorMm,
    },
    maximumVonMises: {
      value: parsed.maxVonMises.mpa,
      unit: "MPa",
      elementId: parsed.maxVonMises.elementId,
    },
  };
  if (deterministicJson(result.metrics) !== deterministicJson(expectedMetrics)) {
    throw new TypeError("result.json metrics differ from the exact job.dat.");
  }
}

export async function validateCalculixIsolatedExecutionEvidence(
  value: unknown,
): Promise<CalculixIsolatedExecutionEvidence> {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "agentRunId",
    "executionRunId",
    "executedAt",
    "bundleFingerprint",
    "proofFingerprint",
    "executionProfileFingerprint",
    "authority",
    "receipt",
    "executionIdentity",
    "result",
    "outputs",
    "fingerprint",
  ], "$evidence");
  literalValue(
    root.schemaVersion,
    CALCULIX_ISOLATED_EVIDENCE_SCHEMA,
    "$evidence.schemaVersion",
  );
  const receipt = await validateIsolatedCodeExecutionReceiptRecord(root.receipt);
  const authority = exactRecord(
    root.authority,
    ["resolvedOperationPlanFingerprint"],
    "$evidence.authority",
  );
  const outputs = Array.isArray(root.outputs)
    ? root.outputs.map((output, index) =>
      validateIsolatedCodeOutputReceiptRecord(
        output,
        `$evidence.outputs[${index}]`,
        receipt.runtime.requestedLimits.maxOutputFileBytes,
      )
    )
    : (() => {
      throw new TypeError("$evidence.outputs must be an array.");
    })();
  const body = deepFreeze({
    schemaVersion: CALCULIX_ISOLATED_EVIDENCE_SCHEMA,
    projectId: safeId(root.projectId, "$evidence.projectId"),
    agentRunId: safeId(root.agentRunId, "$evidence.agentRunId"),
    executionRunId: safeId(root.executionRunId, "$evidence.executionRunId"),
    executedAt: iso(root.executedAt, "$evidence.executedAt"),
    bundleFingerprint: validateContentFingerprint(
      root.bundleFingerprint,
      "$evidence.bundleFingerprint",
    ),
    proofFingerprint: validateContentFingerprint(
      root.proofFingerprint,
      "$evidence.proofFingerprint",
    ),
    executionProfileFingerprint: validateContentFingerprint(
      root.executionProfileFingerprint,
      "$evidence.executionProfileFingerprint",
    ),
    authority: {
      resolvedOperationPlanFingerprint: validateContentFingerprint(
        authority.resolvedOperationPlanFingerprint,
        "$evidence.authority.resolvedOperationPlanFingerprint",
      ),
    },
    receipt,
    executionIdentity: validateExecutionIdentity(root.executionIdentity),
    result: validateCalculixIsolatedStaticResult(root.result),
    outputs: deepFreeze(outputs),
  });
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$evidence.fingerprint",
  );
  if (!fingerprintsEqual(fingerprint, await sha256Fingerprint(body))) {
    throw new TypeError("$evidence.fingerprint does not match the evidence body.");
  }
  if (
    body.executionRunId !== body.receipt.runId ||
    body.bundleFingerprint.digest !== body.receipt.sourceSha256 ||
    deterministicJson(body.outputs) !== deterministicJson(body.receipt.outputs) ||
    deterministicJson(body.executionIdentity) !==
      deterministicJson(body.result.executionIdentity) ||
    body.receipt.profile.id !== CALCULIX_ISOLATED_EXECUTION_PROFILE.id ||
    body.receipt.profile.version !== CALCULIX_ISOLATED_EXECUTION_PROFILE.version ||
    body.receipt.termination.kind !== "exited" ||
    body.receipt.termination.exitCode !== 0 ||
    body.receipt.termination.signal !== null ||
    body.receipt.destruction.status !== "proven" ||
    !isolatedCodeOutputManifestsEqual(
      body.receipt.outputs,
      CALCULIX_ISOLATED_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError("The isolated CalculiX evidence identities diverge.");
  }
  return deepFreeze({ ...body, fingerprint });
}

export function validateCalculixIsolatedStaticResult(
  value: unknown,
  expected?: CalculixIsolatedInputBundleManifest,
): CalculixIsolatedStaticResult {
  const root = exactRecord(value, [
    "schemaVersion",
    "requestId",
    "executionIdentity",
    "inputArtifact",
    "mesh",
    "constraints",
    "metrics",
  ], "$result");
  literalValue(
    root.schemaVersion,
    CALCULIX_ISOLATED_RESULT_SCHEMA,
    "$result.schemaVersion",
  );
  const requestId = requestIdValue(root.requestId, "$result.requestId");
  if (expected && requestId !== expected.requestId) {
    throw new TypeError("result.json requestId differs from the input bundle.");
  }
  const inputArtifact = exactRecord(
    root.inputArtifact,
    ["mediaType", "byteCount", "sha256"],
    "$result.inputArtifact",
  );
  literalValue(
    inputArtifact.mediaType,
    "model/step",
    "$result.inputArtifact.mediaType",
  );
  const normalizedInput = {
    mediaType: "model/step" as const,
    byteCount: positiveInteger(
      inputArtifact.byteCount,
      "$result.inputArtifact.byteCount",
    ),
    sha256: sha256Hex(inputArtifact.sha256, "$result.inputArtifact.sha256"),
  };
  if (
    expected &&
    (normalizedInput.byteCount !== expected.step.byteCount ||
      normalizedInput.sha256 !== expected.step.sha256)
  ) {
    throw new TypeError("result.json input identity differs from the exact STEP.");
  }
  const mesh = exactRecord(
    root.mesh,
    ["nodes", "elements", "nodesPerSelection"],
    "$result.mesh",
  );
  const nodesPerSelection = integerRecord(
    mesh.nodesPerSelection,
    "$result.mesh.nodesPerSelection",
  );
  const meshNodes = positiveInteger(mesh.nodes, "$result.mesh.nodes");
  const meshElements = positiveInteger(mesh.elements, "$result.mesh.elements");
  if (Object.values(nodesPerSelection).some((count) => count > meshNodes)) {
    throw new TypeError(
      "$result.mesh.nodesPerSelection cannot exceed the mesh node count.",
    );
  }
  const constraints = exactRecord(
    root.constraints,
    ["fixedSelections", "loads"],
    "$result.constraints",
  );
  const fixedSelections = stringArray(
    constraints.fixedSelections,
    "$result.constraints.fixedSelections",
  );
  const loads = array(constraints.loads, "$result.constraints.loads").map(
    (load, index) => {
      const record = exactRecord(
        load,
        ["selection", "forceN"],
        `$result.constraints.loads[${index}]`,
      );
      return deepFreeze({
        selection: selection(
          record.selection,
          `$result.constraints.loads[${index}].selection`,
        ),
        forceN: vector(record.forceN, `$result.constraints.loads[${index}].forceN`),
      });
    },
  );
  rejectDuplicates(fixedSelections, "$result.constraints.fixedSelections");
  rejectDuplicates(loads.map((load) => load.selection), "$result.constraints.loads");
  if (fixedSelections.length === 0 || loads.length === 0) {
    throw new TypeError("$result.constraints must retain supports and loads.");
  }
  for (
    const name of [
      ...fixedSelections,
      ...loads.map((load) => load.selection),
    ]
  ) {
    if (!Object.hasOwn(nodesPerSelection, name)) {
      throw new TypeError(`$result constraint ${name} has no positive mesh count.`);
    }
  }
  if (expected) {
    const expectedFixed = expected.proof.analysis.supports.map((item) =>
      item.selection.name
    );
    const expectedLoads = expected.proof.analysis.loads.map((item) => ({
      selection: item.selection.name,
      forceN: item.force.value,
    }));
    if (
      deterministicJson(fixedSelections) !== deterministicJson(expectedFixed) ||
      deterministicJson(loads) !== deterministicJson(expectedLoads)
    ) {
      throw new TypeError("result.json constraints differ from the proof case.");
    }
  }
  const metrics = exactRecord(
    root.metrics,
    ["maximumDisplacement", "maximumVonMises"],
    "$result.metrics",
  );
  const displacement = exactRecord(
    metrics.maximumDisplacement,
    ["value", "unit", "nodeId", "vectorMm"],
    "$result.metrics.maximumDisplacement",
  );
  literalValue(displacement.unit, "mm", "$result.metrics.maximumDisplacement.unit");
  const stress = exactRecord(
    metrics.maximumVonMises,
    ["value", "unit", "elementId"],
    "$result.metrics.maximumVonMises",
  );
  literalValue(stress.unit, "MPa", "$result.metrics.maximumVonMises.unit");
  const displacementValue = nonNegative(
    displacement.value,
    "$result.metrics.maximumDisplacement.value",
  );
  const displacementVector = vector(
    displacement.vectorMm,
    "$result.metrics.maximumDisplacement.vectorMm",
  );
  const displacementNodeId = positiveInteger(
    displacement.nodeId,
    "$result.metrics.maximumDisplacement.nodeId",
  );
  const stressElementId = positiveInteger(
    stress.elementId,
    "$result.metrics.maximumVonMises.elementId",
  );
  const displacementMagnitude = Math.hypot(...displacementVector);
  if (
    Math.abs(displacementValue - displacementMagnitude) >
      8 * Number.EPSILON * Math.max(1, displacementValue, displacementMagnitude)
  ) {
    throw new TypeError(
      "$result.metrics.maximumDisplacement.value disagrees with vectorMm.",
    );
  }
  return deepFreeze({
    schemaVersion: CALCULIX_ISOLATED_RESULT_SCHEMA,
    requestId,
    executionIdentity: validateExecutionIdentity(root.executionIdentity),
    inputArtifact: normalizedInput,
    mesh: {
      nodes: meshNodes,
      elements: meshElements,
      nodesPerSelection,
    },
    constraints: { fixedSelections, loads },
    metrics: {
      maximumDisplacement: {
        value: displacementValue,
        unit: "mm",
        nodeId: displacementNodeId,
        vectorMm: displacementVector,
      },
      maximumVonMises: {
        value: nonNegative(stress.value, "$result.metrics.maximumVonMises.value"),
        unit: "MPa",
        elementId: stressElementId,
      },
    },
  });
}

export function validateCalculixIsolatedRequestDocument(
  value: unknown,
): CalculixIsolatedRequestDocument {
  const root = exactRecord(value, [
    "schemaVersion",
    "requestId",
    "proofFingerprint",
    "effective",
    "step",
  ], "$request");
  literalValue(
    root.schemaVersion,
    CALCULIX_ISOLATED_REQUEST_SCHEMA,
    "$request.schemaVersion",
  );
  const effective = exactRecord(
    root.effective,
    ["elementOrder", "timeoutMs"],
    "$request.effective",
  );
  if (effective.elementOrder !== 1 && effective.elementOrder !== 2) {
    throw new TypeError("$request.effective.elementOrder must be 1 or 2.");
  }
  const elementOrder: 1 | 2 = effective.elementOrder;
  const step = exactRecord(
    root.step,
    ["basename", "mediaType", "byteCount", "sha256"],
    "$request.step",
  );
  literalValue(step.basename, "input.step", "$request.step.basename");
  literalValue(step.mediaType, "model/step", "$request.step.mediaType");
  return deepFreeze({
    schemaVersion: CALCULIX_ISOLATED_REQUEST_SCHEMA,
    requestId: requestIdValue(root.requestId, "$request.requestId"),
    proofFingerprint: validateContentFingerprint(
      root.proofFingerprint,
      "$request.proofFingerprint",
    ),
    effective: {
      elementOrder,
      timeoutMs: positiveInteger(effective.timeoutMs, "$request.effective.timeoutMs"),
    },
    step: {
      basename: "input.step",
      mediaType: "model/step",
      byteCount: positiveInteger(step.byteCount, "$request.step.byteCount"),
      sha256: sha256Hex(step.sha256, "$request.step.sha256"),
    },
  });
}

/** Broker callback: format checks only; bundle-specific bindings are checked in evidence. */
export function validateCalculixIsolatedOutput(
  declaration: IsolatedCodeOutputDeclaration,
  bytes: Uint8Array,
): void {
  const expected = CALCULIX_ISOLATED_OUTPUT_MANIFEST.find((entry) =>
    entry.role === declaration.role
  );
  if (!expected || deterministicJson(expected) !== deterministicJson(declaration)) {
    throw new TypeError("The CalculiX output declaration is not registered.");
  }
  if (declaration.role === "input.step") {
    validatePart21(bytes);
    return;
  }
  if (declaration.role === "request.json") {
    const value = parseCanonicalJson(bytes, "request.json");
    validateCalculixIsolatedRequestDocument(value);
    return;
  }
  if (declaration.role === "result.json") {
    const value = parseCanonicalJson(bytes, "result.json");
    validateCalculixIsolatedStaticResult(value);
    return;
  }
  const text = exactUtf8(bytes, declaration.basename);
  if (text.includes("\0")) {
    throw new TypeError(`${declaration.basename} contains a NUL byte.`);
  }
  if (
    (declaration.role === "mesh.geo" || declaration.role === "mesh.inp" ||
      declaration.role === "job.inp" || declaration.role === "job.dat") &&
    text.length === 0
  ) {
    throw new TypeError(`${declaration.basename} must not be empty.`);
  }
  if (
    declaration.role === "mesh.geo" &&
    (!text.includes('Merge "input.step";') ||
      !text.includes('Physical Volume("PART")'))
  ) {
    throw new TypeError("mesh.geo is not the fixed STEP volume lowering.");
  }
  if (
    (declaration.role === "mesh.inp" || declaration.role === "job.inp") &&
    !text.includes("*NODE")
  ) {
    throw new TypeError(`${declaration.basename} has no Abaqus node block.`);
  }
}

async function validateBundleManifest(
  value: unknown,
): Promise<CalculixIsolatedInputBundleManifest> {
  const root = exactRecord(value, [
    "schemaVersion",
    "requestId",
    "proof",
    "proofFingerprint",
    "effective",
    "step",
  ], "$bundle.manifest");
  literalValue(
    root.schemaVersion,
    CALCULIX_ISOLATED_INPUT_BUNDLE_SCHEMA,
    "$bundle.manifest.schemaVersion",
  );
  const proof = validateMechanicalProofCase(root.proof);
  validateCalculixSelectionNames(proof);
  const proofFingerprint = validateContentFingerprint(
    root.proofFingerprint,
    "$bundle.manifest.proofFingerprint",
  );
  if (!fingerprintsEqual(proofFingerprint, await sha256Fingerprint(proof))) {
    throw new TypeError("The bundle proof fingerprint does not match its proof.");
  }
  const effective = exactRecord(
    root.effective,
    ["elementOrder", "timeoutMs"],
    "$bundle.manifest.effective",
  );
  if (effective.elementOrder !== 1 && effective.elementOrder !== 2) {
    throw new TypeError("$bundle.manifest.effective.elementOrder must be 1 or 2.");
  }
  const elementOrder: 1 | 2 = effective.elementOrder;
  const step = exactRecord(
    root.step,
    ["basename", "mediaType", "byteCount", "sha256"],
    "$bundle.manifest.step",
  );
  literalValue(step.basename, "input.step", "$bundle.manifest.step.basename");
  literalValue(step.mediaType, "model/step", "$bundle.manifest.step.mediaType");
  const normalized = deepFreeze({
    schemaVersion: CALCULIX_ISOLATED_INPUT_BUNDLE_SCHEMA,
    requestId: requestIdValue(root.requestId, "$bundle.manifest.requestId"),
    proof,
    proofFingerprint,
    effective: {
      elementOrder,
      timeoutMs: positiveInteger(
        effective.timeoutMs,
        "$bundle.manifest.effective.timeoutMs",
      ),
    },
    step: {
      basename: "input.step" as const,
      mediaType: "model/step" as const,
      byteCount: positiveInteger(
        step.byteCount,
        "$bundle.manifest.step.byteCount",
      ),
      sha256: sha256Hex(step.sha256, "$bundle.manifest.step.sha256"),
    },
  });
  if (
    normalized.step.byteCount !== proof.expectedCadArtifact.bytes ||
    normalized.step.sha256 !== proof.expectedCadArtifact.sha256
  ) {
    throw new TypeError("The bundle STEP identity differs from its proof case.");
  }
  return normalized;
}

function validateExecutionIdentity(value: unknown): CalculixIsolatedExecutionIdentity {
  const root = exactRecord(value, [
    "schemaVersion",
    "profile",
    "wrapper",
    "lowering",
    "engines",
    "image",
  ], "$executionIdentity");
  literalValue(root.schemaVersion, "1.0", "$executionIdentity.schemaVersion");
  const profile = exactRecord(
    root.profile,
    ["id", "version"],
    "$executionIdentity.profile",
  );
  literalValue(
    profile.id,
    CALCULIX_ISOLATED_EXECUTION_PROFILE.id,
    "$executionIdentity.profile.id",
  );
  literalValue(
    profile.version,
    CALCULIX_ISOLATED_EXECUTION_PROFILE.version,
    "$executionIdentity.profile.version",
  );
  const wrapper = exactRecord(
    root.wrapper,
    ["id", "version"],
    "$executionIdentity.wrapper",
  );
  literalValue(wrapper.id, "calculix-static-proof-v1", "$executionIdentity.wrapper.id");
  literalValue(wrapper.version, "1.0.0", "$executionIdentity.wrapper.version");
  const lowering = exactRecord(
    root.lowering,
    ["id", "version"],
    "$executionIdentity.lowering",
  );
  literalValue(
    lowering.id,
    "calculix.static.abaqus-deck",
    "$executionIdentity.lowering.id",
  );
  literalValue(lowering.version, "1.0", "$executionIdentity.lowering.version");
  const engines = exactRecord(
    root.engines,
    ["gmsh", "ccx"],
    "$executionIdentity.engines",
  );
  return deepFreeze({
    schemaVersion: "1.0",
    profile: CALCULIX_ISOLATED_EXECUTION_PROFILE,
    wrapper: { id: "calculix-static-proof-v1", version: "1.0.0" },
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    engines: {
      gmsh: engine(engines.gmsh, "gmsh"),
      ccx: engine(engines.ccx, "ccx"),
    },
    image: imageBinding(root.image),
  });
}

function imageBinding(
  value: unknown,
): { readonly status: "bound-by-isolated-runner-receipt" } {
  const root = exactRecord(value, ["status"], "$executionIdentity.image");
  literalValue(
    root.status,
    "bound-by-isolated-runner-receipt",
    "$executionIdentity.image.status",
  );
  return Object.freeze({ status: "bound-by-isolated-runner-receipt" });
}

function engine(value: unknown, name: "gmsh"): { command: "gmsh"; version: string };
function engine(value: unknown, name: "ccx"): { command: "ccx"; version: string };
function engine(value: unknown, name: "gmsh" | "ccx") {
  const root = exactRecord(
    value,
    ["command", "version"],
    `$executionIdentity.engines.${name}`,
  );
  literalValue(root.command, name, `$executionIdentity.engines.${name}.command`);
  return {
    command: name,
    version: nonEmptyText(root.version, `$executionIdentity.engines.${name}.version`),
  };
}

function output(role: string, basename: string, mediaType: string, format: string) {
  return { role, basename, mediaType, format };
}

function requestIdValue(value: unknown, path: string): string {
  const id = safeId(value, path);
  if (!REQUEST_ID.test(id)) throw new TypeError(`${path} is not a bounded request id.`);
  return id;
}

function copyBytes(value: unknown, path: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${path} must be bytes.`);
  return Uint8Array.from(value);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.byteLength >= prefix.byteLength &&
    prefix.every((byte, index) => value[index] === byte);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

function requiredOutput(
  outputs: ReadonlyMap<string, Uint8Array>,
  role: string,
): Uint8Array {
  const bytes = outputs.get(role);
  if (!bytes) throw new TypeError(`Missing isolated CalculiX output ${role}.`);
  return bytes;
}

function parseCanonicalJson(bytes: Uint8Array, label: string): unknown {
  const text = exactUtf8(bytes, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(`${label} is not JSON.`);
  }
  if (deterministicJson(parsed) !== text) {
    throw new TypeError(`${label} is not canonical JSON.`);
  }
  return parsed;
}

function exactUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} is not exact UTF-8.`);
  }
}

function validatePart21(bytes: Uint8Array): void {
  const text = exactUtf8(bytes, "input.step");
  if (
    !text.startsWith("ISO-10303-21;") ||
    !text.trimEnd().endsWith("END-ISO-10303-21;") ||
    text.includes("\0")
  ) {
    throw new TypeError("input.step is not one complete STEP Part 21 exchange file.");
  }
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  return deepFreeze(
    array(value, path).map((entry, index) => selection(entry, `${path}[${index}]`)),
  );
}

function selection(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(text)) {
    throw new TypeError(`${path} is not a valid selection.`);
  }
  return text;
}

function validateCalculixSelectionNames(proof: MechanicalProofCase): void {
  for (
    const name of [
      ...proof.analysis.supports.map((item) => item.selection.name),
      ...proof.analysis.loads.map((item) => item.selection.name),
    ]
  ) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(name)) {
      throw new TypeError(
        "The isolated CalculiX profile supports selection names of at most 61 characters.",
      );
    }
  }
}

function vector(value: unknown, path: string): readonly [number, number, number] {
  const values = array(value, path);
  if (values.length !== 3) throw new TypeError(`${path} must contain three values.`);
  return deepFreeze(
    [
      finite(values[0], `${path}[0]`),
      finite(values[1], `${path}[1]`),
      finite(values[2], `${path}[2]`),
    ] as const,
  );
}

function integerRecord(value: unknown, path: string): Readonly<Record<string, number>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const result: Record<string, number> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    selection(key, `${path}.key`);
    result[key] = positiveInteger(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
  }
  return deepFreeze(result);
}

function nonNegative(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number < 0) throw new TypeError(`${path} must be non-negative.`);
  return number;
}

function iso(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) ||
    Number.isNaN(Date.parse(text))
  ) {
    throw new TypeError(`${path} must be a canonical ISO timestamp.`);
  }
  return text;
}
