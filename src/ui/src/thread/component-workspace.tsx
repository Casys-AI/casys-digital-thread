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
  const assemblyComponent = snapshot.components.components.find(
    (component) => component.kind === "assembly",
  );
  return (
    <section class="syson-structure" aria-label="SysON product structure">
      <header class="provider-surface-header">
        <div>
          <p>SYSML V2 · {terminology.heading}</p>
          <h5>{view?.diagramLabel ?? "System structure"}</h5>
        </div>
        <code>{view?.diagramId ?? "diagram identity unavailable"}</code>
      </header>

      {
        /* The assembly banner is the structure root — restored to its
          pre-facet position above everything else. Clicking it selects the
          assembly component when the catalog declares one. */
      }
      <div
        class="syson-root-node"
        role={assemblyComponent ? "button" : undefined}
        tabIndex={assemblyComponent ? 0 : undefined}
        onClick={assemblyComponent
          ? () => onSelect(assemblyComponent)
          : undefined}
      >
        <span>ASSEMBLY</span>
        <strong>{snapshot.subject.label}</strong>
        <small>
          {snapshot.components.components.length} {terminology.countLabel}
        </small>
      </div>

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
            SENSITIVITY RELATIONS ANCHORED IN MODEL
          </p>
          {subtree.sensitivityRecords.map((rec, index) => (
            <div key={index} class="syson-sensitivity-row">
              <span>{rec.label}</span>
              <code>{rec.display}</code>
            </div>
          ))}
        </div>
      )}

      {
        /* Part grid: compact selector, secondary to the SVG. The assembly
          lives in the root banner above, never among its own parts. */
      }
      <div class="syson-part-grid">
        {snapshot.components.components
          .filter((component) => component.kind !== "assembly")
          .map((component, index) => {
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
