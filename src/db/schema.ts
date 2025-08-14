// backend/src/db/schema.ts
import { 
  pgTable, 
  serial, 
  text, 
  varchar, 
  integer, 
  decimal, 
  boolean, 
  timestamp, 
  jsonb,
  uniqueIndex
} from 'drizzle-orm/pg-core';

// Products table - unified catalog
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  sku: varchar('sku', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 500 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  brand: varchar('brand', { length: 100 }),
  basePrice: decimal('base_price', { precision: 10, scale: 2 }),
  status: varchar('status', { length: 20 }).default('active'), // active, inactive, discontinued
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Product variants (size, color, etc.)
export const productVariants = pgTable('product_variants', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').references(() => products.id),
  sku: varchar('sku', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 200 }),
  size: varchar('size', { length: 20 }),
  color: varchar('color', { length: 50 }),
  price: decimal('price', { precision: 10, scale: 2 }),
  weight: decimal('weight', { precision: 8, scale: 2 }),
  dimensions: jsonb('dimensions'), // {length, width, height}
  images: jsonb('images'), // array of image URLs
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Inventory tracking across channels
export const inventory = pgTable('inventory', {
  id: serial('id').primaryKey(),
  variantId: integer('variant_id').references(() => productVariants.id),
      channel: varchar('channel', { length: 50 }).notNull(), // shopify, internal
  channelProductId: varchar('channel_product_id', { length: 100 }),
  quantity: integer('quantity').default(0),
  reserved: integer('reserved').default(0), // reserved for pending orders
  available: integer('available').default(0), // quantity - reserved
  lastSyncAt: timestamp('last_sync_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
  return {
    channelVariantIdx: uniqueIndex('channel_variant_idx').on(table.variantId, table.channel)
  }
});

// Channel mappings for product data
export const channelMappings = pgTable('channel_mappings', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').references(() => products.id),
  variantId: integer('variant_id').references(() => productVariants.id),
  channel: varchar('channel', { length: 50 }).notNull(),
  channelProductId: varchar('channel_product_id', { length: 100 }),
  channelVariantId: varchar('channel_variant_id', { length: 100 }),
  channelData: jsonb('channel_data'), // store channel-specific data
  syncStatus: varchar('sync_status', { length: 20 }).default('pending'), // pending, synced, failed
  lastSyncAt: timestamp('last_sync_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Sync logs for audit trail
export const syncLogs = pgTable('sync_logs', {
  id: serial('id').primaryKey(),
  channel: varchar('channel', { length: 50 }).notNull(),
  operation: varchar('operation', { length: 50 }).notNull(), // import, export, update
  productId: integer('product_id').references(() => products.id),
  variantId: integer('variant_id').references(() => productVariants.id),
  status: varchar('status', { length: 20 }).notNull(), // success, failed, partial
  message: text('message'),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Orders table
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderNumber: varchar('order_number', { length: 100 }).unique(),
  channel: varchar('channel', { length: 50 }).notNull(),
  channelOrderId: varchar('channel_order_id', { length: 100 }),
  customerEmail: varchar('customer_email', { length: 255 }),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }),
  status: varchar('status', { length: 20 }).default('pending'),
  orderData: jsonb('order_data'), // full order details
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Order items
export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => orders.id),
  variantId: integer('variant_id').references(() => productVariants.id),
  quantity: integer('quantity').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }),
  totalPrice: decimal('total_price', { precision: 10, scale: 2 }),
});

// Configuration for API settings
export const configurations = pgTable('configurations', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).unique(),
  value: jsonb('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow(),
});