/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type {
  ThreadArtifact,
  ThreadComponent,
  ThreadComponentBinding,
  ThreadComponentPreview,
  ThreadComponentProvider,
  ThreadGraphNode,
  ThreadWorkbenchSnapshot,
} from "./types.ts";
import {
  buildSysmlSubtree,
  cadSurfaceCoverage,
  correctionNodesForComponent,
  resolveCadMeshStatus,
  resolveCadSurface,
  type SysmlAnchoredRequirement,
  type SysmlSubtreeModel,
} from "./component-workspace-model.ts";

export interface ComponentWorkspaceProps {
  snapshot: ThreadWorkbenchSnapshot;
  activeProvider: ThreadComponentProvider;
  selectedComponentId?: string;
  onProviderChange: (provider: ThreadComponentProvider) => void;
  onComponentSelect: (component: ThreadComponent) => void;
  onBindingSelect: (binding: ThreadComponentBinding) => void;
  /** Opens the same recorded correction context used by the Activity feed. */
  onRevisionOpen: (node: ThreadGraphNode) => void;
}

const PROVIDERS: readonly {
  id: ThreadComponentProvider;
  label: string;
  role: string;
}[] = [
  { id: "syson", label: "SysON", role: "system structure" },
  { id: "build123d", label: "build123d", role: "geometry" },
  { id: "erpnext", label: "ERPNext", role: "enterprise record" },
];

export function ComponentWorkspace({
  snapshot,
  activeProvider,
  selectedComponentId,
  onProviderChange,
  onComponentSelect,
  onBindingSelect,
  onRevisionOpen,
}: ComponentWorkspaceProps): JSX.Element {
  const components = snapshot.components.components;
  const cadCoverage = cadSurfaceCoverage(snapshot);
  const selected =
    components.find((component) => component.id === selectedComponentId) ??
      components[0];
  const revisions = selected
    ? correctionNodesForComponent(snapshot, selected)
    : [];

  if (!selected) {
    return (
      <div class="component-empty">
        <span>00</span>
        <h4>No reviewed product structure</h4>
        <p>{snapshot.components.rationale}</p>
      </div>
    );
  }

  return (
    <div class="component-workspace">
      <header class="component-workspace-header">
        <div>
          <p>PART-CENTRIC WORKSPACE</p>
          <h4>{selected.label}</h4>
        </div>
        <div class="component-workspace-count">
          <strong>{String(components.length).padStart(2, "0")}</strong>
          <span>reviewed components</span>
        </div>
      </header>

      {revisions.length > 0 && (
        <button
          type="button"
          class="component-revision-link"
          onClick={() => onRevisionOpen(revisions[0]!)}
        >
          <span>
            {revisions.length}{" "}
            recorded revision{revisions.length === 1 ? "" : "s"}
          </span>
          <strong>View this part’s lifecycle in Activity</strong>
        </button>
      )}

      <div
        class="component-provider-tabs"
        role="tablist"
        aria-label="Tool facet"
      >
        {PROVIDERS.map((provider) => {
          const linked = components.filter((component) =>
            verifiedBinding(component, provider.id)
          ).length;
          const selectedCad = provider.id === "build123d"
            ? resolveCadSurface(snapshot, selected)
            : undefined;
          return (
            <button
              key={provider.id}
              type="button"
              role="tab"
              aria-selected={activeProvider === provider.id}
              onClick={() => {
                onProviderChange(provider.id);
                if (selectedCad) {
                  onBindingSelect(selectedCad.inspectionBinding);
                }
              }}
            >
              <span>{provider.label}</span>
              <small>
                {provider.id === "build123d"
                  ? `${cadCoverage.assemblySurfaces} assembly · ${cadCoverage.partSurfaces} parts`
                  : `${linked}/${components.length} · ${provider.role}`}
              </small>
            </button>
          );
        })}
      </div>

      <PartTraceStrip
        snapshot={snapshot}
        component={selected}
        activeProvider={activeProvider}
        onProviderChange={onProviderChange}
        onBindingSelect={onBindingSelect}
      />

      <div class="component-provider-surface" data-provider={activeProvider}>
        {activeProvider === "syson"
          ? (
            <SysonStructure
              snapshot={snapshot}
              selected={selected}
              onSelect={onComponentSelect}
              onInspect={onBindingSelect}
            />
          )
          : activeProvider === "erpnext"
          ? (
            <ErpBom
              snapshot={snapshot}
              selected={selected}
              onSelect={onComponentSelect}
              onInspect={onBindingSelect}
            />
          )
          : (
            <CadGeometry
              snapshot={snapshot}
              selected={selected}
              onSelect={onComponentSelect}
              onInspect={onBindingSelect}
            />
          )}
      </div>
    </div>
  );
}

function PartTraceStrip({
  snapshot,
  component,
  activeProvider,
  onProviderChange,
  onBindingSelect,
}: {
  snapshot: ThreadWorkbenchSnapshot;
  component: ThreadComponent;
  activeProvider: ThreadComponentProvider;
  onProviderChange: (provider: ThreadComponentProvider) => void;
  onBindingSelect: (binding: ThreadComponentBinding) => void;
}): JSX.Element {
  return (
    <div
      class="part-trace-strip"
      aria-label={`Tool identities for ${component.label}`}
    >
      {PROVIDERS.map((provider, index) => {
        const binding = bindingFor(component, provider.id);
        const cadSurface = provider.id === "build123d"
          ? resolveCadSurface(snapshot, component)
          : undefined;
        const verified = binding?.status === "verified" || !!cadSurface;
        const inspectableBinding = cadSurface?.inspectionBinding ?? binding;
        return (
          <div class="part-trace-step" key={provider.id}>
            {index > 0 && (
              <span class="part-trace-connector" aria-hidden="true" />
            )}
            <button
              type="button"
              data-state={verified ? "verified" : "gap"}
              aria-current={activeProvider === provider.id ? "true" : undefined}
              onClick={() => {
                onProviderChange(provider.id);
                if (verified && inspectableBinding) {
                  onBindingSelect(inspectableBinding);
                }
              }}
            >
              <i aria-hidden="true">{verified ? "✓" : "!"}</i>
              <span>
                <small>{provider.label}</small>
                <strong>{binding?.id ?? "Unlinked facet"}</strong>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SysonStructure({ snapshot, selected, onSelect, onInspect }: {
  snapshot: ThreadWorkbenchSnapshot;
  selected: ThreadComponent;
  onSelect: (component: ThreadComponent) => void;
  onInspect: (binding: ThreadComponentBinding) => void;
}): JSX.Element {
  const view = snapshot.components.systemViews.syson;
  const terminology = sysonTerminology(snapshot.components.components);
  const subtree = buildSysmlSubtree(snapshot, selected);
  const sysonBinding = bindingFor(selected, "syson");
  return (
    <section class="syson-structure" aria-label="SysON product structure">
      <header class="provider-surface-header">
        <div>
          <p>SYSML V2 · {terminology.heading}</p>
          <h5>{view?.diagramLabel ?? "System structure"}</h5>
        </div>
        <code>{view?.diagramId ?? "diagram identity unavailable"}</code>
      </header>

      {/* Native SVG sub-tree — no iframe, no external lib */}
      <SysmlSubtreeDiagram
        subtree={subtree}
        onSelect={onSelect}
        components={snapshot.components.components}
      />

      {/* Anchored requirements and sensitivity from the snapshot projection */}
      {subtree.anchoredRequirements.length > 0 && (
        <div class="syson-anchored-requirements">
          <p class="syson-section-label">REQUIREMENTS ANCHORED IN MODEL</p>
          {subtree.anchoredRequirements.map((req) => (
            <SysmlRequirementRow key={req.id} req={req} />
          ))}
        </div>
      )}

      {subtree.sensitivityRecords.length > 0 && (
        <div class="syson-sensitivity-records">
          <p class="syson-section-label">
            SENSITIVITY RELATIONS (DripTraySensitivityRelations)
          </p>
          {subtree.sensitivityRecords.map((rec, index) => (
            <div key={index} class="syson-sensitivity-row">
              <span>{rec.label}</span>
              <code>{rec.display}</code>
            </div>
          ))}
        </div>
      )}

      {/* Component grid: compact selector, now secondary to the SVG */}
      <div class="syson-part-grid">
        {snapshot.components.components.map((component, index) => {
          const binding = bindingFor(component, "syson");
          return (
            <button
              key={component.id}
              type="button"
              class={component.id === selected.id ? "is-selected" : undefined}
              data-state={binding?.status ?? "missing"}
              onClick={() => onSelect(component)}
              onDblClick={() => binding && onInspect(binding)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{component.label}</strong>
              <small>{binding?.label ?? terminology.missingLabel}</small>
              <code>{binding?.id ?? "TRACE GAP"}</code>
            </button>
          );
        })}
      </div>

      {sysonBinding && (
        <footer class="syson-element-identity">
          <small>SYSML ELEMENT</small>
          <code>{sysonBinding.id}</code>
        </footer>
      )}
    </section>
  );
}

/**
 * Native SVG diagram showing the selected component's position in the SysML
 * structure tree.  The diagram is purely declarative — no layout engine, no
 * external library.
 *
 * Layout:  root node at top centre → connector → selected node (highlighted)
 *          → sibling labels listed below.
 *
 * All data comes from the pre-computed SysmlSubtreeModel; no snapshot reads
 * are performed here.
 */
function SysmlSubtreeDiagram({ subtree, onSelect, components }: {
  subtree: SysmlSubtreeModel;
  onSelect: (component: ThreadComponent) => void;
  components: readonly ThreadComponent[];
}): JSX.Element {
  const W = 480;
  const H = subtree.siblings.length > 0
    ? 220 + Math.ceil(subtree.siblings.length / 2) * 32
    : 200;
  const rootX = W / 2;
  const rootY = 44;
  const selX = W / 2;
  const selY = 140;

  function selectById(id: string): void {
    const component = components.find((c) => c.id === id);
    if (component) onSelect(component);
  }

  const rootNode = subtree.root;
  const selNode = subtree.selected;
  const isAssemblySelected = rootNode.id === selNode.id;

  return (
    <div class="syson-subtree-diagram" aria-label="SysML structure sub-tree">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        aria-hidden="true"
        role="img"
      >
        {/* Root assembly node */}
        <g
          class="syson-svg-node syson-svg-root"
          data-current={isAssemblySelected ? "true" : undefined}
        >
          <rect
            x={rootX - 90}
            y={rootY - 18}
            width={180}
            height={36}
            rx={4}
          />
          <text
            x={rootX}
            y={rootY - 4}
            text-anchor="middle"
            class="syson-svg-kind"
          >
            {rootNode.kind === "assembly" ? "PartDefinition" : "PartDefinition"}
          </text>
          <text
            x={rootX}
            y={rootY + 13}
            text-anchor="middle"
            class="syson-svg-label"
          >
            {rootNode.label}
          </text>
        </g>

        {/* Connector from root to selected (only when different) */}
        {!isAssemblySelected && (
          <>
            <line
              x1={rootX}
              y1={rootY + 18}
              x2={selX}
              y2={selY - 18}
              class="syson-svg-edge"
              marker-end="url(#arrowhead)"
            />

            {/* Selected component node (highlighted) */}
            <g
              class="syson-svg-node syson-svg-selected"
              role="button"
              tabIndex={0}
              aria-label={`Selected: ${selNode.label}`}
            >
              <rect
                x={selX - 100}
                y={selY - 18}
                width={200}
                height={36}
                rx={4}
              />
              <text
                x={selX}
                y={selY - 4}
                text-anchor="middle"
                class="syson-svg-kind"
              >
                PartDefinition
              </text>
              <text
                x={selX}
                y={selY + 13}
                text-anchor="middle"
                class="syson-svg-label-selected"
              >
                {selNode.label}
              </text>
            </g>
          </>
        )}

        {/* Sibling labels — compact list below the selected node */}
        {subtree.siblings.length > 0 && (
          <g class="syson-svg-siblings">
            <text
              x={W / 2}
              y={selY + 44}
              text-anchor="middle"
              class="syson-svg-sibling-header"
            >
              {subtree.siblings.length} sibling
              {subtree.siblings.length === 1 ? "" : "s"} in assembly
            </text>
            {subtree.siblings.slice(0, 8).map((sib, index) => (
              <text
                key={sib.id}
                x={W / 2 + ((index % 2 === 0 ? -1 : 1) * 110)}
                y={selY + 64 + Math.floor(index / 2) * 28}
                text-anchor="middle"
                class="syson-svg-sibling"
                role="button"
                onClick={() => selectById(sib.id)}
              >
                {sib.label}
              </text>
            ))}
            {subtree.siblings.length > 8 && (
              <text
                x={W / 2}
                y={selY + 64 + 4 * 28}
                text-anchor="middle"
                class="syson-svg-sibling-more"
              >
                +{subtree.siblings.length - 8} more
              </text>
            )}
          </g>
        )}

        {/* Arrow marker definition */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="6"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" class="syson-svg-arrowhead" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

function SysmlRequirementRow(
  { req }: { req: SysmlAnchoredRequirement },
): JSX.Element {
  return (
    <div class="syson-req-row" data-status={req.status}>
      <span class="syson-req-status" aria-hidden="true">
        {req.status === "pass" ? "✓" : req.status === "fail" ? "✕" : "?"}
      </span>
      <div>
        <strong>{req.label}</strong>
        <code>{req.expression}</code>
      </div>
      <span class="syson-req-verdict">{req.status}</span>
    </div>
  );
}

function sysonTerminology(
  components: readonly ThreadComponent[],
): { heading: string; countLabel: string; missingLabel: string } {
  const kinds = new Set(
    components.flatMap((component) =>
      component.bindings
        .filter((binding) => binding.provider === "syson")
        .map((binding) => binding.kind)
    ),
  );
  if (kinds.size === 1 && kinds.has("part-definition")) {
    return {
      heading: "PART DEFINITIONS",
      countLabel: "declared definitions",
      missingLabel: "No SysON PartDefinition",
    };
  }
  if (kinds.size === 1 && kinds.has("part-usage")) {
    return {
      heading: "PART USAGES",
      countLabel: "declared usages",
      missingLabel: "No SysON PartUsage",
    };
  }
  return {
    heading: "PRODUCT STRUCTURE",
    countLabel: "declared elements",
    missingLabel: "No SysON product element",
  };
}

function ErpBom({ snapshot, selected, onSelect, onInspect }: {
  snapshot: ThreadWorkbenchSnapshot;
  selected: ThreadComponent;
  onSelect: (component: ThreadComponent) => void;
  onInspect: (binding: ThreadComponentBinding) => void;
}): JSX.Element {
  const bomName = snapshot.components.systemViews.erpnext?.bomName;
  return (
    <section class="erp-bom" aria-label="ERPNext bill of materials">
      <header class="provider-surface-header">
        <div>
          <p>MANUFACTURING BILL OF MATERIALS</p>
          <h5>{bomName ?? "ERP BOM identity unavailable"}</h5>
        </div>
        <span>{snapshot.components.components.length} component records</span>
      </header>
      <div class="erp-bom-table" role="table">
        <div class="erp-bom-row erp-bom-head" role="row">
          <span>Line</span>
          <span>Item</span>
          <span>Description</span>
          <span>Qty</span>
          <span>Trace</span>
        </div>
        {snapshot.components.components.map((component, index) => {
          const binding = bindingFor(component, "erpnext");
          return (
            <button
              key={component.id}
              type="button"
              class={`erp-bom-row${
                component.id === selected.id ? " is-selected" : ""
              }`}
              data-state={binding?.status ?? "missing"}
              role="row"
              onClick={() => onSelect(component)}
              onDblClick={() => binding && onInspect(binding)}
            >
              <span>{String(index + 10).padStart(3, "0")}</span>
              <code>{binding?.id ?? "UNLINKED"}</code>
              <strong>{component.label}</strong>
              <span>{component.quantity}</span>
              <span class="erp-trace-state">
                {binding?.status === "verified" ? "verified" : "gap"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CadGeometry({ snapshot, selected, onSelect, onInspect }: {
  snapshot: ThreadWorkbenchSnapshot;
  selected: ThreadComponent;
  onSelect: (component: ThreadComponent) => void;
  onInspect: (binding: ThreadComponentBinding) => void;
}): JSX.Element {
  const binding = bindingFor(selected, "build123d");
  const surface = resolveCadSurface(snapshot, selected);
  const meshStatus = resolveCadMeshStatus(snapshot, selected);
  const available = snapshot.components.components.flatMap((component) => {
    const candidate = resolveCadSurface(snapshot, component);
    return candidate?.preview ? [component] : [];
  });
  return (
    <section class="cad-geometry" aria-label="build123d geometry">
      <header class="provider-surface-header">
        <div>
          <p>
            {surface?.scope === "assembly"
              ? "ASSEMBLY-LEVEL CAD · PRESENTATION MESH"
              : "PARAMETRIC CAD · PRESENTATION MESH"}
          </p>
          <h5>{selected.label}</h5>
        </div>
        {surface
          ? (
            <button
              type="button"
              onClick={() => onInspect(surface.inspectionBinding)}
            >
              inspect evidence →
            </button>
          )
          : binding?.selection
          ? (
            <button type="button" onClick={() => onInspect(binding)}>
              inspect evidence →
            </button>
          )
          : <span>CAD surface not linked</span>}
      </header>
      {surface?.preview
        ? (
          <>
            {surface.scope === "assembly" && (
              <div class="cad-scope-notice">
                <span>ASSEMBLY SCOPE</span>
                <p>
                  This is the exact global CM-01 assembly export. It does not
                  imply separate geometry identities for its child parts.
                </p>
              </div>
            )}
            <CadStlViewer
              preview={surface.preview}
              authoritativeArtifact={surface.authoritativeArtifact}
              snapshot={snapshot}
            />
          </>
        )
        : meshStatus === "not-exported"
        ? (
          <div class="cad-mesh-pending">
            <span aria-hidden="true" class="cad-mesh-pending-icon">⬡</span>
            <div>
              <h5>Mesh not yet exported for {selected.label}</h5>
              <p>
                A build123d artifact is declared for this component but no
                presentation mesh has been generated yet. The @3 CAD operation
                must be executed with operator consent to produce per-part STLs.
              </p>
              <code class="cad-mesh-pending-state">MESH NOT YET EXPORTED</code>
            </div>
          </div>
        )
        : (
          <div class="cad-trace-gap">
            <span aria-hidden="true">CAD?</span>
            <div>
              <h5>
                No exact{" "}
                {selected.kind === "part" ? "part " : ""}geometry is linked to
                {" "}
                {selected.label}
              </h5>
              <p>
                {selected.kind === "part"
                  ? "No build123d identity has been declared for this part. The assembly can be viewed, but this revision does not include per-part geometry."
                  : "This revision contains no exact build123d assembly artifact and matching presentation mesh."}
              </p>
            </div>
            {available.length > 0 && (
              <div class="cad-available-parts">
                <small>AVAILABLE GEOMETRY</small>
                {available.map((component) => (
                  <button
                    key={component.id}
                    type="button"
                    onClick={() => onSelect(component)}
                  >
                    {component.label} →
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
    </section>
  );
}

function CadStlViewer({ preview, authoritativeArtifact, snapshot }: {
  preview: ThreadComponentPreview;
  authoritativeArtifact: ThreadArtifact;
  snapshot: ThreadWorkbenchSnapshot;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const presentation = snapshot.artifacts.find((artifact) =>
    artifact.id === preview.artifactId
  );

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.MeshStandardMaterial | undefined;
    setState("loading");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f10);
    scene.fog = new THREE.Fog(0x0b0f10, 350, 900);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = true;

    scene.add(new THREE.HemisphereLight(0xdce9dd, 0x202828, 2.3));
    const key = new THREE.DirectionalLight(0xf4f0dc, 3.6);
    key.position.set(180, 220, 260);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x80adb0, 2.2);
    rim.position.set(-180, 100, -120);
    scene.add(rim);
    const grid = new THREE.GridHelper(500, 20, 0x52605a, 0x26302e);
    scene.add(grid);

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    new STLLoader().load(
      preview.url,
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
          color: 0xa8bf72,
          metalness: 0.34,
          roughness: 0.56,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        const radius = Math.max(geometry.boundingSphere?.radius ?? 50, 1);
        camera.near = Math.max(radius / 100, 0.1);
        camera.far = radius * 30;
        camera.position.set(radius * 1.6, radius * 1.15, radius * 1.9);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        grid.scale.setScalar(Math.max(radius / 120, 0.35));
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
  }, [preview.url]);

  return (
    <div class="cad-viewer-shell">
      <div class="cad-viewer" aria-label="Interactive STL geometry">
        <div class="cad-viewer-canvas" ref={host} />
        <div class="cad-viewer-state" data-state={state}>
          {state === "loading"
            ? "Loading presentation mesh…"
            : state === "error"
            ? "Presentation mesh unavailable"
            : "Drag to orbit · wheel to zoom"}
        </div>
        <div class="cad-axis" aria-hidden="true">
          <i>X</i>
          <i>Y</i>
          <i>Z</i>
        </div>
      </div>
      <footer class="cad-viewer-evidence">
        <div>
          <small>ENGINEERING AUTHORITY</small>
          <strong>{authoritativeArtifact.label}</strong>
          <code>
            {authoritativeArtifact.fingerprint ?? "fingerprint unavailable"}
          </code>
        </div>
        <div>
          <small>PRESENTATION ONLY · STL</small>
          <strong>{presentation?.label ?? "Derived display mesh"}</strong>
          <code>{presentation?.fingerprint ?? preview.sha256}</code>
        </div>
      </footer>
    </div>
  );
}

function bindingFor(
  component: ThreadComponent,
  provider: ThreadComponentProvider,
): ThreadComponentBinding | undefined {
  return component.bindings.find((binding) => binding.provider === provider);
}

function verifiedBinding(
  component: ThreadComponent,
  provider: ThreadComponentProvider,
): ThreadComponentBinding | undefined {
  const binding = bindingFor(component, provider);
  return binding?.status === "verified" ? binding : undefined;
}
