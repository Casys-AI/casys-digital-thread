import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Decision Center hands review previews to the chronological Activity feed", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );

  assertStringIncludes(source, "export function DecisionCenter");
  assertStringIncludes(source, 'surface="inbox"');
  assertStringIncludes(source, "export function ReviewNotifications");
  assertStringIncludes(source, "<p>Review</p>");
  assertStringIncludes(source, "export function ActivityReviewFeedCard");
  assertStringIncludes(source, "activityReviewStatus(record)");
  assertStringIncludes(source, "activityReviewStatusLabel(status)");
  assertStringIncludes(source, "data-review-status={status}");
  assertStringIncludes(source, "data-canonical-review-status={status}");
  assertStringIncludes(source, "ReviewBusinessPreview");
  assertEquals(source.includes("activity-review-events"), false);
  assertEquals(source.includes("CompactDecisionRecord"), false);
  assertEquals(source.includes("RESULT PUBLISHED"), false);
  assertStringIncludes(source, "Review in activity");
  assertStringIncludes(source, "needsReviewCount");
  assertStringIncludes(source, "Approved · result pending");
  assertEquals(source.includes("AGENT PREPARING"), false);
  assertEquals(source.includes("<dd>{nextReview ? 1 : 0}</dd>"), false);
  assertStringIncludes(source, "PartDefinition binding diagram");
  assertStringIncludes(source, "Requirements proposal · target");
  assertStringIncludes(source, "GltfAssetCanvas");
  assertStringIncludes(source, "isDuplicateSealedGlbCopy");
  assertStringIncludes(source, "const targetAssets = view.targetPart");
  assertStringIncludes(source, "{targetAssets.map((asset) => (");
  assertStringIncludes(source, "Sealed result · exact recorded bytes");
  assertStringIncludes(source, "Validated proposal · result pending");
  assertStringIncludes(source, "Draft · geometry proposal");
  const geometryProse = source.replace(/\s+/g, " ");
  assertStringIncludes(
    geometryProse,
    "Canonical PartDefinition STEP ${elementId}; no assembly/occurrence/placement claim.",
  );
  assertStringIncludes(
    geometryProse,
    "Reviewed target PartDefinition STEP ${elementId}; canonical seal pending; no assembly/occurrence/placement claim.",
  );
  assertStringIncludes(
    geometryProse,
    "Proposed target PartDefinition STEP ${elementId}; canonical seal pending; no assembly/occurrence/placement claim.",
  );
  const targetStatusStart = source.indexOf("function targetPartSealStatus(");
  const targetStatusEnd = source.indexOf(
    "function GeometryDecisionDetails(",
    targetStatusStart,
  );
  const targetStatus = source.slice(targetStatusStart, targetStatusEnd);
  assertEquals(targetStatusStart >= 0, true);
  assertEquals(targetStatusEnd > targetStatusStart, true);
  // Only a sealed Thread projection may be called canonical.  Reviewed and
  // proposed target drafts remain explicitly pending, even though they have
  // a target PartDefinition and reviewable STEP bytes.
  assertEquals(
    targetStatus.match(/Canonical PartDefinition STEP/g)?.length,
    1,
  );
  assertEquals(targetStatus.match(/canonical seal pending/g)?.length, 2);
  assertStringIncludes(targetStatus, 'if (mode === "sealed")');
  assertStringIncludes(targetStatus, 'if (mode === "approved")');
  assertStringIncludes(targetStatus, 'if (mode === "draft")');
  assertEquals(source.includes("0x1a1c1e"), false);
  assertEquals(source.includes("Comment for the agent"), false);
  assertStringIncludes(source, "paired conversation");
  assertStringIncludes(source, "Recorded review outcome");
  assertStringIncludes(source, 'aria-live="polite"');
  assertEquals(source.includes('send("validate"'), false);
  assertEquals(source.includes("Request revision"), false);
  assertEquals(source.includes("Send your intent"), false);
  assertEquals(source.includes("onSubmitIntent"), false);
  assertEquals(source.includes("What should change?"), false);
  assertEquals(source.includes("Send revision request"), false);
  assertEquals(source.includes("decision-inbox-preview"), false);

  const feed = await Deno.readTextFile(
    new URL("./src/thread/feed.tsx", import.meta.url),
  );
  assertStringIncludes(feed, "activityReviewStatus");
  assertStringIncludes(feed, "activityReviewStatusLabel");
  assertStringIncludes(feed, "data-review-status={status}");
  assertStringIncludes(feed, "data-review-status={reviewStatus}");
  assertStringIncludes(feed, "activityCurrency(node, familyGraph)");
  assertStringIncludes(feed, "data-currency={currency}");
  assertEquals(feed.includes("{node.freshness}"), false);
  assertEquals(feed.includes("effectiveActivityReviewStatus"), false);
  assertEquals(feed.includes("activityReviewDisplayStatusLabel"), false);

  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  assertStringIncludes(
    workbench,
    "familyGraph={snapshot.evidenceFamilyGraph}",
  );

  const styles = await Deno.readTextFile(
    new URL("./src/styles/11-review-notifications.css", import.meta.url),
  );
  for (const transportStatus of ["sending", "sent", "received"]) {
    assertEquals(
      styles.includes(`[data-review-status="${transportStatus}"]`),
      false,
      transportStatus,
    );
  }

  for (
    const removedCommand of [
      "ProjectOperatorCommand",
      "OperatorCommandCapabilities",
      "ProjectCommandFeedback",
      "onCommand",
      "onActorIdChange",
      "decision.approve",
      "decision.reject",
      "agent-run.queue",
      "requestState",
      "HMAC",
      "Authorize recorded scope",
      "Request revised recommendation",
      "REVIEWER IDENTITY",
    ]
  ) {
    assertEquals(source.includes(removedCommand), false, removedCommand);
  }
});

Deno.test("Activity reuses one exact GLB viewer across selectable PartDefinitions", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );
  const start = source.indexOf("function PartDefinitionGlbReview(");
  const end = source.indexOf("function partDefinitionPreviewCopy(", start);
  const viewer = source.slice(start, end);

  assertEquals(start >= 0, true);
  assertEquals(end > start, true);
  assertStringIncludes(
    source,
    'asset.format === "gltf" && asset.path !== undefined &&',
  );
  assertStringIncludes(source, "asset.path.length > 0");
  assertStringIncludes(
    source,
    "partDefinitionIds.has(asset.partDefinitionElementId)",
  );
  assertStringIncludes(viewer, 'aria-label="PartDefinition GLB previews"');
  assertStringIncludes(viewer, "aria-pressed={isSelected}");
  assertStringIncludes(viewer, "url={selected.asset.path}");
  assertEquals(viewer.match(/<GltfAssetCanvas/g)?.length, 1);
  // Les phrases d'autorité vivent dans du JSX que `deno fmt` re-enroule : on
  // normalise les blancs avant de les chercher, sinon un simple retour à la
  // ligne casse la garde sans que la phrase ait changé.
  const prose = source.replace(/\s+/g, " ");
  assertStringIncludes(prose, "STEP remains the");
  assertStringIncludes(prose, "authoritative per-part CAD");
  assertStringIncludes(prose, "no per-part browser viewer is");
  assertStringIncludes(source, "Sealed part presentation · exact recorded GLB");
  assertStringIncludes(
    source,
    "Validated part proposal · result pending · GLB",
  );
  assertStringIncludes(
    source,
    "Validated historical part proposal · superseded · GLB",
  );
  assertStringIncludes(source, "Draft part proposal · GLB · not canonical");
  assertEquals(source.includes("Desk Lamp"), false);
});

Deno.test("Project keeps its brief and path without duplicate engineering summaries", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const brief = await Deno.readTextFile(
    new URL("./src/project/brief-record.tsx", import.meta.url),
  );
  assertStringIncludes(brief, "Complete engineering brief");
  assertStringIncludes(brief, "Approved engineering project brief");
  assertStringIncludes(overview, ">Project path</h3>");
  assertStringIncludes(overview, 'title="Agent now"');
  assertEquals(overview.includes("RUNNING"), false);
  assertEquals(overview.includes("168.4 g"), false);
  assertEquals(overview.includes("REQ-M-001"), false);
  assertEquals(overview.includes("GENERIC GOLDEN PATH"), false);
  assertEquals(overview.includes("Brief to sealed geometry"), false);
  assertEquals(overview.includes("SEPARATE ENGINEERING RECORD"), false);
  assertEquals(
    overview.includes("Published engineering specification summary"),
    false,
  );
  assertEquals(overview.includes("PublishedEngineeringSpecification"), false);
  assertEquals(overview.includes("0 reviewed component records"), false);
});

Deno.test("Workbench keeps navigation and recorded review projection without a mutation client", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertStringIncludes(source, "const openDecisionActivity");
  assertStringIncludes(source, "const openProjectDeepLink");
  assertStringIncludes(source, "projectDeepLinkHash");
  assertStringIncludes(source, "const openPublishedEvidence");
  assertStringIncludes(source, "buildActivityReviewRecords");
  assertStringIncludes(source, "reviewRecords={activityReviewRecords}");
  assertStringIncludes(source, "onOpenReviewEvidence={openPublishedEvidence}");
  assertStringIncludes(source, 'target.startsWith("review/")');
  assertStringIncludes(source, "const changeProductFacet");
  assertStringIncludes(source, "productFacetHash");
  assertStringIncludes(source, "<ProductRequirementsMatrix");
  assertStringIncludes(source, "<ProductSourcingLane");
  assertStringIncludes(source, "activeProductFacet={activeProductFacet}");
  assertEquals(source.includes("<ReviewNotifications"), false);
  assertEquals(source.includes('surface="activity"'), false);
  assertEquals(source.includes("onOpenOwner"), false);
  assertEquals(source.includes("groupActivityNodesByOperation"), false);

  for (
    const removedIntent of [
      "buildReviewIntent",
      "retryIntent",
      "reviewIntentScopeKey",
      "reviewIntentProjectId",
      "hasQueuedReviewIntent",
      "ReviewIntentStaleError",
      "refreshReceipts",
      "reviewIntentClient",
    ]
  ) {
    assertEquals(source.includes(removedIntent), false, removedIntent);
  }

  const reviewCard = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );
  assertEquals(reviewCard.includes("approvalId !== undefined"), false);
  assertEquals(reviewCard.includes("[decisionId, digest, approvalId]"), false);
  assertEquals(reviewCard.includes("onSubmitIntent"), false);

  for (
    const removedCommand of [
      "executeProjectCommand",
      "executePlanningCommand",
      "createProjectCommandRequest",
      "ProjectCommandConflictError",
      "operatorId",
      "agent-run.queue",
      "onPrepareAction",
      "requestState",
      "HMAC",
    ]
  ) {
    assertEquals(source.includes(removedCommand), false, removedCommand);
  }
});

Deno.test("native Workbench has no review-intent client or POST outbox", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  assertEquals(source.includes("HttpProjectReviewIntentClient"), false);
  assertEquals(source.includes("/api/review-intents"), false);
  assertEquals(source.includes("reviewIntentClient"), false);
  assertStringIncludes(source, "HttpThreadWorkbenchClient");
  assertStringIncludes(source, "HttpCockpitFleetClient");
});

Deno.test("Product structure is geometry-first with a compact SysML rail", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/component-workspace.tsx", import.meta.url),
  );
  assertStringIncludes(source, "Product · sealed geometry");
  assertStringIncludes(source, "StructurePartChips");
  assertStringIncludes(source, "SysmlRail");
  assertStringIncludes(source, "disabled={!available}");
  assertStringIncludes(source, "ProductSourcingCoverageLine");
  assertStringIncludes(source, "sealedAssemblyGlbAsset");
  assertStringIncludes(source, "GltfAssetCanvas");
  assertStringIncludes(source, "Sealed assembly preview · GLB");
  assertStringIncludes(source, "productStructureHeadline");
  assertStringIncludes(source, "AttributeUsage");
  assertEquals(source.includes("function ErpBom"), false);
  assertEquals(source.includes('role="tablist"'), false);
  assertEquals(source.includes("168.4 g"), false);
  assertEquals(source.includes("COM "), false);
  assertEquals(source.includes("Ixx "), false);
  assertEquals(source.includes("RUNNING"), false);
  assertEquals(source.includes("partOccurrenceCount).padStart"), false);
  assertEquals(source.includes("Review published geometry"), false);
  assertEquals(source.includes("per-part GLB"), false);
  assertEquals(source.includes("Catalog-bound meshes"), false);
  assertEquals(
    source.includes("if (inspect) onBindingSelect(inspect)"),
    false,
  );
});

Deno.test("the shared GLB viewer stays on a light surface", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/gltf-asset-canvas.tsx", import.meta.url),
  );
  assertStringIncludes(source, "GLTFLoader");
  assertStringIncludes(source, "Fit / reset");
  assertEquals(source.includes("0x1a1c1e"), false);
  assertEquals(source.includes("0x0b0f10"), false);
});
