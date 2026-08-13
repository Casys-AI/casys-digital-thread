/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { createThreeOrbitViewport } from "../geometry/three-orbit-viewport.ts";
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
  resolveSealedAssemblyGeometry,
  sealedAssemblyGeometryBlocker,
  sealedAssemblyGlbAsset,
  type SysmlAnchoredRequirement,
} from "./component-workspace-model.ts";
import { CompactIdentifier } from "./compact-identifier.tsx";
import { GltfAssetCanvas } from "./gltf-asset-canvas.tsx";
import { productStructureAvailability } from "./product-anchor-model.ts";

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
  const sealedAssembly = resolveSealedAssemblyGeometry(snapshot);
  const structure = productStructureAvailability(snapshot);
  const selected =
    components.find((component) => component.id === selectedComponentId) ??
      components[0];
  const revisions = selected
    ? correctionNodesForComponent(snapshot, selected)
    : [];

  if (!selected) {
    const unavailable = structure.status === "unavailable"
      ? structure
      : undefined;
    return (
      <div class="component-empty">
        <span aria-hidden="true">N/A</span>
        <div>
          <h4>{unavailable?.title ?? "Product structure unavailable"}</h4>
          <p>{unavailable?.detail ?? snapshot.components.rationale}</p>
          <p class="component-empty-guidance">
            {unavailable?.guidance ??
              "No component count can be inferred from this thread revision."}
          </p>
        </div>
      </div>
    );
  }

  const structureCounts = structure.status === "available" ? structure : {
    assemblyRootCount: 0,
    partOccurrenceCount: 0,
  };

  return (
    <div class="component-workspace">
      <header class="component-workspace-header">
        <div>
          <p>PART-CENTRIC WORKSPACE</p>
          <h4>{selected.label}</h4>
        </div>
        <div class="component-workspace-count">
          <strong>
            {String(structureCounts.partOccurrenceCount).padStart(2, "0")}
          </strong>
          <span>declared part occurrences</span>
          <small>
            {structureCounts.assemblyRootCount} assembly root{structureCounts
                .assemblyRootCount === 1
              ? ""
              : "s"}
          </small>
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
          const genericAssemblyInspection = provider.id === "build123d" &&
              selected.kind === "assembly"
            ? sealedAssembly?.inspectionBinding
            : undefined;
          const inspectionBinding = selectedCad?.inspectionBinding ??
            genericAssemblyInspection;
          return (
            <button
              key={provider.id}
              type="button"
              role="tab"
              aria-selected={activeProvider === provider.id}
              onClick={() => {
                onProviderChange(provider.id);
                if (inspectionBinding) {
                  onBindingSelect(inspectionBinding);
                }
              }}
            >
              <span>{provider.label}</span>
              <small>
                {provider.id === "build123d"
                  ? cadCoverageLabel(cadCoverage, sealedAssembly)
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
  const sealedAssembly = resolveSealedAssemblyGeometry(snapshot);
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
        const genericAssemblyBinding = provider.id === "build123d" &&
            component.kind === "assembly"
          ? sealedAssembly?.inspectionBinding
          : undefined;
        const verified = binding?.status === "verified" || !!cadSurface ||
          !!genericAssemblyBinding;
        const inspectableBinding = cadSurface?.inspectionBinding ??
          genericAssemblyBinding ?? binding;
        const displayBinding = binding ?? cadSurface?.binding;
        const displayIdentity = displayBinding?.id ??
          (genericAssemblyBinding
            ? "Sealed assembly result"
            : provider.id === "build123d"
            ? component.kind === "part"
              ? "No per-part CAD identity"
              : "No assembly CAD identity"
            : provider.id === "syson"
            ? "No SysON identity"
            : "No ERP record identity");
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
                {displayBinding
                  ? (
                    <CompactIdentifier
                      value={displayIdentity}
                      label={`${provider.label} identity`}
                      copyable={false}
                    />
                  )
                  : <strong>{displayIdentity}</strong>}
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
        {view?.diagramId
          ? (
            <CompactIdentifier
              value={view.diagramId}
              label="SysON diagram identity"
            />
          )
          : <span>Diagram identity unavailable</span>}
      </header>

      {
        /* The assembly banner is the structure root — restored to its
          pre-facet position above everything else. Clicking it selects the
          assembly component when the catalog declares one. */
      }
      <button
        type="button"
        class={`syson-root-node${
          assemblyComponent && assemblyComponent.id === selected.id
            ? " is-selected"
            : ""
        }`}
        disabled={!assemblyComponent}
        onClick={assemblyComponent
          ? () => onSelect(assemblyComponent)
          : undefined}
      >
        <span>PART DEFINITION</span>
        <strong>{snapshot.subject.label}</strong>
        <small>
          {snapshot.components.components.filter((component) =>
            component.kind === "part"
          ).length} {terminology.countLabel}
        </small>
      </button>

      {/* Anchored requirements from the snapshot projection */}
      {subtree.anchoredRequirements.length > 0 && (
        <div class="syson-anchored-requirements">
          <p class="syson-section-label">REQUIREMENTS ANCHORED IN MODEL</p>
          {subtree.anchoredRequirements.map((req) => (
            <SysmlRequirementRow key={req.id} req={req} />
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
                <span class="syson-part-ordinal">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>{component.label}</strong>
                <small>{binding?.label ?? terminology.missingLabel}</small>
                {binding
                  ? (
                    <CompactIdentifier
                      value={binding.id}
                      label={`${component.label} SysON identity`}
                      copyable={false}
                    />
                  )
                  : <code>TRACE GAP</code>}
              </button>
            );
          })}
      </div>

      {sysonBinding && (
        <footer class="syson-element-identity">
          <small>SYSML ELEMENT</small>
          <CompactIdentifier
            value={sysonBinding.id}
            label="SysML element identity"
          />
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
  const selectedBinding = bindingFor(selected, "erpnext");
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
              {binding
                ? (
                  <CompactIdentifier
                    value={binding.id}
                    label={`${component.label} ERP identity`}
                    copyable={false}
                  />
                )
                : <code>UNLINKED</code>}
              <strong>{component.label}</strong>
              <span>{component.quantity}</span>
              <span class="erp-trace-state">
                {binding?.status === "verified" ? "verified" : "gap"}
              </span>
            </button>
          );
        })}
      </div>
      {selectedBinding && (
        <footer class="syson-element-identity erp-element-identity">
          <small>SELECTED ERP RECORD</small>
          <CompactIdentifier
            value={selectedBinding.id}
            label="ERP record identity"
          />
        </footer>
      )}
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
  const sealedAssembly = resolveSealedAssemblyGeometry(snapshot);
  const assemblyGlb = sealedAssembly && selected.kind === "assembly"
    ? sealedAssemblyGlbAsset(sealedAssembly)
    : undefined;
  const geometryBlocker = sealedAssemblyGeometryBlocker(snapshot);
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
            {surface?.representation === "authoritative-step"
              ? surface.scope === "part"
                ? surface.preview?.mediaType === "model/gltf-binary"
                  ? "PART-LEVEL CAD · STEP + GLB"
                  : "PART-LEVEL CAD · AUTHORITATIVE STEP"
                : "ASSEMBLY-LEVEL CAD · AUTHORITATIVE STEP"
              : surface?.scope === "assembly"
              ? "ASSEMBLY-LEVEL CAD · PRESENTATION MESH"
              : surface?.scope === "part"
              ? "PART-LEVEL CAD · EXACT RECORD"
              : sealedAssembly && selected.kind === "assembly"
              ? "SEALED ASSEMBLY RESULT · EXACT RECORD"
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
          : sealedAssembly && selected.kind === "assembly"
          ? (
            <button
              type="button"
              onClick={() => onInspect(sealedAssembly.inspectionBinding)}
            >
              inspect sealed result →
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
      {sealedAssembly && (
        <div class="cad-sealed-assembly">
          <div class="cad-sealed-assembly-copy">
            <span>SEALED ASSEMBLY RESULT</span>
            <strong>{sealedAssembly.assemblyFormats.join(" + ")}</strong>
            <p>
              The exact assembly files are sealed and linked to this geometry
              capture.{" "}
              {sealedAssembly.independentPartDefinitionGeometryCount > 0
                ? `${sealedAssembly.independentPartDefinitionGeometryCount} independent PartDefinition geometr${
                  sealedAssembly.independentPartDefinitionGeometryCount === 1
                    ? "y is"
                    : "ies are"
                } recorded under exact STEP identities.`
                : "No independent per-part geometry mapping was published."}
              {sealedAssembly.legacyPartMeshCount > 0 &&
                ` ${sealedAssembly.legacyPartMeshCount} legacy presentation mesh${
                  sealedAssembly.legacyPartMeshCount === 1 ? " is" : "es are"
                } retained separately.`}
            </p>
            <CompactIdentifier
              value={sealedAssembly.captureArtifact.fingerprint ??
                sealedAssembly.captureArtifact.id}
              label="sealed geometry fingerprint"
            />
          </div>
          <div class="cad-sealed-assembly-actions">
            <button
              type="button"
              onClick={() => onInspect(sealedAssembly.inspectionBinding)}
            >
              Open exact record
            </button>
          </div>
        </div>
      )}
      {geometryBlocker && (
        <div class="cad-geometry-blocker" role="alert">
          <strong>Assembly result unavailable</strong>
          <p>{geometryBlocker}</p>
        </div>
      )}
      {assemblyGlb
        ? (
          <SealedAssemblyGlbViewer
            asset={assemblyGlb}
            captureArtifact={sealedAssembly!.captureArtifact}
          />
        )
        : surface?.preview && surface.scope === "assembly"
        ? (
          <>
            <div class="cad-scope-notice">
              <span>ASSEMBLY SCOPE</span>
              <p>
                This exact assembly export does not imply separate geometry
                identities for its child parts.
              </p>
            </div>
            <CadStlViewer
              preview={surface.preview}
              authoritativeArtifact={surface.authoritativeArtifact}
              snapshot={snapshot}
            />
          </>
        )
        : surface?.preview?.mediaType === "model/gltf-binary" &&
            surface.scope === "part" && surface.presentationArtifact
        ? (
          <PartDefinitionGlbViewer
            label={selected.label}
            preview={surface.preview}
            authoritativeArtifact={surface.authoritativeArtifact}
            presentationArtifact={surface.presentationArtifact}
          />
        )
        : surface?.preview
        ? (
          <div class="cad-sealed-summary">
            <span aria-hidden="true">✓</span>
            <div>
              <h5>Part-level geometry record is linked</h5>
              <p>
                This exact part mesh remains inspectable as evidence. Product
                does not create a separate CAD viewer for each part.
              </p>
              {surface.authoritativeArtifact.fingerprint && (
                <CompactIdentifier
                  value={surface.authoritativeArtifact.fingerprint}
                  label={`${selected.label} geometry fingerprint`}
                />
              )}
            </div>
          </div>
        )
        : surface?.representation === "authoritative-step"
        ? (
          <div class="cad-sealed-summary">
            <span aria-hidden="true">✓</span>
            <div>
              <h5>
                {surface.scope === "part"
                  ? "Authoritative STEP linked"
                  : "Authoritative assembly STEP linked"}
              </h5>
              <p>
                {surface.scope === "part"
                  ? "This exact PartDefinition STEP is linked through the sealed geometry capture. No exact PartDefinition GLB was published in this bundle, so Product keeps the authoritative record visible without inventing a preview."
                  : "This exact assembly STEP is linked through the sealed geometry capture. Use the published assembly preview for visual review."}
              </p>
              {surface.authoritativeArtifact.fingerprint && (
                <CompactIdentifier
                  value={surface.authoritativeArtifact.fingerprint}
                  label={`${selected.label} authoritative STEP fingerprint`}
                />
              )}
            </div>
          </div>
        )
        : meshStatus === "not-exported"
        ? (
          <div class="cad-mesh-pending">
            <span aria-hidden="true" class="cad-mesh-pending-icon">⬡</span>
            <div>
              <h5>Mesh not yet exported for {selected.label}</h5>
              <p>
                A build123d identity is declared for this component, but this
                revision contains no exact component-level presentation mesh.
              </p>
              <code class="cad-mesh-pending-state">MESH NOT YET EXPORTED</code>
            </div>
          </div>
        )
        : sealedAssembly && selected.kind === "assembly"
        ? (
          <div class="cad-sealed-summary">
            <span aria-hidden="true">✓</span>
            <div>
              <h5>Assembly geometry is sealed</h5>
              <p>
                No fingerprint-bound GLB is available in this sealed assembly
                family. The exact capture remains inspectable from the record
                action above; Product does not infer a preview from another
                asset.
              </p>
            </div>
          </div>
        )
        : (
          <div class="cad-trace-gap">
            <span aria-hidden="true">CAD?</span>
            <div>
              <h5>
                {selected.kind === "part"
                  ? `No per-part mesh is linked to ${selected.label}`
                  : `No exact assembly geometry is linked to ${selected.label}`}
              </h5>
              <p>
                {selected.kind === "part"
                  ? sealedAssembly
                    ? "The sealed assembly remains available as evidence, but it does not establish an independently addressable CAD identity for this part."
                    : "No exact build123d identity has been declared for this part in the reviewed catalog."
                  : "This revision contains neither a catalog-bound assembly mesh nor a generic sealed assembly result."}
              </p>
            </div>
            {available.length > 0 && (
              <div class="cad-available-parts">
                <small>CATALOG-BOUND MESHES</small>
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

function SealedAssemblyGlbViewer({ asset, captureArtifact }: {
  asset: ThreadArtifact;
  captureArtifact: ThreadArtifact;
}): JSX.Element {
  return (
    <div class="cad-viewer-shell cad-assembly-gltf-viewer">
      <header class="cad-assembly-gltf-heading">
        <div>
          <small>SEALED ASSEMBLY PREVIEW · GLB</small>
          <strong>{asset.label}</strong>
        </div>
        <CompactIdentifier
          value={asset.fingerprint ?? asset.id}
          label="sealed assembly GLB fingerprint"
        />
      </header>
      <GltfAssetCanvas
        url={asset.uri!}
        ariaLabel="Interactive sealed assembly geometry"
        loadingLabel="Loading sealed assembly…"
        errorLabel="Sealed assembly preview unavailable"
      />
      <footer class="cad-viewer-evidence">
        <div>
          <small>EXACT VISUAL ASSET · GLB</small>
          <strong>{asset.label}</strong>
          <CompactIdentifier
            value={asset.fingerprint ?? asset.id}
            label="exact visual asset fingerprint"
          />
        </div>
        <div>
          <small>SEALED CAPTURE</small>
          <strong>{captureArtifact.label}</strong>
          <CompactIdentifier
            value={captureArtifact.fingerprint ?? captureArtifact.id}
            label="sealed capture fingerprint"
          />
        </div>
      </footer>
    </div>
  );
}

function PartDefinitionGlbViewer({
  label,
  preview,
  authoritativeArtifact,
  presentationArtifact,
}: {
  label: string;
  preview: ThreadComponentPreview;
  authoritativeArtifact: ThreadArtifact;
  presentationArtifact: ThreadArtifact;
}): JSX.Element {
  return (
    <div class="cad-viewer-shell cad-part-gltf-viewer">
      <header class="cad-part-gltf-heading">
        <div>
          <small>PARTDEFINITION PREVIEW · GLB</small>
          <strong>{label}</strong>
        </div>
        <CompactIdentifier
          value={presentationArtifact.fingerprint ?? presentationArtifact.id}
          label={`${label} GLB fingerprint`}
        />
      </header>
      <GltfAssetCanvas
        url={preview.url}
        ariaLabel={`Interactive ${label} PartDefinition geometry`}
        loadingLabel={`Loading ${label}…`}
        errorLabel={`${label} preview unavailable`}
      />
      <footer class="cad-viewer-evidence">
        <div>
          <small>VISUAL DERIVATIVE · GLB</small>
          <strong>{presentationArtifact.label}</strong>
          <CompactIdentifier
            value={presentationArtifact.fingerprint ?? presentationArtifact.id}
            label={`${label} exact visual asset fingerprint`}
          />
        </div>
        <div>
          <small>AUTHORITATIVE CAD · STEP</small>
          <strong>{authoritativeArtifact.label}</strong>
          <CompactIdentifier
            value={authoritativeArtifact.fingerprint ??
              authoritativeArtifact.id}
            label={`${label} authoritative STEP fingerprint`}
          />
        </div>
      </footer>
    </div>
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
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.MeshStandardMaterial | undefined;
    setState("loading");

    const viewport = createThreeOrbitViewport(container);
    const { scene } = viewport;
    scene.background = new THREE.Color(0xf8f6f0);
    scene.fog = new THREE.Fog(0xf8f6f0, 350, 900);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd5ddd8, 2.3));
    const key = new THREE.DirectionalLight(0xfff4e8, 3.6);
    key.position.set(180, 220, 260);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cc5c7, 2.2);
    rim.position.set(-180, 100, -120);
    scene.add(rim);
    const grid = new THREE.GridHelper(500, 20, 0x7c8b83, 0xd5dad4);
    scene.add(grid);

    new STLLoader().load(
      preview.url,
      (loaded) => {
        if (viewport.isDisposed()) {
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
        viewport.fitRadius(radius);
        grid.scale.setScalar(Math.max(radius / 120, 0.35));
        setState("ready");
      },
      undefined,
      () => !viewport.isDisposed() && setState("error"),
    );

    viewport.start();

    return () => {
      viewport.dispose(() => {
        geometry?.dispose();
        material?.dispose();
      });
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
          {authoritativeArtifact.fingerprint
            ? (
              <CompactIdentifier
                value={authoritativeArtifact.fingerprint}
                label="engineering authority fingerprint"
              />
            )
            : <code>Fingerprint unavailable</code>}
        </div>
        <div>
          <small>PRESENTATION ONLY · STL</small>
          <strong>{presentation?.label ?? "Derived display mesh"}</strong>
          <CompactIdentifier
            value={presentation?.fingerprint ?? preview.sha256}
            label="presentation mesh fingerprint"
          />
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

function cadCoverageLabel(
  coverage: ReturnType<typeof cadSurfaceCoverage>,
  sealed: ReturnType<typeof resolveSealedAssemblyGeometry>,
): string {
  if (sealed) {
    if (sealed.independentPartDefinitionGeometryCount > 0) {
      return `1 sealed assembly · ${sealed.independentPartDefinitionGeometryCount} independent PartDefinition geometr${
        sealed.independentPartDefinitionGeometryCount === 1 ? "y" : "ies"
      }`;
    }
    if (sealed.legacyPartMeshCount > 0) {
      return `1 sealed assembly · ${sealed.legacyPartMeshCount} legacy part mesh${
        sealed.legacyPartMeshCount === 1 ? "" : "es"
      }`;
    }
    return "1 sealed assembly · no independent part geometry";
  }
  const assembly = coverage.assemblySurfaces === 0
    ? "no assembly mesh"
    : `${coverage.assemblySurfaces} assembly mesh${
      coverage.assemblySurfaces === 1 ? "" : "es"
    }`;
  const parts = coverage.partSurfaces === 0
    ? "no part meshes"
    : `${coverage.partSurfaces} part mesh${
      coverage.partSurfaces === 1 ? "" : "es"
    }`;
  return `${assembly} · ${parts}`;
}
