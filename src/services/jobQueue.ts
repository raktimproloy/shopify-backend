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
      console.log('⚠️ Redis not configured. Background jobs will be disabled.');
      console.log('💡 Set REDIS_HOST, REDIS_PORT, or REDIS_PASSWORD to enable background jobs.');
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
      
      console.log('✅ Redis connection established. Background jobs enabled.');
    } catch (error) {
      console.warn('⚠️ Redis connection failed. Background jobs will be disabled.');
      console.warn('💡 Error:', (error as Error).message);
      console.warn('💡 To enable background jobs, ensure Redis is running and accessible.');
      
      this.redisAvailable = false;
      this.inventorySyncQueue = null;
      this.productSyncQueue = null;
    }
  }

  private setupQueueHandlers() {
    // Inventory sync queue handler
    this.inventorySyncQueue!.on('completed', (job) => {
      console.log(`✅ Inventory sync job ${job.id} completed successfully`);
    });

    this.inventorySyncQueue!.on('failed', (job, error) => {
      console.error(`❌ Inventory sync job ${job.id} failed:`, error);
      // Log additional details for recurring jobs
      if (job.name === 'recurring-inventory-sync') {
        console.error(`🔄 Recurring job failed - will retry according to schedule`);
      }
    });

    // Process inventory sync jobs (read-only by default)
    this.inventorySyncQueue!.process('sync-inventory', async (job) => {
      try {
        console.log(`🔄 Processing inventory sync job ${job.id} (read-only)`);
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        console.log(`✅ Inventory sync job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        console.error(`❌ Inventory sync job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process Shopify inventory sync jobs (read-only by default)
    this.inventorySyncQueue!.process('shopify-inventory-sync', async (job) => {
      try {
        console.log(`🔄 Processing Shopify inventory sync job ${job.id} (read-only)`);
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        console.log(`✅ Shopify inventory sync job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        console.error(`❌ Shopify inventory sync job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process recurring inventory sync jobs (read-only by default)
    this.inventorySyncQueue!.process('recurring-inventory-sync', async (job) => {
      try {
        console.log(`🔄 Processing recurring inventory sync job ${job.id} (read-only)`);
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        console.log(`✅ Recurring inventory sync job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        console.error(`❌ Recurring inventory sync job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Product sync queue handler
    this.productSyncQueue!.on('completed', (job) => {
      console.log(`✅ Product sync job ${job.id} completed successfully`);
    });

    this.productSyncQueue!.on('failed', (job, error) => {
      console.error(`❌ Product sync job ${job.id} failed:`, error);
    });

    // Process product create jobs
    this.productSyncQueue!.process('product-create', async (job) => {
      const { data } = job.data;
      try {
        console.log(`🔄 Processing product create job ${job.id}`);
        const result = await this.productService.deployToShopify(data);
        console.log(`✅ Product create job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        console.error(`❌ Product create job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process product update jobs
    this.productSyncQueue!.process('product-update', async (job) => {
      const { data, productId } = job.data;
      try {
        console.log(`🔄 Processing product update job ${job.id}`);
        const result = await this.productService.updateProductInShopify(productId, data);
        console.log(`✅ Product update job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        console.error(`❌ Product update job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process product import jobs
    this.productSyncQueue!.process('product-import', async (job) => {
      const { data } = job.data;
      try {
        console.log(`🔄 Processing product import job ${job.id}`);
        const result = await this.productService.importFromShopify(data);
        console.log(`✅ Product import job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        console.error(`❌ Product import job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Process Shopify import jobs specifically
    this.productSyncQueue!.process('shopify-import', async (job) => {
      const { data } = job.data;
      try {
        console.log(`🔄 Processing Shopify import job ${job.id}`);
        console.log(`📊 Job data:`, JSON.stringify(data, null, 2));
        
        const result = await this.productService.importFromShopifyBulk(data);
        console.log(`✅ Shopify import job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        console.error(`❌ Shopify import job ${job.id} failed:`, error);
        console.error(`📋 Job data that caused failure:`, JSON.stringify(data, null, 2));
        
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
      // Fallback: execute immediately without queue
      console.log('📝 Redis not available. Executing inventory sync immediately...');
      try {
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        console.log('✅ Inventory sync completed immediately (read-only)');
        return { id: 'immediate', result, immediate: true };
      } catch (error) {
        console.error('❌ Immediate inventory sync failed:', error);
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

    console.log(`📝 Added inventory sync job ${job.id} to queue (read-only)`);
    return { id: job.id, immediate: false };
  }

  // Add Shopify inventory sync job to queue
  async addShopifyInventorySyncJob(options: {
    priority?: number;
    delay?: number;
    attempts?: number;
  } = {}) {
    if (!this.redisAvailable) {
      // Fallback: execute immediately without queue
      console.log('📝 Redis not available. Executing Shopify inventory sync immediately...');
      try {
        const result = await this.productService.syncInventoryFromShopifyReadOnly();
        console.log('✅ Shopify inventory sync completed immediately (read-only)');
        return { id: 'immediate', result, immediate: true };
      } catch (error) {
        console.error('❌ Immediate Shopify inventory sync failed:', error);
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

    console.log(`📝 Added Shopify inventory sync job ${job.id} to queue (read-only)`);
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
      // Fallback: execute immediately without queue
      console.log(`📝 Redis not available. Executing product ${operation} immediately...`);
      try {
        let result;
        if (operation === 'import') {
          result = await this.productService.importFromShopify(data);
        } else {
          result = await this.productService.updateProductInShopify(options.productId!, data);
        }
        console.log(`✅ Product ${operation} completed immediately`);
        return { id: 'immediate', result, immediate: true };
      } catch (error) {
        console.error(`❌ Immediate product ${operation} failed:`, error);
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

    console.log(`📋 Product ${operation} job added to queue with ID: ${job.id}`);
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
      // Fallback: execute immediately without queue
      console.log('📝 Redis not available. Executing Shopify import immediately...');
      try {
        const result = await this.productService.importFromShopifyBulk({
          limit: options.limit || 50,
          syncDeletions: options.syncDeletions !== false
        });
        
        console.log(`✅ Shopify import completed immediately. Imported ${result.importedCount} products.`);
        return { id: 'immediate', result, immediate: true };
      } catch (error) {
        console.error('❌ Immediate Shopify import failed:', error);
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

    console.log(`📋 Creating delayed Shopify import job with options:`, validatedOptions);

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

    console.log(`📋 Delayed Shopify import job added to queue with ID: ${job.id}, delay: ${validatedOptions.delay}ms`);
    return job;
  }

  // Schedule recurring inventory sync
  async scheduleRecurringInventorySync(cronExpression: string = '*/6 * * * *') { // Every 6 minutes
    if (!this.redisAvailable) {
      console.log('📅 Redis not available. Cannot schedule recurring jobs.');
      console.log('💡 Set up Redis to enable scheduled background jobs.');
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

    console.log(`📅 Scheduled recurring inventory sync with pattern: ${cronExpression}`);
    console.log(`🔄 Job ID: ${job.id} - Will execute every 6 minutes`);
    return job;
  }

  // Schedule recurring Shopify inventory sync
  async scheduleRecurringShopifyInventorySync(cronExpression: string = '0 */6 * * *') { // Every 6 hours
    if (!this.redisAvailable) {
      console.log('📅 Redis not available. Cannot schedule recurring jobs.');
      console.log('💡 Set up Redis to enable scheduled background jobs.');
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

    console.log(`📅 Scheduled recurring Shopify inventory sync with pattern: ${cronExpression}`);
    console.log(`🔄 Job ID: ${job.id} - Will execute every 6 hours`);
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
        console.log(`🗑️ Removed existing recurring inventory sync job: ${job.key}`);
      }

      return { 
        message: `Cleared ${inventorySyncJobs.length} existing recurring inventory sync jobs`,
        clearedCount: inventorySyncJobs.length
      };
    } catch (error) {
      console.error('❌ Error clearing recurring inventory sync jobs:', error);
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
        console.log(`🗑️ Removed existing recurring Shopify inventory sync job: ${job.key}`);
      }

      return { 
        message: `Cleared ${shopifyInventorySyncJobs.length} existing recurring Shopify inventory sync jobs`,
        clearedCount: shopifyInventorySyncJobs.length
      };
    } catch (error) {
      console.error('❌ Error clearing recurring Shopify inventory sync jobs:', error);
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
        status: 'active'
      },
      redisStatus: 'enabled'
    };
  }

  // Clean up completed/failed jobs
  async cleanupOldJobs() {
    if (!this.redisAvailable) {
      console.log('🧹 Redis not available. No jobs to clean up.');
      return;
    }

    await Promise.all([
      this.inventorySyncQueue!.clean(24 * 60 * 60 * 1000, 'completed'), // 24 hours
      this.inventorySyncQueue!.clean(24 * 60 * 60 * 1000, 'failed'), // 24 hours
      this.productSyncQueue!.clean(24 * 60 * 60 * 1000, 'completed'), // 24 hours
      this.productSyncQueue!.clean(24 * 60 * 60 * 1000, 'failed'), // 24 hours
    ]);

    console.log('🧹 Cleaned up old completed/failed jobs');
  }

  // Get recurring jobs information
  async getRecurringJobs() {
    if (!this.redisAvailable || !this.inventorySyncQueue) {
      return [];
    }

    try {
      const recurringJobs = await this.inventorySyncQueue.getRepeatableJobs();
      return recurringJobs.map(job => ({
        id: job.id,
        name: job.name,
        cron: job.cron,
        next: job.next,
        key: job.key
      }));
    } catch (error) {
      console.error('Error getting recurring jobs:', error);
      return [];
    }
  }

  // Graceful shutdown
  async shutdown() {
    console.log('🔄 Shutting down job queues...');
    
    if (this.redisAvailable && this.inventorySyncQueue && this.productSyncQueue) {
      await Promise.all([
        this.inventorySyncQueue.close(),
        this.productSyncQueue.close(),
      ]);
      console.log('✅ Job queues shut down successfully');
    } else {
      console.log('ℹ️ No job queues to shut down (Redis not available)');
    }
  }
}
