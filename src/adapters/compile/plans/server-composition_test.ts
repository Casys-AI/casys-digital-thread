import { assertEquals, assertStrictEquals } from "@std/assert";
import type { CalculixIsolatedExecutionProfile } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import { FileThreadSnapshotStore } from "../../shared/stores/file-thread-snapshot-store.ts";
import { createArchitectureFoundation } from "../../architecture/server-composition.ts";
import { createTechnicalCompilationFoundation } from "../server-composition.ts";
import { createFeaFoundation } from "../../fea/server-composition.ts";
import {
  createRecordedOperationPlanComposition,
  recordedPlanCalculixBinding,
} from "./server-composition.ts";
import { testReopenAgentResource } from "../../../testing/agent-resource-test-support.ts";
import { FileProjectSourceWorkspaceStore } from "../../project-source-workspace/file-project-source-workspace-store.ts";

Deno.test("ROP composition reopens the exact shared proof and requirements CAS instances", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-rop-composition-" });
  try {
    const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
    const architecture = createArchitectureFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      sourceAnalysisCaptures: new FileCaptureStore({
        kind: "source-analysis",
        directory: `${root}/source-analysis`,
        uriNamespace: "source-analysis",
        label: "Source analysis",
      }),
      sysmlSourceCaptureDirectory: `${root}/sysml`,
      sysonModelSeedCaptureDirectory: `${root}/seed`,
      architectureCaptureDirectory: `${root}/architecture`,
      requirementsCaptureDirectory: `${root}/requirements`,
      resources: testReopenAgentResource(`${root}/agent-resources`),
    });
    const compilation = createTechnicalCompilationFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      snapshots,
      resources: testReopenAgentResource(`${root}/agent-resources-compile`),
      workspace: new FileProjectSourceWorkspaceStore(`${root}/workspace`),
    });
    const fea = createFeaFoundation();
    const plans = createRecordedOperationPlanComposition({
      snapshots,
      feaProofCaptures: fea.feaProofCaptures,
      sensitivityCatalogOfferCaptures: fea.sensitivityCatalogOfferCaptures,
      requirementsCaptures: architecture.requirementsCaptures,
      admissions: compilation.technicalCompilationAdmissions,
      recordedAnalysisDirectory: `${root}/analysis`,
      canonicalAssetDirectory: `${root}/assets`,
    });

    const text = '{"schemaVersion":"fea-proof-identity/test"}';
    const bytes = new TextEncoder().encode(text);
    const digest = await fingerprintResourceBytes(bytes);
    const fingerprint = { algorithm: "sha256" as const, digest };
    await fea.feaProofCaptures.save(fingerprint, text);
    const reopened = await plans.recordedAnalysisCas.read({
      uri: fea.feaProofCaptures.uriFor(fingerprint),
      byteCount: bytes.byteLength,
      sha256: digest,
      mediaType: "application/json",
    });
    assertEquals(reopened === undefined, false);
    assertEquals(new TextDecoder().decode(reopened), text);

    assertEquals(recordedPlanCalculixBinding(undefined), {});
    const localProfile = {
      imageReference: "casys/calculix@sha256:" + "a".repeat(64),
    } as unknown as CalculixIsolatedExecutionProfile;
    const bound = recordedPlanCalculixBinding(localProfile);
    assertStrictEquals(bound.calculix?.localProfile, localProfile);

    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
    assertEquals(
      source.includes("${recordedAnalysisDirectory}/calculix/proof-cases") ||
        source.includes("calculix/proof-cases"),
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
