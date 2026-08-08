/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type {
  EngineeringDecision,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import {
  type GeometryDecisionValid,
  parseGeometryDecisionView,
} from "../thread/geometry-decision-model.ts";

export interface ProjectReviewProps {
  readonly project: EngineeringProjectSnapshot;
  /** Opens the live activity feed, optionally focused on this decision. */
  readonly onOpenActivity?: (decisionId?: string) => void;
  /** Opens the specification/SysML projection for the affected decision. */
  readonly onOpenSpecification?: (decisionId: string) => void;
}

export type ReviewNotificationsSurface = "inbox" | "activity";

/** A compact overview handoff to the records that explain a decision. */
export function DecisionCenter(props: ProjectReviewProps): JSX.Element {
  return <ReviewNotifications {...props} surface="inbox" />;
}

/**
 * The cockpit never asks the person to authorize work. It projects the
 * decision record and points back to the paired conversation, where the agent
 * can ask for intent, explain a recommendation and persist the outcome.
 */
export function ReviewNotifications({
  project,
  onOpenActivity,
  onOpenSpecification,
  surface = "inbox",
}: ProjectReviewProps & {
  readonly surface?: ReviewNotificationsSurface;
}): JSX.Element {
  const reviewable = project.decisions.filter((decision) =>
    decision.status === "proposed"
  );
  const agentPreparing = project.decisions.filter((decision) =>
    decision.status === "required" || decision.status === "rejected"
  );
  const isActivity = surface === "activity";

  return (
    <section
      class="decision-center"
      data-surface={surface}
      aria-labelledby={`review-notifications-title-${surface}`}
    >
      <header class="decision-center-header">
        <div class="decision-center-index" aria-hidden="true">RN</div>
        <div>
          <p>{isActivity ? "DECISION RECORD" : "PROJECT SIGNALS"}</p>
          <h3 id={`review-notifications-title-${surface}`}>
            {isActivity
              ? "What the agent needs you to consider"
              : "Attention, in context"}
          </h3>
          <span>
            {isActivity
              ? "Read the recorded scope and evidence here; discuss the decision with the agent in your paired conversation."
              : "The feed carries the engineering story. This summary only points to the decision records worth discussing with the agent."}
          </span>
        </div>
        <dl class="decision-center-meter">
          <div data-tone={reviewable.length > 0 ? "attention" : "quiet"}>
            <dt>To discuss</dt>
            <dd>{reviewable.length}</dd>
          </div>
          <div data-tone={agentPreparing.length > 0 ? "preparing" : "quiet"}>
            <dt>Preparing</dt>
            <dd>{agentPreparing.length}</dd>
          </div>
        </dl>
      </header>

      {isActivity
        ? (
          <ActivityDecisionRecord
            project={project}
            reviewable={reviewable}
            agentPreparing={agentPreparing}
            onOpenSpecification={onOpenSpecification}
          />
        )
        : (
          <ReviewInboxHandoff
            reviewable={reviewable}
            agentPreparing={agentPreparing}
            onOpenActivity={onOpenActivity}
          />
        )}
    </section>
  );
}

function ReviewInboxHandoff({
  reviewable,
  agentPreparing,
  onOpenActivity,
}: {
  reviewable: readonly EngineeringDecision[];
  agentPreparing: readonly EngineeringDecision[];
  onOpenActivity?: (decisionId?: string) => void;
}): JSX.Element {
  const nextReview = reviewable[0];
  const state = nextReview
    ? {
      tone: "proposed",
      marker: "AGENT QUESTION",
      title: reviewable.length === 1
        ? "One recorded recommendation needs discussion"
        : `${reviewable.length} recorded recommendations need discussion`,
      detail:
        "Open Activity to inspect the lineage and evidence, then continue with the agent in your paired conversation.",
      action: "Open activity",
      icon: "!",
    }
    : agentPreparing.length > 0
    ? {
      tone: "required",
      marker: "AGENT PREPARING",
      title: "The agent is preparing the next recommendation",
      detail:
        "Nothing is needed in the cockpit. The activity feed will show the record when it is ready to discuss.",
      action: "See activity",
      icon: "···",
    }
    : {
      tone: "approved",
      marker: "NO QUESTION WAITING",
      title: "No project decision needs discussion right now",
      detail:
        "Use Activity to follow the project. Your paired conversation remains the place to clarify or change intent.",
      action: "See activity",
      icon: "✓",
    };

  return (
    <section
      class="decision-review-brief"
      data-state={state.tone}
      aria-label="Project signal"
    >
      <span aria-hidden="true">{state.icon}</span>
      <div>
        <p>{state.marker}</p>
        <strong>{state.title}</strong>
        <small>{state.detail}</small>
      </div>
      <button
        type="button"
        class="decision-secondary-button"
        onClick={() => onOpenActivity?.(nextReview?.id)}
        disabled={!onOpenActivity}
      >
        {state.action}
      </button>
    </section>
  );
}

function ActivityDecisionRecord({
  project,
  reviewable,
  agentPreparing,
  onOpenSpecification,
}: {
  project: EngineeringProjectSnapshot;
  reviewable: readonly EngineeringDecision[];
  agentPreparing: readonly EngineeringDecision[];
  onOpenSpecification?: (decisionId: string) => void;
}): JSX.Element {
  if (!reviewable.length) {
    return (
      <section
        class="decision-review-brief"
        data-state={agentPreparing.length > 0 ? "required" : "approved"}
        aria-label="Decision status"
      >
        <span aria-hidden="true">{agentPreparing.length ? "···" : "✓"}</span>
        <div>
          <p>
            {agentPreparing.length ? "AGENT PREPARING" : "NO QUESTION WAITING"}
          </p>
          <strong>
            {agentPreparing.length
              ? "The agent has not recorded a recommendation yet"
              : "There is no recorded decision awaiting discussion"}
          </strong>
          <small>
            Follow the live feed, or ask the agent about the project context in
            your paired conversation.
          </small>
        </div>
      </section>
    );
  }

  return (
    <ol class="decision-notification-list" aria-label="Recorded decisions">
      {reviewable.map((decision) => (
        <li key={decision.id}>
          <DecisionRecord
            project={project}
            decision={decision}
            onOpenSpecification={onOpenSpecification}
          />
        </li>
      ))}
    </ol>
  );
}

function DecisionRecord({
  project,
  decision,
  onOpenSpecification,
}: {
  project: EngineeringProjectSnapshot;
  decision: EngineeringDecision;
  onOpenSpecification?: (decisionId: string) => void;
}): JSX.Element {
  const phase = project.phases.find((candidate) =>
    candidate.id === decision.phaseId
  );
  const proposal = decision.proposal;

  /**
   * WHY TRY TO PARSE — every proposal's parameter list is flat key-value pairs.
   * `parseGeometryDecisionView` returns `{ kind: "invalid" }` for any proposal
   * that doesn't carry geometry keys, so non-geometry decisions are unaffected.
   * Only a `{ kind: "valid" }` result triggers the draft viewer.
   */
  const geoView = proposal?.parameters.length
    ? parseGeometryDecisionView(proposal.parameters)
    : null;
  const geoValid = geoView?.kind === "valid" ? geoView : null;

  return (
    <article
      class="decision-review-notification"
      data-state={decision.status}
      aria-label={`Decision record: ${decision.title}`}
    >
      <header>
        <div>
          <span>AGENT RECOMMENDATION</span>
          <strong>{decision.title}</strong>
        </div>
        <small>{phase?.name ?? decision.phaseId}</small>
      </header>
      <blockquote>{decision.question}</blockquote>
      <p class="decision-notification-summary">
        {proposal?.summary ??
          "The recorded recommendation is available in the project activity."}
      </p>
      {geoValid && <GeometryDraftPreview view={geoValid} />}
      <dl class="decision-notification-scope">
        <div>
          <dt>Evidence</dt>
          <dd>{decision.inputEvidenceRefs.length} linked</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>
            {decision.inputFingerprint ? "Exact input bound" : "Not ready"}
          </dd>
        </div>
        <div>
          <dt>Recorded</dt>
          <dd>{formatDateTime(decision.requestedAt)}</dd>
        </div>
      </dl>
      <div class="decision-review-actions">
        <button
          type="button"
          class="decision-secondary-button"
          onClick={() => onOpenSpecification?.(decision.id)}
          disabled={!onOpenSpecification}
          title={!onOpenSpecification
            ? "The specification route is not available on this surface."
            : undefined}
        >
          Inspect specification
        </button>
      </div>
      <small class="decision-review-guidance">
        Discuss this recommendation with the agent in your paired conversation.
        The cockpit will update when the shared project record changes.
      </small>
    </article>
  );
}

// ── Geometry draft viewer ─────────────────────────────────────────────────────

/**
 * WHY THIS COMPONENT EXISTS — the human must see the draft geometry before
 * signing the MRTR that authorises `design.write-geometry@1` to seal it.
 * "Signing what you have seen" is the contract.  The viewer is deliberately
 * labelled DRAFT to enforce contractual vocabulary: this is not a canonical
 * evidence artifact.
 */
function GeometryDraftPreview(
  { view }: { view: GeometryDecisionValid },
): JSX.Element {
  const format = view.primaryAssetFormat;
  const path = view.primaryAssetPreviewPath;

  if (!path || !format) {
    return (
      <p class="geometry-draft-no-preview">
        No previewable geometry asset in this draft (
        {view.assemblyFiles.length} file
        {view.assemblyFiles.length === 1 ? "" : "s"} present).
      </p>
    );
  }

  if (format === "step") {
    return (
      <div class="geometry-draft-viewer geometry-draft-viewer--text">
        <p class="geometry-draft-label">DRAFT · GEOMETRY PROPOSAL</p>
        <p>
          STEP format — no in-browser preview. Discuss with the agent before
          approving.
        </p>
        <code class="geometry-draft-digest">{view.draftDigest}</code>
      </div>
    );
  }

  return (
    <div class="geometry-draft-viewer">
      <p class="geometry-draft-label">
        DRAFT · GEOMETRY PROPOSAL · {format.toUpperCase()} · NOT CANONICAL
      </p>
      {format === "gltf"
        ? <GltfDraftCanvas url={path} />
        : <StlDraftCanvas url={path} />}
      <footer class="geometry-draft-footer">
        <small>
          Assembly files: {view.assemblyFiles.length} · Components:{" "}
          {view.components.length} · Unit: {view.unitSystem}
        </small>
        <code class="geometry-draft-digest">{view.draftDigest}</code>
      </footer>
    </div>
  );
}

function StlDraftCanvas({ url }: { url: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.MeshStandardMaterial | undefined;
    setState("loading");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1c1e);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.0));
    const key = new THREE.DirectionalLight(0xffe8cc, 3.2);
    key.position.set(180, 220, 260);
    scene.add(key);

    const resize = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    new STLLoader().load(
      url,
      (loaded) => {
        if (disposed) {
          loaded.dispose();
          return;
        }
        geometry = loaded;
        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingSphere();
        material = new THREE.MeshStandardMaterial({
          color: 0x4a9eff,
          metalness: 0.2,
          roughness: 0.65,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        scene.add(mesh);
        const radius = Math.max(geometry.boundingSphere?.radius ?? 50, 1);
        camera.near = Math.max(radius / 100, 0.1);
        camera.far = radius * 30;
        camera.position.set(radius * 1.6, radius * 1.15, radius * 1.9);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        setState("ready");
      },
      undefined,
      () => !disposed && setState("error"),
    );

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      geometry?.dispose();
      material?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <div class="geometry-draft-canvas-shell">
      <div class="geometry-draft-canvas" ref={host} />
      <div class="geometry-draft-canvas-state" data-state={state}>
        {state === "loading"
          ? "Loading draft mesh…"
          : state === "error"
          ? "Draft mesh unavailable"
          : "Drag to orbit · scroll to zoom"}
      </div>
    </div>
  );
}

function GltfDraftCanvas({ url }: { url: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    setState("loading");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1c1e);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.0));
    const key = new THREE.DirectionalLight(0xffe8cc, 3.2);
    key.position.set(180, 220, 260);
    scene.add(key);

    const resize = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return;
        scene.add(gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() / 2, 1);
        gltf.scene.position.sub(center);
        camera.near = Math.max(radius / 100, 0.1);
        camera.far = radius * 30;
        camera.position.set(radius * 1.6, radius * 1.15, radius * 1.9);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        setState("ready");
      },
      undefined,
      () => !disposed && setState("error"),
    );

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <div class="geometry-draft-canvas-shell">
      <div class="geometry-draft-canvas" ref={host} />
      <div class="geometry-draft-canvas-state" data-state={state}>
        {state === "loading"
          ? "Loading draft model…"
          : state === "error"
          ? "Draft model unavailable"
          : "Drag to orbit · scroll to zoom"}
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
