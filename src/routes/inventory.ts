import { Router } from 'express';
import { db } from '../db/connection';
import { inventory, productVariants, products } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = Router();

// Get inventory overview
router.get('/', async (req, res) => {
  try {
    const inventoryItems = await db.select({
      id: inventory.id,
      variantId: inventory.variantId,
      channel: inventory.channel,
      quantity: inventory.quantity,
      available: inventory.available,
      lastSyncAt: inventory.lastSyncAt,
      sku: productVariants.sku,
      productName: products.name,
    })
    .from(inventory)
    .leftJoin(productVariants, eq(inventory.variantId, productVariants.id))
    .leftJoin(products, eq(productVariants.productId, products.id));

    // Group by variant
    const groupedInventory = inventoryItems.reduce((acc:any, item:any) => {
      const key:any = item.variantId;
      if (!acc[key]) {
        acc[key] = {
          id: item.variantId,
          sku: item.sku,
          productName: item.productName,
          channels: {},
        };
      }
      
      acc[key].channels[item.channel] = {
        quantity: item.quantity,
        available: item.available,
        lastSync: item.lastSyncAt?.toISOString() || '',
      };
      
      return acc;
    }, {});

    res.json({
      success: true,
      items: Object.values(groupedInventory),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export { router as inventoryRoutes };