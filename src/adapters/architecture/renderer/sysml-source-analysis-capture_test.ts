import { assertEquals, assertRejects } from "@std/assert";
import {
  RenderedArchitectureSysmlAnalyzer,
} from "./rendered-architecture-sysml-analyzer.ts";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  SysmlSourceAnalysisCaptureService,
  validateSysmlSourceCapture,
} from "./sysml-source-analysis-capture.ts";

const operation = { id: "model.write-architecture", version: "1" } as const;
const proposal = parseArchitectureProposalParameters([
  { key: "architecture.package", label: "Package", value: "DroneV4" },
  { key: "system.name", label: "System", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
]);

function stores(root: string) {
  return {
    sourceCaptures: new FileCaptureStore({
      kind: "sysml-source-capture" as const,
      directory: `${root}/sysml-source-captures`,
      uriNamespace: "test-sysml-source",
      label: "Test SysML source",
    }),
    analysisCaptures: new FileCaptureStore({
      kind: "source-analysis" as const,
      directory: `${root}/source-analysis-captures`,
      uriNamespace: "test-source-analysis",
      label: "Test source analysis",
    }),
  };
}

Deno.test("SysML source capture saves and rereads exact source before local analysis", async () => {
  const root = await Deno.makeTempDir({ prefix: "sysml-source-capture-" });
  try {
    const captures = stores(root);
    let sourceFilesPresentDuringAnalysis = 0;
    const native = new RenderedArchitectureSysmlAnalyzer();
    const service = new SysmlSourceAnalysisCaptureService({
      ...captures,
      frontend: {
        async analyzeRendered(input) {
          sourceFilesPresentDuringAnalysis =
            [...Deno.readDirSync(`${root}/sysml-source-captures`)].length;
          return await native.analyzeRendered(input);
        },
      },
    });
    const rendered = renderArchitectureSysmlWithManifest(proposal);
    const reference = await service.capture({
      proposal,
      selector: rendered.manifest.selector,
      runId: "run-1",
      operation,
    });
    assertEquals(sourceFilesPresentDuringAnalysis, 1);
    assertEquals(reference.sourceId.startsWith("sysml-source:"), true);
    assertEquals(
      (await captures.analysisCaptures.read(reference.analysisFingerprint)) !==
        undefined,
      true,
    );
    const sourceText = await captures.sourceCaptures.read(
      reference.sourceCaptureFingerprint,
    );
    assertEquals(sourceText !== undefined, true);
    assertEquals(
      (await validateSysmlSourceCapture(JSON.parse(sourceText!))).sourceText,
      rendered.sourceText,
    );
    assertEquals(
      (await service.reopen(reference)).source.sourceText,
      rendered.sourceText,
      "a later executor receives the persisted bytes, not a fresh render",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("SysML source capture identities differ across exact run occurrences", async () => {
  const root = await Deno.makeTempDir({ prefix: "sysml-source-capture-" });
  try {
    const captures = stores(root);
    const service = new SysmlSourceAnalysisCaptureService({
      ...captures,
      frontend: new RenderedArchitectureSysmlAnalyzer(),
    });
    const rendered = renderArchitectureSysmlWithManifest(proposal);
    const first = await service.capture({
      proposal,
      selector: rendered.manifest.selector,
      runId: "run-1",
      operation,
    });
    const second = await service.capture({
      proposal,
      selector: rendered.manifest.selector,
      runId: "run-2",
      operation,
    });
    assertEquals(first.sourceId === second.sourceId, false);
    assertEquals(first.sourceFingerprint, second.sourceFingerprint);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("SysML source capture rejects source fingerprint and source identity tampering on reread", async () => {
  const root = await Deno.makeTempDir({ prefix: "sysml-source-capture-" });
  try {
    const captures = stores(root);
    const service = new SysmlSourceAnalysisCaptureService({
      ...captures,
      frontend: new RenderedArchitectureSysmlAnalyzer(),
    });
    const rendered = renderArchitectureSysmlWithManifest(proposal);
    const reference = await service.capture({
      proposal,
      selector: rendered.manifest.selector,
      runId: "run-1",
      operation,
    });
    const saved = JSON.parse(
      (await captures.sourceCaptures.read(reference.sourceCaptureFingerprint))!,
    );
    await assertRejects(
      () => validateSysmlSourceCapture({ ...saved, sourceId: "sysml-source:deadbeef" }),
      TypeError,
    );
    await assertRejects(
      () =>
        validateSysmlSourceCapture({
          ...saved,
          sourceFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
        }),
      TypeError,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("SysML source-analysis reopen fails closed when its CAS analysis is altered", async () => {
  const root = await Deno.makeTempDir({ prefix: "sysml-source-capture-" });
  try {
    const captures = stores(root);
    const service = new SysmlSourceAnalysisCaptureService({
      ...captures,
      frontend: new RenderedArchitectureSysmlAnalyzer(),
    });
    const rendered = renderArchitectureSysmlWithManifest(proposal);
    const reference = await service.capture({
      proposal,
      selector: rendered.manifest.selector,
      runId: "run-1",
      operation,
    });
    await Deno.writeTextFile(
      captures.analysisCaptures.pathFor(reference.analysisFingerprint),
      "{}",
    );
    await assertRejects(() => service.reopen(reference));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
