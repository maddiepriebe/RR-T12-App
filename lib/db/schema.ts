import { pgTable, text, timestamp, integer, jsonb, uuid } from "drizzle-orm/pg-core";

export const operators = pgTable("operators", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  clerkOrgId: text("clerk_org_id"),
  clerkUserId: text("clerk_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const t12Mappings = pgTable("t12_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").references(() => operators.id),
  rawLabel: text("raw_label").notNull(),
  mappedCategory: text("mapped_category").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").references(() => operators.id),
  clerkUserId: text("clerk_user_id").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  units: integer("units"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").references(() => properties.id),
  type: text("type").notNull(), // "t12" | "rentroll" | "rentcomps" | "tradeout"
  label: text("label"),
  excelUrl: text("excel_url"),
  metadata: jsonb("metadata"),
  processedData: jsonb("processed_data"), // full parsed output for inline preview
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
