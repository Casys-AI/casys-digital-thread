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
  assertStringIncludes(source, "data-review-status={displayStatus}");
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
  assertStringIncludes(source, "Sealed result · exact recorded bytes");
  assertStringIncludes(source, "Validated proposal · result pending");
  assertStringIncludes(source, "Draft · geometry proposal");
  assertEquals(source.includes("0x1a1c1e"), false);
  assertEquals(source.includes("Comment for the agent"), false);
  assertStringIncludes(source, 'send("validate", undefined)');
  assertStringIncludes(source, "Request revision");
  assertStringIncludes(source, "What should change?");
  assertStringIncludes(source, 'aria-required="true"');
  assertStringIncludes(source, "Send revision request");
  assertStringIncludes(source, 'setComposerMode("revision")');
  assertStringIncludes(source, 'setComposerMode("choice")');
  assertStringIncludes(source, 'send("request-revision", comment)');
  assertStringIncludes(source, 'role="group"');
  assertStringIncludes(source, 'aria-live="polite"');
  assertStringIncludes(source, 'role="alert"');
  assertStringIncludes(source, "Sent to review queue · agent receipt pending");
  assertStringIncludes(source, "Waiting for agent receipt");
  assertStringIncludes(source, "Waiting for signed decision");
  assertStringIncludes(source, "Recorded review outcome");
  assertEquals(source.includes("decision-inbox-preview"), false);

  const feed = await Deno.readTextFile(
    new URL("./src/thread/feed.tsx", import.meta.url),
  );
  assertStringIncludes(feed, "effectiveActivityReviewStatus");
  assertStringIncludes(feed, "data-review-status={displayStatus}");
  assertStringIncludes(feed, "data-review-status={reviewDisplayStatus}");
  assertStringIncludes(feed, "activityReviewDisplayStatusLabel");

  const styles = await Deno.readTextFile(
    new URL("./src/styles/11-review-notifications.css", import.meta.url),
  );
  for (const transportStatus of ["sending", "sent", "received"]) {
    assertStringIncludes(
      styles,
      `[data-review-status="${transportStatus}"]`,
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
  assertStringIncludes(source, "STEP remains the");
  assertStringIncludes(source, "authoritative per-part CAD");
  assertStringIncludes(source, "no per-part browser");
  assertStringIncludes(source, "viewer is claimed");
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

Deno.test("Workbench keeps navigation and sends only bounded review intents", async () => {
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
  assertStringIncludes(source, "buildReviewIntent");
  assertStringIncludes(source, "retryIntent");
  assertStringIncludes(source, "reviewIntentScopeKey");
  assertStringIncludes(source, "reviewIntentProjectId={project.project.id}");
  assertStringIncludes(source, "hasQueuedReviewIntent");
  assertStringIncludes(source, 'approval?.status !== "pending"');
  assertStringIncludes(source, "decision.approvalIds.at(-1)");
  assertStringIncludes(source, "approvalId: record.approvalId");
  assertStringIncludes(source, "setInterval(refreshReceipts, 2_000)");
  assertStringIncludes(source, "ReviewIntentStaleError");
  assertStringIncludes(source, 'target.startsWith("review/")');
  assertEquals(source.includes("<ReviewNotifications"), false);
  assertEquals(source.includes('surface="activity"'), false);
  assertEquals(source.includes("onOpenOwner"), false);
  assertEquals(source.includes("groupActivityNodesByOperation"), false);

  const reviewCard = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );
  assertStringIncludes(reviewCard, "approvalId !== undefined");
  assertStringIncludes(reviewCard, "[decisionId, digest, approvalId]");

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

Deno.test("native Workbench enables the same-origin review intent outbox", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  assertStringIncludes(source, "HttpProjectReviewIntentClient");
  assertStringIncludes(source, '"/api/review-intents"');
  assertStringIncludes(source, "reviewIntentClient={reviewIntentClient}");
});

Deno.test("Product keeps its combined SysML and build123d facets", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/component-workspace.tsx", import.meta.url),
  );
  assertStringIncludes(source, '{ id: "syson", label: "SysON"');
  assertStringIncludes(source, '{ id: "build123d", label: "build123d"');
  assertStringIncludes(source, 'role="tablist"');
  assertStringIncludes(source, "sealedAssemblyGlbAsset");
  assertStringIncludes(source, "GltfAssetCanvas");
  assertStringIncludes(source, "Sealed assembly preview · GLB");
  assertEquals(source.includes("Review published geometry"), false);
  assertEquals(source.includes("per-part GLB"), false);
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
