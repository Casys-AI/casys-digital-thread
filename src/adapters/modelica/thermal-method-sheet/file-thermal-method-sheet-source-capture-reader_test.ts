import { assertEquals, assertRejects } from "@std/assert";
import {
  fingerprintSourceAnalysisBundle,
  SOURCE_ANALYSIS_SCHEMA,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { FileThermalMethodSheetSourceCaptureReader } from "./file-thermal-method-sheet-source-capture-reader.ts";

Deno.test(
  "thermal method-sheet source reader reopens a Modelica analysis capture by fingerprint",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "thermal-method-sheet-source-",
    });
    try {
      const store = new FileByteStore({
        kind: "technical-source-analysis",
        directory,
        uriNamespace: "technical-source-analysis",
        label: "Captured technical source analysis",
      });
      const bundle = validateSourceAnalysisBundle(modelicaBundle());
      const fingerprint = await fingerprintSourceAnalysisBundle(bundle);
      await store.save(
        fingerprint,
        new TextEncoder().encode(deterministicJson(bundle)),
      );
      const reader = new FileThermalMethodSheetSourceCaptureReader(store);
      const identity = await reader.read(fingerprint);
      assertEquals(identity, {
        fingerprint,
        role: "modelica-model",
        language: "modelica",
        symbols: [
          {
            id: `3b6a${"c".repeat(60)}`,
            kind: "variable",
            name: "temperature",
          },
          {
            id: `3b6a${"d".repeat(60)}`,
            kind: "parameter",
            name: "heatingRate",
          },
        ],
      });
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "thermal method-sheet source reader refuses a CAD analysis capture",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "thermal-method-sheet-source-cad-",
    });
    try {
      const store = new FileByteStore({
        kind: "technical-source-analysis",
        directory,
        uriNamespace: "technical-source-analysis",
        label: "Captured technical source analysis",
      });
      const bundle = validateSourceAnalysisBundle(cadBundle());
      const fingerprint = await fingerprintSourceAnalysisBundle(bundle);
      await store.save(
        fingerprint,
        new TextEncoder().encode(deterministicJson(bundle)),
      );
      const reader = new FileThermalMethodSheetSourceCaptureReader(store);
      await assertRejects(
        () => reader.read(fingerprint),
        TypeError,
        "modelica-model",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "thermal method-sheet source reader returns undefined for a missing capture",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "thermal-method-sheet-source-missing-",
    });
    try {
      const store = new FileByteStore({
        kind: "technical-source-analysis",
        directory,
        uriNamespace: "technical-source-analysis",
        label: "Captured technical source analysis",
      });
      const reader = new FileThermalMethodSheetSourceCaptureReader(store);
      assertEquals(
        await reader.read({ algorithm: "sha256", digest: "a".repeat(64) }),
        undefined,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

function modelicaBundle(): unknown {
  return {
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: "placeholder-module",
      role: "modelica-model",
      language: "modelica",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    analyzer: { id: "modelica-closed-subset", version: "2.0.0" },
    policy: {
      profile: "modelica-closed-subset-v2",
      status: "passed",
      findings: [],
    },
    symbols: [
      { id: `3b6a${"d".repeat(60)}`, kind: "parameter", name: "heatingRate" },
      { id: `3b6a${"c".repeat(60)}`, kind: "variable", name: "temperature" },
    ],
    dependencies: [],
    unresolvedConstructs: [],
  };
}

function cadBundle(): unknown {
  return {
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: "cad.box",
      role: "cad-script",
      language: "python",
      fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    },
    analyzer: { id: "python-ast", version: "1.0.0" },
    policy: { profile: "cad.preview", status: "passed", findings: [] },
    symbols: [{ id: "result", kind: "artifact", name: "result" }],
    dependencies: [],
    unresolvedConstructs: [],
  };
}
