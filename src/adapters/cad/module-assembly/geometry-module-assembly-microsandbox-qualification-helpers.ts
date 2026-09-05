/** Shared exactness checks used by qualification capture and WAL recovery. */

import type { CapabilityRuntimeBindingQualificationAttestation } from "../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  createCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeBindingQualificationAttestation,
} from "../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type {
  IsolatedCodeExecutionReceiptRecord,
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedCodeRuntimeAttestation,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  isolatedCodeOutputManifestsEqual,
  isolatedCodeRefsEqual,
  runtimeAttestationsEqual,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "./fixed-geometry-module-assembly-execution.ts";
import { GeometryModuleAssemblyOutputValidator } from "./geometry-module-assembly-output-validator.ts";
import { assertTwoBracketQualificationSemantics } from "./geometry-module-assembly-qualification-oracle.ts";
import {
  type GeometryModuleAssemblerMicrosandboxQualificationCandidate,
  geometryModuleAssemblerQualificationRuntime,
} from "./geometry-module-assembly-microsandbox-qualification-candidate.ts";

export interface GeometryModuleAssemblerQualificationReceiptContext {
  readonly candidate: GeometryModuleAssemblerMicrosandboxQualificationCandidate;
  readonly observedHost: {
    readonly identityFingerprint: ContentFingerprint;
    readonly platform: "linux/arm64";
    readonly fingerprint: ContentFingerprint;
  };
  readonly profile: {
    readonly executionProfile: IsolatedCodeProfileRef;
    readonly isolationPolicy: IsolatedCodePolicyRef;
    readonly runtime: IsolatedCodeRuntimeAttestation;
    readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  };
  readonly runId: string;
}

export function sameGeometryModuleAssemblyPolicy(
  policy: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  },
  expected: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  },
): boolean {
  return policy.id === expected.id && policy.version === expected.version &&
    fingerprintsEqual(policy.fingerprint, expected.fingerprint);
}

export function assertExactGeometryModuleAssemblerQualificationReceipt(
  context: GeometryModuleAssemblerQualificationReceiptContext,
  receipt: IsolatedCodeExecutionReceiptRecord,
): void {
  if (
    receipt.runId !== context.runId || receipt.producerGeneration !== 0 ||
    receipt.publication.ref.runId !== context.runId ||
    receipt.publication.ref.producerGeneration !== 0 ||
    !isolatedCodeRefsEqual(receipt.profile, context.profile.executionProfile) ||
    receipt.profile.id !== context.candidate.profile.id ||
    receipt.profile.version !== context.candidate.profile.version ||
    receipt.sourceSha256 !== context.candidate.fixture.bundle.fingerprint.digest ||
    !sameGeometryModuleAssemblyPolicy(
      receipt.policy,
      context.profile.isolationPolicy,
    ) ||
    !sameGeometryModuleAssemblyPolicy(receipt.policy, context.candidate.policy) ||
    !runtimeAttestationsEqual(receipt.runtime, context.profile.runtime) ||
    !runtimeAttestationsEqual(
      receipt.runtime,
      geometryModuleAssemblerQualificationRuntime(context.candidate),
    ) ||
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 || receipt.termination.signal !== null ||
    !isolatedCodeOutputManifestsEqual(
      receipt.outputs,
      context.profile.outputManifest,
    ) ||
    !isolatedCodeOutputManifestsEqual(
      receipt.outputs,
      GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
    )
  ) {
    throw new Error(
      "Geometry-module qualification receipt differs from its exact execution context.",
    );
  }
}

export async function rereadAndValidateGeometryModuleAssemblerQualificationOutputs(
  receipt: IsolatedCodeExecutionReceiptRecord,
  outputBytes: readonly { readonly role: string; readonly bytes: Uint8Array }[],
  validateOutput: (
    declaration: (typeof GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST)[number],
    bytes: Uint8Array,
  ) => Promise<void>,
): Promise<
  readonly {
    readonly role: string;
    readonly byteCount: number;
    readonly sha256: string;
  }[]
> {
  const bytesByRole = new Map<string, Uint8Array>();
  for (const output of outputBytes) {
    if (bytesByRole.has(output.role)) {
      throw new TypeError("Qualification output reread has duplicate roles.");
    }
    bytesByRole.set(output.role, Uint8Array.from(output.bytes));
  }
  if (
    bytesByRole.size !== receipt.outputs.length ||
    receipt.outputs.some((output) => !bytesByRole.has(output.role))
  ) {
    throw new TypeError("Qualification output reread has an incomplete role set.");
  }
  const verified = await Promise.all(receipt.outputs.map(async (output) => {
    const bytes = bytesByRole.get(output.role)!;
    if (
      bytes.byteLength !== output.byteCount ||
      await fingerprintResourceBytes(bytes) !== output.sha256
    ) {
      throw new TypeError(
        `Qualification output ${output.role} drifted after CAS reread.`,
      );
    }
    const declaration = GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.find((candidate) =>
      candidate.role === output.role
    );
    if (!declaration) {
      throw new TypeError(`Qualification output ${output.role} is not declared.`);
    }
    await validateOutput(declaration, bytes);
    return {
      role: output.role,
      byteCount: output.byteCount,
      sha256: output.sha256,
    };
  }));
  return verified.toSorted((left, right) => left.role.localeCompare(right.role));
}

export function assertGeometryModuleAssemblerQualificationSemantics(
  candidate: GeometryModuleAssemblerMicrosandboxQualificationCandidate,
  outputBytes: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  return assertTwoBracketQualificationSemantics(
    candidate.fixture.bundle.stepBytes[0]!.copy(),
    outputBytes.get("assembly.step")!,
    outputBytes.get("assembly.glb")!,
  );
}

export function canonicalGeometryModuleAssemblerQualificationTimestamp(
  value: string,
): string {
  if (new Date(value).toISOString() !== value) {
    throw new TypeError("Qualification time must be an exact canonical UTC timestamp.");
  }
  return value;
}

export async function createGeometryModuleAssemblerQualificationRevocationScope(
  context: GeometryModuleAssemblerQualificationReceiptContext,
  recordedAt: string,
): Promise<CapabilityRuntimeBindingQualificationAttestation> {
  const body = {
    schemaVersion: "capability-runtime-binding-qualification-attestation/1.1" as const,
    state: "qualified" as const,
    recordedAt: canonicalGeometryModuleAssemblerQualificationTimestamp(recordedAt),
    binding: context.candidate.binding,
    selector: context.candidate.selector,
    contract: context.candidate.contract,
    profile: context.candidate.profile,
    unit: context.candidate.unit,
    material: context.candidate.material,
    targetPlatform: context.candidate.targetPlatform,
    mode: context.candidate.mode,
    launchGroup: context.candidate.launchGroup,
    observedHost: context.observedHost,
    fixture: {
      id: context.candidate.fixture.id,
      fingerprint: context.candidate.fixture.bundle.fingerprint,
    },
    qualificationSpec: {
      id: context.candidate.specification.id,
      fingerprint: context.candidate.specification.fingerprint,
    },
    outcome: {
      id: "geometry-module-assembler-qualification-revocation-scope",
      fingerprint: context.candidate.specification.fingerprint,
    },
  };
  return await createCapabilityRuntimeBindingQualificationAttestation({
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
      body,
    ),
  });
}

export function createGeometryModuleAssemblerQualificationOutputValidator() {
  return new GeometryModuleAssemblyOutputValidator().validateOutput;
}
