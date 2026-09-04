import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { ThreadArtifact } from "../../../domain/thread/thread-snapshot.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  RecordedAnalysisCasReader,
  type RecordedAnalysisCasStoreBinding,
  type RecordedAnalysisCasTuple,
} from "./recorded-analysis-cas-reader.ts";

const encoder = new TextEncoder();

/** Mirrors the two independent ThreadArtifact reader ports without importing an executor. */
interface ThreadArtifactReaderPort {
  read(artifact: Readonly<ThreadArtifact>): Promise<Uint8Array | undefined>;
}

/** Mirrors the receipt-bearing FEA artifact reader port. */
interface ExactThreadArtifactReaderPort {
  readArtifact(artifact: Readonly<ThreadArtifact>): Promise<
    | {
      readonly uri: string;
      readonly mediaType: string;
      readonly byteCount: number;
      readonly sha256: string;
      readonly bytes: Uint8Array;
    }
    | undefined
  >;
}

/** Mirrors the exact local CAS tuple reader port. */
interface TupleReaderPort {
  read(expected: Readonly<RecordedAnalysisCasTuple>): Promise<Uint8Array | undefined>;
}

Deno.test(
  "RecordedAnalysisCasReader reads proof, catalog-offer, requirements, and exact technical-admission captures",
  async () => {
    const fixture = await createFixture();
    try {
      const proof = await saveText(fixture.proofCaptures, "proof capture");
      const catalogOffer = await saveText(
        fixture.sensitivityCatalogOffers,
        "catalog offer capture",
      );
      const requirements = await saveRequirementsText(
        fixture.requirementsCaptures,
        "FixtureComponent",
      );
      const admission = await saveBytes(
        fixture.technicalCompilationAdmissionCaptures,
        '{"schemaVersion":"technical-compilation-admission-capture/4.0"}',
      );

      const reader = fixture.reader();
      const tupleReader: TupleReaderPort = reader;
      const recordedPlanReader: ThreadArtifactReaderPort = reader;
      const feaPlanReader: ExactThreadArtifactReaderPort = reader;
      assertEquals(typeof tupleReader.read, "function");
      assertEquals(typeof recordedPlanReader.read, "function");
      assertEquals(typeof feaPlanReader.readArtifact, "function");

      assertEquals(await reader.read(proof.tuple), proof.bytes);
      assertEquals(await reader.read(catalogOffer.tuple), catalogOffer.bytes);
      assertEquals(await reader.read(requirements.tuple), requirements.bytes);
      assertEquals(await reader.read(admission.tuple), admission.bytes);
      assertEquals(
        await reader.read(threadArtifact(proof.tuple, proof.fingerprint)),
        proof.bytes,
      );
      assertEquals(
        await reader.read(threadArtifact(admission.tuple, admission.fingerprint)),
        admission.bytes,
      );
      const requirementsArtifact = threadArtifact(
        requirements.tuple,
        requirements.fingerprint,
      );
      const openedRequirements = await reader.readArtifact(requirementsArtifact);
      assertEquals(openedRequirements, {
        uri: requirements.tuple.uri,
        mediaType: requirements.tuple.mediaType,
        byteCount: requirements.bytes.byteLength,
        sha256: requirements.fingerprint.digest,
        bytes: requirements.bytes,
      });
      await assertRejects(
        () =>
          reader.read({
            ...requirements.tuple,
            uri:
              `casys://requirements-capture/TransplantedComponent/sha256/${requirements.fingerprint.digest}`,
          }),
        TypeError,
        "does not bind",
      );
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  },
);

Deno.test(
  "RecordedAnalysisCasReader rejects unknown and malformed local references before consulting a store",
  async () => {
    let reads = 0;
    const reader = new RecordedAnalysisCasReader({
      stores: countingBindings(() => reads += 1),
    });
    const digest = "a".repeat(64);
    const rejected = [
      tuple(`casys://unreviewed/sha256/${digest}`, digest),
      tuple(`casys://fea-proof-case-capture/not-sha256/${digest}`, digest),
      tuple(`casys://fea-proof-case-capture/sha256/${digest}`, digest, "text/plain"),
      tuple(
        `casys://sensitivity-catalog-offer-capture/sha256/${digest}`,
        digest,
        "text/plain",
      ),
      tuple(`file:///private/recorded-analysis/${digest}`, digest),
      tuple(`mcp://modelica/resources/${digest}`, digest),
      tuple(`casys://requirements-capture/sha256/${digest}`, digest),
      tuple(
        `casys://technical-compilation-admission-capture/not-sha256/${digest}`,
        digest,
      ),
      tuple(
        `casys://technical-compilation-admission-capture/sha256/${digest}`,
        digest,
        "text/plain",
      ),
    ];

    for (const input of rejected) {
      await assertRejects(() => reader.read(input), TypeError);
    }
    assertEquals(reads, 0);
  },
);

Deno.test(
  "RecordedAnalysisCasReader rejects an exact tuple with a mismatched count or hash",
  async () => {
    const fixture = await createFixture();
    try {
      const saved = await saveText(fixture.proofCaptures, "proof bytes");
      const reader = fixture.reader();
      await assertRejects(
        () => reader.read({ ...saved.tuple, byteCount: saved.tuple.byteCount + 1 }),
        TypeError,
      );
      await assertRejects(
        () => reader.read({ ...saved.tuple, sha256: "0".repeat(64) }),
        TypeError,
      );
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  },
);

Deno.test(
  "RecordedAnalysisCasReader rejects duplicate or namespace-swapped closed configuration",
  async () => {
    const fixture = await createFixture();
    try {
      const bindings = fixture.bindings();
      assertThrows(
        () => new RecordedAnalysisCasReader({ stores: [...bindings, bindings[0]] }),
        TypeError,
      );
      const swapped: RecordedAnalysisCasStoreBinding[] = [
        {
          namespace: "fea-proof-case-capture",
          storage: "bytes",
          store: fixture.proofCaptures,
        } as unknown as RecordedAnalysisCasStoreBinding,
        ...bindings.slice(1),
      ];
      assertThrows(
        () => new RecordedAnalysisCasReader({ stores: swapped }),
        TypeError,
      );
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  },
);

Deno.test(
  "RecordedAnalysisCasReader fails closed when byte or text capture storage is tampered",
  async () => {
    const fixture = await createFixture();
    try {
      const proof = await saveText(fixture.proofCaptures, "proof before tamper");
      await Deno.writeFile(
        fixture.proofCaptures.pathFor(proof.fingerprint),
        encoder.encode("tampered proof bytes"),
      );
      await assertRejects(() => fixture.reader().read(proof.tuple), Error);

      const catalogOffer = await saveText(
        fixture.sensitivityCatalogOffers,
        "catalog offer before tamper",
      );
      await Deno.writeFile(
        fixture.sensitivityCatalogOffers.pathFor(catalogOffer.fingerprint),
        encoder.encode("tampered catalog offer bytes"),
      );
      await assertRejects(() => fixture.reader().read(catalogOffer.tuple), Error);

      const requirements = await saveRequirementsText(
        fixture.requirementsCaptures,
        "FixtureComponent",
      );
      await Deno.writeFile(
        fixture.requirementsCaptures.pathFor(requirements.fingerprint),
        encoder.encode("tampered requirements bytes"),
      );
      await assertRejects(() => fixture.reader().read(requirements.tuple), Error);
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  },
);

interface Fixture {
  readonly directory: string;
  readonly proofCaptures: FileCaptureStore<"fea-proof-case">;
  readonly sensitivityCatalogOffers: FileCaptureStore<"sensitivity-catalog-offer">;
  readonly requirementsCaptures: FileCaptureStore<"requirements-capture">;
  readonly technicalCompilationAdmissionCaptures: FileByteStore<
    "technical-compilation-admission-capture"
  >;
  readonly bindings: () => RecordedAnalysisCasStoreBinding[];
  readonly reader: () => RecordedAnalysisCasReader;
}

async function createFixture(): Promise<Fixture> {
  const directory = await Deno.makeTempDir({ prefix: "recorded-analysis-cas-reader-" });
  const proofCaptures = new FileCaptureStore({
    kind: "fea-proof-case",
    directory: `${directory}/proof-captures`,
    uriNamespace: "fea-proof-case-capture",
    label: "FEA proof case",
  });
  const sensitivityCatalogOffers = new FileCaptureStore({
    kind: "sensitivity-catalog-offer",
    directory: `${directory}/sensitivity-catalog-offers`,
    uriNamespace: "sensitivity-catalog-offer-capture",
    label: "Sensitivity catalog offer",
  });
  const requirementsCaptures = new FileCaptureStore({
    kind: "requirements-capture",
    directory: `${directory}/requirements-captures`,
    uriNamespace: "requirements-capture",
    label: "Requirements",
  });
  const technicalCompilationAdmissionCaptures = new FileByteStore({
    kind: "technical-compilation-admission-capture",
    directory: `${directory}/technical-compilation-admission-captures`,
    uriNamespace: "technical-compilation-admission-capture",
    label: "Technical compilation admission",
  });
  const bindings = (): RecordedAnalysisCasStoreBinding[] => [
    {
      namespace: "fea-proof-case-capture",
      storage: "text",
      store: proofCaptures,
    },
    {
      namespace: "sensitivity-catalog-offer-capture",
      storage: "text",
      store: sensitivityCatalogOffers,
    },
    {
      namespace: "requirements-capture",
      storage: "text",
      store: requirementsCaptures,
    },
    {
      namespace: "technical-compilation-admission-capture",
      storage: "bytes",
      store: technicalCompilationAdmissionCaptures,
    },
  ];
  return {
    directory,
    proofCaptures,
    sensitivityCatalogOffers,
    requirementsCaptures,
    technicalCompilationAdmissionCaptures,
    bindings,
    reader: () => new RecordedAnalysisCasReader({ stores: bindings() }),
  };
}

async function saveText<K extends string>(
  store: FileCaptureStore<K>,
  text: string,
): Promise<StoredValue> {
  const bytes = encoder.encode(text);
  const fingerprint = await contentFingerprint(bytes);
  const saved = await store.save(fingerprint, text);
  return {
    bytes,
    fingerprint,
    tuple: {
      uri: saved.uri,
      byteCount: bytes.byteLength,
      sha256: fingerprint.digest,
      mediaType: "application/json",
    },
  };
}

async function saveRequirementsText(
  store: FileCaptureStore<"requirements-capture">,
  component: string,
): Promise<StoredValue> {
  const text = JSON.stringify({
    containerComponent: component,
    schemaVersion: "requirements-capture/3.0",
  });
  const bytes = encoder.encode(text);
  const fingerprint = await contentFingerprint(bytes);
  await store.save(fingerprint, text);
  return {
    bytes,
    fingerprint,
    tuple: {
      uri: `casys://requirements-capture/${component}/sha256/${fingerprint.digest}`,
      byteCount: bytes.byteLength,
      sha256: fingerprint.digest,
      mediaType: "application/json",
    },
  };
}

async function saveBytes<K extends string>(
  store: FileByteStore<K>,
  text: string,
): Promise<StoredValue> {
  const bytes = encoder.encode(text);
  const fingerprint = await contentFingerprint(bytes);
  const saved = await store.save(fingerprint, bytes);
  return {
    bytes,
    fingerprint,
    tuple: {
      uri: saved.uri,
      byteCount: bytes.byteLength,
      sha256: fingerprint.digest,
      mediaType: "application/json",
    },
  };
}

interface StoredValue {
  readonly bytes: Uint8Array;
  readonly fingerprint: ContentFingerprint;
  readonly tuple: RecordedAnalysisCasTuple;
}

async function contentFingerprint(bytes: Uint8Array): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  };
}

function tuple(
  uri: string,
  sha256: string,
  mediaType = "application/json",
): RecordedAnalysisCasTuple {
  return { uri, byteCount: 1, sha256, mediaType };
}

function threadArtifact(
  tuple: RecordedAnalysisCasTuple,
  fingerprint: ContentFingerprint,
): ThreadArtifact {
  return {
    id: "recorded-proof-artifact",
    name: "Recorded proof artifact",
    kind: "document",
    version: "1",
    fingerprint,
    uri: tuple.uri,
    mediaType: tuple.mediaType,
    producer: { serverId: "digital-thread", tool: "recorded", runId: "run-1" },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-12T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function countingBindings(
  onRead: () => void,
): RecordedAnalysisCasStoreBinding[] {
  const text = <K extends string>(namespace: string) =>
    ({
      uriFor: (fingerprint: ContentFingerprint) =>
        `casys://${namespace}/sha256/${fingerprint.digest}`,
      read: () => {
        onRead();
        return Promise.resolve(undefined);
      },
    }) as unknown as FileCaptureStore<K>;
  return [
    {
      namespace: "fea-proof-case-capture",
      storage: "text",
      store: text<"fea-proof-case">("fea-proof-case-capture"),
    },
    {
      namespace: "sensitivity-catalog-offer-capture",
      storage: "text",
      store: text<"sensitivity-catalog-offer">(
        "sensitivity-catalog-offer-capture",
      ),
    },
    {
      namespace: "requirements-capture",
      storage: "text",
      store: text<"requirements-capture">("requirements-capture"),
    },
    {
      namespace: "technical-compilation-admission-capture",
      storage: "bytes",
      store: {
        uriFor: (fingerprint: ContentFingerprint) =>
          `casys://technical-compilation-admission-capture/sha256/${fingerprint.digest}`,
        read: () => {
          onRead();
          return Promise.resolve(undefined);
        },
      } as unknown as FileByteStore<"technical-compilation-admission-capture">,
    },
  ];
}
