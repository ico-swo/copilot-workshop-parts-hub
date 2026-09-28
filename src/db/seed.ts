import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./index.ts";
import { SuppliersRepository } from "../modules/suppliers/repository.ts";
import { PartsRepository } from "../modules/parts/repository.ts";
import { PurchaseOrderRepository } from "../modules/purchase-orders/repository.ts";
import { ApiKeyRepository } from "../modules/auth/repository.ts";
import { AuditService } from "../modules/audit/service.ts";
import type { CreateSupplierInput } from "../modules/suppliers/schema.ts";

/**
 * Reference data for the workshop environment.
 *
 * The API keys below are fixed so participants can copy them from the lab
 * guide. They are development credentials for a throwaway environment and must
 * never be reused anywhere else.
 */
export const WORKSHOP_API_KEYS = [
  { name: "warehouse-viewer", role: "viewer" as const, key: "aoph_viewer_workshop_key" },
  { name: "warehouse-operator", role: "operator" as const, key: "aoph_operator_workshop_key" },
  { name: "procurement-admin", role: "admin" as const, key: "aoph_admin_workshop_key" },
];

export const SEED_SUPPLIERS: CreateSupplierInput[] = [
  { code: "SUP-DNSO", name: "Denso Indonesia", contactEmail: "sales@denso.example.co.id", phone: "+62 21 5555 0110", country: "Indonesia", leadTimeDays: 7, isActive: true },
  { code: "SUP-AISN", name: "Aisin Sunter Manufacturing", contactEmail: "order@aisin.example.co.id", phone: "+62 21 5555 0220", country: "Indonesia", leadTimeDays: 10, isActive: true },
  { code: "SUP-NGKB", name: "NGK Busi Indonesia", contactEmail: "cs@ngk.example.co.id", phone: "+62 21 5555 0330", country: "Indonesia", leadTimeDays: 5, isActive: true },
  { code: "SUP-BSCH", name: "Bosch Automotive SEA", contactEmail: "apac.order@bosch.example.com", phone: "+65 6555 0440", country: "Singapore", leadTimeDays: 21, isActive: true },
  { code: "SUP-LGCY", name: "Legacy Parts Trading", contactEmail: "info@legacyparts.example.co.id", phone: null, country: "Indonesia", leadTimeDays: 30, isActive: false },
];

interface SeedPart {
  sku: string;
  name: string;
  category: string;
  vehicleModel: string;
  unitPriceIdr: number;
  stockQuantity: number;
  reorderLevel: number;
  warehouse: string;
  supplierCode: string;
}

export const SEED_PARTS: SeedPart[] = [
  { sku: "AOP-BRK-1001", name: "Brake pad set, front", category: "brake", vehicleModel: "Avanza 1.3 G", unitPriceIdr: 385000, stockQuantity: 48, reorderLevel: 20, warehouse: "Jakarta-1", supplierCode: "SUP-AISN" },
  { sku: "AOP-BRK-1002", name: "Brake disc, ventilated", category: "brake", vehicleModel: "Xenia 1.3 R", unitPriceIdr: 720000, stockQuantity: 6, reorderLevel: 15, warehouse: "Jakarta-1", supplierCode: "SUP-AISN" },
  { sku: "AOP-BRK-1003", name: "Brake master cylinder", category: "brake", vehicleModel: "Innova 2.0 G", unitPriceIdr: 1150000, stockQuantity: 22, reorderLevel: 10, warehouse: "Karawang-1", supplierCode: "SUP-BSCH" },
  { sku: "AOP-FLT-2001", name: "Oil filter, spin-on", category: "filter", vehicleModel: "Avanza 1.5 S", unitPriceIdr: 62000, stockQuantity: 320, reorderLevel: 100, warehouse: "Bekasi-2", supplierCode: "SUP-DNSO" },
  { sku: "AOP-FLT-2002", name: "Cabin air filter", category: "filter", vehicleModel: "Rush 1.5 G", unitPriceIdr: 95000, stockQuantity: 9, reorderLevel: 40, warehouse: "Bekasi-2", supplierCode: "SUP-DNSO" },
  { sku: "AOP-FLT-2003", name: "Fuel filter assembly", category: "filter", vehicleModel: "Innova 2.4 G", unitPriceIdr: 245000, stockQuantity: 64, reorderLevel: 25, warehouse: "Bekasi-2", supplierCode: "SUP-DNSO" },
  { sku: "AOP-SUS-3001", name: "Shock absorber, rear", category: "suspension", vehicleModel: "Terios 1.5 X", unitPriceIdr: 545000, stockQuantity: 27, reorderLevel: 12, warehouse: "Karawang-1", supplierCode: "SUP-AISN" },
  { sku: "AOP-SUS-3002", name: "Stabiliser link, front", category: "suspension", vehicleModel: "Avanza 1.3 E", unitPriceIdr: 185000, stockQuantity: 11, reorderLevel: 30, warehouse: "Karawang-1", supplierCode: "SUP-AISN" },
  { sku: "AOP-ELC-4001", name: "Alternator 12V 90A", category: "electrical", vehicleModel: "Innova 2.0 V", unitPriceIdr: 2150000, stockQuantity: 4, reorderLevel: 6, warehouse: "Karawang-1", supplierCode: "SUP-BSCH" },
  { sku: "AOP-ELC-4002", name: "Spark plug, iridium", category: "electrical", vehicleModel: "Avanza 1.5 S", unitPriceIdr: 148000, stockQuantity: 480, reorderLevel: 150, warehouse: "Jakarta-1", supplierCode: "SUP-NGKB" },
  { sku: "AOP-ELC-4003", name: "Ignition coil", category: "electrical", vehicleModel: "Rush 1.5 S", unitPriceIdr: 675000, stockQuantity: 38, reorderLevel: 20, warehouse: "Jakarta-1", supplierCode: "SUP-NGKB" },
  { sku: "AOP-ENG-5001", name: "Timing belt kit", category: "engine", vehicleModel: "Innova 2.4 G", unitPriceIdr: 1480000, stockQuantity: 15, reorderLevel: 8, warehouse: "Jakarta-1", supplierCode: "SUP-DNSO" },
  { sku: "AOP-ENG-5002", name: "Water pump assembly", category: "engine", vehicleModel: "Xenia 1.5 R", unitPriceIdr: 890000, stockQuantity: 19, reorderLevel: 10, warehouse: "Jakarta-1", supplierCode: "SUP-DNSO" },
  { sku: "AOP-BDY-6001", name: "Side mirror assembly, left", category: "body", vehicleModel: "Avanza 1.3 E", unitPriceIdr: 410000, stockQuantity: 2, reorderLevel: 10, warehouse: "Bekasi-2", supplierCode: "SUP-BSCH" },
  { sku: "AOP-BDY-6002", name: "Front bumper cover", category: "body", vehicleModel: "Terios 1.5 R", unitPriceIdr: 1320000, stockQuantity: 7, reorderLevel: 5, warehouse: "Bekasi-2", supplierCode: "SUP-BSCH" },
];

export interface SeedResult {
  suppliers: number;
  parts: number;
  purchaseOrders: number;
  apiKeys: number;
}

export function seed(db: DatabaseSync = getDatabase()): SeedResult {
  const suppliers = new SuppliersRepository(db);
  const parts = new PartsRepository(db);
  const orders = new PurchaseOrderRepository(db);
  const keys = new ApiKeyRepository(db);
  const audit = new AuditService(db);

  const result: SeedResult = { suppliers: 0, parts: 0, purchaseOrders: 0, apiKeys: 0 };

  for (const supplier of SEED_SUPPLIERS) {
    if (!suppliers.findByCode(supplier.code)) {
      suppliers.create(supplier);
      result.suppliers += 1;
    }
  }

  for (const part of SEED_PARTS) {
    if (parts.findBySku(part.sku)) continue;
    const supplier = suppliers.findByCode(part.supplierCode);
    const { supplierCode: _ignored, ...rest } = part;
    parts.create({ ...rest, supplierId: supplier?.id ?? null, isActive: true });
    result.parts += 1;
  }

  for (const key of WORKSHOP_API_KEYS) {
    if (!keys.list().some((record) => record.name === key.name)) {
      keys.issue(key.name, key.role, key.key);
      result.apiKeys += 1;
    }
  }

  // One order in each interesting state, so the dashboard is not empty and the
  // state machine can be explored without creating data first.
  if (orders.list(new URLSearchParams({ limit: "1" })).total === 0) {
    const denso = suppliers.findByCode("SUP-DNSO");
    const cabinFilter = parts.findBySku("AOP-FLT-2002");
    const stabiliser = parts.findBySku("AOP-SUS-3002");
    const mirror = parts.findBySku("AOP-BDY-6001");

    if (denso && cabinFilter && stabiliser) {
      const draft = orders.create(
        {
          supplierId: denso.id,
          expectedAt: null,
          notes: "Replenishment for the Bekasi cabin filter shortfall",
          lines: [
            { partId: cabinFilter.id, quantity: 120, unitPriceIdr: 88000 },
            { partId: stabiliser.id, quantity: 60, unitPriceIdr: 172000 },
          ],
        },
        "warehouse-operator",
      );
      result.purchaseOrders += 1;
      audit.record({
        actor: "seed",
        action: "purchase_order.created",
        entityType: "purchase_order",
        entityId: draft.id,
        summary: `Seeded ${draft.reference} in draft`,
      });
    }

    const bosch = suppliers.findByCode("SUP-BSCH");
    if (bosch && mirror) {
      const submitted = orders.create(
        {
          supplierId: bosch.id,
          expectedAt: null,
          notes: "Body panel top-up ahead of the service campaign",
          lines: [{ partId: mirror.id, quantity: 40, unitPriceIdr: 398000 }],
        },
        "warehouse-operator",
      );
      orders.transition(submitted.id, "submitted", submitted.version, "warehouse-operator");
      result.purchaseOrders += 1;
    }
  }

  return result;
}

if (import.meta.filename === process.argv[1]) {
  const summary = seed();
  console.log(JSON.stringify({ level: "info", message: "Seed complete", ...summary }));
  console.log(
    JSON.stringify({
      level: "warn",
      message: "Development API keys issued. Do not reuse these values anywhere else.",
      keys: WORKSHOP_API_KEYS.map((k) => `${k.role}: ${k.key}`),
    }),
  );
}
