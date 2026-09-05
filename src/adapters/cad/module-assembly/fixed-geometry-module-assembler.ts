/** Current Build123d/Microsandbox implementation of the neutral assembler port. */

import {
  type GeometryModuleAssembler,
  GeometryModuleAssemblyError,
  type GeometryModuleAssemblyResult,
} from "../../../application/ports/out/cad/module-assembly/geometry-module-assembler.ts";
import type { GeometryModuleAssemblyExecutionProfileCatalog } from "./fixed-geometry-module-assembly-profile.ts";
import {
  IsolatedCodeExecutionRejectedError,
  type IsolatedCodeRunner,
  type IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_ASSETS,
  GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
  recrossGeometryModuleAssemblyReceipt,
} from "../../../domain/cad/module-assembly/geometry-module-assembly-receipt.ts";
import { GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "./fixed-geometry-module-assembly-execution.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  isolatedCodeOutputManifestsEqual,
  isolatedCodeRefsEqual,
  runtimeAttestationsEqual,
  validateIsolatedCodeExecutionReceiptRecord,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { safeId } from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";

export const FIXED_GEOMETRY_MODULE_ASSEMBLER_IMPLEMENTATION = Object.freeze(
  {
    id: "build123d-module-assembler-v1",
    version: "1.0.0",
  } as const,
);

export interface FixedGeometryModuleAssemblerDependencies {
  readonly profiles: GeometryModuleAssemblyExecutionProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  readonly publications: IsolatedOutputPublicationReader;
  /**
   * Adapter-only linearization seam.  It is invoked after the generation-zero
   * publication check and immediately before the native runner boundary.
   * The public GeometryModuleAssembler command remains provider-neutral.
   */
  readonly beforeDispatch?: (
    request: IsolatedCodeExecutionRequest,
  ) => Promise<void> | void;
}

export class FixedGeometryModuleAssembler implements GeometryModuleAssembler {
  readonly #profiles: GeometryModuleAssemblyExecutionProfileCatalog;
  readonly #runner: IsolatedCodeRunner;
  readonly #publications: IsolatedOutputPublicationReader;
  readonly #beforeDispatch?: (
    request: IsolatedCodeExecutionRequest,
  ) => Promise<void> | void;

  constructor(dependencies: FixedGeometryModuleAssemblerDependencies) {
    this.#profiles = dependencies.profiles;
    this.#runner = dependencies.runner;
    this.#publications = dependencies.publications;
    this.#beforeDispatch = dependencies.beforeDispatch;
  }

  async assemble(
    command: Parameters<GeometryModuleAssembler["assemble"]>[0],
  ): Promise<GeometryModuleAssemblyResult> {
    const runId = safeId(command.runId, "$geometryModuleAssembly.runId");
    try {
      const profile = await this.#profiles.initial();
      const request = executionRequest(runId, command.bundle, profile);
      const nativeReceipt = await this.#resolveOrRunGenerationZero(
        request,
        profile,
      );
      const record = isolatedCodeExecutionReceiptRecord(nativeReceipt);
      const step = requiredOutput(nativeReceipt, "assembly.step");
      const glb = requiredOutput(nativeReceipt, "assembly.glb");
      const receipt = recrossGeometryModuleAssemblyReceipt({
        schemaVersion: GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
        capability: GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
        runId,
        inputBundle: {
          fingerprint: command.bundle.fingerprint,
          byteCount: command.bundle.bytes.byteLength,
        },
        assembly: {
          step: {
            ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.step,
            fingerprint: { algorithm: "sha256", digest: step.sha256 },
            byteCount: step.byteCount,
          },
          glb: {
            ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb,
            fingerprint: { algorithm: "sha256", digest: glb.sha256 },
            byteCount: glb.byteCount,
          },
        },
        implementation: {
          ...FIXED_GEOMETRY_MODULE_ASSEMBLER_IMPLEMENTATION,
          evidenceFingerprint: await sha256Fingerprint(record),
        },
      }, {
        inputBundle: {
          fingerprint: command.bundle.fingerprint,
          byteCount: command.bundle.bytes.byteLength,
        },
        assemblyStep: {
          fingerprint: { algorithm: "sha256", digest: step.sha256 },
          bytes: step.byteCount,
        },
        assemblyGlb: {
          fingerprint: { algorithm: "sha256", digest: glb.sha256 },
          bytes: glb.byteCount,
        },
      });
      return Object.freeze({
        receipt,
        assemblyStep: step.bytes,
        assemblyGlb: glb.bytes,
      });
    } catch (cause) {
      if (cause instanceof GeometryModuleAssemblyError) throw cause;
      if (cause instanceof IsolatedCodeExecutionRejectedError) {
        throw new GeometryModuleAssemblyError(
          "The registered geometry-module assembler rejected the closed bundle.",
        );
      }
      throw new GeometryModuleAssemblyError(
        "The registered geometry-module assembler failed closed.",
      );
    }
  }

  async #resolveOrRunGenerationZero(
    request: IsolatedCodeExecutionRequest,
    profile: Awaited<
      ReturnType<GeometryModuleAssemblyExecutionProfileCatalog["initial"]>
    >,
  ): Promise<IsolatedCodeExecutionReceipt> {
    let resolution;
    try {
      resolution = await this.#publications.resolvePublicationByRunId(
        request.runId,
        0,
      );
    } catch {
      throw new GeometryModuleAssemblyError(
        "The existing assembly outcome could not be resolved safely.",
      );
    }
    if (resolution.status === "outcome-unknown") {
      throw new GeometryModuleAssemblyError(
        "The existing assembly outcome is unknown; redispatch is refused.",
      );
    }
    if (resolution.status === "published") {
      let receipt: IsolatedCodeExecutionReceipt | undefined;
      try {
        receipt = await this.#publications.readReceipt(resolution.ref);
      } catch {
        throw new GeometryModuleAssemblyError(
          "The existing assembly result could not be reopened.",
        );
      }
      if (
        !receipt ||
        deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
          deterministicJson(resolution.receipt)
      ) {
        throw new GeometryModuleAssemblyError(
          "The existing assembly result is absent or divergent.",
        );
      }
      await assertNativeReceiptMatches(receipt, request, profile);
      return receipt;
    }
    await this.#beforeDispatch?.(request);
    const receipt = await this.#runner.run(request);
    await assertNativeReceiptMatches(receipt, request, profile);
    return receipt;
  }
}

function executionRequest(
  runId: string,
  bundle: Parameters<GeometryModuleAssembler["assemble"]>[0]["bundle"],
  profile: Awaited<
    ReturnType<GeometryModuleAssemblyExecutionProfileCatalog["initial"]>
  >,
): IsolatedCodeExecutionRequest {
  if (
    !isolatedCodeRefsEqual(
      profile.executionProfile,
      GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
    ) ||
    !isolatedCodeOutputManifestsEqual(
      profile.outputManifest,
      GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
    )
  ) {
    throw new GeometryModuleAssemblyError(
      "The registered geometry-module assembler profile is divergent.",
    );
  }
  return {
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId,
    producerGeneration: 0,
    profile: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
    source: {
      bytes: bundle.bytes.copy(),
      sha256: bundle.fingerprint.digest,
    },
    policy: profile.isolationPolicy,
    outputs: GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
  };
}

async function assertNativeReceiptMatches(
  receipt: IsolatedCodeExecutionReceipt,
  request: IsolatedCodeExecutionRequest,
  profile: Awaited<
    ReturnType<GeometryModuleAssemblyExecutionProfileCatalog["initial"]>
  >,
): Promise<void> {
  const record = await validateIsolatedCodeExecutionReceiptRecord(
    isolatedCodeExecutionReceiptRecord(receipt),
  );
  if (
    record.runId !== request.runId ||
    record.producerGeneration !== 0 ||
    record.publication.ref.runId !== request.runId ||
    record.publication.ref.producerGeneration !== 0 ||
    !isolatedCodeRefsEqual(record.profile, request.profile) ||
    record.sourceSha256 !== request.source.sha256 ||
    !isolatedCodeRefsEqual(record.policy, request.policy) ||
    !isolatedCodeOutputManifestsEqual(record.outputs, request.outputs) ||
    !runtimeAttestationsEqual(record.runtime, profile.runtime) ||
    record.termination.kind !== "exited" ||
    record.termination.exitCode !== 0 ||
    record.termination.signal !== null ||
    record.destruction.status !== profile.minimumDestructionAssurance ||
    record.destruction.runId !== request.runId
  ) {
    throw new GeometryModuleAssemblyError(
      "The native assembly evidence differs from its registered execution context.",
    );
  }
}

function requiredOutput(
  receipt: IsolatedCodeExecutionReceipt,
  role: "assembly.step" | "assembly.glb",
): IsolatedCodeExecutionReceipt["outputs"][number] {
  const output = receipt.outputs.find((candidate) => candidate.role === role);
  if (!output) {
    throw new GeometryModuleAssemblyError(
      `The geometry-module assembler did not publish ${role}.`,
    );
  }
  return output;
}
