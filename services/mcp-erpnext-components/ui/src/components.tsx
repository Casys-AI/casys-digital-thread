import { defineComponentRegistry, readSurfaceContext } from "@casys/mcp-view";
import {
  definePreactComponent,
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
        <button
          class={bom.name === data.selectedName ? "selected" : ""}
          type="button"
          onClick={() =>
            publishSelection(context, "erpnext.bom.selected", {
              name: bom.name,
              item: bom.item,
            })}
        >
          <span>{bom.itemName || bom.item}</span>
          <code>{bom.name}</code>
        </button>
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
              {bom.active && <span class="mcp-view-badge">Active</span>}
              {bom.default && <span class="mcp-view-badge">Default</span>}
            </div>
          </div>
        )
        : <Empty />}
    </Card>
  );
};

const BomMetrics = ({ data }: Props) => {
  const bom = data.selected;
  const metrics = bom
    ? [
      ["Output quantity", formatNumber(bom.quantity), bom.uom],
      ["Materials", String(bom.materials.length), undefined],
      ["Operations", String(bom.operations.length), undefined],
      ["Total cost", formatMoney(bom.totalCost, bom.currency), bom.currency],
    ]
    : [];
  return (
    <Card title="BOM metrics">
      {metrics.length
        ? (
          <div class="mcp-view-metrics">
            {metrics.map(([label, value, unit]) => (
              <article class="mcp-view-metric">
                <span class="mcp-view-metric-label">{label}</span>
                <strong class="mcp-view-metric-value">{value}</strong>
                {unit && <small class="mcp-view-metric-unit">{unit}</small>}
              </article>
            ))}
          </div>
        )
        : <Empty />}
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
          <div class="mcp-view-table-wrap">
            <table class="mcp-view-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.selected.materials.map((material) => (
                  <MaterialRow
                    material={material}
                    selected={material.itemCode === selectedItemCode}
                    onSelect={() => {
                      setSelectedItemCode(material.itemCode);
                      publishSelection(
                        context,
                        "erpnext.material.selected",
                        { itemCode: material.itemCode },
                      );
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
        : <Empty />}
    </Card>
  );
};

const MaterialRow = ({
  material,
  selected,
  onSelect,
}: {
  material: BomMaterial;
  selected: boolean;
  onSelect: () => void;
}) => (
  <tr
    class={selected ? "mcp-view-selected" : ""}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect();
    }}
    tabindex={0}
  >
    <td>
      <strong>{material.itemName || material.itemCode}</strong>
      <code>{material.itemCode}</code>
    </td>
    <td>{formatNumber(material.quantity)} {material.uom}</td>
    <td>{formatNumber(material.rate)}</td>
    <td>{formatNumber(material.amount)}</td>
  </tr>
);

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
      : <Empty />}
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
        : <Empty />}
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

const Card = (
  { title, children }: { title: string; children: preact.ComponentChildren },
) => (
  <section class="mcp-view-card">
    <h2 class="mcp-view-card-title">{title}</h2>
    {children}
  </section>
);

const Empty = () => <p class="mcp-view-empty">No matching BOM data</p>;

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
