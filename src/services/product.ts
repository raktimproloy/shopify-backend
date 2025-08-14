import { db } from '../db/connection';
import { products, productVariants, inventory, channelMappings, syncLogs } from '../db/schema';
import { ShopifyService } from './shopify';
import { eq, and, or, like, gte, lte, notExists } from 'drizzle-orm';

export class ProductService {
  private shopifyService: ShopifyService;

  constructor() {
    this.shopifyService = new ShopifyService();
  }

  async updateProductInShopify(productId: number, productData: any) {
    try {
      console.log(`🔄 Updating product ${productId} in Shopify`);
      
      // Get Shopify channel mappings
      const [mapping] = await db.select()
        .from(channelMappings)
        .where(and(
          eq(channelMappings.productId, productId),
          eq(channelMappings.channel, 'shopify')
        ));

      if (!mapping) {
        throw new Error('Product not found in Shopify channel mappings');
      }

      // Transform data for Shopify update
      const shopifyUpdateData = {
        id: mapping.channelProductId,
        title: productData.name,
        body_html: productData.description,
        vendor: productData.brand,
        product_type: productData.category,
        tags: [productData.category, productData.brand].filter(Boolean).join(', '),
        variants: productData.variants.map((variant: any) => ({
          id: mapping.channelVariantId || undefined,
          title: variant.name,
          price: variant.price?.toString() || '0',
          sku: variant.sku,
          weight: parseFloat(variant.weight?.toString() || '0'),
        })),
      };

      // Update product in Shopify
      const updatedShopifyProduct = await this.shopifyService.updateProduct(shopifyUpdateData);

      // Update channel mapping data
      await db.update(channelMappings)
        .set({
          channelData: updatedShopifyProduct,
          lastSyncAt: new Date(),
        })
        .where(eq(channelMappings.id, mapping.id));

      // Log the update
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'update',
        productId: productId,
        status: 'success',
        message: `Updated product ${productData.name} in Shopify`,
        details: { updatedShopifyProduct },
      });

      return updatedShopifyProduct;
    } catch (error) {
      console.error(`❌ Failed to update product ${productId} in Shopify:`, error);
      throw error;
    }
  }

  async deployToShopify(product: any) {
    try {
      // Get product variants
      const variants = await db.select()
        .from(productVariants)
        .where(eq(productVariants.productId, product.id));

      // Transform data for Shopify
      const shopifyProductData = {
        title: product.name,
        body_html: product.description,
        vendor: product.brand,
        product_type: product.category,
        tags: [product.category, product.brand].filter(Boolean).join(', '),
        variants: variants.map(variant => ({
          title: variant.name,
          price: variant.price?.toString() || '0',
          sku: variant.sku,
          inventory_quantity: 0, // Will be synced separately
          weight: parseFloat(variant.weight?.toString() || '0'),
        })),
        images: variants
          .filter(v => v.images && Array.isArray(v.images) && v.images.length > 0)
          .map((v:any) => ({ src: v.images[0], alt: v.name }))
      };

      // Create product in Shopify
      const shopifyProduct = await this.shopifyService.createProduct(shopifyProductData);

      // Create channel mappings for Shopify
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        const shopifyVariant = shopifyProduct.variants[i];

        await db.insert(channelMappings).values({
          productId: product.id,
          variantId: variant.id,
          channel: 'shopify',
          channelProductId: shopifyProduct.id.toString(),
          channelVariantId: shopifyVariant.id.toString(),
          channelData: shopifyVariant,
          syncStatus: 'synced',
          lastSyncAt: new Date(),
        });

        // Create inventory entry for Shopify
        await db.insert(inventory).values({
          variantId: variant.id,
          channel: 'shopify',
          channelProductId: shopifyProduct.id.toString(),
          quantity: 0,
          available: 0,
          lastSyncAt: new Date(),
        });
      }

      // Log the deployment
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'export',
        productId: product.id,
        status: 'success',
        message: `Deployed product ${product.name} to Shopify`,
        details: { shopifyProduct },
      });

      return shopifyProduct;
    } catch (error) {
      // Log the error
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'export',
        productId: product.id,
        status: 'failed',
        message: `Failed to deploy product: ${(error as Error).message}`,
        details: { error: (error as Error).message },
      });
      throw error;
    }
  }

  async getById(productId: number) {
    const [product] = await db.select()
      .from(products)
      .where(eq(products.id, productId));

    if (!product) {
      throw new Error('Product not found');
    }

    const variants = await db.select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId));

    return { ...product, variants };
  }

  async getAllProducts(
    limit = 100, 
    offset = 0, 
    includeDeleted = false,
    filters: {
      search?: string;
      category?: string;
      brand?: string;
      status?: string;
      minPrice?: number;
      maxPrice?: number;
      color?: string;
      size?: string;
    } = {}
  ) {
    try {
      console.log('🔍 Fetching products from database with filters:', filters);
      
      let query:any = db.select().from(products);
      
      // Apply status filter
      if (!includeDeleted) {
        query = query.where(eq(products.status, 'active'));
      } else if (filters.status) {
        query = query.where(eq(products.status, filters.status));
      }
      
      // Apply search filter
      if (filters.search) {
        const searchTerm = `%${filters.search}%`;
        query = query.where(
          or(
            like(products.name, searchTerm),
            like(products.description || '', searchTerm),
            like(products.sku, searchTerm),
            like(products.brand || '', searchTerm),
            like(products.category || '', searchTerm)
          )
        );
      }
      
      // Apply category filter
      if (filters.category) {
        query = query.where(eq(products.category, filters.category));
      }
      
      // Apply brand filter
      if (filters.brand) {
        query = query.where(eq(products.brand, filters.brand));
      }
      
      // Apply price filters
      if (filters.minPrice !== undefined) {
        query = query.where(gte(products.basePrice, filters.minPrice.toString()));
      }
      if (filters.maxPrice !== undefined) {
        query = query.where(lte(products.basePrice, filters.maxPrice.toString()));
      }
      
      // Get total count for pagination
      const countQuery = query;
      const totalProducts = await countQuery;
      const total = totalProducts.length;
      
      // Apply pagination
      const productList = await query
        .limit(limit)
        .offset(offset);

      console.log(`📦 Found ${productList.length} products, fetching variants...`);

      const productsWithVariants = await Promise.all(
        productList.map(async (product:any) => {
          let variantsQuery:any = db.select()
            .from(productVariants)
            .where(eq(productVariants.productId, product.id));
          
          // Apply color filter
          if (filters.color) {
            variantsQuery = variantsQuery.where(eq(productVariants.color, filters.color as string));
          }
          
          // Apply size filter
          if (filters.size) {
            variantsQuery = variantsQuery.where(eq(productVariants.size, filters.size as string));
          }
          
          const variants = await variantsQuery;
          return { ...product, variants };
        })
      );

      // Filter out products that have no variants after color/size filtering
      const filteredProducts = productsWithVariants.filter(product => product.variants.length > 0);
      
      // Recalculate total for accurate pagination
      const actualTotal = filteredProducts.length;

      console.log(`✅ Successfully fetched ${filteredProducts.length} products with variants after filtering`);
      
      return {
        products: filteredProducts,
        pagination: {
          total: actualTotal,
          totalPages: Math.ceil(actualTotal / limit),
          currentPage: Math.floor(offset / limit) + 1,
          limit,
          offset,
          hasNextPage: offset + limit < actualTotal,
          hasPrevPage: offset > 0
        }
      };
    } catch (error) {
      console.error('❌ Error in getAllProducts:', error);
      throw new Error(`Failed to fetch products: ${(error as Error).message}`);
    }
  }

  async getAllProductsIncludingDeleted(limit = 100, offset = 0) {
    try {
      console.log('🔍 Fetching all products including deleted from database...');
      
      // Get total count for pagination
      const totalProducts = await db.select().from(products);
      const total = totalProducts.length;
      
      const productList = await db.select()
        .from(products)
        .limit(limit)
        .offset(offset);

      console.log(`📦 Found ${productList.length} products, fetching variants...`);

      const productsWithVariants = await Promise.all(
        productList.map(async (product) => {
          const variants = await db.select()
            .from(productVariants)
            .where(eq(productVariants.productId, product.id));

          return { ...product, variants };
        })
      );

      console.log(`✅ Successfully fetched ${productsWithVariants.length} products with variants`);
      
      return {
        products: productsWithVariants,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: Math.floor(offset / limit) + 1,
          limit,
          offset,
          hasNextPage: offset + limit < total,
          hasPrevPage: offset > 0
        }
      };
    } catch (error) {
      console.error('❌ Error in getAllProductsIncludingDeleted:', error);
      throw new Error(`Failed to fetch all products: ${(error as Error).message}`);
    }
  }

  // Ensure internal inventory records exist for all variants
  private async ensureInternalInventoryExists() {
    try {
      // Get all variants that don't have internal inventory records
      const variantsWithoutInternal = await db.select({
        variantId: productVariants.id,
        productId: productVariants.productId,
        sku: productVariants.sku,
        name: productVariants.name,
      })
      .from(productVariants)
      .where(
        notExists(
          db.select()
            .from(inventory)
            .where(and(
              eq(inventory.variantId, productVariants.id),
              eq(inventory.channel, 'internal')
            ))
        )
      );

      if (variantsWithoutInternal.length > 0) {
        console.log(`📝 Creating ${variantsWithoutInternal.length} missing internal inventory records`);
        
        for (const variant of variantsWithoutInternal) {
          await db.insert(inventory).values({
            variantId: variant.variantId,
            channel: 'internal',
            quantity: 0,
            available: 0,
            reserved: 0,
            lastSyncAt: new Date(),
          });
        }
        
        console.log(`✅ Created ${variantsWithoutInternal.length} internal inventory records`);
      }
    } catch (error) {
      console.error('❌ Error ensuring internal inventory exists:', error);
    }
  }

  // Read-only inventory sync from Shopify (doesn't overwrite Shopify data)
  async syncInventoryFromShopifyReadOnly() {
    try {
      console.log('🔄 Starting read-only inventory sync from Shopify...');
      
      // Ensure internal inventory records exist
      await this.ensureInternalInventoryExists();
      
      // Get all products with Shopify mappings
      const productsWithShopify = await db.select({
        productId: products.id,
        productName: products.name,
        variantId: productVariants.id,
        variantName: productVariants.name,
        shopifyProductId: channelMappings.channelProductId,
        shopifyVariantId: channelMappings.channelVariantId,
      })
      .from(products)
      .innerJoin(productVariants, eq(products.id, productVariants.productId))
      .innerJoin(channelMappings, eq(productVariants.id, channelMappings.variantId))
      .where(eq(channelMappings.channel, 'shopify'));

      console.log(`📊 Found ${productsWithShopify.length} products with Shopify mappings`);

      let syncedFromShopify = 0;
      let failedFromShopify = 0;

      for (const product of productsWithShopify) {
        try {
          if (!product.shopifyProductId || !product.shopifyVariantId) {
            console.log(`⚠️ Skipping product ${product.productName} - missing Shopify IDs`);
            continue;
          }

          // Fetch current inventory from Shopify API
          console.log(`🔄 Fetching inventory for ${product.productName} from Shopify...`);
          
          // Get current inventory from Shopify
          const shopifyInventory = await this.shopifyService.getProductInventory(
            product.shopifyProductId as string,
            product.shopifyVariantId as string
          );

          if (shopifyInventory !== null) {
            // Update local database with Shopify inventory
            await db.update(inventory)
              .set({
                quantity: shopifyInventory.quantity,
                available: shopifyInventory.available,
                reserved: shopifyInventory.reserved || 0,
                lastSyncAt: new Date(),
              })
              .where(and(
                eq(inventory.variantId, product.variantId),
                eq(inventory.channel, 'shopify')
              ));

            // Also update internal inventory to match
            await db.update(inventory)
              .set({
                quantity: shopifyInventory.quantity,
                available: shopifyInventory.available,
                reserved: shopifyInventory.reserved || 0,
                lastSyncAt: new Date(),
              })
              .where(and(
                eq(inventory.variantId, product.variantId),
                eq(inventory.channel, 'internal')
              ));

            console.log(`✅ Updated ${product.productName}: ${shopifyInventory.available} available`);
            syncedFromShopify++;
          } else {
            console.log(`⚠️ Could not fetch inventory for ${product.productName} from Shopify`);
            failedFromShopify++;
          }

        } catch (error) {
          console.error(`❌ Error syncing ${product.productName}:`, error);
          failedFromShopify++;
        }
      }

      console.log(`📊 Read-only inventory sync completed: ${syncedFromShopify} synced, ${failedFromShopify} failed`);
      
      return {
        success: true,
        syncedFromShopify,
        failedFromShopify,
        total: productsWithShopify.length
      };

    } catch (error) {
      console.error('❌ Read-only inventory sync failed:', error);
      throw error;
    }
  }

  // Bidirectional inventory sync (can overwrite Shopify data - use with caution)
  async syncInventoryAcrossChannels() {
    try {
      console.log('🔄 Starting bidirectional inventory sync across channels...');
      
      // Ensure internal inventory records exist
      await this.ensureInternalInventoryExists();
      
      // Step 1: Sync from Shopify to local database
      const shopifyInventory = await db.select()
        .from(inventory)
        .where(eq(inventory.channel, 'shopify'));

      let syncedFromShopify = 0;
      let failedFromShopify = 0;

      for (const shopifyItem of shopifyInventory) {
        try {
          // Get the corresponding internal inventory record
          const internalInventory = await db.select()
            .from(inventory)
            .where(and(
              eq(inventory.variantId, shopifyItem.variantId as number),
              eq(inventory.channel, 'internal')
            ));

          if (internalInventory.length > 0) {
            const internalItem = internalInventory[0];
            
            // Update internal inventory with Shopify data
            await db.update(inventory)
              .set({
                quantity: shopifyItem.quantity,
                available: shopifyItem.available,
                reserved: shopifyItem.reserved,
                lastSyncAt: new Date(),
              })
              .where(eq(inventory.id, internalItem.id as number));

            console.log(`✅ Updated internal inventory for variant ${shopifyItem.variantId}: ${shopifyItem.quantity} available`);
            syncedFromShopify++;
          } else {
            console.log(`⚠️ No internal inventory record found for variant ${shopifyItem.variantId}`);
          }
        } catch (error) {
          console.error(`❌ Failed to sync Shopify inventory for variant ${shopifyItem.variantId}:`, error);
          failedFromShopify++;
        }
      }

      // Step 2: Sync from local database to Shopify (existing logic)
      const internalInventory = await db.select()
        .from(inventory)
        .where(eq(inventory.channel, 'internal'));

      let syncedToShopify = 0;
      let failedToShopify = 0;
      let skippedToShopify = 0;

      for (const item of internalInventory) {
        let mapping: any = null;
        
        try {
          // Get corresponding Shopify inventory
          const shopifyInventory = await db.select()
            .from(inventory)
            .where(and(
              eq(inventory.variantId, item.variantId as number),
              eq(inventory.channel, 'shopify')
            ));

          if (shopifyInventory.length > 0) {
            const shopifyItem = shopifyInventory[0];
            
            // Get Shopify variant mapping
            const [mappingResult] = await db.select()
              .from(channelMappings)
              .where(and(
                eq(channelMappings.variantId, item.variantId as number),
                eq(channelMappings.channel, 'shopify')
              ));
            
            mapping = mappingResult;

            if (mapping && mapping.channelVariantId) {
              // Validate that the Shopify variant still exists before attempting to update
              const variantExists = await this.shopifyService.validateVariant(mapping.channelVariantId as string);
              
              if (!variantExists) {
                console.log(`⚠️ Shopify variant ${mapping.channelVariantId} no longer exists, skipping sync for variant ${item.variantId}`);
                
                // Mark the mapping as invalid
                await db.update(channelMappings)
                  .set({
                    syncStatus: 'failed',
                    lastSyncAt: new Date(),
                  })
                  .where(eq(channelMappings.id, mapping.id as number));
                
                skippedToShopify++;
                continue;
              }

              // Update Shopify inventory
              await this.shopifyService.updateProductInventory(
                mapping.channelVariantId as string,
                item.available as number
              );

              // Update local Shopify inventory record
              await db.update(inventory)
                .set({
                  quantity: item.quantity,
                  available: item.available,
                  reserved: item.reserved,
                  lastSyncAt: new Date(),
                })
                .where(eq(inventory.id, shopifyItem.id as number));

              // Mark the mapping as synced
              await db.update(channelMappings)
                .set({
                  syncStatus: 'synced',
                  lastSyncAt: new Date(),
                })
                .where(eq(channelMappings.id, mapping.id as number));

              console.log(`✅ Updated Shopify inventory for variant ${item.variantId}: ${item.available} available`);
              syncedToShopify++;
            } else {
              console.log(`⚠️ No Shopify mapping found for variant ${item.variantId}, skipping sync`);
              skippedToShopify++;
            }
          }
        } catch (error) {
          console.error(`❌ Failed to sync to Shopify for variant ${item.variantId}:`, error);
          
          // Update the mapping status to failed
          if (mapping) {
            await db.update(channelMappings)
              .set({
                syncStatus: 'failed',
                lastSyncAt: new Date(),
              })
              .where(eq(channelMappings.id, mapping.id as number));
          }
          
          failedToShopify++;
        }
      }

      const result = {
        success: true,
        operation: 'bidirectional-sync',
        syncedFromShopify,
        failedFromShopify,
        syncedToShopify,
        failedToShopify,
        skippedToShopify,
        totalSynced: syncedFromShopify + syncedToShopify,
        totalFailed: failedFromShopify + failedToShopify,
        totalSkipped: skippedToShopify,
        timestamp: new Date(),
      };

      console.log(`📊 Bidirectional inventory sync completed: ${result.totalSynced} synced, ${result.totalFailed} failed`);

      // Log the sync operation
      await db.insert(syncLogs).values({
        channel: 'all',
        operation: 'bidirectional-sync',
        status: result.totalFailed === 0 ? 'success' : 'partial',
        message: `Bidirectional inventory sync completed: ${result.totalSynced} synced, ${result.totalFailed} failed`,
        details: result,
      });

      return result;
    } catch (error) {
      console.error('❌ Bidirectional inventory sync failed:', error);
      throw error;
    }
  }

  async importFromShopify(shopifyProduct: any) {
    try {
      // Validate required data before processing
      if (!shopifyProduct || !shopifyProduct.id) {
        throw new Error('Invalid Shopify product data: missing product ID');
      }

      if (!shopifyProduct.title) {
        throw new Error(`Invalid Shopify product data: missing title for product ${shopifyProduct.id}`);
      }

      console.log(`🔄 Importing Shopify product: ${shopifyProduct.title} (ID: ${shopifyProduct.id})`);
      
      // Generate a safe SKU
      let safeSku = shopifyProduct.variants?.[0]?.sku;
      if (!safeSku || safeSku.trim() === '') {
        safeSku = `SHOPIFY-${shopifyProduct.id}`;
      }
      
      // Ensure we have a valid name
      const productName = shopifyProduct.title?.trim() || `Shopify Product ${shopifyProduct.id}`;
      
      // Create main product with validated data
      const [product] = await db.insert(products).values({
        sku: safeSku,
        name: productName,
        description: shopifyProduct.body_html?.trim() || '',
        category: shopifyProduct.product_type?.trim() || 'Uncategorized',
        brand: shopifyProduct.vendor?.trim() || 'Unknown',
        basePrice: shopifyProduct.variants?.[0]?.price?.toString() || '0.00',
        status: 'active',
      }).returning();

      console.log(`✅ Created product: ${product.name} (SKU: ${product.sku})`);

      // Create variants
      const variants = [];
      for (const variant of shopifyProduct.variants || []) {
        // Validate variant data
        if (!variant.id) {
          console.warn(`⚠️ Skipping variant without ID for product ${product.id}`);
          continue;
        }

        // Generate safe variant SKU
        let variantSku = variant.sku;
        if (!variantSku || variantSku.trim() === '') {
          variantSku = `${product.sku}-${variant.id}`;
        }

        // Ensure variant name is valid
        const variantName = variant.title?.trim() || `Variant ${variant.id}`;

        // Handle images properly - Shopify provides image data in different ways
        let variantImages: string[] = [];
        
        // Check if variant has direct image
        if (variant.image_id) {
          variantImages.push(variant.image_id.toString());
        }
        // Check if variant has image URL
        else if (variant.image) {
          variantImages.push(variant.image);
        }
        // Check if product has images
        else if (shopifyProduct.images && Array.isArray(shopifyProduct.images)) {
          // Find images that match this variant
          const matchingImages = shopifyProduct.images.filter((img: any) => {
            // Some Shopify setups link images to variants via variant_ids
            if (img.variant_ids && Array.isArray(img.variant_ids)) {
              return img.variant_ids.includes(variant.id);
            }
            // If no variant-specific images, use the first product image
            return true;
          });
          
          if (matchingImages.length > 0) {
            variantImages = matchingImages.map((img: any) => img.src || img.id?.toString() || '');
          }
        }
        
        // If still no images, try to get from Shopify variant data
        if (variantImages.length === 0 && variant.image) {
          variantImages.push(variant.image);
        }
        
        // Log image processing for debugging
        console.log(`🖼️ Variant ${variant.title} images:`, variantImages);
        
        const [productVariant] = await db.insert(productVariants).values({
          productId: product.id,
          sku: variantSku,
          name: variantName,
          size: variant.option1 || 'Standard',
          color: variant.option2 || 'Default',
          price: variant.price?.toString() || '0',
          weight: variant.weight?.toString() || '0',
          images: variantImages,
        }).returning();

        variants.push(productVariant);

        // Create inventory entry for Shopify
        await db.insert(inventory).values({
          variantId: productVariant.id,
          channel: 'shopify',
          channelProductId: shopifyProduct.id.toString(),
          quantity: variant.inventory_quantity || 0,
          available: variant.inventory_quantity || 0,
          lastSyncAt: new Date(),
        });

        // Create inventory entry for internal channel
        await db.insert(inventory).values({
          variantId: productVariant.id,
          channel: 'internal',
          channelProductId: null,
          quantity: variant.inventory_quantity || 0,
          available: variant.inventory_quantity || 0,
          reserved: 0,
          lastSyncAt: new Date(),
        });

        // Create channel mapping
        await db.insert(channelMappings).values({
          productId: product.id,
          variantId: productVariant.id,
          channel: 'shopify',
          channelProductId: shopifyProduct.id.toString(),
          channelVariantId: variant.id.toString(),
          channelData: variant,
          syncStatus: 'synced',
          lastSyncAt: new Date(),
        });

        console.log(`✅ Created variant: ${variant.title}`);
      }

      // Log the import
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'import',
        productId: product.id,
        status: 'success',
        message: `Imported product ${product.name} with ${variants.length} variants from Shopify`,
        details: { shopifyProduct, variants },
      });

      return { ...product, variants };
    } catch (error) {
      console.error(`❌ Failed to import Shopify product: ${shopifyProduct.title}`, error);
      
      // Log the error
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'import',
        status: 'failed',
        message: `Failed to import product: ${(error as Error).message}`,
        details: { error: (error as Error).message, shopifyProduct },
      });
      throw error;
    }
  }

  // Import products from Shopify with bulk processing
  async importFromShopifyBulk(options: { limit?: number; syncDeletions?: boolean } = {}) {
    try {
      const limit = options.limit || 50;
      console.log(`🔄 Starting bulk import from Shopify (limit: ${limit})`);
      
      // Get products from Shopify first
      const shopifyProducts = await this.shopifyService.getProducts(limit);
      console.log(`📊 Found ${shopifyProducts.length} products in Shopify`);
      
      let importedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];
      
      for (const product of shopifyProducts) {
        try {
          await this.importFromShopify(product);
          importedCount++;
          console.log(`✅ Imported: ${product.title || product.id}`);
        } catch (error) {
          failedCount++;
          const errorMsg = `Failed to import ${product.title || product.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }
      
      console.log(`📊 Bulk import completed. Success: ${importedCount}, Failed: ${failedCount}`);
      
      return {
        success: true,
        importedCount,
        failedCount,
        totalProcessed: shopifyProducts.length,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      console.error('❌ Bulk Shopify import failed:', error);
      throw error;
    }
  }

  async getShopifyProducts() {
    try {
      // Get all products that have Shopify channel mappings
      const productsWithMappings = await db.select()
        .from(products)
        .innerJoin(channelMappings, eq(products.id, channelMappings.productId))
        .where(eq(channelMappings.channel, 'shopify'));

      // Group by product and include channel mappings
      const productMap = new Map();
      for (const row of productsWithMappings) {
        if (!productMap.has(row.products.id)) {
          productMap.set(row.products.id, {
            ...row.products,
            channelMappings: [],
            variants: []
          });
        }
        
        const product = productMap.get(row.products.id);
        product.channelMappings.push(row.channel_mappings);
      }

      // Get variants for each product
      for (const product of productMap.values()) {
        const variants = await db.select()
          .from(productVariants)
          .where(eq(productVariants.productId, product.id));
        product.variants = variants;
      }

      return Array.from(productMap.values());
    } catch (error) {
      console.error('❌ Error in getShopifyProducts:', error);
      throw new Error(`Failed to fetch Shopify products: ${(error as Error).message}`);
    }
  }

  async markProductAsDeleted(productId: number) {
    try {
      // Mark product as deleted (inactive)
      await db.update(products)
        .set({ 
          status: 'deleted',
          updatedAt: new Date()
        })
        .where(eq(products.id, productId));

      // Log the deletion
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'delete_sync',
        productId: productId,
        status: 'success',
        message: `Product marked as deleted due to Shopify sync`,
        details: { productId },
      });

      console.log(`✅ Product ${productId} marked as deleted`);
    } catch (error) {
      console.error(`❌ Failed to mark product ${productId} as deleted:`, error);
      throw error;
    }
  }

  async updateFromShopify(productId: number, shopifyProduct: any) {
    try {
      console.log(`🔄 Updating product ${productId} from Shopify data`);
      
      // Update main product
      const [updatedProduct] = await db.update(products)
        .set({
          name: shopifyProduct.title,
          description: shopifyProduct.body_html || '',
          category: shopifyProduct.product_type || 'Uncategorized',
          brand: shopifyProduct.vendor || 'Unknown',
          basePrice: shopifyProduct.variants?.[0]?.price || '0',
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning();

      // Update variants
      const variants = [];
      for (const variant of shopifyProduct.variants || []) {
        // Find existing variant by Shopify mapping
        const [mapping] = await db.select()
          .from(channelMappings)
          .where(and(
            eq(channelMappings.productId, productId),
            eq(channelMappings.channel, 'shopify'),
            eq(channelMappings.channelVariantId, variant.id.toString())
          ));

        if (mapping) {
          // Update existing variant
          const [updatedVariant] = await db.update(productVariants)
            .set({
              name: variant.title,
              price: variant.price?.toString() || '0',
              weight: variant.weight?.toString() || '0',
              updatedAt: new Date(),
            })
            .where(eq(productVariants.id, mapping.variantId as number))
            .returning();

          variants.push(updatedVariant);

          // Update inventory
          await db.update(inventory)
            .set({
              quantity: variant.inventory_quantity || 0,
              available: variant.inventory_quantity || 0,
              lastSyncAt: new Date(),
            })
            .where(eq(inventory.variantId, mapping.variantId as number));

          // Update channel mapping data
          await db.update(channelMappings)
            .set({
              channelData: variant,
              lastSyncAt: new Date(),
            })
            .where(eq(channelMappings.id, mapping.id));
        }
      }

      // Log the update
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'update',
        productId: productId,
        status: 'success',
        message: `Updated product ${updatedProduct.name} from Shopify`,
        details: { shopifyProduct, variants },
      });

      return { ...updatedProduct, variants };
    } catch (error) {
      console.error(`❌ Failed to update product ${productId}:`, error);
      throw error;
    }
  }

  async getDistinctCategories() {
    try {
      const result = await db.select({ category: products.category })
        .from(products)
        .where(eq(products.status, 'active'))
        .groupBy(products.category);
      
      return result.map(r => r.category).filter(Boolean);
    } catch (error) {
      console.error('❌ Error in getDistinctCategories:', error);
      return [];
    }
  }

  async getDistinctBrands() {
    try {
      const result = await db.select({ brand: products.brand })
        .from(products)
        .where(eq(products.status, 'active'))
        .groupBy(products.brand);
      
      return result.map(r => r.brand).filter(Boolean);
    } catch (error) {
      console.error('❌ Error in getDistinctBrands:', error);
      return [];
    }
  }

  async getDistinctStatuses() {
    try {
      const result = await db.select({ status: products.status })
        .from(products)
        .groupBy(products.status);
      
      return result.map(r => r.status).filter(Boolean);
    } catch (error) {
      console.error('❌ Error in getDistinctStatuses:', error);
      return [];
    }
  }

  async getDistinctColors() {
    try {
      const result = await db.select({ color: productVariants.color })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(eq(products.status, 'active'))
        .groupBy(productVariants.color);
      
      return result.map(r => r.color).filter(Boolean);
    } catch (error) {
      console.error('❌ Error in getDistinctColors:', error);
      return [];
    }
  }

  async getDistinctSizes() {
    try {
      const result = await db.select({ size: productVariants.size })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(eq(products.status, 'active'))
        .groupBy(productVariants.size);
      
      return result.map(r => r.size).filter(Boolean);
    } catch (error) {
      console.error('❌ Error in getDistinctSizes:', error);
      return [];
    }
  }

  async syncInventoryFromShopify() {
    try {
      console.log('🔄 Starting inventory sync from Shopify...');
      
      // Get all Shopify channel mappings
      const shopifyMappings = await db.select()
        .from(channelMappings)
        .where(eq(channelMappings.channel, 'shopify'));

      if (shopifyMappings.length === 0) {
        console.log('ℹ️ No Shopify products found to sync inventory');
        return { synced: 0, total: 0, message: 'No Shopify products found' };
      }

      let syncedCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      // Process each product in batches to avoid overwhelming Shopify API
      const batchSize = 10;
      for (let i = 0; i < shopifyMappings.length; i += batchSize) {
        const batch = shopifyMappings.slice(i, i + batchSize);
        
        console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(shopifyMappings.length / batchSize)}`);
        
        await Promise.all(batch.map(async (mapping) => {
          try {
            // Get product details from Shopify
            const shopifyProduct = await this.shopifyService.getProduct(mapping.channelProductId as string);
            
            if (!shopifyProduct || !shopifyProduct.variants) {
              console.warn(`⚠️ No variants found for Shopify product ${mapping.channelProductId}`);
              return;
            }

            // Update inventory for each variant
            for (const shopifyVariant of shopifyProduct.variants) {
              // Find the corresponding variant mapping
              const variantMapping = await db.select()
                .from(channelMappings)
                .where(and(
                  eq(channelMappings.channel, 'shopify'),
                  eq(channelMappings.channelVariantId, shopifyVariant.id.toString()),
                  eq(channelMappings.productId, mapping.productId as number)
                ));

              if (variantMapping.length > 0) {
                // Update or create inventory record
                const existingInventory = await db.select()
                  .from(inventory)
                  .where(and(
                    eq(inventory.variantId, variantMapping[0].variantId as number),
                    eq(inventory.channel, 'shopify')
                  ));

                const inventoryData = {
                  variantId: variantMapping[0].variantId as number,
                  channel: 'shopify',
                  channelProductId: mapping.channelProductId,
                  quantity: shopifyVariant.inventory_quantity || 0,
                  available: shopifyVariant.inventory_quantity || 0,
                  lastSyncAt: new Date(),
                  channelData: shopifyVariant
                };

                if (existingInventory.length > 0) {
                  // Update existing inventory
                  await db.update(inventory)
                    .set(inventoryData)
                    .where(eq(inventory.id, existingInventory[0].id));
                } else {
                  // Create new inventory record
                  await db.insert(inventory).values(inventoryData);
                }

                // Update channel mapping with latest data
                await db.update(channelMappings)
                  .set({
                    channelData: shopifyVariant,
                    lastSyncAt: new Date(),
                    syncStatus: 'synced'
                  })
                  .where(eq(channelMappings.id, variantMapping[0].id));

                syncedCount++;
              }
            }

            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));

          } catch (error) {
            errorCount++;
            const errorMsg = `Failed to sync product ${mapping.productId}: ${(error as Error).message}`;
            errors.push(errorMsg);
            console.error(`❌ ${errorMsg}`);
          }
        }));

        // Add delay between batches to avoid rate limiting
        if (i + batchSize < shopifyMappings.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Log the sync operation
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'inventory-sync',
        productId: null,
        status: errorCount === 0 ? 'success' : 'partial',
        message: `Inventory sync completed. Synced: ${syncedCount}, Errors: ${errorCount}`,
        details: { 
          syncedCount, 
          errorCount, 
          totalProducts: shopifyMappings.length,
          errors: errors.slice(0, 10) // Limit error details
        },
      });

      console.log(`✅ Inventory sync completed. Synced: ${syncedCount}, Errors: ${errorCount}`);
      
      return {
        synced: syncedCount,
        total: shopifyMappings.length,
        errors: errorCount,
        message: `Successfully synced ${syncedCount} inventory items from Shopify`,
        errorDetails: errors
      };

    } catch (error) {
      console.error('❌ Inventory sync from Shopify failed:', error);
      
      // Log the error
      await db.insert(syncLogs).values({
        channel: 'shopify',
        operation: 'inventory-sync',
        productId: null,
        status: 'failed',
        message: `Inventory sync failed: ${(error as Error).message}`,
        details: { error: (error as Error).message },
      });

      throw error;
    }
  }
}