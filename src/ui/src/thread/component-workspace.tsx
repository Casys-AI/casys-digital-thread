import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { createThreeOrbitViewport } from "../cad/three-orbit-viewport.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { ProductSourcingCoverageLine } from "../project/product-sourcing.tsx";
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
  sealedGlbPreviewBlocks,
  type SysmlAnchoredRequirement,
} from "./component-workspace-model.ts";
import { CompactIdentifier } from "./compact-identifier.tsx";
import { GltfAssetCanvas } from "./gltf-asset-canvas.tsx";
import {
  productStructureAvailability,
  productStructureHeadline,
} from "./product-anchor-model.ts";

export interface ComponentWorkspaceProps {
  snapshot: ThreadWorkbenchSnapshot;
  activeProvider: ThreadComponentProvider;
  selectedComponentId?: string;
  onProviderChange: (provider: ThreadComponentProvider) => void;
  onComponentSelect: (component: ThreadComponent) => void;
  onBindingSelect: (binding: ThreadComponentBinding) => void;
  /** Opens the same recorded correction context used by the Activity feed. */
  onRevisionOpen: (node: ThreadGraphNode) => void;
  /** Opens the reserved Product › Sourcing · ERP facet. */
  onOpenSourcing?: () => void;
}

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
  onOpenSourcing,
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

  const headline = structure.status === "available"
    ? productStructureHeadline(structure)
    : {
      count: 0,
      label: "declared PartDefinition",
      detail: "0 part occurrences",
    };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-brand">
            Product · sealed geometry
          </p>
          <h3 className="m-0 text-lg font-semibold tracking-tight">
            {selected.label}
          </h3>
        </div>
        <dl className="grid shrink-0 grid-cols-2 divide-x divide-border overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3">
          <div className="flex flex-col gap-0.5 px-3 py-1.5">
            <dt className="font-mono text-[9px] font-medium tracking-wider text-muted-foreground">
              Catalog
            </dt>
            <dd className="m-0 font-mono text-[12.5px] tabular-nums">
              {headline.count} {headline.label}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 px-3 py-1.5">
            <dt className="font-mono text-[9px] font-medium tracking-wider text-muted-foreground">
              Geometry
            </dt>
            <dd className="m-0 font-mono text-[12.5px]">
              {cadCoverageLabel(cadCoverage, sealedAssembly)}
            </dd>
          </div>
          <div className="col-span-2 flex flex-col gap-0.5 px-3 py-1.5 sm:col-span-1">
            <dt className="font-mono text-[9px] font-medium tracking-wider text-muted-foreground">
              Detail
            </dt>
            <dd className="m-0 font-mono text-[12.5px] text-muted-foreground">
              {headline.detail}
            </dd>
          </div>
        </dl>
      </div>

      {revisions.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-auto w-full justify-between py-2"
          onClick={() => onRevisionOpen(revisions[0]!)}
        >
          <span className="font-normal text-muted-foreground">
            {revisions.length} recorded revision
            {revisions.length === 1 ? "" : "s"}
          </span>
          <strong className="font-medium">
            View this part’s lifecycle in Activity
          </strong>
        </Button>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <Card className="min-w-0 overflow-hidden py-0">
          <CardContent className="flex flex-col gap-0 p-0">
            <StructurePartChips
              components={components}
              selectedId={selected.id}
              sealLabel={sealedAssembly
                ? sealedAssembly.assemblyFormats.join(" · ") + " · SEALED"
                : undefined}
              onSelect={(component) => {
                onComponentSelect(component);
                onProviderChange("build123d");
                const cad = resolveCadSurface(snapshot, component);
                const assemblyInspect = component.kind === "assembly"
                  ? sealedAssembly?.inspectionBinding
                  : undefined;
                const inspect = cad?.inspectionBinding ?? assemblyInspect;
                if (inspect) onBindingSelect(inspect);
              }}
            />
            <div
              className="min-h-[388px] p-4"
              data-provider={activeProvider}
            >
              <CadGeometry
                snapshot={snapshot}
                selected={selected}
                onSelect={onComponentSelect}
                onInspect={onBindingSelect}
              />
            </div>
            {sealedAssembly && (
              <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-3 py-2">
                <CompactIdentifier
                  value={sealedAssembly.captureArtifact.fingerprint ??
                    sealedAssembly.captureArtifact.id}
                  label="sealed geometry fingerprint"
                />
                <button
                  type="button"
                  className={cn(
                    "font-mono text-[9.5px] text-brand hover:underline",
                    focusRing,
                  )}
                  onClick={() =>
                    onBindingSelect(sealedAssembly.inspectionBinding)}
                >
                  Inspect in Activity →
                </button>
              </div>
            )}
          </CardContent>
        </Card>
        <SysmlRail
          snapshot={snapshot}
          selected={selected}
          activeProvider={activeProvider}
          onSelect={(component) => {
            onComponentSelect(component);
            onProviderChange("syson");
            const binding = bindingFor(component, "syson");
            if (binding) onBindingSelect(binding);
          }}
          onInspect={onBindingSelect}
        />
      </div>

      <ProductSourcingCoverageLine
        thread={snapshot}
        onOpenSourcing={onOpenSourcing}
      />
    </div>
  );
}

function StructurePartChips({
  components,
  selectedId,
  sealLabel,
  onSelect,
}: {
  components: readonly ThreadComponent[];
  selectedId: string;
  sealLabel?: string;
  onSelect: (component: ThreadComponent) => void;
}): JSX.Element {
  return (
    <div
      className="flex items-center gap-1.5 border-b border-border px-3 py-2"
      aria-label="Catalog components"
    >
      <div className="flex flex-1 flex-wrap gap-1.5">
        {components.map((component) => (
          <Button
            key={component.id}
            size="sm"
            variant={component.id === selectedId ? "default" : "outline"}
            aria-pressed={component.id === selectedId}
            className="h-7 px-2.5"
            onClick={() => onSelect(component)}
          >
            {component.label}
          </Button>
        ))}
      </div>
      {sealLabel && (
        <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">
          {sealLabel}
        </span>
      )}
    </div>
  );
}

function SysmlRail({
  snapshot,
  selected,
  activeProvider,
  onSelect,
  onInspect,
}: {
  snapshot: ThreadWorkbenchSnapshot;
  selected: ThreadComponent;
  activeProvider: ThreadComponentProvider;
  onSelect: (component: ThreadComponent) => void;
  onInspect: (binding: ThreadComponentBinding) => void;
}): JSX.Element {
  const view = snapshot.components.systemViews.syson;
  const terminology = sysonTerminology(snapshot.components.components);
  const subtree = buildSysmlSubtree(snapshot, selected);
  const sysonBinding = bindingFor(selected, "syson");
  const verifiedCount =
    snapshot.components.components.filter((component) =>
      verifiedBinding(component, "syson")
    ).length;
  return (
    <aside className="flex min-w-0 flex-col gap-3">
      <Card className="gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between gap-2 px-3 py-2">
          <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            SysML v2 · {terminology.heading}
          </p>
          <span className="font-mono text-[9.5px] text-muted-foreground">
            {verifiedCount}/{snapshot.components.components.length} verified
          </span>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {view?.diagramLabel && (
            <p className="px-3 pb-1 text-xs text-muted-foreground">
              {view.diagramLabel}
            </p>
          )}
          {snapshot.components.components.map((component) => {
            const binding = bindingFor(component, "syson");
            const current = component.id === selected.id;
            return (
              <button
                key={component.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                  focusRing,
                  current && "bg-brand/[0.04]",
                )}
                onClick={() => onSelect(component)}
              >
                <i
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    binding?.status === "verified"
                      ? "bg-success"
                      : "bg-muted-foreground/40",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-[11.5px]">
                  {component.label}
                </span>
                <span className="font-mono text-[9.5px] text-muted-foreground">
                  {component.kind}
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {(selected.attributes ?? []).length > 0 && (
        <Card className="gap-0 py-0">
          <CardHeader className="px-3 py-2">
            <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              AttributeUsage
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 px-3 pb-3">
            {(selected.attributes ?? []).map((attribute) => (
              <div
                key={attribute.id}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate text-[11.5px]">
                  {attribute.label}
                </span>
                <CompactIdentifier
                  value={attribute.id}
                  label={`${attribute.label} AttributeUsage identity`}
                  copyable={false}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {subtree.anchoredRequirements.length > 0 && (
        <Card className="gap-0 py-0">
          <CardHeader className="px-3 py-2">
            <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Requirements & constraints · anchored
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 px-3 pb-3">
            {subtree.anchoredRequirements.map((req) => (
              <SysmlRequirementRow key={req.id} req={req} />
            ))}
          </CardContent>
        </Card>
      )}

      {sysonBinding && (
        <button
          type="button"
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-brand/30",
            focusRing,
          )}
          data-provider={activeProvider}
          onClick={() => onInspect(sysonBinding)}
        >
          <span className="text-[11px] text-muted-foreground">
            Ports, connections, full diagram
          </span>
          <strong className="font-medium text-brand">Inspect record</strong>
        </button>
      )}
    </aside>
  );
}

function SysmlRequirementRow(
  { req }: { req: SysmlAnchoredRequirement },
): JSX.Element {
  const isPassing = req.status === "pass";
  const isFailing = req.status === "fail";
  return (
    <div
      className="flex items-center gap-3 rounded-lg bg-muted/50 p-3"
      data-status={req.status}
    >
      <span
        className={cn(
          "text-sm",
          isPassing
            ? "text-success"
            : isFailing
            ? "text-destructive"
            : "text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {isPassing ? "✓" : isFailing ? "✕" : "?"}
      </span>
      <div className="min-w-0 flex-1">
        <strong className="text-sm font-semibold">{req.label}</strong>
        <code className="block font-mono text-xs text-muted-foreground">
          {req.expression}
        </code>
      </div>
      {isPassing
        ? <Badge variant="success">{req.status}</Badge>
        : isFailing
        ? <Badge variant="destructive">{req.status}</Badge>
        : (
          <span className="inline-flex rounded border border-brand/20 bg-brand/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase leading-none text-brand">
            {req.status}
          </span>
        )}
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
  const definitionPreview = surface?.preview?.mediaType === "model/gltf-binary"
    ? surface.preview
    : selected.preview?.mediaType === "model/gltf-binary"
    ? selected.preview
    : undefined;
  const glbBlocks = sealedGlbPreviewBlocks(assemblyGlb, definitionPreview);
  const definitionGlb = glbBlocks.definition
    ? definitionGlbEvidence(
      snapshot,
      selected,
      glbBlocks.definition,
      surface,
      sealedAssembly,
    )
    : undefined;
  const geometryBlocker = sealedAssemblyGeometryBlocker(snapshot);
  const meshStatus = resolveCadMeshStatus(snapshot, selected);
  const available = snapshot.components.components.flatMap((component) => {
    const candidate = resolveCadSurface(snapshot, component);
    return candidate?.preview ? [component] : [];
  });
  return (
    <section className="flex flex-col gap-4" aria-label="build123d geometry">
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
      {glbBlocks.assembly || definitionGlb
        ? (
          <>
            {glbBlocks.assembly && sealedAssembly && (
              <SealedAssemblyGlbViewer
                asset={glbBlocks.assembly}
                captureArtifact={sealedAssembly.captureArtifact}
              />
            )}
            {definitionGlb && (
              <PartDefinitionGlbViewer
                label={selected.label}
                preview={definitionGlb.preview}
                authoritativeArtifact={definitionGlb.authoritativeArtifact}
                presentationArtifact={definitionGlb.presentationArtifact}
              />
            )}
          </>
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
      {surface && selected.kind !== "assembly" && (
        <div className="flex justify-end">
          <button
            type="button"
            className={cn(
              "font-mono text-[9.5px] text-muted-foreground hover:text-brand",
              focusRing,
            )}
            onClick={() =>
              onInspect(surface.inspectionBinding)}
          >
            Inspect evidence →
          </button>
        </div>
      )}
      {!surface && binding?.selection && (
        <div className="flex justify-end">
          <button
            type="button"
            className={cn(
              "font-mono text-[9.5px] text-muted-foreground hover:text-brand",
              focusRing,
            )}
            onClick={() => onInspect(binding)}
          >
            Inspect evidence →
          </button>
        </div>
      )}
    </section>
  );
}

function definitionGlbEvidence(
  snapshot: ThreadWorkbenchSnapshot,
  selected: ThreadComponent,
  preview: ThreadComponentPreview,
  surface: ReturnType<typeof resolveCadSurface>,
  sealedAssembly: ReturnType<typeof resolveSealedAssemblyGeometry>,
): {
  readonly preview: ThreadComponentPreview;
  readonly authoritativeArtifact: ThreadArtifact;
  readonly presentationArtifact: ThreadArtifact;
} | undefined {
  const presentationArtifact =
    snapshot.artifacts.find((artifact) => artifact.id === preview.artifactId) ??
      snapshot.artifacts.find((artifact) => artifact.uri === preview.url);
  if (!presentationArtifact) return undefined;
  const authoritativeArtifact = surface?.authoritativeArtifact ??
    snapshot.artifacts.find((artifact) =>
      selected.bindings.some((binding) =>
        binding.provider === "digital-thread" &&
        binding.kind === "artifact" &&
        binding.id === artifact.id
      )
    ) ??
    sealedAssembly?.assemblyAssets.find((artifact) => artifact.kind === "step");
  if (!authoritativeArtifact) return undefined;
  return { preview, authoritativeArtifact, presentationArtifact };
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
