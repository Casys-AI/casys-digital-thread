export const ERP_NEXT_COMPONENT_KEYS = {
  bomList: "erpnext.bom.list",
  bomIdentity: "erpnext.bom.identity",
  bomMetrics: "erpnext.bom.metrics",
  bomMaterials: "erpnext.bom.materials",
  bomOperations: "erpnext.bom.operations",
  bomCosts: "erpnext.bom.costs",
} as const;

export interface BomSummary {
  readonly name: string;
  readonly item: string;
  readonly itemName?: string;
  readonly quantity: number;
  readonly uom?: string;
  readonly active: boolean;
  readonly default: boolean;
  readonly totalCost: number;
}

export interface BomMaterial {
  readonly itemCode: string;
  readonly itemName?: string;
  readonly quantity: number;
  readonly stockQuantity?: number;
  readonly uom?: string;
  readonly rate: number;
  readonly amount: number;
  readonly sourceWarehouse?: string;
}

export interface BomOperation {
  readonly operation: string;
  readonly workstation?: string;
  readonly timeMinutes: number;
  readonly hourlyRate: number;
  readonly operatingCost: number;
}

export interface BomDetail extends BomSummary {
  readonly currency?: string;
  readonly rawMaterialCost: number;
  readonly operatingCost: number;
  readonly materials: readonly BomMaterial[];
  readonly operations: readonly BomOperation[];
}

export interface ErpNextBomSurfaceData extends Record<string, unknown> {
  readonly generatedAt: string;
  readonly count: number;
  readonly selectedName?: string;
  readonly boms: readonly BomSummary[];
  readonly selected?: BomDetail;
}

export interface BomSurfaceArgs {
  readonly name?: string;
  readonly item?: string;
  readonly is_active?: boolean;
  readonly is_default?: boolean;
  readonly limit?: number;
}
