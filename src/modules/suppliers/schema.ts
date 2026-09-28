import { Validator, requireNonEmptyUpdate } from "../../core/validation.ts";

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactEmail: string;
  phone: string | null;
  country: string;
  leadTimeDays: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateSupplierInput = Omit<Supplier, "id" | "version" | "createdAt" | "updatedAt">;
export type UpdateSupplierInput = Partial<Omit<CreateSupplierInput, "code">>;

const CODE_PATTERN = /^SUP-[A-Z0-9]{4}$/;

const CREATE_FIELDS = [
  "code",
  "name",
  "contactEmail",
  "phone",
  "country",
  "leadTimeDays",
  "isActive",
] as const;

const UPDATE_FIELDS = ["name", "contactEmail", "phone", "country", "leadTimeDays", "isActive"] as const;

export function parseCreateSupplier(input: unknown): CreateSupplierInput {
  const v = Validator.forBody(input);
  v.rejectUnknown(CREATE_FIELDS);

  const code = v.pattern("code", CODE_PATTERN, "SUP-XXXX");
  const name = v.string("name");
  const contactEmail = v.email("contactEmail");
  const country = v.string("country", { max: 60 });
  const leadTimeDays = v.integer("leadTimeDays", { min: 0, max: 365 });
  const phone = v.has("phone") && v.raw("phone") !== null
    ? v.string("phone", { max: 40, required: false })
    : null;
  const isActive = v.has("isActive") ? v.boolean("isActive", { required: false }) : true;

  v.settle();

  return {
    code: code as string,
    name: name as string,
    contactEmail: contactEmail as string,
    phone: phone ?? null,
    country: country as string,
    leadTimeDays: leadTimeDays as number,
    isActive: isActive ?? true,
  };
}

export function parseUpdateSupplier(input: unknown): UpdateSupplierInput {
  const v = Validator.forBody(input);
  v.rejectUnknown(UPDATE_FIELDS);

  if (v.has("code")) v.reject("code", "cannot be changed after a supplier is created");

  const update: UpdateSupplierInput = {};
  if (v.has("name")) {
    const value = v.string("name");
    if (value !== undefined) update.name = value;
  }
  if (v.has("contactEmail")) {
    const value = v.email("contactEmail");
    if (value !== undefined) update.contactEmail = value;
  }
  if (v.has("country")) {
    const value = v.string("country", { max: 60 });
    if (value !== undefined) update.country = value;
  }
  if (v.has("leadTimeDays")) {
    const value = v.integer("leadTimeDays", { min: 0, max: 365 });
    if (value !== undefined) update.leadTimeDays = value;
  }
  if (v.has("phone")) {
    update.phone = v.raw("phone") === null ? null : (v.string("phone", { max: 40 }) ?? null);
  }
  if (v.has("isActive")) {
    const value = v.boolean("isActive");
    if (value !== undefined) update.isActive = value;
  }

  v.settle();
  requireNonEmptyUpdate(update);
  return update;
}
