/** Qualification CAS document factory and anchored file store. */

import {
  type CapabilityRuntimeBindingQualificationAttestation,
  createCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeObservedHost,
} from "../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  isolatedCodeOutputManifestsEqual,
  runtimeAttestationsEqual,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { CapabilityRuntimeHostObservation } from "../../../domain/capability/runtime/capability-runtime-catalog.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "./fixed-geometry-module-assembly-execution.ts";
import {
  assertExactGeometryModuleAssemblerQualificationCandidate,
  createGeometryModuleAssemblerMicrosandboxQualificationCandidate,
  type GeometryModuleAssemblerMicrosandboxQualificationCandidate,
  geometryModuleAssemblerQualificationRuntime,
} from "./geometry-module-assembly-microsandbox-qualification-candidate.ts";
import {
  assertGeometryModuleAssemblerQualificationSemantics,
  canonicalGeometryModuleAssemblerQualificationTimestamp,
  createGeometryModuleAssemblerQualificationOutputValidator,
  rereadAndValidateGeometryModuleAssemblerQualificationOutputs,
  sameGeometryModuleAssemblyPolicy,
} from "./geometry-module-assembly-microsandbox-qualification-helpers.ts";

export const GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_CAPTURE_SCHEMA =
  "geometry-module-assembler-microsandbox-qualification-capture/1.0" as const;

export interface GeometryModuleAssemblerMicrosandboxQualificationOutcome {
  readonly schemaVersion:
    "geometry-module-assembler-microsandbox-qualification-outcome/1.0";
  readonly status: "qualified";
  readonly qualifiedAt: string;
  readonly candidate: { readonly id: string; readonly fingerprint: ContentFingerprint };
  readonly observedHost: {
    readonly identityFingerprint: ContentFingerprint;
    readonly platform: "linux/arm64";
    readonly fingerprint: ContentFingerprint;
  };
  readonly fixture: { readonly id: string; readonly fingerprint: ContentFingerprint };
  readonly execution: {
    readonly runId: string;
    readonly receipt: IsolatedCodeExecutionReceiptRecord;
    readonly outputs: readonly {
      readonly role: string;
      readonly byteCount: number;
      readonly sha256: string;
    }[];
  };
}

export interface GeometryModuleAssemblerMicrosandboxQualificationCapture {
  readonly schemaVersion:
    typeof GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_CAPTURE_SCHEMA;
  readonly outcome: GeometryModuleAssemblerMicrosandboxQualificationOutcome;
  readonly attestation: CapabilityRuntimeBindingQualificationAttestation;
}

export interface GeometryModuleAssemblerMicrosandboxQualificationReference {
  readonly uri: string;
  readonly fingerprint: ContentFingerprint;
}

export const GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_DESCRIPTOR = {
  kind: "geometry-module-assembler-microsandbox-qualification" as const,
  directory:
    "state/local/geometry-module-assembler-microsandbox-qualification/captures",
  uriNamespace: "geometry-module-assembler-microsandbox-qualification",
  label: "Geometry-module assembler Microsandbox qualification",
};

export async function createGeometryModuleAssemblerMicrosandboxQualificationCapture(
  input: {
    readonly candidate: GeometryModuleAssemblerMicrosandboxQualificationCandidate;
    /**
     * Independent server-created expected authority. Omit only for the active
     * catalogue pin; imported-candidate capture must pass the bound-record
     * factory rather than trust fields inside the candidate value.
     */
    readonly expectedCandidate?: () => Promise<
      GeometryModuleAssemblerMicrosandboxQualificationCandidate
    >;
    readonly qualifiedAt: string;
    /** Authoritative capability-runtime observation; never Deno.build. */
    readonly observedHost: CapabilityRuntimeHostObservation;
    readonly receipt: IsolatedCodeExecutionReceipt;
    readonly publishedReceipt: IsolatedCodeExecutionReceiptRecord;
    readonly outputBytes: readonly {
      readonly role: string;
      readonly bytes: Uint8Array;
    }[];
    readonly validateOutput?: (
      declaration: (typeof GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST)[number],
      bytes: Uint8Array,
    ) => Promise<void>;
  },
): Promise<GeometryModuleAssemblerMicrosandboxQualificationCapture> {
  const candidate = await assertExactGeometryModuleAssemblerQualificationCandidate(
    input.candidate,
    await (input.expectedCandidate ??
      createGeometryModuleAssemblerMicrosandboxQualificationCandidate)(),
  );
  const qualifiedAt = canonicalGeometryModuleAssemblerQualificationTimestamp(
    input.qualifiedAt,
  );
  const receipt = isolatedCodeExecutionReceiptRecord(input.receipt);
  if (deterministicJson(receipt) !== deterministicJson(input.publishedReceipt)) {
    throw new TypeError("The qualification CAS receipt differs from the run receipt.");
  }
  if (
    receipt.runId === "" || receipt.producerGeneration !== 0 ||
    receipt.profile.id !== candidate.profile.id ||
    receipt.profile.version !== candidate.profile.version ||
    receipt.sourceSha256 !== candidate.fixture.bundle.fingerprint.digest ||
    !sameGeometryModuleAssemblyPolicy(receipt.policy, candidate.policy) ||
    !runtimeAttestationsEqual(
      receipt.runtime,
      geometryModuleAssemblerQualificationRuntime(candidate),
    ) ||
    receipt.termination.kind !== "exited" || receipt.termination.exitCode !== 0 ||
    receipt.termination.signal !== null || receipt.destruction.status !== "proven" ||
    receipt.destruction.runId !== receipt.runId ||
    !isolatedCodeOutputManifestsEqual(
      receipt.outputs,
      GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError(
      "The geometry-module qualification did not close the exact runtime, outputs and destruction.",
    );
  }
  const outputs = await rereadAndValidateGeometryModuleAssemblerQualificationOutputs(
    receipt,
    input.outputBytes,
    input.validateOutput ??
      createGeometryModuleAssemblerQualificationOutputValidator(),
  );
  const outputByRole = new Map(input.outputBytes.map((output) => [
    output.role,
    output.bytes,
  ]));
  await assertGeometryModuleAssemblerQualificationSemantics(candidate, outputByRole);
  if (input.observedHost.platform !== "linux/arm64") {
    throw new TypeError(
      "The geometry-module qualification requires an observed linux/arm64 runtime host.",
    );
  }
  const observedHost = {
    identityFingerprint: input.observedHost.identityFingerprint,
    platform: input.observedHost.platform,
    fingerprint: await fingerprintCapabilityRuntimeObservedHost(
      input.observedHost.platform,
      input.observedHost.identityFingerprint,
    ),
  };
  const outcome: GeometryModuleAssemblerMicrosandboxQualificationOutcome = Object
    .freeze({
      schemaVersion: "geometry-module-assembler-microsandbox-qualification-outcome/1.0",
      status: "qualified",
      qualifiedAt,
      candidate: { id: candidate.id, fingerprint: candidate.fingerprint },
      observedHost,
      fixture: {
        id: candidate.fixture.id,
        fingerprint: candidate.fixture.bundle.fingerprint,
      },
      execution: { runId: receipt.runId, receipt, outputs },
    });
  const outcomeFingerprint = await sha256Fingerprint(outcome);
  const attestationBody = {
    schemaVersion: "capability-runtime-binding-qualification-attestation/1.1" as const,
    state: "qualified" as const,
    recordedAt: outcome.qualifiedAt,
    binding: candidate.binding,
    selector: candidate.selector,
    contract: candidate.contract,
    profile: candidate.profile,
    unit: candidate.unit,
    material: candidate.material,
    targetPlatform: candidate.targetPlatform,
    mode: candidate.mode,
    launchGroup: candidate.launchGroup,
    observedHost,
    fixture: outcome.fixture,
    qualificationSpec: {
      id: candidate.specification.id,
      fingerprint: candidate.specification.fingerprint,
    },
    outcome: {
      id:
        `geometry-module-assembler-qualification-outcome-${outcomeFingerprint.digest}`,
      fingerprint: outcomeFingerprint,
    },
  };
  const attestation = await createCapabilityRuntimeBindingQualificationAttestation({
    ...attestationBody,
    fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
      attestationBody,
    ),
  });
  return Object.freeze({
    schemaVersion: GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_CAPTURE_SCHEMA,
    outcome,
    attestation,
  });
}

export class FileGeometryModuleAssemblerMicrosandboxQualificationStore {
  readonly #store: FileCaptureStore<
    "geometry-module-assembler-microsandbox-qualification"
  >;

  constructor(
    directory =
      GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_DESCRIPTOR.directory,
  ) {
    this.#store = new FileCaptureStore({
      ...GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_QUALIFICATION_DESCRIPTOR,
      directory,
    });
  }

  async save(
    capture: GeometryModuleAssemblerMicrosandboxQualificationCapture,
  ): Promise<GeometryModuleAssemblerMicrosandboxQualificationReference> {
    const fingerprint = await sha256Fingerprint(capture);
    const text = deterministicJson(capture);
    const persisted = await this.#store.save(fingerprint, text);
    const reread = await this.#store.read(fingerprint);
    if (reread !== text) {
      throw new Error(
        "The geometry-module qualification capture failed durable reread.",
      );
    }
    return Object.freeze({ uri: persisted.uri, fingerprint });
  }
}
