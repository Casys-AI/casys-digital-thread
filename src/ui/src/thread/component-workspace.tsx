import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { createThreeOrbitViewport } from "../geometry/three-orbit-viewport.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
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

const focusRing =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
      <Card className="min-w-0">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Badge variant="secondary" aria-hidden="true">N/A</Badge>
          <div className="space-y-2">
            <CardTitle className="text-base">
              {unavailable?.title ?? "Product structure unavailable"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {unavailable?.detail ?? snapshot.components.rationale}
            </p>
            <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
              {unavailable?.guidance ??
                "No component count can be inferred from this thread revision."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const structureCounts = structure.status === "available" ? structure : {
    assemblyRootCount: 0,
    partOccurrenceCount: 0,
  };

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start justify-between gap-4 max-md:flex-col">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Part-centric workspace
          </p>
          <CardTitle className="text-base">{selected.label}</CardTitle>
        </div>
        <div className="shrink-0 text-right">
          <strong className="text-xl font-semibold tabular-nums">
            {String(structureCounts.partOccurrenceCount).padStart(2, "0")}
          </strong>
          <p className="text-xs text-muted-foreground">
            declared part occurrences
          </p>
          <small className="block text-xs text-muted-foreground">
            {structureCounts.assemblyRootCount} assembly root{structureCounts
                .assemblyRootCount === 1
              ? ""
              : "s"}
          </small>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {revisions.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-auto w-full justify-between py-2"
            onClick={() => onRevisionOpen(revisions[0]!)}
          >
            <span className="font-normal text-muted-foreground">
              {revisions.length}{" "}
              recorded revision{revisions.length === 1 ? "" : "s"}
            </span>
            <strong className="font-medium">
              View this part’s lifecycle in Activity
            </strong>
          </Button>
        )}

        <Tabs
          value={activeProvider}
          onValueChange={(id) => {
            const provider = id as ThreadComponentProvider;
            onProviderChange(provider);
            const selectedCad = provider === "build123d"
              ? resolveCadSurface(snapshot, selected)
              : undefined;
            const genericAssemblyInspection = provider === "build123d" &&
                selected.kind === "assembly"
              ? sealedAssembly?.inspectionBinding
              : undefined;
            const inspectionBinding = selectedCad?.inspectionBinding ??
              genericAssemblyInspection;
            if (inspectionBinding) onBindingSelect(inspectionBinding);
          }}
        >
          <TabsList
            role="tablist"
            aria-label="Tool facet"
            className="h-auto w-full"
          >
            {PROVIDERS.map((provider) => {
              const linked = components.filter((component) =>
                verifiedBinding(component, provider.id)
              ).length;
              return (
                <TabsTrigger
                  key={provider.id}
                  value={provider.id}
                  className="min-w-0 flex-1 flex-col items-start px-3 py-1.5 text-left"
                >
                  <span className="block w-full truncate">
                    {provider.label}
                  </span>
                  <small className="block w-full truncate text-xs font-normal text-muted-foreground">
                    {provider.id === "build123d"
                      ? cadCoverageLabel(cadCoverage, sealedAssembly)
                      : `${linked}/${components.length} · ${provider.role}`}
                  </small>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <PartTraceStrip
          snapshot={snapshot}
          component={selected}
          activeProvider={activeProvider}
          onProviderChange={onProviderChange}
          onBindingSelect={onBindingSelect}
        />

        <div className="min-h-[455px]" data-provider={activeProvider}>
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
      </CardContent>
    </Card>
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
      className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch md:gap-3"
      aria-label={`Tool identities for ${component.label}`}
    >
      {PROVIDERS.flatMap((provider, index) => {
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
        const tile = (
          <button
            key={provider.id}
            type="button"
            data-state={verified ? "verified" : "gap"}
            aria-current={activeProvider === provider.id ? "true" : undefined}
            className={cn(
              "flex min-h-14 w-full min-w-0 items-center gap-2 rounded-lg border bg-card p-3 text-left",
              focusRing,
              verified ? "border-border" : "border-dashed border-border",
              activeProvider === provider.id && "ring-1 ring-ring",
            )}
            onClick={() => {
              onProviderChange(provider.id);
              if (verified && inspectableBinding) {
                onBindingSelect(inspectableBinding);
              }
            }}
          >
            <Badge variant={verified ? "success" : "warning"}>
              {verified ? "verified" : "gap"}
            </Badge>
            <span className="grid min-w-0 gap-1">
              <small className="text-xs font-medium text-muted-foreground">
                {provider.label}
              </small>
              {displayBinding
                ? (
                  <CompactIdentifier
                    value={displayIdentity}
                    label={`${provider.label} identity`}
                    copyable={false}
                  />
                )
                : genericAssemblyBinding
                ? (
                  <strong className="truncate text-sm font-medium">
                    {displayIdentity}
                  </strong>
                )
                : <Badge variant="warning">{displayIdentity}</Badge>}
            </span>
          </button>
        );
        if (index === 0) return [tile];
        return [
          <span
            key={`${provider.id}-connector`}
            className="hidden w-px self-stretch bg-border md:block"
            aria-hidden="true"
          />,
          tile,
        ];
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
  const assemblySelected = !!assemblyComponent &&
    assemblyComponent.id === selected.id;
  return (
    <section
      className="flex flex-col gap-4"
      aria-label="SysON product structure"
    >
      <ProviderSurfaceHeader
        eyebrow={`SysML v2 · ${terminology.heading}`}
        title={view?.diagramLabel ?? "System structure"}
        aside={view?.diagramId
          ? (
            <CompactIdentifier
              value={view.diagramId}
              label="SysON diagram identity"
            />
          )
          : (
            <span className="text-xs text-muted-foreground">
              Diagram identity unavailable
            </span>
          )}
      />

      {
        /* The assembly banner is the structure root — restored to its
          pre-facet position above everything else. Clicking it selects the
          assembly component when the catalog declares one. */
      }
      <button
        type="button"
        disabled={!assemblyComponent}
        className={cn(
          "w-full rounded-lg border bg-card p-4 text-left disabled:cursor-default disabled:opacity-100",
          focusRing,
          assemblySelected ? "border-brand" : "border-border",
        )}
        onClick={assemblyComponent
          ? () => onSelect(assemblyComponent)
          : undefined}
      >
        <span className="text-xs font-medium text-muted-foreground">
          Part definition
        </span>
        <strong className="mt-1 block text-sm font-semibold">
          {snapshot.subject.label}
        </strong>
        <small className="mt-1 block text-xs text-muted-foreground">
          {snapshot.components.components.filter((component) =>
            component.kind === "part"
          ).length} {terminology.countLabel}
        </small>
      </button>

      {subtree.anchoredRequirements.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Requirements anchored in model
          </p>
          {subtree.anchoredRequirements.map((req) => (
            <SysmlRequirementRow key={req.id} req={req} />
          ))}
        </div>
      )}

      {
        /* Part grid: compact selector, secondary to the SVG. The assembly
          lives in the root banner above, never among its own parts. */
      }
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {snapshot.components.components
          .filter((component) => component.kind !== "assembly")
          .map((component, index) => {
            const binding = bindingFor(component, "syson");
            const missing = !binding;
            return (
              <button
                key={component.id}
                type="button"
                data-state={binding?.status ?? "missing"}
                className={cn(
                  "flex min-h-[92px] min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 text-left",
                  focusRing,
                  missing ? "border-dashed border-border" : "border-border",
                  component.id === selected.id && "border-solid border-brand",
                )}
                onClick={() => onSelect(component)}
                onDoubleClick={() => binding && onInspect(binding)}
              >
                <span className="text-xs tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong className="truncate text-sm font-semibold">
                  {component.label}
                </strong>
                <small className="truncate text-xs text-muted-foreground">
                  {binding?.label ?? terminology.missingLabel}
                </small>
                {binding
                  ? (
                    <CompactIdentifier
                      value={binding.id}
                      label={`${component.label} SysON identity`}
                      copyable={false}
                    />
                  )
                  : (
                    <code className="font-mono text-xs text-muted-foreground">
                      Trace gap
                    </code>
                  )}
              </button>
            );
          })}
      </div>

      {sysonBinding && (
        <footer className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 max-md:flex-col max-md:items-start">
          <small className="text-xs font-medium text-muted-foreground">
            SysML element
          </small>
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
  const variant = req.status === "pass"
    ? "success"
    : req.status === "fail"
    ? "destructive"
    : "secondary";
  return (
    <div
      className="flex items-center gap-3 rounded-lg bg-muted/50 p-3"
      data-status={req.status}
    >
      <span
        className={cn(
          "text-sm",
          req.status === "pass"
            ? "text-success"
            : req.status === "fail"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {req.status === "pass" ? "✓" : req.status === "fail" ? "✕" : "?"}
      </span>
      <div className="min-w-0 flex-1">
        <strong className="text-sm font-semibold">{req.label}</strong>
        <code className="block font-mono text-xs text-muted-foreground">
          {req.expression}
        </code>
      </div>
      <Badge variant={variant}>{req.status}</Badge>
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
      heading: "Part definitions",
      countLabel: "declared definitions",
      missingLabel: "No SysON PartDefinition",
    };
  }
  if (kinds.size === 1 && kinds.has("part-usage")) {
    return {
      heading: "Part usages",
      countLabel: "declared usages",
      missingLabel: "No SysON PartUsage",
    };
  }
  return {
    heading: "Product structure",
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
    <section
      className="flex flex-col gap-4"
      aria-label="ERPNext bill of materials"
    >
      <ProviderSurfaceHeader
        eyebrow="Manufacturing bill of materials"
        title={bomName ?? "ERP BOM identity unavailable"}
        aside={
          <span className="text-xs text-muted-foreground">
            {snapshot.components.components.length} component records
          </span>
        }
      />
      <div
        className="overflow-x-auto rounded-lg border border-border"
        role="table"
      >
        <div
          className="grid min-w-[630px] grid-cols-[48px_minmax(120px,0.9fr)_minmax(150px,1.25fr)_48px_70px] items-center gap-2.5 border-b border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
          role="row"
        >
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
              data-state={binding?.status ?? "missing"}
              role="row"
              className={cn(
                "grid min-h-[42px] min-w-[630px] w-full grid-cols-[48px_minmax(120px,0.9fr)_minmax(150px,1.25fr)_48px_70px] items-center gap-2.5 border-b border-border px-3 py-2 text-left text-sm last:border-0",
                focusRing,
                component.id === selected.id && "bg-accent",
              )}
              onClick={() => onSelect(component)}
              onDoubleClick={() => binding && onInspect(binding)}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {String(index + 10).padStart(3, "0")}
              </span>
              {binding
                ? (
                  <CompactIdentifier
                    value={binding.id}
                    label={`${component.label} ERP identity`}
                    copyable={false}
                  />
                )
                : (
                  <code className="font-mono text-xs text-muted-foreground">
                    Unlinked
                  </code>
                )}
              <strong className="truncate text-sm font-medium">
                {component.label}
              </strong>
              <span>{component.quantity}</span>
              <Badge
                variant={binding?.status === "verified" ? "success" : "warning"}
              >
                {binding?.status === "verified" ? "verified" : "gap"}
              </Badge>
            </button>
          );
        })}
      </div>
      {selectedBinding && (
        <footer className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 max-md:flex-col max-md:items-start">
          <small className="text-xs font-medium text-muted-foreground">
            Selected ERP record
          </small>
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
  const inspectAction = surface
    ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onInspect(surface.inspectionBinding)}
      >
        inspect evidence →
      </Button>
    )
    : sealedAssembly && selected.kind === "assembly"
    ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onInspect(sealedAssembly.inspectionBinding)}
      >
        inspect sealed result →
      </Button>
    )
    : binding?.selection
    ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onInspect(binding)}
      >
        inspect evidence →
      </Button>
    )
    : (
      <span className="text-xs text-muted-foreground">
        CAD surface not linked
      </span>
    );
  return (
    <section className="flex flex-col gap-4" aria-label="build123d geometry">
      <ProviderSurfaceHeader
        eyebrow={cadEyebrow(surface, sealedAssembly, selected)}
        title={selected.label}
        aside={inspectAction}
      />
      {sealedAssembly && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 md:flex-row md:items-center">
          <div className="grid min-w-0 flex-1 gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Sealed assembly result
            </span>
            <strong className="text-sm font-semibold">
              {sealedAssembly.assemblyFormats.join(" + ")}
            </strong>
            <p className="text-sm text-muted-foreground">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => onInspect(sealedAssembly.inspectionBinding)}
          >
            Open exact record
          </Button>
        </div>
      )}
      {geometryBlocker && (
        <div
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          <strong className="block font-semibold">
            Assembly result unavailable
          </strong>
          <p className="mt-1">{geometryBlocker}</p>
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
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <span className="mr-2 font-medium">Assembly scope</span>
              This exact assembly export does not imply separate geometry
              identities for its child parts.
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
          <CadRecordNotice
            title="Part-level geometry record is linked"
            body="This exact part mesh remains inspectable as evidence. Product does not create a separate CAD viewer for each part."
          >
            {surface.authoritativeArtifact.fingerprint && (
              <CompactIdentifier
                value={surface.authoritativeArtifact.fingerprint}
                label={`${selected.label} geometry fingerprint`}
              />
            )}
          </CadRecordNotice>
        )
        : surface?.representation === "authoritative-step"
        ? (
          <CadRecordNotice
            title={surface.scope === "part"
              ? "Authoritative STEP linked"
              : "Authoritative assembly STEP linked"}
            body={surface.scope === "part"
              ? "This exact PartDefinition STEP is linked through the sealed geometry capture. No exact PartDefinition GLB was published in this bundle, so Product keeps the authoritative record visible without inventing a preview."
              : "This exact assembly STEP is linked through the sealed geometry capture. Use the published assembly preview for visual review."}
          >
            {surface.authoritativeArtifact.fingerprint && (
              <CompactIdentifier
                value={surface.authoritativeArtifact.fingerprint}
                label={`${selected.label} authoritative STEP fingerprint`}
              />
            )}
          </CadRecordNotice>
        )
        : meshStatus === "not-exported"
        ? (
          <div className="flex gap-4 rounded-lg border border-dashed border-border bg-muted/50 p-8">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
            >
              ⬡
            </span>
            <div className="min-w-0 space-y-2">
              <h5 className="text-base font-semibold">
                Mesh not yet exported for {selected.label}
              </h5>
              <p className="max-w-xl text-sm text-muted-foreground">
                A build123d identity is declared for this component, but this
                revision contains no exact component-level presentation mesh.
              </p>
              <Badge variant="warning">Mesh not yet exported</Badge>
            </div>
          </div>
        )
        : sealedAssembly && selected.kind === "assembly"
        ? (
          <CadRecordNotice
            title="Assembly geometry is sealed"
            body="No fingerprint-bound GLB is available in this sealed assembly family. The exact capture remains inspectable from the record action above; Product does not infer a preview from another asset."
          />
        )
        : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/50 px-4 py-8 text-center">
            <Badge variant="warning" aria-hidden="true">CAD?</Badge>
            <div className="space-y-2">
              <h5 className="text-base font-semibold">
                {selected.kind === "part"
                  ? `No per-part mesh is linked to ${selected.label}`
                  : `No exact assembly geometry is linked to ${selected.label}`}
              </h5>
              <p className="max-w-xl text-sm text-muted-foreground">
                {selected.kind === "part"
                  ? sealedAssembly
                    ? "The sealed assembly remains available as evidence, but it does not establish an independently addressable CAD identity for this part."
                    : "No exact build123d identity has been declared for this part in the reviewed catalog."
                  : "This revision contains neither a catalog-bound assembly mesh nor a generic sealed assembly result."}
              </p>
            </div>
            {available.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <small className="text-xs font-medium text-muted-foreground">
                  Catalog-bound meshes
                </small>
                <div className="flex flex-wrap justify-center gap-2">
                  {available.map((component) => (
                    <Button
                      key={component.id}
                      variant="outline"
                      size="sm"
                      onClick={() => onSelect(component)}
                    >
                      {component.label} →
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
    </section>
  );
}

function cadEyebrow(
  surface: ReturnType<typeof resolveCadSurface>,
  sealedAssembly: ReturnType<typeof resolveSealedAssemblyGeometry>,
  selected: ThreadComponent,
): string {
  if (surface?.representation === "authoritative-step") {
    if (surface.scope === "part") {
      return surface.preview?.mediaType === "model/gltf-binary"
        ? "Part-level CAD · STEP + GLB"
        : "Part-level CAD · authoritative STEP";
    }
    return "Assembly-level CAD · authoritative STEP";
  }
  if (surface?.scope === "assembly") {
    return "Assembly-level CAD · presentation mesh";
  }
  if (surface?.scope === "part") return "Part-level CAD · exact record";
  if (sealedAssembly && selected.kind === "assembly") {
    return "Sealed assembly result · exact record";
  }
  return "Parametric CAD · presentation mesh";
}

function CadRecordNotice({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex gap-4 rounded-lg border border-dashed border-border bg-muted/50 p-8">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full border border-success text-success"
      >
        ✓
      </span>
      <div className="min-w-0 space-y-2">
        <h5 className="text-base font-semibold">{title}</h5>
        <p className="max-w-xl text-sm text-muted-foreground">{body}</p>
        {children}
      </div>
    </div>
  );
}

function SealedAssemblyGlbViewer({ asset, captureArtifact }: {
  asset: ThreadArtifact;
  captureArtifact: ThreadArtifact;
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border px-3 py-3 max-md:flex-col max-md:items-start">
        <div className="min-w-0 space-y-1">
          <small className="text-xs font-medium text-muted-foreground">
            Sealed assembly preview · GLB
          </small>
          <strong className="block text-sm font-semibold">{asset.label}</strong>
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
      <CadEvidenceFooter
        left={{
          eyebrow: "Exact visual asset · GLB",
          title: asset.label,
          identity: {
            value: asset.fingerprint ?? asset.id,
            label: "exact visual asset fingerprint",
          },
        }}
        right={{
          eyebrow: "Sealed capture",
          title: captureArtifact.label,
          identity: {
            value: captureArtifact.fingerprint ?? captureArtifact.id,
            label: "sealed capture fingerprint",
          },
        }}
      />
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
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border px-3 py-3 max-md:flex-col max-md:items-start">
        <div className="min-w-0 space-y-1">
          <small className="text-xs font-medium text-muted-foreground">
            PartDefinition preview · GLB
          </small>
          <strong className="block text-sm font-semibold">{label}</strong>
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
      <CadEvidenceFooter
        left={{
          eyebrow: "Visual derivative · GLB",
          title: presentationArtifact.label,
          identity: {
            value: presentationArtifact.fingerprint ??
              presentationArtifact.id,
            label: `${label} exact visual asset fingerprint`,
          },
        }}
        right={{
          eyebrow: "Authoritative CAD · STEP",
          title: authoritativeArtifact.label,
          identity: {
            value: authoritativeArtifact.fingerprint ??
              authoritativeArtifact.id,
            label: `${label} authoritative STEP fingerprint`,
          },
        }}
      />
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
    scene.background = new THREE.Color(0xf2f4f6);
    scene.fog = new THREE.Fog(0xf2f4f6, 350, 900);

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
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        className="relative h-[clamp(360px,47vh,570px)] overflow-hidden"
        aria-label="Interactive STL geometry"
      >
        <div
          className="size-full [&_canvas]:block [&_canvas]:size-full"
          ref={host}
        />
        <div
          className={cn(
            "pointer-events-none absolute bottom-2.5 right-2.5 font-mono text-xs text-muted-foreground",
            state === "error" && "text-destructive",
          )}
          data-state={state}
        >
          {state === "loading"
            ? "Loading presentation mesh…"
            : state === "error"
            ? "Presentation mesh unavailable"
            : "Drag to orbit · wheel to zoom"}
        </div>
        <div
          className="pointer-events-none absolute bottom-2.5 left-2.5 flex gap-1"
          aria-hidden="true"
        >
          {["X", "Y", "Z"].map((axis) => (
            <span
              key={axis}
              className="flex size-5 items-center justify-center border border-border font-mono text-[0.49rem]"
            >
              {axis}
            </span>
          ))}
        </div>
      </div>
      <CadEvidenceFooter
        left={{
          eyebrow: "Engineering authority",
          title: authoritativeArtifact.label,
          identity: authoritativeArtifact.fingerprint
            ? {
              value: authoritativeArtifact.fingerprint,
              label: "engineering authority fingerprint",
            }
            : undefined,
          fallback: authoritativeArtifact.fingerprint
            ? undefined
            : "Fingerprint unavailable",
        }}
        right={{
          eyebrow: "Presentation only · STL",
          title: presentation?.label ?? "Derived display mesh",
          identity: {
            value: presentation?.fingerprint ?? preview.sha256,
            label: "presentation mesh fingerprint",
          },
        }}
      />
    </div>
  );
}

function ProviderSurfaceHeader({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside: JSX.Element;
}): JSX.Element {
  return (
    <header className="flex items-start justify-between gap-4 max-md:flex-col">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
        <h5 className="text-base font-semibold">{title}</h5>
      </div>
      {aside}
    </header>
  );
}

function CadEvidenceFooter({
  left,
  right,
}: {
  left: EvidenceColumn;
  right: EvidenceColumn;
}): JSX.Element {
  return (
    <footer className="grid border-t border-border md:grid-cols-2">
      <EvidenceColumnView column={left} />
      <EvidenceColumnView
        column={right}
        className="border-t border-border md:border-l md:border-t-0"
      />
    </footer>
  );
}

interface EvidenceColumn {
  eyebrow: string;
  title: string;
  identity?: { value: string; label: string };
  fallback?: string;
}

function EvidenceColumnView({
  column,
  className,
}: {
  column: EvidenceColumn;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("grid min-w-0 gap-1 p-3", className)}>
      <small className="text-xs font-medium text-muted-foreground">
        {column.eyebrow}
      </small>
      <strong className="truncate text-sm font-medium">{column.title}</strong>
      {column.identity
        ? (
          <CompactIdentifier
            value={column.identity.value}
            label={column.identity.label}
          />
        )
        : column.fallback
        ? (
          <code className="font-mono text-xs text-muted-foreground">
            {column.fallback}
          </code>
        )
        : null}
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
