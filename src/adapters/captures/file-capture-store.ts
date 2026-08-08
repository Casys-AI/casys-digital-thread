import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";

/**
 * Descriptor for a content-addressed capture store.
 *
 * `uriNamespace` is a mandatory literal field and must never be derived from
 * `directory`, `kind`, or any automatic pattern. 552 `casys://` URIs are
 * already written in immutable proof files under `state/`, and their
 * namespaces are irregular: six stores carry the `-capture` suffix but
 * `coffee-machine-cm01-v3-architecture` does not. Any derivation rule would
 * silently produce wrong URIs for that store and invalidate existing proofs.
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
  /** Short human-readable label used in error messages, e.g. "CM-01 Modelica". */
  readonly label: string;
}

/**
 * Generic content-addressed capture store parameterised by a nominal `Kind`.
 *
 * The private `_kind` field carries `Kind` into the structural shape of the
 * class so that `FileCaptureStore<"cm01-semantic-cad">` is structurally
 * incompatible with `FileCaptureStore<"cm01-drip-tray-mechanical">` at
 * compile time. An executor holding a typed store reference cannot silently
 * receive a store of a different kind — the compiler rejects the assignment.
 *
 * Durability tier: every write uses the highest tier available in the original
 * seven stores (nominal-modelica level): partial-write loop, `syncData()`,
 * then `syncDirectoryChain()` up to the `state` directory boundary. No
 * existing store's durability is regressed.
 */
export class FileCaptureStore<Kind extends string> {
  /**
   * Phantom type field. Never assigned at runtime; exists solely to make
   * TypeScript record `Kind` in the class's structural type so that two
   * instantiations with different `Kind` strings are compile-time incompatible.
   */
  declare private readonly _kind: Kind;

  constructor(private readonly descriptor: CaptureStoreDescriptor<Kind>) {}

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
      await syncDirectoryChain(this.descriptor.directory);
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
      await syncDirectoryChain(this.descriptor.directory);
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

export const CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "cm01-drip-tray-mechanical"
> = {
  kind: "cm01-drip-tray-mechanical",
  directory: "state/local/cm01-drip-tray-mechanical-captures",
  uriNamespace: "cm01-drip-tray-mechanical-capture",
  label: "CM-01 drip-tray mechanical",
};

export const CM01_ERPNEXT_BOM_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "cm01-erpnext-bom"
> = {
  kind: "cm01-erpnext-bom",
  directory: "state/local/cm01-erpnext-bom-captures",
  uriNamespace: "cm01-erpnext-bom-capture",
  label: "CM-01 ERPNext BOM",
};

export const CM01_NOMINAL_MODELICA_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "cm01-nominal-modelica"
> = {
  kind: "cm01-nominal-modelica",
  directory: "state/local/cm01-nominal-modelica-captures",
  uriNamespace: "cm01-nominal-modelica-capture",
  label: "CM-01 Modelica",
};

export const CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "cm01-semantic-cad"
> = {
  kind: "cm01-semantic-cad",
  directory: "state/local/cm01-semantic-cad-captures",
  uriNamespace: "cm01-semantic-cad-capture",
  label: "CM-01 CAD",
};

/**
 * Separate store for @3 captures (assembly + per-part STLs).  The kind
 * nominal makes `FileCaptureStore<"cm01-semantic-cad-r3">` structurally
 * incompatible with `FileCaptureStore<"cm01-semantic-cad">` at compile time,
 * so no executor can silently receive the wrong store.
 */
export const CM01_SEMANTIC_CAD_R3_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "cm01-semantic-cad-r3"
> = {
  kind: "cm01-semantic-cad-r3",
  directory: "state/local/cm01-semantic-cad-r3-captures",
  uriNamespace: "cm01-semantic-cad-r3-capture",
  label: "CM-01 CAD R3",
};

/**
 * NOTE: `uriNamespace` has NO "-capture" suffix here — intentional.
 * 552 `casys://` URIs in `state/` reference
 * `coffee-machine-cm01-v3-architecture` without that suffix.
 * Do not add it.
 */
export const COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR:
  CaptureStoreDescriptor<"coffee-machine-cm01-v3-architecture"> = {
    kind: "coffee-machine-cm01-v3-architecture",
    directory: "state/local/coffee-machine-cm01-v3-architecture-captures",
    uriNamespace: "coffee-machine-cm01-v3-architecture",
    label: "CM-01 architecture",
  };

export const SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "syson-model-seed"
> = {
  kind: "syson-model-seed",
  directory: "state/local/syson-model-seed-captures",
  uriNamespace: "syson-model-seed-capture",
  label: "SysON model-seed",
};

/** Capture of the bounded qualitative inspection-drone architecture only. */
export const INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR:
  CaptureStoreDescriptor<
    "inspection-drone-v4-architecture"
  > = {
    kind: "inspection-drone-v4-architecture",
    directory: "state/local/inspection-drone-v4-architecture-captures",
    uriNamespace: "inspection-drone-v4-architecture-capture",
    label: "Inspection-drone V4 architecture",
  };

/** Read-only documentary capture of the six reviewed drone PartDefinitions. */
export const INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR:
  CaptureStoreDescriptor<"inspection-drone-v4-part-definitions"> = {
    kind: "inspection-drone-v4-part-definitions",
    directory: "state/local/inspection-drone-v4-part-definitions-captures",
    uriNamespace: "inspection-drone-v4-part-definitions-capture",
    label: "Inspection-drone V4 part definitions",
  };

export const ORACLE_REQUIREMENTS_SEED_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "oracle-requirements-seed"
> = {
  kind: "oracle-requirements-seed",
  directory: "state/local/oracle-requirements-seed-captures",
  uriNamespace: "oracle-requirements-seed-capture",
  label: "Oracle requirements seed",
};

export const SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sensitivity-study"
> = {
  kind: "sensitivity-study",
  directory: "state/local/sensitivity-study-captures",
  uriNamespace: "sensitivity-study-capture",
  label: "Sensitivity study",
};

export const CM01_DRIP_TRAY_PRINTABILITY_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "cm01-drip-tray-printability"
> = {
  kind: "cm01-drip-tray-printability",
  directory: "state/local/cm01-drip-tray-printability-captures",
  uriNamespace: "cm01-drip-tray-printability-capture",
  label: "CM-01 DripTray printability",
};

export const SENSITIVITY_RELATIONS_SEED_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sensitivity-relations-seed"
> = {
  kind: "sensitivity-relations-seed",
  directory: "state/local/sensitivity-relations-seed-captures",
  uriNamespace: "sensitivity-relations-seed-capture",
  label: "Sensitivity relations seed",
};

export const CM01_DRIP_TRAY_PRINT_ESTIMATE_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "cm01-drip-tray-print-estimate"
> = {
  kind: "cm01-drip-tray-print-estimate",
  directory: "state/local/cm01-drip-tray-print-estimate-captures",
  uriNamespace: "cm01-drip-tray-print-estimate-capture",
  label: "CM-01 DripTray FFF print estimate",
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
 * Generic sensitivity-edge seed capture store (@2 operation).
 *
 * Distinct from SENSITIVITY_RELATIONS_SEED_CAPTURE_DESCRIPTOR (@1): the @2
 * operation inserts DripTraySensitivityEdges (not DripTraySensitivityRelations)
 * and its captures use SensitivityEdge[] as the payload. The separate kind
 * makes FileCaptureStore<"sensitivity-edges-seed"> structurally incompatible
 * with the @1 store at compile time.
 */
export const SENSITIVITY_EDGES_SEED_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "sensitivity-edges-seed"
> = {
  kind: "sensitivity-edges-seed",
  directory: "state/local/sensitivity-edges-seed-captures",
  uriNamespace: "sensitivity-edges-seed-capture",
  label: "Sensitivity edges seed",
};

export const CM01_PART_DEFINITIONS_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "cm01-part-definitions"
> = {
  kind: "cm01-part-definitions",
  directory: "state/local/cm01-part-definitions-captures",
  uriNamespace: "part-definitions-capture",
  label: "CM-01 part definitions",
};

/**
 * Generic requirements capture store for `model.write-requirements@1`.
 *
 * Distinct from the CM-01 oracle-requirements store: this store serves the
 * generic operation and uses a plain `requirements-capture` URI namespace.
 * The CM-01 oracle requirements store uses `oracle-requirements-seed-capture`;
 * the two are structurally incompatible at compile time through the `Kind`
 * parameter.
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
async function syncDirectoryChain(path: string): Promise<void> {
  let current = path.replace(/\/+$/, "") || ".";
  while (current !== "/") {
    const directory = await Deno.open(current, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    if (current === "state" || current.endsWith("/state")) return;
    // A relative custom root is created in `.`. Persist that parent entry too,
    // then stop after its single sync rather than looping on `.` forever.
    if (current === ".") return;
    const parent = current.lastIndexOf("/");
    current = parent < 0 ? "." : parent === 0 ? "/" : current.slice(0, parent);
  }
}
