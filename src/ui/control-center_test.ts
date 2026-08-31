import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Decision Center hands generic review records to the chronological Activity feed", async () => {
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
  assertStringIncludes(source, "ReviewRecordSummary");
  assertStringIncludes(source, "export function ProjectReviewAppHandoff");
  assertStringIncludes(source, "export function ProjectReviewAppHandoffs");
  assertStringIncludes(source, "resolveProjectReviewApp");
  assertStringIncludes(
    source,
    "projection.basis.projectId !== project.project.id",
  );
  assertStringIncludes(source, 'session.anchor.kind === "project-review"');
  assertStringIncludes(
    source,
    "session.anchor.fingerprint === anchor.fingerprint",
  );
  assertStringIncludes(source, "data-app-resolution={resolution.status}");
  assertStringIncludes(source, "Multiple exact bindings match this review");
  assertStringIncludes(source, "<McpAppFrame");
  assertEquals(source.includes("activity-review-events"), false);
  assertEquals(source.includes("CompactDecisionRecord"), false);
  assertEquals(source.includes("RESULT PUBLISHED"), false);
  assertStringIncludes(source, "Review in activity");
  assertStringIncludes(source, "needsReviewCount");
  assertStringIncludes(source, "Approved · result pending");
  assertEquals(source.includes("AGENT PREPARING"), false);
  assertEquals(source.includes("<dd>{nextReview ? 1 : 0}</dd>"), false);
  assertStringIncludes(source, 'aria-label="Generic review record"');
  assertStringIncludes(source, "owned by the exact whole MCP App");
  assertStringIncludes(source, "Open it from the App handoff in");
  assertEquals(source.includes("record.preview"), false);
  assertEquals(source.includes("data-superseded"), false);
  assertEquals(source.includes("PartDefinition binding diagram"), false);
  assertEquals(source.includes("Requirements proposal · target"), false);
  assertEquals(source.includes("GeometryDraftPreview"), false);
  assertEquals(source.includes("GltfAssetCanvas"), false);
  assertEquals(source.includes("STLLoader"), false);
  assertEquals(source.includes('from "three"'), false);
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
  assertStringIncludes(feed, "project={project}");
  assertStringIncludes(feed, "viewerSessions={viewerSessions}");
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
  assertStringIncludes(workbench, "viewerSessions={viewerSessions}");

  const planning = await Deno.readTextFile(
    new URL("./src/project/planning-workbench.tsx", import.meta.url),
  );
  const documentary = await Deno.readTextFile(
    new URL(
      "./src/project/documentary-baseline-workbench.tsx",
      import.meta.url,
    ),
  );
  assertStringIncludes(planning, "<ProjectReviewAppHandoffs");
  assertStringIncludes(documentary, "<ProjectReviewAppHandoffs");

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

Deno.test("Project keeps its path on one whiteboard without duplicate engineering summaries", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  assertStringIncludes(overview, "Project path and digital thread");
  assertStringIncludes(overview, 'data-surface="digital-thread-whiteboard"');
  assertStringIncludes(overview, "<OverviewThreadHero");
  assertStringIncludes(overview, "immersive");
  assertEquals(overview.match(/<OverviewThreadHero/g)?.length, 1);
  assertStringIncludes(overview, 'className="project-thread-top-hud"');
  assertStringIncludes(overview, 'className="project-thread-bottom-hud"');
  assertStringIncludes(overview, 'className="project-thread-now-hud"');
  assertStringIncludes(overview, 'title="Agent now"');
  assertEquals(overview.includes("<ThreadAssetOpenLinks"), false);
  assertEquals(overview.includes("<GltfAssetCanvas"), false);
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
  assertEquals(source.includes("const changeProductFacet"), false);
  assertEquals(source.includes("productFacetHash"), false);
  assertStringIncludes(source, "<McpAppProductHandoff");
  assertStringIncludes(source, "projection={viewerSessions}");
  assertStringIncludes(source, "Open Project whiteboard");
  assertEquals(source.includes("<ProductFacetNavigation"), false);
  assertEquals(source.includes("<ProductRequirementsMatrix"), false);
  assertEquals(source.includes("<ProductSourcingLane"), false);
  assertEquals(source.includes("<ComponentWorkspace"), false);
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
  assertEquals(source.includes("HttpProductAuthoringSourceClient"), false);
});

Deno.test("Product has no native domain renderer and hands exact Apps to the whiteboard", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  assertStringIncludes(source, "function McpAppProductHandoff");
  assertStringIncludes(source, "Digital Thread keeps no native CAD, SysML");
  assertStringIncludes(source, "no exact whole-App binding is registered");
  assertStringIncludes(source, "artifact kinds, providers or graph proximity");
  assertEquals(source.includes("GltfAssetCanvas"), false);
  assertEquals(source.includes("ComponentWorkspace"), false);
  assertEquals(source.includes("STLLoader"), false);
  assertEquals(source.includes('from "three"'), false);
});
