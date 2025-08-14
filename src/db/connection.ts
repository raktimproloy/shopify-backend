import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set!');
  console.error('Please create a .env file with the following content:');
  console.error('DATABASE_URL=postgresql://username:password@localhost:5432/database_name');
  console.error('SHOPIFY_SHOP_NAME=your-shop-name');
  console.error('SHOPIFY_ACCESS_TOKEN=your-access-token');
  console.error('SHOPIFY_WEBHOOK_SECRET=your-webhook-secret');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test database connection
pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
  process.exit(1);
});

pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

export const db = drizzle(pool, { schema });