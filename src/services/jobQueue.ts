import Queue from 'bull';
import { ProductService } from './product';

export class JobQueueService {
  private inventorySyncQueue: Queue.Queue | null = null;
  private productSyncQueue: Queue.Queue | null = null;
  private productService: ProductService;
  private redisAvailable: boolean = false;

  constructor() {
    this.productService = new ProductService();
    
    // Check if Redis environment variables are set
    if (process.env.REDIS_HOST || process.env.REDIS_PORT || process.env.REDIS_PASSWORD) {
      this.initializeRedis();
    } else {
      console.log('Redis not configured. Background jobs will be disabled.');
    }
  }

  private async initializeRedis() {
    try {
      // Initialize Redis connection for Bull
      const redisConfig = {
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
        }
      };

      // Test Redis connection
      const testQueue = new Queue('test-connection', redisConfig);
      await testQueue.close();
      
      // Create actual queues
      this.inventorySyncQueue = new Queue('inventory-sync', redisConfig);
      this.productSyncQueue = new Queue('product-sync', redisConfig);
      
      this.redisAvailable = true;
      this.setupQueueHandlers();
    } catch (error) {
      console.warn('Error:', (error as Error).message);
      
      this.redisAvailable = false;
      this.inventorySyncQueue = null;
      this.productSyncQueue = null;
    }
  }

  private setupQueueHandlers() {
    // Inventory sync queue handler
    this.inventorySyncQueue!.on('completed', (job) => {
      console.log(`Inventory sync job ${job.id} completed successfully`);
    });

    this.inventorySyncQueue!.on('failed', (job, error) => {
      console.error(`Inventory sync job ${job.id} failed:`, error);
      // Log additional details for recurring jobs
      if (job.name === 'recurring-inventory-sync') {
        console.error(`Recurring job failed - will retry according to schedule`);
      }
    });

    // Process inventory sync jobs (read-only by default)
    this.inventorySyncQueue!.process('sync-inventory', async (job) => {
      try {
        console.log(`Processing inventory sync job ${job.id} (read-only)`);
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        console.log(`Inventory sync job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        console.error(`Inventory sync job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process Shopify inventory sync jobs (read-only by default)
    this.inventorySyncQueue!.process('shopify-inventory-sync', async (job) => {
      try {
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        return result;
      } catch (error) {
        console.error(`Shopify inventory sync job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process recurring inventory sync jobs (read-only by default)
    this.inventorySyncQueue!.process('recurring-inventory-sync', async (job) => {
      try {
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        return result;
      } catch (error) {
        console.error(`Recurring inventory sync job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Product sync queue handler
    this.productSyncQueue!.on('completed', (job) => {
      console.log(`Product sync job ${job.id} completed successfully`);
    });

    this.productSyncQueue!.on('failed', (job, error) => {
      console.error(`Product sync job ${job.id} failed:`, error);
    });

    // Process product create jobs
    this.productSyncQueue!.process('product-create', async (job) => {
      const { data } = job.data;
      try {
        const result = await this.productService.deployToShopify(data);
        return result;
      } catch (error) {
        console.error(`Product create job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process product update jobs
    this.productSyncQueue!.process('product-update', async (job) => {
      const { data, productId } = job.data;
      try {
        const result = await this.productService.updateProductInShopify(productId, data);
        return result;
      } catch (error) {
        console.error(`Product update job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process product import jobs
    this.productSyncQueue!.process('product-import', async (job) => {
      const { data } = job.data;
      try {
        const result = await this.productService.importFromShopify(data);
        return result;
      } catch (error) {
        console.error(`Product import job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process Shopify import jobs specifically
    this.productSyncQueue!.process('shopify-import', async (job) => {
      const { data } = job.data;
      try {
        const result = await this.productService.importFromShopifyBulk(data);
        return result;
      } catch (error) {
        console.error(`Shopify import job ${job.id} failed:`, error);
        console.error(`Job data that caused failure:`, JSON.stringify(data, null, 2));
        
        // Log additional error details for debugging
        if (error instanceof Error) {
          console.error(`🔍 Error details:`, {
            name: error.name,
            message: error.message,
            stack: error.stack
          });
        }
        
        throw error;
      }
    });

    // Process recurring product sync jobs
    this.productSyncQueue!.process('recurring-product-sync', async (job) => {
      try {
        const result = await this.productService.importFromShopifyBulk({
          limit: 50,
          syncDeletions: true
        });
        return result;
      } catch (error) {
        console.error(`Recurring product sync job ${job.id} failed:`, error);
        throw error;
      }
    });
  }

  // Check if Redis is available
  isRedisAvailable(): boolean {
    return this.redisAvailable;
  }

  // Add inventory sync job to queue
  async addInventorySyncJob(options: {
    priority?: number;
    delay?: number;
    attempts?: number;
  } = {}) {
    if (!this.redisAvailable) {
      try {
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        return { id: 'immediate', result, immediate: true };
      } catch (error) {
        console.error('Immediate inventory sync failed:', error);
        throw error;
      }
    }

    const job = await this.inventorySyncQueue!.add(
      'sync-inventory',
      {},
      {
        priority: options.priority || 0,
        delay: options.delay || 0,
        attempts: options.attempts || 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );
    return { id: job.id, immediate: false };
  }

  // Add Shopify inventory sync job to queue
  async addShopifyInventorySyncJob(options: {
    priority?: number;
    delay?: number;
    attempts?: number;
  } = {}) {
    if (!this.redisAvailable) {
      try {
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        return { id: 'immediate', result, immediate: true };
      } catch (error) {
        console.error('Immediate Shopify inventory sync failed:', error);
        throw error;
      }
    }

    const job = await this.inventorySyncQueue!.add(
      'shopify-inventory-sync',
      {},
      {
        priority: options.priority || 0,
        delay: options.delay || 0,
        attempts: options.attempts || 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );
    return { id: job.id, immediate: false };
  }

  // Add product sync job to queue
  async addProductSyncJob(
    operation: 'create' | 'update' | 'delete' | 'import',
    data: any,
    options: {
      priority?: number;
      delay?: number;
      attempts?: number;
      productId?: number;
    } = {}
  ) {
    if (!this.redisAvailable) {
      try {
        let result;
        if (operation === 'import') {
          result = await this.productService.importFromShopify(data);
        } else {
          result = await this.productService.updateProductInShopify(options.productId!, data);
        }
        return { id: 'immediate', result, immediate: true };
      } catch (error) {
        console.error(`Immediate product ${operation} failed:`, error);
        throw error;
      }
    }

    const job = await this.productSyncQueue!.add(
      `product-${operation}`,
      { operation, data, productId: options.productId },
      {
        priority: options.priority || 1,
        delay: options.delay || 0,
        attempts: options.attempts || 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
    return job;
  }

  // Add delayed Shopify product import job
  async addDelayedShopifyImportJob(options: {
    limit?: number;
    syncDeletions?: boolean;
    delay?: number;
    priority?: number;
  } = {}) {
    if (!this.redisAvailable) {
      try {
        const result = await this.productService.importFromShopifyBulk({
          limit: options.limit || 50,
          syncDeletions: options.syncDeletions !== false
        });
        return { id: 'immediate', result, immediate: true };
      } catch (error) {
        console.error('Immediate Shopify import failed:', error);
        throw error;
      }
    }

    // Validate options
    const validatedOptions = {
      limit: Math.max(1, Math.min(options.limit || 50, 1000)), // Ensure limit is between 1 and 1000
      syncDeletions: options.syncDeletions !== false,
      delay: Math.max(0, options.delay || 360000), // Ensure delay is non-negative
      priority: Math.max(1, Math.min(options.priority || 1, 10)) // Ensure priority is between 1 and 10
    };
    const job = await this.productSyncQueue!.add(
      'shopify-import',
      { 
        operation: 'import',
        data: {
          limit: validatedOptions.limit,
          syncDeletions: validatedOptions.syncDeletions
        }
      },
      {
        priority: validatedOptions.priority,
        delay: validatedOptions.delay,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
    return job;
  }

  // Schedule recurring inventory sync
  async scheduleRecurringInventorySync(cronExpression: string = '*/6 * * * *') { // Every 6 minutes
    if (!this.redisAvailable) {
      return { id: 'no-redis', message: 'Redis not available for scheduling' };
    }

    // Clear any existing recurring inventory sync jobs first
    await this.clearRecurringInventorySync();

    const job = await this.inventorySyncQueue!.add(
      'recurring-inventory-sync',
      {},
      {
        repeat: {
          cron: cronExpression,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3, // Allow retries for recurring jobs
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
    return job;
  }

  // Schedule recurring Shopify inventory sync
  async scheduleRecurringShopifyInventorySync(cronExpression: string = '0 */6 * * *') { // Every 6 hours
    if (!this.redisAvailable) {
      return { id: 'no-redis', message: 'Redis not available for scheduling' };
    }

    // Clear any existing recurring Shopify inventory sync jobs first
    await this.clearRecurringShopifyInventorySync();

    const job = await this.inventorySyncQueue!.add(
      'shopify-inventory-sync',
      {},
      {
        repeat: {
          cron: cronExpression,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3, // Allow retries for recurring jobs
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
    return job;
  }

  // Schedule recurring product sync from Shopify
  async scheduleRecurringProductSync(cronExpression: string = '*/6 * * * *') { // Every 6 minutes
    if (!this.redisAvailable) {
      return { id: 'no-redis', message: 'Redis not available for scheduling' };
    }

    // Clear any existing recurring product sync jobs first
    await this.clearRecurringProductSync();

    const job = await this.productSyncQueue!.add(
      'recurring-product-sync',
      {},
      {
        repeat: {
          cron: cronExpression,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3, // Allow retries for recurring jobs
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
    return job;
  }

  // Clear existing recurring inventory sync jobs
  async clearRecurringInventorySync() {
    if (!this.redisAvailable) {
      return { message: 'Redis not available' };
    }

    try {
      const repeatableJobs = await this.inventorySyncQueue!.getRepeatableJobs();
      const inventorySyncJobs = repeatableJobs.filter(job => 
        job.name === 'recurring-inventory-sync'
      );

      for (const job of inventorySyncJobs) {
        await this.inventorySyncQueue!.removeRepeatableByKey(job.key);
      }

      return { 
        message: `Cleared ${inventorySyncJobs.length} existing recurring inventory sync jobs`,
        clearedCount: inventorySyncJobs.length
      };
    } catch (error) {
      console.error('Error clearing recurring inventory sync jobs:', error);
      throw error;
    }
  }

  // Clear existing recurring Shopify inventory sync jobs
  async clearRecurringShopifyInventorySync() {
    if (!this.redisAvailable) {
      return { message: 'Redis not available' };
    }

    try {
      const repeatableJobs = await this.inventorySyncQueue!.getRepeatableJobs();
      const shopifyInventorySyncJobs = repeatableJobs.filter(job => 
        job.name === 'shopify-inventory-sync'
      );

      for (const job of shopifyInventorySyncJobs) {
        await this.inventorySyncQueue!.removeRepeatableByKey(job.key);
      }

      return { 
        message: `Cleared ${shopifyInventorySyncJobs.length} existing recurring Shopify inventory sync jobs`,
        clearedCount: shopifyInventorySyncJobs.length
      };
    } catch (error) {
      console.error('Error clearing recurring Shopify inventory sync jobs:', error);
      throw error;
    }
  }

  // Clear existing recurring product sync jobs
  async clearRecurringProductSync() {
    if (!this.redisAvailable) {
      return { message: 'Redis not available' };
    }

    try {
      const repeatableJobs = await this.productSyncQueue!.getRepeatableJobs();
      const productSyncJobs = repeatableJobs.filter(job => 
        job.name === 'recurring-product-sync'
      );

      for (const job of productSyncJobs) {
        await this.productSyncQueue!.removeRepeatableByKey(job.key);
      }

      return { 
        message: `Cleared ${productSyncJobs.length} existing recurring product sync jobs`,
        clearedCount: productSyncJobs.length
      };
    } catch (error) {
      console.error('Error clearing recurring product sync jobs:', error);
      throw error;
    }
  }

  // Get queue statistics
  async getQueueStats() {
    if (!this.redisAvailable) {
      return {
        inventory: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          status: 'Redis not available'
        },
        product: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          status: 'Redis not available'
        },
        redisStatus: 'disabled'
      };
    }

    const [inventoryStats, productStats] = await Promise.all([
      this.inventorySyncQueue!.getJobCounts(),
      this.productSyncQueue!.getJobCounts(),
    ]);

    // Get recurring job information
    const recurringJobs = await this.inventorySyncQueue!.getRepeatableJobs();
    const recurringJobInfo = recurringJobs.length > 0 ? {
      count: recurringJobs.length,
      nextRun: recurringJobs[0]?.next,
      cron: recurringJobs[0]?.cron
    } : null;

    // Get recurring product sync job information
    const recurringProductJobs = await this.productSyncQueue!.getRepeatableJobs();
    const recurringProductJobInfo = recurringProductJobs.length > 0 ? {
      count: recurringProductJobs.length,
      nextRun: recurringProductJobs[0]?.next,
      cron: recurringProductJobs[0]?.cron
    } : null;

    return {
      inventory: {
        waiting: inventoryStats.waiting,
        active: inventoryStats.active,
        completed: inventoryStats.completed,
        failed: inventoryStats.failed,
        delayed: inventoryStats.delayed,
        status: 'active',
        recurringJobs: recurringJobInfo
      },
      product: {
        waiting: productStats.waiting,
        active: productStats.active,
        completed: productStats.completed,
        failed: productStats.failed,
        delayed: productStats.delayed,
        status: 'active',
        recurringJobs: recurringProductJobInfo
      },
      redisStatus: 'enabled'
    };
  }

  // Clean up completed/failed jobs
  async cleanupOldJobs() {
    if (!this.redisAvailable) {
      return;
    }

    await Promise.all([
      this.inventorySyncQueue!.clean(24 * 60 * 60 * 1000, 'completed'), // 24 hours
      this.inventorySyncQueue!.clean(24 * 60 * 60 * 1000, 'failed'), // 24 hours
      this.productSyncQueue!.clean(24 * 60 * 60 * 1000, 'completed'), // 24 hours
      this.productSyncQueue!.clean(24 * 60 * 60 * 1000, 'failed'), // 24 hours
    ]);
  }

  // Get recurring jobs information
  async getRecurringJobs() {
    if (!this.redisAvailable || !this.inventorySyncQueue || !this.productSyncQueue) {
      return [];
    }

    try {
      const [inventoryRecurringJobs, productRecurringJobs] = await Promise.all([
        this.inventorySyncQueue.getRepeatableJobs(),
        this.productSyncQueue.getRepeatableJobs(),
      ]);
      
      const allJobs = [
        ...inventoryRecurringJobs.map(job => ({
          id: job.id,
          name: job.name,
          cron: job.cron,
          next: job.next,
          key: job.key,
          queue: 'inventory'
        })),
        ...productRecurringJobs.map(job => ({
          id: job.id,
          name: job.name,
          cron: job.cron,
          next: job.next,
          key: job.key,
          queue: 'product'
        }))
      ];
      
      return allJobs;
    } catch (error) {
      console.error('Error getting recurring jobs:', error);
      return [];
    }
  }

  // Clean up missing Shopify products
  async cleanupMissingShopifyProducts() {
    try {
      const result = await this.productService.cleanupMissingShopifyProducts();
      return result;
    } catch (error) {
      console.error('Cleanup failed via JobQueueService:', error);
      throw error;
    }
  }

  // Graceful shutdown
  async shutdown() {
    
    if (this.redisAvailable && this.inventorySyncQueue && this.productSyncQueue) {
      await Promise.all([
        this.inventorySyncQueue.close(),
        this.productSyncQueue.close(),
      ]);
    } else {
      console.log('No job queues to shut down (Redis not available)');
    }
  }
}
