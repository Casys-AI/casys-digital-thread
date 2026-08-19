/** Exact pre-run qualification capture. A manifest selection is not a provider run. */
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
} from "../../../../domain/kernel/case-validation.ts";
import {
  compareAsciiCodeUnits,
  type ExpectedProviderResource,
  fingerprintResourceBytes,
  type ProviderResourceReader,
  sha256Hex,
  validateExpectedProviderResource,
} from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../../../shared/cas/file-byte-store.ts";

export const MODELICA_QUALIFIED_SOURCE_CAPTURE_SCHEMA =
  "modelica-qualified-source-capture/1.0" as const;

export type ModelicaQualifiedSourceRole =
  | "model"
  | "scenario"
  | "parameter_schema";

/**
 * Persisted, self-validating description of every source read from the
 * qualified Modelica method. It deliberately identifies a selection rather
 * than a provider run: the seal has no provider-side write effect.
 */
export interface ModelicaQualifiedSourceCaptureDocument {
  readonly schemaVersion: typeof MODELICA_QUALIFIED_SOURCE_CAPTURE_SCHEMA;
  readonly selection: {
    readonly modelId: string;
    readonly modelVersion: string;
    readonly scenarioId: string;
  };
  readonly manifestFingerprint: string;
  readonly artifacts: readonly {
    readonly role: ModelicaQualifiedSourceRole;
    readonly resource: ExpectedProviderResource;
    readonly cas: {
      readonly uri: string;
      readonly byteCount: number;
      readonly sha256: string;
    };
  }[];
}

export interface ModelicaQualifiedSourceCaptureRequest {
  readonly selection: {
    readonly modelId: string;
    readonly modelVersion: string;
    readonly scenarioId: string;
  };
  readonly manifestFingerprint: string;
  readonly resources: readonly (
    & { readonly role: ModelicaQualifiedSourceRole }
    & ExpectedProviderResource
  )[];
}
export interface ModelicaQualifiedSourceCaptureResult {
  readonly document: ModelicaQualifiedSourceCaptureDocument;
  readonly artifacts: readonly {
    readonly role: ModelicaQualifiedSourceRole;
    readonly stored: VerifiedStoredBytes<"modelica-qualified-source">;
    readonly resource: ExpectedProviderResource;
  }[];
  readonly capture: VerifiedStoredBytes<"modelica-qualified-source-capture">;
}
/** Captures selection-bound source bytes; it intentionally has no runId field. */
export class ModelicaQualifiedSourceCaptureService {
  constructor(
    private readonly d: {
      readonly reader: ProviderResourceReader;
      readonly artifacts: FileByteStore<"modelica-qualified-source">;
      readonly captures: FileByteStore<"modelica-qualified-source-capture">;
    },
  ) {}
  async capture(
    input: ModelicaQualifiedSourceCaptureRequest,
  ): Promise<ModelicaQualifiedSourceCaptureResult> {
    const request = validateCaptureRequest(input);
    const roles = new Set<ModelicaQualifiedSourceRole>();
    const uris = new Set<string>();
    if (
      request.resources.length < 2
    ) {
      throw new TypeError(
        "Qualified Modelica source capture requires a manifest fingerprint and model/scenario resources.",
      );
    }
    const artifacts = [] as Array<
      ModelicaQualifiedSourceCaptureResult["artifacts"][number]
    >;
    for (
      const resource of [...request.resources].sort((a, b) =>
        compareAsciiCodeUnits(a.role, b.role)
      )
    ) {
      if (roles.has(resource.role) || uris.has(resource.uri)) {
        throw new TypeError("Qualified Modelica source roles and URIs must be unique.");
      }
      roles.add(resource.role);
      uris.add(resource.uri);
      const expected: ExpectedProviderResource = {
        uri: resource.uri,
        mediaType: resource.mediaType,
        byteCount: resource.byteCount,
        sha256: resource.sha256,
      };
      const read = await this.d.reader.read(expected);
      const bytes = read.bytes.copy();
      if (
        bytes.byteLength !== expected.byteCount ||
        await fingerprintResourceBytes(bytes) !== expected.sha256
      ) {
        throw new TypeError(
          `Qualified Modelica ${resource.role} bytes do not match their exact tuple.`,
        );
      }
      const stored = await this.d.artifacts.save({
        algorithm: "sha256",
        digest: resource.sha256,
      }, bytes);
      const reread = await this.d.artifacts.read(stored.fingerprint);
      if (
        !reread || await fingerprintResourceBytes(reread.copy()) !== resource.sha256
      ) throw new Error("Qualified Modelica source was not durably reread.");
      artifacts.push({ role: resource.role, resource: expected, stored });
    }
    if (!roles.has("model") || !roles.has("scenario")) {
      throw new TypeError(
        "Qualified Modelica source capture requires model and scenario.",
      );
    }
    const document = validateModelicaQualifiedSourceCaptureDocument({
      schemaVersion: MODELICA_QUALIFIED_SOURCE_CAPTURE_SCHEMA,
      selection: request.selection,
      manifestFingerprint: request.manifestFingerprint,
      artifacts: artifacts.map((item) => ({
        role: item.role,
        resource: item.resource,
        cas: {
          uri: item.stored.uri,
          byteCount: item.stored.byteCount,
          sha256: item.stored.fingerprint.digest,
        },
      })),
    });
    const text = canonicalModelicaQualifiedSourceCaptureText(document);
    const digest = await fingerprintResourceBytes(new TextEncoder().encode(text));
    const capture = await this.d.captures.save(
      { algorithm: "sha256", digest },
      new TextEncoder().encode(text),
    );
    const reopened = await this.d.captures.read(capture.fingerprint);
    if (!reopened || decodeExactUtf8(reopened.copy()) !== text) {
      throw new Error("Qualified Modelica source capture was not durably reread.");
    }
    return Object.freeze({
      document,
      artifacts: Object.freeze(artifacts),
      capture,
    });
  }

  /**
   * Re-read a persisted source-capture document without consulting the
   * provider. Recovery uses this after a run has been claimed.
   */
  async reopen(
    value: unknown,
  ): Promise<readonly ModelicaQualifiedSourceCaptureResult["artifacts"][number][]> {
    const document = validateModelicaQualifiedSourceCaptureDocument(value);
    const reopened = [] as Array<
      ModelicaQualifiedSourceCaptureResult["artifacts"][number]
    >;
    for (const entry of document.artifacts) {
      const fingerprint = { algorithm: "sha256" as const, digest: entry.cas.sha256 };
      if (this.d.artifacts.uriFor(fingerprint) !== entry.cas.uri) {
        throw new Error("Qualified Modelica source capture has a foreign CAS URI.");
      }
      const bytes = await this.d.artifacts.read(fingerprint);
      if (
        !bytes || bytes.byteLength !== entry.cas.byteCount ||
        await fingerprintResourceBytes(bytes.copy()) !== entry.cas.sha256
      ) {
        throw new Error(
          "Qualified Modelica source was not durably reread during recovery.",
        );
      }
      reopened.push({
        role: entry.role,
        resource: entry.resource,
        stored: await this.d.artifacts.save(fingerprint, bytes.copy()),
      });
    }
    return Object.freeze(reopened);
  }

  /**
   * Re-read the capture envelope from its own namespace, validate its exact
   * canonical bytes, then re-open every referenced source without provider I/O.
   */
  async reopenCapture(input: {
    readonly uri: string;
    readonly byteCount: number;
    readonly sha256: string;
  }): Promise<ModelicaQualifiedSourceCaptureDocument> {
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: sha256Hex(input.sha256, "$capture.sha256"),
    };
    if (this.d.captures.uriFor(fingerprint) !== input.uri) {
      throw new Error("Qualified Modelica source capture has a foreign CAS URI.");
    }
    const bytes = await this.d.captures.read(fingerprint);
    if (
      !bytes || bytes.byteLength !== input.byteCount ||
      await fingerprintResourceBytes(bytes.copy()) !== input.sha256
    ) {
      throw new Error(
        "Qualified Modelica source capture was not durably reread during recovery.",
      );
    }
    const text = decodeExactUtf8(bytes.copy());
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Qualified Modelica source capture is not JSON.");
    }
    const document = validateModelicaQualifiedSourceCaptureDocument(parsed);
    if (
      canonicalModelicaQualifiedSourceCaptureText(document) !==
        text
    ) {
      throw new Error("Qualified Modelica source capture is not canonical.");
    }
    await this.reopen(document);
    return document;
  }
}

/** Exact, versioned readback contract for a Modelica qualification capture. */
export function validateModelicaQualifiedSourceCaptureDocument(
  value: unknown,
  path = "$modelicaQualifiedSourceCapture",
): ModelicaQualifiedSourceCaptureDocument {
  const root = exactRecord(
    value,
    ["schemaVersion", "selection", "manifestFingerprint", "artifacts"],
    path,
  );
  literalValue(
    root.schemaVersion,
    MODELICA_QUALIFIED_SOURCE_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const selection = validateSelection(root.selection, `${path}.selection`);
  const artifacts = arrayOf(root.artifacts, `${path}.artifacts`).map(
    (item, index) => {
      const entryPath = `${path}.artifacts[${index}]`;
      const entry = exactRecord(item, ["role", "resource", "cas"], entryPath);
      const role = validateRole(entry.role, `${entryPath}.role`);
      const resource = validateExpectedProviderResource(
        entry.resource,
        `${entryPath}.resource`,
      );
      const cas = exactRecord(
        entry.cas,
        ["uri", "byteCount", "sha256"],
        `${entryPath}.cas`,
      );
      const casResource = validateExpectedProviderResource({
        uri: cas.uri,
        mediaType: resource.mediaType,
        byteCount: cas.byteCount,
        sha256: cas.sha256,
      }, `${entryPath}.cas`);
      if (
        casResource.sha256 !== resource.sha256 ||
        casResource.byteCount !== resource.byteCount
      ) {
        throw new TypeError(
          `${entryPath}.cas must preserve the exact resource sha256 and byteCount.`,
        );
      }
      return deepFreeze({
        role,
        resource,
        cas: {
          uri: casResource.uri,
          byteCount: casResource.byteCount,
          sha256: casResource.sha256,
        },
      });
    },
  );
  if (artifacts.length < 2) {
    throw new TypeError(`${path}.artifacts must contain model and scenario.`);
  }
  rejectDuplicates(artifacts.map((item) => item.role), `${path}.artifacts roles`);
  rejectDuplicates(
    artifacts.map((item) => item.resource.uri),
    `${path}.artifacts URIs`,
  );
  artifacts.sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  if (
    !artifacts.some((item) => item.role === "model") ||
    !artifacts.some((item) => item.role === "scenario")
  ) {
    throw new TypeError(`${path}.artifacts must contain model and scenario.`);
  }
  return deepFreeze({
    schemaVersion: MODELICA_QUALIFIED_SOURCE_CAPTURE_SCHEMA,
    selection,
    manifestFingerprint: sha256Hex(
      root.manifestFingerprint,
      `${path}.manifestFingerprint`,
    ),
    artifacts,
  });
}

export function canonicalModelicaQualifiedSourceCaptureText(value: unknown): string {
  return deterministicJson(validateModelicaQualifiedSourceCaptureDocument(value));
}

function validateCaptureRequest(
  value: ModelicaQualifiedSourceCaptureRequest,
): ModelicaQualifiedSourceCaptureRequest {
  const selection = validateSelection(value.selection, "$request.selection");
  const manifestFingerprint = sha256Hex(
    value.manifestFingerprint,
    "$request.manifestFingerprint",
  );
  const resources = value.resources.map((resource, index) => ({
    role: validateRole(resource.role, `$request.resources[${index}].role`),
    ...validateExpectedProviderResource({
      uri: resource.uri,
      mediaType: resource.mediaType,
      byteCount: resource.byteCount,
      sha256: resource.sha256,
    }, `$request.resources[${index}]`),
  }));
  rejectDuplicates(
    resources.map((resource) => resource.role),
    "$request.resources roles",
  );
  rejectDuplicates(
    resources.map((resource) => resource.uri),
    "$request.resources URIs",
  );
  return deepFreeze({ selection, manifestFingerprint, resources });
}

function validateSelection(
  value: unknown,
  path: string,
): ModelicaQualifiedSourceCaptureRequest["selection"] {
  const record = exactRecord(value, ["modelId", "modelVersion", "scenarioId"], path);
  return deepFreeze({
    modelId: nonEmptyText(record.modelId, `${path}.modelId`),
    modelVersion: nonEmptyText(record.modelVersion, `${path}.modelVersion`),
    scenarioId: nonEmptyText(record.scenarioId, `${path}.scenarioId`),
  });
}

function validateRole(value: unknown, path: string): ModelicaQualifiedSourceRole {
  if (value === "model" || value === "scenario" || value === "parameter_schema") {
    return value;
  }
  throw new TypeError(`${path} must be model, scenario, or parameter_schema.`);
}

function decodeExactUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Qualified Modelica source capture is not valid UTF-8.");
  }
}
