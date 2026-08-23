import { assertEquals } from "@std/assert";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { validCrossDomainImpactManifestBody } from "../../testing/cross-domain-impact-fixtures.ts";
import { persistAgentResourceText } from "../../testing/agent-resource-test-support.ts";
import { createCrossDomainImpactProject } from "./server-composition.ts";

Deno.test("impact composition captures a closed manifest without a provider grant", async () => {
  const recordedAnalysisDirectory = await Deno.makeTempDir({
    prefix: "casys-impact-composition-",
  });
  try {
    const sourceText = JSON.stringify(validCrossDomainImpactManifestBody());
    const persisted = await persistAgentResourceText(
      `${recordedAnalysisDirectory}/agent-resources`,
      {
        name: "impact.json",
        mimeType: "application/json",
        text: sourceText,
      },
    );
    const composed = createCrossDomainImpactProject({
      projects: {
        get: () => Promise.resolve(undefined),
      } as never,
      commands: {} as never,
      snapshots: {
        get: () => Promise.resolve(undefined),
        getFresh: () => Promise.resolve(undefined),
      } as never,
      lease: unusedLease(),
      recordedAnalysisDirectory,
      resources: persisted.reopen,
    });
    const review = await composed.crossDomainImpactManifestCapture.capture({
      resourceRef: persisted.reference,
    });
    assertEquals(review.status, "captured");
    assertEquals(review.grants, "none");
    assertEquals(Object.keys(review.reference), ["fingerprint"]);
    const reread = await composed.manifests.read(review.reference);
    assertEquals(reread?.reference, review.reference);
    assertEquals(reread?.manifest.id, review.summary.id);

    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("HttpMcpToolClient"), false);
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
    assertEquals(source.includes("ngspice"), false);
    assertEquals(source.includes("FileCrossDomainImpactManifestStore"), true);
  } finally {
    await Deno.remove(recordedAnalysisDirectory, { recursive: true });
  }
});

function unusedLease(): EngineeringProjectRunLease {
  return {
    withLease(_projectId, _scope, operation) {
      return operation();
    },
  };
}
