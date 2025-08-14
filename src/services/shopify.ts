import Shopify from 'shopify-api-node';

export class ShopifyService {
  private shopify: Shopify | null = null;

  constructor() {
    // Only initialize if environment variables are available
    if (process.env.SHOPIFY_SHOP_NAME && process.env.SHOPIFY_ACCESS_TOKEN) {
      this.shopify = new Shopify({
        shopName: process.env.SHOPIFY_SHOP_NAME,
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
      });
    } else {
      console.warn('Shopify environment variables not configured. Shopify service will not be available.');
    }
  }

  private checkShopifyInitialized() {
    if (!this.shopify) {
      throw new Error('Shopify service not initialized. Please check environment variables SHOPIFY_SHOP_NAME and SHOPIFY_ACCESS_TOKEN.');
    }
  }

  async createProduct(productData: any) {
    try {
      this.checkShopifyInitialized();
      const product = await this.shopify!.product.create({
        title: productData.title,
        body_html: productData.description,
        vendor: productData.vendor,
        product_type: productData.product_type,
        tags: productData.tags,
        variants: productData.variants.map((variant: any) => ({
          title: variant.title,
          price: variant.price,
          sku: variant.sku,
          inventory_quantity: variant.inventory_quantity,
          weight: variant.weight,
          weight_unit: 'lb',
        })),
        images: productData.images.map((image: any) => ({
          src: image.src,
          alt: image.alt,
        })),
      });
      
      return product;
    } catch (error) {
      throw new Error(`Shopify API error: ${error}`);
    }
  }

  async updateProduct(productData: any) {
    try {
      this.checkShopifyInitialized();
      const product = await this.shopify!.product.update(parseInt(productData.id), {
        title: productData.title,
        body_html: productData.body_html,
        vendor: productData.vendor,
        product_type: productData.product_type,
        tags: productData.tags,
        variants: productData.variants.map((variant: any) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price,
          sku: variant.sku,
          weight: variant.weight,
          weight_unit: 'lb',
        })),
      });
      
      return product;
    } catch (error) {
      throw new Error(`Shopify API error: ${error}`);
    }
  }

  async updateProductInventory(variantId: string, quantity: number) {
    try {
      this.checkShopifyInitialized();
      
      // First, get the inventory item ID for this variant
      const variant = await this.shopify!.productVariant.get(parseInt(variantId));
      if (!variant) {
        throw new Error(`Variant ${variantId} not found in Shopify`);
      }

      // Get the primary location ID
      const locationId = await this.getPrimaryLocationId();
      
      // Set the inventory level directly (not adjust)
      const inventoryLevel = await this.shopify!.inventoryLevel.set({
        inventory_item_id: variant.inventory_item_id.toString(),
        location_id: locationId,
        available: quantity,
      });
      
      console.log(`✅ Shopify inventory updated for variant ${variantId}: ${quantity} available`);
      return inventoryLevel;
    } catch (error:any) {
      console.error(`❌ Shopify inventory update failed for variant ${variantId}:`, error);
      
      // Check if it's a 404 error (variant not found)
      if (error.message && error.message.includes('404')) {
        throw new Error(`Variant ${variantId} not found in Shopify. The variant may have been deleted or the ID is invalid.`);
      }
      
      throw new Error(`Shopify inventory update error: ${error.message || error}`);
    }
  }

  // Validate if a variant exists in Shopify
  async validateVariant(variantId: string): Promise<boolean> {
    try {
      this.checkShopifyInitialized();
      await this.shopify!.productVariant.get(parseInt(variantId));
      return true;
    } catch (error) {
      return false;
    }
  }

  async getPrimaryLocationId(): Promise<string> {
    this.checkShopifyInitialized();
    const locations = await this.shopify!.location.list();
    return locations[0].id.toString();
  }

  async getProduct(productId: string) {
    try {
      this.checkShopifyInitialized();
      return await this.shopify!.product.get(parseInt(productId));
    } catch (error) {
      throw new Error(`Shopify API error: ${error}`);
    }
  }

  async deleteProduct(productId: string) {
    try {
      this.checkShopifyInitialized();
      return await this.shopify!.product.delete(parseInt(productId));
    } catch (error) {
      throw new Error(`Shopify API error: ${error}`);
    }
  }

  async getProducts(limit = 50) {
    try {
      this.checkShopifyInitialized();
      const products = await this.shopify!.product.list({ limit });
      return products;
    } catch (error) {
      throw new Error(`Shopify API error: ${error}`);
    }
  }

  // Get current inventory for a specific product variant
  async getProductInventory(productId: string, variantId: string): Promise<{
    quantity: number;
    available: number;
    reserved: number;
  } | null> {
    try {
      this.checkShopifyInitialized();
      
      if (!this.shopify) {
        console.error('❌ Shopify client not initialized');
        return null;
      }
      
      console.log(`🔄 Fetching inventory for product ${productId}, variant ${variantId} from Shopify`);
      
      // Get product details from Shopify
      const product = await this.shopify.product.get(parseInt(productId));
      
      if (!product || !product.variants) {
        console.log(`⚠️ Product ${productId} not found in Shopify`);
        return null;
      }

      // Find the specific variant
      const variant = product.variants.find(v => v.id?.toString() === variantId);
      
      if (!variant) {
        console.log(`⚠️ Variant ${variantId} not found in product ${productId}`);
        return null;
      }

      // Get inventory levels for this variant
      const inventoryLevels = await this.shopify.inventoryLevel.list({
        inventory_item_ids: variant.inventory_item_id?.toString()
      });

      if (inventoryLevels && inventoryLevels.length > 0) {
        const inventoryLevel = inventoryLevels[0];
        
        const result = {
          quantity: inventoryLevel.available || 0,
          available: inventoryLevel.available || 0,
          reserved: 0 // Shopify doesn't provide reserved inventory directly
        };

        console.log(`✅ Fetched inventory from Shopify: ${result.available} available`);
        return result;
      }

      // Fallback to variant inventory data
      if (variant.inventory_quantity !== undefined) {
        const result = {
          quantity: variant.inventory_quantity,
          available: variant.inventory_quantity,
          reserved: 0
        };

        console.log(`✅ Fetched inventory from variant data: ${result.available} available`);
        return result;
      }

      console.log(`⚠️ No inventory data found for variant ${variantId}`);
      return null;

    } catch (error) {
      console.error(`❌ Error fetching inventory from Shopify:`, error);
      return null;
    }
  }
}