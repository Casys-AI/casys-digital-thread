/**
 * Compose one exact static assembly basis with the closed observer profile.
 *
 * Static evidence reopening remains provider-free in
 * `ExactStaticAssemblyBasisResolver`; this vertical owns only its method
 * binding, input bundle encoding, and profile ceilings.
 */

import {
  type ExactStaticAssemblyBasisResolver,
  parseExactStaticAssemblyThreadBasis,
  readExactStaticAssemblySnapshotIdentity,
  sameExactStaticAssemblyThreadBasis,
} from "../../../application/ports/out/cad/exact-static-assembly-basis-resolver.ts";
import type {
  AssemblyIntegrityInputResolver,
  ExactAssemblyIntegrityInputRequest,
  ResolvedAssemblyIntegrityInput,
} from "../../../application/ports/out/cad/assembly-integrity/exact-assembly-integrity-input-resolver.ts";
import type { AssemblyIntegrityObserverProfileCatalog } from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observer.ts";
import { createAssemblyIntegrityInputBundle } from "../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import {
  sameAssemblyIntegrityObserverProfileRef,
  validateAssemblyIntegrityObserverProfile,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import { validateGeometryModuleReference } from "../../../domain/cad/canonical/geometry-module-reference.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
  safeVersion,
} from "../../../domain/kernel/case-validation.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { validateContentFingerprint } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";

export type ExactAssemblyIntegrityInputResolutionCode =
  | "basis-mismatch"
  | "identity-mismatch"
  | "profile-mismatch";

export class ExactAssemblyIntegrityInputResolutionError extends Error {
  constructor(
    readonly code: ExactAssemblyIntegrityInputResolutionCode,
    message: string,
  ) {
    super(message);
    this.name = "ExactAssemblyIntegrityInputResolutionError";
  }
}

export interface ExactAssemblyIntegrityInputReopenerOptions {
  /** Provider-free exact canonical module and STEP rereader. */
  readonly basis: ExactStaticAssemblyBasisResolver;
  /** Closed catalogue selected by server composition, never request input. */
  readonly profiles: AssemblyIntegrityObserverProfileCatalog;
}

export class ExactAssemblyIntegrityInputReopener
  implements AssemblyIntegrityInputResolver {
  readonly #basis: ExactStaticAssemblyBasisResolver;
  readonly #profiles: AssemblyIntegrityObserverProfileCatalog;

  constructor(options: ExactAssemblyIntegrityInputReopenerOptions) {
    exactRecord(
      options,
      ["basis", "profiles"],
      "$exactAssemblyIntegrityInputReopener",
    );
    this.#basis = options.basis;
    this.#profiles = options.profiles;
  }

  async resolve(
    value: ExactAssemblyIntegrityInputRequest,
  ): Promise<ResolvedAssemblyIntegrityInput> {
    const request = parseRequest(value);
    if (!sameExactStaticAssemblyThreadBasis(request.snapshot, request.basis)) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "basis-mismatch",
        "The supplied Thread snapshot does not equal the exact assembly-integrity basis.",
      );
    }
    const profile = await validateAssemblyIntegrityObserverProfile(
      await this.#profiles.resolve(request.observerProfile.profile),
    );
    if (
      !sameAssemblyIntegrityObserverProfileRef(
        profile.profile,
        request.observerProfile.profile,
      ) ||
      !fingerprintsEqual(
        profile.profileFingerprint,
        request.observerProfile.fingerprint,
      )
    ) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "profile-mismatch",
        "The reopened observer profile does not equal the exact server-selected profile identity.",
      );
    }
    const basis = await this.#basis.resolve({
      basis: request.basis,
      snapshot: request.snapshot,
      geometryModule: request.geometryModule,
    });
    if (
      basis.basis.snapshotId !== request.basis.snapshotId ||
      basis.basis.revision !== request.basis.revision ||
      basis.basis.subjectId !== request.basis.subjectId ||
      basis.geometryModule.artifactId !== request.geometryModule.artifactId ||
      !fingerprintsEqual(
        basis.geometryModule.fingerprint,
        request.geometryModule.fingerprint,
      )
    ) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "identity-mismatch",
        "The exact static assembly basis diverges from the requested canonical geometry identity.",
      );
    }
    if (basis.assemblyStepBytes.byteLength > profile.maximumStepBytes) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "profile-mismatch",
        "The exact assembly STEP exceeds the server-selected observer profile ceiling.",
      );
    }
    const inputBundle = await createAssemblyIntegrityInputBundle({
      geometryModule: basis.geometryModule,
      geometryModuleCapture: basis.capture,
      assemblyStepBytes: basis.assemblyStepBytes.copy(),
      method: profile.method,
    });
    if (
      inputBundle.manifest.occurrences.length > profile.maximumOccurrences ||
      inputBundle.manifest.occurrences.length *
            (inputBundle.manifest.occurrences.length - 1) / 2 >
        profile.maximumPairs
    ) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "profile-mismatch",
        "The exact module occurrence basis exceeds the server-selected observer profile ceiling.",
      );
    }
    return deepFreeze({
      ...basis,
      profile,
      observerProfile: request.observerProfile,
      inputBundle,
    });
  }
}

function parseRequest(value: unknown): ExactAssemblyIntegrityInputRequest {
  const root = exactRecord(
    value,
    ["basis", "snapshot", "geometryModule", "observerProfile"],
    "$exactAssemblyIntegrityInput",
  );
  if (readExactStaticAssemblySnapshotIdentity(root.snapshot) === undefined) {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "basis-mismatch",
      "The exact assembly-integrity input requires a persisted Thread snapshot.",
    );
  }
  return deepFreeze({
    basis: parseExactStaticAssemblyThreadBasis(
      root.basis,
      "$exactAssemblyIntegrityInput.basis",
    ),
    snapshot: root.snapshot as ThreadSnapshot,
    geometryModule: validateGeometryModuleReference(
      root.geometryModule,
      "$exactAssemblyIntegrityInput.geometryModule",
    ),
    observerProfile: parseObserverProfile(root.observerProfile),
  });
}

function parseObserverProfile(value: unknown): {
  readonly profile: { readonly id: string; readonly version: string };
  readonly fingerprint: ContentFingerprint;
} {
  const root = exactRecord(
    value,
    ["profile", "fingerprint"],
    "$exactAssemblyIntegrityInput.observerProfile",
  );
  const profile = exactRecord(
    root.profile,
    ["id", "version"],
    "$exactAssemblyIntegrityInput.observerProfile.profile",
  );
  return deepFreeze({
    profile: {
      id: safeId(profile.id, "$exactAssemblyIntegrityInput.observerProfile.profile.id"),
      version: safeVersion(
        profile.version,
        "$exactAssemblyIntegrityInput.observerProfile.profile.version",
      ),
    },
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$exactAssemblyIntegrityInput.observerProfile.fingerprint",
    ),
  });
}
