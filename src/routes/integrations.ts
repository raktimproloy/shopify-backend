import { Router } from 'express';
import { ShopifyService } from '../services/shopify';
import { ProductService } from '../services/product';

const router = Router();
const shopify = new ShopifyService();
const productService = new ProductService();

// Deploy products to Shopify
router.post('/shopify/deploy', async (req, res) => {
  try {
    const { productIds } = req.body;
    
    const deployedProducts = [];
    for (const productId of productIds) {
      try {
        const product = await productService.getById(productId);
        const shopifyProduct = await productService.deployToShopify(product);
        deployedProducts.push(shopifyProduct);
      } catch (error) {
        console.error(`Failed to deploy product ${productId}:`, error);
      }
    }
    
    res.json({
      success: true,
      deployed: deployedProducts.length,
      products: deployedProducts,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Import products from Shopify to local database (with deletion sync)
router.post('/shopify/import', async (req, res) => {
  try {
    const { limit = 50, syncDeletions = true } = req.body;
    
    console.log('🔄 Starting Shopify product import with deletion sync...');
    
    // Get products from Shopify
    const shopifyProducts = await shopify.getProducts(limit);
    
    console.log(`📦 Found ${shopifyProducts.length} products in Shopify`);
    
    const importedProducts = [];
    const updatedProducts = [];
    const failedProducts = [];
    let deletedCount = 0;
    
    // Get all existing Shopify products from local database
    const existingProducts = await productService.getShopifyProducts();
    const shopifyProductIds = shopifyProducts.map(p => p.id.toString());
    
    // Handle deletions if syncDeletions is true
    if (syncDeletions) {
      for (const existingProduct of existingProducts) {
        const shopifyMapping = existingProduct.channelMappings?.find((m: any) => m.channel === 'shopify');
        if (shopifyMapping && !shopifyProductIds.includes(shopifyMapping.channelProductId)) {
          // Product exists locally but not in Shopify - mark as deleted
          await productService.markProductAsDeleted(existingProduct.id);
          deletedCount++;
          console.log(`🗑️ Marked as deleted: ${existingProduct.name}`);
        }
      }
    }
    
    // Import/Update products
    for (const shopifyProduct of shopifyProducts) {
      try {
        // Check if product already exists
        const existingProduct = existingProducts.find((p: any) => 
          p.channelMappings?.some((m: any) => 
            m.channel === 'shopify' && m.channelProductId === shopifyProduct.id.toString()
          )
        );
        
        if (existingProduct) {
          // Update existing product
          const updatedProduct = await productService.updateFromShopify(existingProduct.id, shopifyProduct);
          updatedProducts.push(updatedProduct);
          console.log(`🔄 Updated: ${shopifyProduct.title}`);
        } else {
          // Import new product
          const importedProduct = await productService.importFromShopify(shopifyProduct);
          importedProducts.push(importedProduct);
          console.log(`✅ Imported: ${shopifyProduct.title}`);
        }
      } catch (error) {
        console.error(`❌ Failed to process ${shopifyProduct.title}:`, error);
        failedProducts.push({
          title: shopifyProduct.title,
          error: (error as Error).message
        });
      }
    }
    
    res.json({
      success: true,
      imported: importedProducts.length,
      updated: updatedProducts.length,
      deleted: deletedCount,
      failed: failedProducts.length,
      total: shopifyProducts.length,
      importedProducts,
      updatedProducts,
      failedProducts
    });
    
  } catch (error) {
    console.error('❌ Shopify import failed:', error);
    res.status(500).json({ 
      error: 'Failed to import products from Shopify',
      details: (error as Error).message 
    });
  }
});

// Sync inventory across all channels
router.post('/inventory/sync', async (req, res) => {
  try {
    const syncResult = await productService.syncInventoryAcrossChannels();
    res.json(syncResult);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Bidirectional inventory sync (can overwrite Shopify data - use with caution)
router.post('/inventory/bidirectional-sync', async (req, res) => {
  try {
    console.log('🔄 Starting bidirectional inventory sync...');
    
    const syncResult = await productService.syncInventoryAcrossChannels();
    
    res.json({
      success: true,
      message: 'Bidirectional inventory sync completed',
      result: syncResult,
      warning: 'This operation can overwrite Shopify inventory data. Use with caution.'
    });
  } catch (error) {
    console.error('❌ Bidirectional inventory sync failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to perform bidirectional inventory sync'
    });
  }
});

export { router as integrationRoutes };