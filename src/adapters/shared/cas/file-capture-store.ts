import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";

/**
 * Descriptor for a content-addressed capture store.
 *
 * `uriNamespace` is a mandatory literal field and must never be derived from
 * `directory`, `kind`, or any automatic pattern. 552 `casys://` URIs are
 * already written in immutable proof files under `state/`, and their
 * namespaces are reviewed identities. Any derivation rule could silently
 * produce wrong URIs and invalidate existing proofs.
 */
export interface CaptureStoreDescriptor<Kind extends string> {
  /** Nominal identity; makes two stores of different kinds compile-time incompatible. */
  readonly kind: Kind;
  /** File-system directory where `<digest>.json` files are persisted. */
  readonly directory: string;
  /**
   * The segment following `casys://` in every URI produced by this store.
   * Copy verbatim from the original per-store implementation — never derive.
   */
  readonly uriNamespace: string;
  /** Short human-readable label used in error messages, e.g. "Architecture". */
  readonly label: string;
  /** Explicit fsync ceiling for an absolute temporary store. */
  readonly syncBoundary?: string;
}

export interface CaptureDirectorySyncFileSystem {
  open(
    path: string,
    options: Deno.OpenOptions,
  ): Promise<Pick<Deno.FsFile, "sync" | "close">>;
}

const DENO_CAPTURE_DIRECTORY_SYNC_FILE_SYSTEM: CaptureDirectorySyncFileSystem = {
  open: (path, options) => Deno.open(path, options),
};

/**
 * Generic content-addressed capture store parameterised by a nominal `Kind`.
 *
 * The private `_kind` field carries `Kind` into the structural shape of the
 * class so that `FileCaptureStore<"geometry-capture">` is structurally
 * incompatible with `FileCaptureStore<"architecture-capture">` at
 * compile time. An executor holding a typed store reference cannot silently
 * receive a store of a different kind — the compiler rejects the assignment.
 *
 * Durability tier: every write uses a partial-write loop, `syncData()`, then
 * `syncDirectoryChain()` up to the `state` directory boundary. No existing
 * store's durability is regressed.
 */
export class FileCaptureStore<Kind extends string> {
  /**
   * Phantom type field. Never assigned at runtime; exists solely to make
   * TypeScript record `Kind` in the class's structural type so that two
   * instantiations with different `Kind` strings are compile-time incompatible.
   */
  declare private readonly _kind: Kind;

  private readonly descriptor: CaptureStoreDescriptor<Kind>;

  constructor(descriptor: CaptureStoreDescriptor<Kind>) {
    const directory = withoutTrailingSlash(descriptor.directory) || ".";
    const syncBoundary = descriptor.syncBoundary === undefined
      ? undefined
      : withoutTrailingSlash(descriptor.syncBoundary) || ".";
    if (syncBoundary !== undefined && !containsPath(syncBoundary, directory)) {
      throw new TypeError(
        "Capture sync boundary must contain the capture directory.",
      );
    }
    this.descriptor = Object.freeze({
      ...descriptor,
      directory,
      ...(syncBoundary === undefined ? {} : { syncBoundary }),
    });
  }

  uriFor(fingerprint: ContentFingerprint): string {
    const d = sha256Digest(fingerprint);
    return `casys://${this.descriptor.uriNamespace}/sha256/${d}`;
  }

  /** Public so tests can inject corrupted bytes for corruption-detection checks. */
  pathFor(fingerprint: ContentFingerprint): string {
    const d = sha256Digest(fingerprint);
    return `${this.descriptor.directory.replace(/\/$/, "")}/${d}.json`;
  }

  /**
   * Persist exactly the bytes named by `fingerprint`.
   *
   * Identical content on a second call is an idempotent success; divergent
   * bytes under the same digest are a hard integrity conflict. The write path
   * applies a partial-write loop, `syncData()`, and `syncDirectoryChain()` to
   * guarantee durability up to the `state` directory boundary.
   */
  async save(
    fingerprint: ContentFingerprint,
    text: string,
  ): Promise<{ readonly uri: string; readonly path: string }> {
    const d = sha256Digest(fingerprint);
    const bytes = new TextEncoder().encode(text);
    const actual = await fingerprintBytes(bytes);
    if (actual !== d) {
      throw new Error(
        `${this.descriptor.label} capture content does not match declared sha256 ${d}.`,
      );
    }

    const path = this.pathFor(fingerprint);
    await Deno.mkdir(this.descriptor.directory, { recursive: true });
    try {
      await writeNewDurably(path, bytes, this.descriptor.label);
      await syncCaptureDirectoryChain(
        this.descriptor.directory,
        this.descriptor.syncBoundary,
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      const existing = await Deno.readTextFile(path);
      if (existing !== text) {
        throw new Error(
          `${this.descriptor.label} capture ${d} already exists with different content.`,
        );
      }
      // A concurrent writer may have linked the identical final just before
      // its own directory fsync. The idempotent loser owns the same success
      // guarantee and therefore closes that durability window before return.
      await syncCaptureDirectoryChain(
        this.descriptor.directory,
        this.descriptor.syncBoundary,
      );
    }
    return { uri: this.uriFor(fingerprint), path };
  }

  async read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    const path = this.pathFor(fingerprint);
    try {
      const text = await Deno.readTextFile(path);
      const actual = await fingerprintBytes(new TextEncoder().encode(text));
      if (actual !== fingerprint.digest) {
        throw new Error(
          `${this.descriptor.label} capture ${fingerprint.digest} does not match its filename digest.`,
        );
      }
      return text;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }
}

// ── Descriptors ─────────────────────────────────────────────────────────────
//
// `directory` and `uriNamespace` are literal values copied verbatim from the
// original per-store implementations. Changing either would invalidate URIs
// already written in `state/` or move files to a different directory.

export const APPROVED_BRIEF_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "approved-brief"
> = {
  kind: "approved-brief",
  directory: "state/local/approved-brief-captures",
  uriNamespace: "approved-brief-capture",
  label: "Approved-brief",
};

/**
 * Provider-free, human-signed closeout record for the generic static
 * mechanical family.  This is distinct from the CalculiX execution and SysON
 * evaluation stores: it records a consequence over already persisted L4
 * evidence and never dispatches an engine or provider.
 */
export const EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "evaluation-closeout-capture"
> = {
  kind: "evaluation-closeout-capture",
  directory: "state/local/evaluation-closeout-captures",
  uriNamespace: "evaluation-closeout-capture",
  label: "Evaluation closeout",
};

export const EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX =
  "casys://evaluation-closeout-capture/" as const;

export const SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "syson-model-seed"
> = {
  kind: "syson-model-seed",
  directory: "state/local/syson-model-seed-captures",
  uriNamespace: "syson-model-seed-capture",
  label: "SysON model-seed",
};

/**
 * Generic project-agnostic architecture capture store.
 *
 * The URI prefix `casys://architecture-capture/sha256/<digest>` is the
 * discriminant used by the monotony ratchet and the generic product-structure
 * catalog projector. It must remain stable — changing it would invalidate URIs
 * already written in immutable proof files.
 */
export const ARCHITECTURE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "architecture-capture"
> = {
  kind: "architecture-capture",
  directory: "state/local/architecture-captures",
  uriNamespace: "architecture-capture",
  label: "Architecture",
};

/**
 * Shared prefix for all generic architecture capture URIs.
 *
 * Used by the executor (to build the capture URI), the ratchet check (to
 * identify architecture artifacts in previous revisions), and the generic
 * catalog projector (to locate the architecture artifact by URI prefix).
 * Must be consistent with ARCHITECTURE_CAPTURE_DESCRIPTOR.uriNamespace.
 */
export const ARCHITECTURE_CAPTURE_URI_PREFIX = "casys://architecture-capture/" as const;

/**
 * Generic project-agnostic PartDefinition structure capture store.
 *
 * The URI prefix `casys://part-definitions-capture/sha256/<digest>` is a
 * reviewed identity, distinct from `ARCHITECTURE_CAPTURE_URI_PREFIX` so the
 * architecture tip selector never confuses the two.
 */
export const PART_DEFINITIONS_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "part-definitions-capture"
> = {
  kind: "part-definitions-capture",
  directory: "state/local/part-definitions-captures",
  uriNamespace: "part-definitions-capture",
  label: "Part definitions",
};

export const PART_DEFINITIONS_CAPTURE_URI_PREFIX =
  "casys://part-definitions-capture/" as const;

/**
 * Canonical geometry captures (JSON) sealed by `design.write-geometry@1`.
 *
 * URI prefix `casys://geometry-capture/sha256/<digest>` is the discriminant
 * used by the monotony ratchet (`geometry_artifact_removed`).  It must remain
 * stable — changing it would invalidate URIs already written in immutable
 * proof files.
 */
export const GEOMETRY_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<"geometry-capture"> = {
  kind: "geometry-capture",
  directory: "state/local/geometry-captures",
  uriNamespace: "geometry-capture",
  label: "Geometry capture",
};

/**
 * Shared prefix for all canonical geometry capture URIs.
 *
 * Used by the executor (to build the artifact URI) and the monotony ratchet
 * (to identify geometry artifacts in previous revisions).  Must be consistent
 * with GEOMETRY_CAPTURE_DESCRIPTOR.uriNamespace.
 */
export const GEOMETRY_CAPTURE_URI_PREFIX = "casys://geometry-capture/" as const;

/**
 * Draft geometry captures (JSON) produced by admitted geometry export, later
 * sealed by `design.write-geometry@1`.
 *
 * These captures are NEVER addressable from a ThreadSnapshot (D2 decision).
 * The write executor (design.write-geometry@1) reads from this store only to
 * verify the draft digest before promoting bytes into the canonical thread.
 *
 * `uriNamespace` is `geometry-draft-capture` — distinct from the future
 * canonical geometry capture namespace so that the executor cannot confuse the
 * two at a URI-matching level.
 */
export const GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "geometry-draft"
> = {
  kind: "geometry-draft",
  directory: "state/local/geometry-drafts",
  uriNamespace: "geometry-draft-capture",
  label: "Geometry draft",
};

/**
 * Exact native CAD sources captured before syntax analysis or sandbox preview.
 *
 * The stored record contains the unmodified source text plus its independent
 * source-byte fingerprint and a selector (assembly or PartDefinition). Keeping
 * this store separate from the later geometry draft makes the causal order
 * explicit: source capture -> source analysis -> provider preview -> draft.
 */
export const GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "geometry-source"
> = {
  kind: "geometry-source",
  directory: "state/local/geometry-source-captures",
  uriNamespace: "geometry-source-capture",
  label: "Geometry source",
};

/**
 * Canonical project-brief source bytes captured before their local analysis.
 * This store is documentary only: it does not turn a brief into an admission.
 */
export const BRIEF_SOURCE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "brief-source-capture"
> = {
  kind: "brief-source-capture",
  directory: "state/local/brief-source-captures",
  uriNamespace: "brief-source-capture",
  label: "Brief source",
};

/** Exact server-rendered SysML bytes and source map, captured before analysis. */
export const SYSML_SOURCE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sysml-source-capture"
> = {
  kind: "sysml-source-capture",
  directory: "state/local/sysml-source-captures",
  uriNamespace: "sysml-source-capture",
  label: "SysML source",
};

/**
 * Provider-neutral source-analysis bundles. These records contain inferred
 * source-local facts only; their presence grants no execution authority.
 */
export const SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "source-analysis"
> = {
  kind: "source-analysis",
  directory: "state/local/source-analysis-captures",
  uriNamespace: "source-analysis-capture",
  label: "Source analysis",
};

/**
 * Generic requirements capture store for `model.write-requirements@1`.
 */
export const REQUIREMENTS_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "requirements-capture"
> = {
  kind: "requirements-capture",
  directory: "state/local/requirements-captures",
  uriNamespace: "requirements-capture",
  label: "Requirements",
};

export const REQUIREMENTS_CAPTURE_URI_PREFIX = "casys://requirements-capture/" as const;

/**
 * Content-addressed store for `fea-proof-case-capture/1.0` envelopes produced
 * by `verify.seal-proof-case@1`.
 *
 * URI: `casys://fea-proof-case-capture/sha256/<captureFp>`.
 * The captureFp IS the FileCaptureStore key (sha256 of the full envelope JSON).
 */
export const FEA_PROOF_CASE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "fea-proof-case"
> = {
  kind: "fea-proof-case",
  directory: "state/local/fea-proof-case-captures",
  uriNamespace: "fea-proof-case-capture",
  label: "FEA proof case",
};

export const SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sensitivity-study-case"
> = {
  kind: "sensitivity-study-case",
  directory: "state/local/sensitivity-study-case-captures",
  uriNamespace: "sensitivity-study-case-capture",
  label: "Sensitivity study case",
};

export const SENSITIVITY_CATALOG_OFFER_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sensitivity-catalog-offer"
> = {
  kind: "sensitivity-catalog-offer",
  directory: "state/local/sensitivity-catalog-offer-captures",
  uriNamespace: "sensitivity-catalog-offer-capture",
  label: "Sensitivity catalog offer",
};

export const SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sensitivity-study"
> = {
  kind: "sensitivity-study",
  directory: "state/local/sensitivity-study-captures",
  uriNamespace: "sensitivity-study-capture",
  label: "Sensitivity study",
};

export const SENSITIVITY_EDGES_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sensitivity-edges"
> = {
  kind: "sensitivity-edges",
  directory: "state/local/sensitivity-edges-captures",
  uriNamespace: "sensitivity-edges-capture",
  label: "Sensitivity edges",
};

export const SENSITIVITY_BASE_EVALUATION_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sensitivity-base-evaluation"
> = {
  kind: "sensitivity-base-evaluation",
  directory: "state/local/sensitivity-base-evaluation-captures",
  uriNamespace: "sensitivity-base-evaluation-capture",
  label: "Sensitivity-base evaluation",
};

export const PRINTABILITY_CASE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "printability-case"
> = {
  kind: "printability-case",
  directory: "state/local/printability-case-captures",
  uriNamespace: "printability-case-capture",
  label: "Printability case",
};

export const PRINTABILITY_OBSERVATION_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "printability-observation"
> = {
  kind: "printability-observation",
  directory: "state/local/printability-observation-captures",
  uriNamespace: "printability-observation-capture",
  label: "Printability observation",
};

/** Canonical factual L3 assembly-integrity observation captures. */
export const ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "assembly-integrity-observation"
> = {
  kind: "assembly-integrity-observation",
  directory: "state/local/assembly-integrity-observation-captures",
  uriNamespace: "assembly-integrity-observation-capture",
  label: "Assembly-integrity observation",
};

/** Provider-free L4 assembly-integrity evaluation captures. */
export const ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "assembly-integrity-evaluation-capture"
> = {
  kind: "assembly-integrity-evaluation-capture",
  directory: "state/local/assembly-integrity-evaluation-captures",
  uriNamespace: "assembly-integrity-evaluation-capture",
  label: "Assembly-integrity evaluation",
};

/**
 * Human L5 consequence over one exact L4 assembly-integrity capture. This
 * documentary store has no observer, provider, SysON, tolerance, or generic
 * RequirementEvaluation authority.
 */
export const ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR:
  CaptureStoreDescriptor<"assembly-integrity-evaluation-closeout"> = {
    kind: "assembly-integrity-evaluation-closeout",
    directory: "state/local/assembly-integrity-evaluation-closeout-captures",
    uriNamespace: "assembly-integrity-evaluation-closeout",
    label: "Assembly-integrity evaluation closeout",
  };

export const PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "print-estimate-case"
> = {
  kind: "print-estimate-case",
  directory: "state/local/print-estimate-case-captures",
  uriNamespace: "print-estimate-case-capture",
  label: "Print-estimate case",
};

export const PRINT_ESTIMATE_OBSERVATION_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "print-estimate-observation"
> = {
  kind: "print-estimate-observation",
  directory: "state/local/print-estimate-observation-captures",
  uriNamespace: "print-estimate-observation-capture",
  label: "Print-estimate observation",
};

export const DFM_CASE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<"dfm-case"> = {
  kind: "dfm-case",
  directory: "state/local/dfm-case-captures",
  uriNamespace: "dfm-case-capture",
  label: "DFM case",
};

export const DFM_CHECK_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<"dfm-check"> = {
  kind: "dfm-check",
  directory: "state/local/dfm-check-captures",
  uriNamespace: "dfm-check-capture",
  label: "DFM check",
};

export const CORRECTION_PROPOSAL_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "correction-proposal"
> = {
  kind: "correction-proposal",
  directory: "state/local/correction-proposal-captures",
  uriNamespace: "correction-proposal-capture",
  label: "Correction proposal",
};

/**
 * Content-addressed store for `modelica-thermal-method-sheet/1.0`.
 * The sheet is a reviewed method document, not admission or OMC authority.
 *
 * URI: `casys://modelica-thermal-method-sheet-capture/sha256/<captureFp>`.
 */
export const THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "modelica-thermal-method-sheet"
> = {
  kind: "modelica-thermal-method-sheet",
  directory: "state/local/modelica-thermal-method-sheet-captures",
  uriNamespace: "modelica-thermal-method-sheet-capture",
  label: "Modelica thermal method sheet",
};

export const THERMAL_METHOD_SHEET_CAPTURE_URI_PREFIX =
  "casys://modelica-thermal-method-sheet-capture/" as const;

/**
 * Content-addressed store for admitted Modelica observation-evaluation
 * captures. Documentary L4 evidence only: no OMC, SysON HTTP or Thread path.
 *
 * URI: `casys://modelica-admitted-observation-evaluation-capture/sha256/<fp>`.
 */
export const ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "modelica-admitted-observation-evaluation"
> = {
  kind: "modelica-admitted-observation-evaluation",
  directory: "state/local/modelica-admitted-observation-evaluation-captures",
  uriNamespace: "modelica-admitted-observation-evaluation-capture",
  label: "Admitted Modelica observation evaluation",
};

export const ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX =
  "casys://modelica-admitted-observation-evaluation-capture/" as const;

/**
 * Content-addressed store for human L5 closeout of an L4 admitted Modelica
 * observation evaluation. Documentary only: no OMC or SysON call.
 *
 * URI: `casys://modelica-admitted-observation-evaluation-closeout/sha256/<fp>`.
 */
export const ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR:
  CaptureStoreDescriptor<"modelica-admitted-observation-evaluation-closeout"> = {
    kind: "modelica-admitted-observation-evaluation-closeout",
    directory: "state/local/modelica-admitted-observation-evaluation-closeout-captures",
    uriNamespace: "modelica-admitted-observation-evaluation-closeout",
    label: "Admitted Modelica observation evaluation closeout",
  };

export const ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX =
  "casys://modelica-admitted-observation-evaluation-closeout/" as const;

/**
 * Content-addressed store for `electrical-observation-method-sheet/1.0`.
 *
 * URI: `casys://electrical-observation-method-sheet-capture/sha256/<fp>`.
 */
export const ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR:
  CaptureStoreDescriptor<"electrical-observation-method-sheet"> = {
    kind: "electrical-observation-method-sheet",
    directory: "state/local/electrical-observation-method-sheet-captures",
    uriNamespace: "electrical-observation-method-sheet-capture",
    label: "Electrical observation method sheet",
  };

export const ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_URI_PREFIX =
  "casys://electrical-observation-method-sheet-capture/" as const;

/**
 * Documentary L4 capture for admitted SPICE observation evaluation.
 *
 * URI: `casys://spice-admitted-observation-evaluation-capture/sha256/<fp>`.
 */
export const SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR:
  CaptureStoreDescriptor<"spice-admitted-observation-evaluation"> = {
    kind: "spice-admitted-observation-evaluation",
    directory: "state/local/spice-admitted-observation-evaluation-captures",
    uriNamespace: "spice-admitted-observation-evaluation-capture",
    label: "Admitted SPICE observation evaluation",
  };

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX =
  "casys://spice-admitted-observation-evaluation-capture/" as const;

/**
 * Human L5 closeout of an L4 admitted SPICE observation evaluation.
 *
 * URI: `casys://spice-admitted-observation-evaluation-closeout/sha256/<fp>`.
 */
export const SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR:
  CaptureStoreDescriptor<"spice-admitted-observation-evaluation-closeout"> = {
    kind: "spice-admitted-observation-evaluation-closeout",
    directory: "state/local/spice-admitted-observation-evaluation-closeout-captures",
    uriNamespace: "spice-admitted-observation-evaluation-closeout",
    label: "Admitted SPICE observation evaluation closeout",
  };

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX =
  "casys://spice-admitted-observation-evaluation-closeout/" as const;

// ── Private helpers ──────────────────────────────────────────────────────────

function sha256Digest(fingerprint: ContentFingerprint): string {
  if (
    fingerprint.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(
      "A lowercase 64-character sha256 fingerprint is required.",
    );
  }
  return fingerprint.digest;
}

async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  // Copy into an ArrayBuffer-backed view before crossing the Web Crypto
  // boundary; the generic Uint8Array input may otherwise be
  // SharedArrayBuffer-backed, which Web Crypto refuses.
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function writeNewDurably(
  path: string,
  bytes: Uint8Array,
  label: string,
): Promise<void> {
  // Do not expose the content-addressed final name until all bytes are fsynced.
  // A short sibling name also avoids exceeding NAME_MAX for a long final path.
  const parent = path.slice(0, path.lastIndexOf("/"));
  const temporary = `${parent}/.${crypto.randomUUID()}.tmp`;
  try {
    const file = await Deno.open(temporary, { createNew: true, write: true });
    try {
      let written = 0;
      while (written < bytes.length) {
        const count = await file.write(bytes.subarray(written));
        if (count <= 0) {
          throw new Error(`${label} capture made no write progress.`);
        }
        written += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
    // link(2) publishes the complete inode without overwrite semantics. A
    // competing writer can only observe a complete final file and save() will
    // compare its exact bytes for idempotence/conflict.
    await Deno.link(temporary, path);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

/**
 * Fsync every directory from `path` up to (and including) the `state`
 * boundary, ensuring directory entries survive a crash before the caller
 * returns. Derived from the original per-family store implementations, now
 * consolidated into FileCaptureStore.
 */
export async function syncCaptureDirectoryChain(
  path: string,
  syncBoundary?: string,
  fileSystem: CaptureDirectorySyncFileSystem = DENO_CAPTURE_DIRECTORY_SYNC_FILE_SYSTEM,
): Promise<void> {
  let current = withoutTrailingSlash(path) || ".";
  const boundary = syncBoundary === undefined
    ? undefined
    : withoutTrailingSlash(syncBoundary) || ".";
  if (boundary !== undefined && !containsPath(boundary, current)) {
    throw new TypeError("Capture sync boundary must contain the capture directory.");
  }
  while (current !== "/") {
    const directory = await fileSystem.open(current, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    if (
      current === boundary || current === "state" || current.endsWith("/state")
    ) return;
    // A relative custom root is created in `.`. Persist that parent entry too,
    // then stop after its single sync rather than looping on `.` forever.
    if (current === ".") return;
    const parent = current.lastIndexOf("/");
    current = parent < 0 ? "." : parent === 0 ? "/" : current.slice(0, parent);
  }
}

function containsPath(boundary: string, path: string): boolean {
  return path === boundary || path.startsWith(`${boundary}/`);
}

function withoutTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}
