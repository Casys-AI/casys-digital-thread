import { defineComponentRegistry, readSurfaceContext } from "@casys/mcp-view";
import {
  Badge,
  Button,
  Card,
  DataTable,
  definePreactComponent,
  EmptyState,
  MetricGrid,
  type PreactSurfaceComponentProps,
  type PreactSurfaceContext,
} from "@casys/mcp-view/preact";
import { useEffect, useState } from "preact/hooks";
import {
  type BomMaterial,
  ERP_NEXT_COMPONENT_KEYS,
  type ErpNextBomSurfaceData,
} from "../../component-contract.ts";
type Props = PreactSurfaceComponentProps<ErpNextBomSurfaceData>;

const BomList = ({ data, context }: Props) => (
  <Card title="Bills of materials">
    <div class="bom-list">
      {data.boms.map((bom) => (
        <Button
          className="bom-list-entry"
          pressed={bom.name === data.selectedName}
          onClick={() =>
            publishSelection(context, "erpnext.bom.selected", {
              name: bom.name,
              item: bom.item,
            })}
        >
          <span>{bom.itemName || bom.item}</span>
          <code>{bom.name}</code>
        </Button>
      ))}
    </div>
  </Card>
);

const BomIdentity = ({ data }: Props) => {
  const bom = data.selected;
  return (
    <Card title="BOM identity">
      {bom
        ? (
          <div class="identity mcp-view-row-responsive">
            <div>
              <strong>{bom.itemName || bom.item}</strong>
              <code>{bom.name}</code>
            </div>
            <div class="mcp-view-badges">
              {bom.active && <Badge tone="success">Active</Badge>}
              {bom.default && <Badge tone="success">Default</Badge>}
            </div>
          </div>
        )
        : <EmptyState>No matching BOM data</EmptyState>}
    </Card>
  );
};

const BomMetrics = ({ data }: Props) => {
  const bom = data.selected;
  const metrics = bom
    ? [
      {
        id: "output-quantity",
        label: "Output quantity",
        value: formatNumber(bom.quantity),
        unit: bom.uom,
      },
      {
        id: "materials",
        label: "Materials",
        value: String(bom.materials.length),
      },
      {
        id: "operations",
        label: "Operations",
        value: String(bom.operations.length),
      },
      {
        id: "total-cost",
        label: "Total cost",
        value: formatMoney(bom.totalCost, bom.currency),
        unit: bom.currency,
      },
    ]
    : [];
  return (
    <Card title="BOM metrics">
      {metrics.length
        ? <MetricGrid items={metrics} />
        : <EmptyState>No matching BOM data</EmptyState>}
    </Card>
  );
};

const BomMaterials = ({ data, context }: Props) => {
  const [systemSelection, setSystemSelection] = useState<string>();
  const [selectedItemCode, setSelectedItemCode] = useState<string>();

  useEffect(
    () =>
      context.events?.on("syson.element.selected", ({ data: eventData }) => {
        const label = eventLabel(eventData);
        if (!label) return;
        setSystemSelection(label);
        setSelectedItemCode(findMatchingMaterial(data, label)?.itemCode);
      }),
    [context, data],
  );

  return (
    <Card title="Materials">
      {systemSelection && (
        <div class="mcp-view-cross-selection" role="status">
          SysON selection: <strong>{systemSelection}</strong>
          {!selectedItemCode && (
            <span class="mcp-view-cross-selection-status">
              No direct BOM match
            </span>
          )}
        </div>
      )}
      {data.selected?.materials.length
        ? (
          <DataTable
            label="BOM materials"
            rows={data.selected.materials}
            columns={MATERIAL_COLUMNS}
            rowKey={(material) => material.itemCode}
            selected={(material) => material.itemCode === selectedItemCode}
            onSelect={(material) => {
              setSelectedItemCode(material.itemCode);
              publishSelection(
                context,
                "erpnext.material.selected",
                { itemCode: material.itemCode },
              );
            }}
          />
        )
        : <EmptyState>No matching BOM data</EmptyState>}
    </Card>
  );
};

const MATERIAL_COLUMNS = [
  {
    id: "item",
    label: "Item",
    render: (material: BomMaterial) => (
      <>
        <strong>{material.itemName || material.itemCode}</strong>
        <code>{material.itemCode}</code>
      </>
    ),
  },
  {
    id: "quantity",
    label: "Qty",
    render: (material: BomMaterial) => (
      <>{formatNumber(material.quantity)} {material.uom}</>
    ),
  },
  {
    id: "rate",
    label: "Rate",
    render: (material: BomMaterial) => formatNumber(material.rate),
  },
  {
    id: "amount",
    label: "Amount",
    render: (material: BomMaterial) => formatNumber(material.amount),
  },
] as const;

const BomOperations = ({ data }: Props) => (
  <Card title="Operations">
    {data.selected?.operations.length
      ? (
        <div class="operations">
          {data.selected.operations.map((operation) => (
            <article>
              <div>
                <strong>{operation.operation}</strong>
                <span>{operation.workstation || "Unassigned"}</span>
              </div>
              <div>
                <b>{formatNumber(operation.timeMinutes)} min</b>
                <small>{formatNumber(operation.operatingCost)}</small>
              </div>
            </article>
          ))}
        </div>
      )
      : <EmptyState>No matching BOM data</EmptyState>}
  </Card>
);

const BomCosts = ({ data }: Props) => {
  const bom = data.selected;
  return (
    <Card title="Cost structure">
      {bom
        ? (
          <div class="costs">
            <Cost
              label="Raw materials"
              value={bom.rawMaterialCost}
              total={bom.totalCost}
            />
            <Cost
              label="Operations"
              value={bom.operatingCost}
              total={bom.totalCost}
            />
            <Cost label="Total" value={bom.totalCost} total={bom.totalCost} />
          </div>
        )
        : <EmptyState>No matching BOM data</EmptyState>}
    </Card>
  );
};

const Cost = (
  { label, value, total }: { label: string; value: number; total: number },
) => (
  <div>
    <span>{label}</span>
    <progress max={Math.max(total, 1)} value={value} />
    <strong>{formatNumber(value)}</strong>
  </div>
);

export const bomRegistry = defineComponentRegistry<
  ErpNextBomSurfaceData,
  PreactSurfaceContext<ErpNextBomSurfaceData>
>({
  components: {
    [ERP_NEXT_COMPONENT_KEYS.bomList]: definePreactComponent(
      { title: "BOM list", description: "Selectable ERPNext BOM documents." },
      BomList,
    ),
    [ERP_NEXT_COMPONENT_KEYS.bomIdentity]: definePreactComponent(
      {
        title: "BOM identity",
        description: "Selected item, document and status.",
      },
      BomIdentity,
    ),
    [ERP_NEXT_COMPONENT_KEYS.bomMetrics]: definePreactComponent(
      {
        title: "BOM metrics",
        description: "Compact quantity, cost and count metrics.",
      },
      BomMetrics,
    ),
    [ERP_NEXT_COMPONENT_KEYS.bomMaterials]: definePreactComponent(
      {
        title: "BOM materials",
        description: "Raw material quantities and costs.",
      },
      BomMaterials,
    ),
    [ERP_NEXT_COMPONENT_KEYS.bomOperations]: definePreactComponent(
      {
        title: "BOM operations",
        description: "Manufacturing operations and workstations.",
      },
      BomOperations,
    ),
    [ERP_NEXT_COMPONENT_KEYS.bomCosts]: definePreactComponent(
      {
        title: "BOM costs",
        description: "Material and operating cost structure.",
      },
      BomCosts,
    ),
  },
});

function publishSelection(
  context: PreactSurfaceContext<ErpNextBomSurfaceData>,
  event: string,
  data: Record<string, string>,
): void {
  if (context.capabilities.updateModelContext) {
    void context.app.updateModelContext({
      content: [{ type: "text", text: `${event}: ${JSON.stringify(data)}` }],
      structuredContent: { event, ...data },
    });
  }
  if (
    readSurfaceContext(context.hostContext)?.eventChannel === "ui/compose/event"
  ) {
    context.events?.emit(event, data);
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    value,
  );
}

function formatMoney(value: number, currency?: string): string {
  if (!currency) return formatNumber(value);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency })
      .format(
        value,
      );
  } catch {
    return `${formatNumber(value)} ${currency}`;
  }
}

function eventLabel(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const label = (value as Record<string, unknown>).label;
  if (typeof label !== "string" || !label.trim()) return undefined;
  const withoutStereotype = label.replace(/«[^»]+»/g, "").trim();
  const typeName = withoutStereotype.split(":").at(-1)?.trim();
  return typeName || withoutStereotype;
}

function findMatchingMaterial(
  data: ErpNextBomSurfaceData,
  label: string,
): BomMaterial | undefined {
  const needle = searchable(label);
  if (!needle) return undefined;
  return data.selected?.materials.find((material) => {
    const code = searchable(material.itemCode);
    const name = searchable(material.itemName ?? "");
    return code === needle || (name.length > 0 && (
      name === needle || name.includes(needle) || needle.includes(name)
    ));
  });
}

function searchable(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}
