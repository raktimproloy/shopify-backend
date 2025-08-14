import { Router } from 'express';
import { JobQueueService } from '../services/jobQueue';

const router = Router();
const jobQueueService = new JobQueueService();

// Get queue statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await jobQueueService.getQueueStats();
    res.json({
      success: true,
      stats,
      redisAvailable: jobQueueService.isRedisAvailable(),
      message: jobQueueService.isRedisAvailable() 
        ? 'Background jobs are enabled with Redis' 
        : 'Background jobs are disabled (Redis not available). Jobs execute immediately.'
    });
  } catch (error) {
    console.error('Error getting queue stats:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to get queue statistics',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Get Redis status
router.get('/status', (req, res) => {
  const redisAvailable = jobQueueService.isRedisAvailable();
  res.json({
    success: true,
    redis: {
      available: redisAvailable,
      status: redisAvailable ? 'connected' : 'not available',
      message: redisAvailable 
        ? 'Background jobs are enabled with Redis' 
        : 'Background jobs are disabled. Jobs will execute immediately without queuing.'
    },
    recommendations: redisAvailable ? [] : [
      'Install Redis to enable background job queuing',
      'Set REDIS_HOST, REDIS_PORT environment variables',
      'Use Docker: docker run -d --name redis -p 6379:6379 redis:alpine'
    ]
  });
});

// Add inventory sync job
router.post('/inventory-sync', async (req, res) => {
  try {
    const { priority, delay, attempts } = req.body;
    
    const job = await jobQueueService.addInventorySyncJob({
      priority,
      delay,
      attempts
    });
    const isImmediate = 'immediate' in job && job.immediate;
    
    res.json({
      success: true,
      message: isImmediate 
        ? 'Inventory sync executed immediately (Redis not available)'
        : 'Inventory sync job added to queue',
      jobId: job.id,
      immediate: isImmediate,
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  } catch (error) {
    console.error('Error adding inventory sync job:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to add inventory sync job',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Add Shopify inventory sync job
router.post('/shopify-inventory-sync', async (req, res) => {
  try {
    const { priority, delay, attempts } = req.body;
    
    const job = await jobQueueService.addShopifyInventorySyncJob({
      priority,
      delay,
      attempts
    });
    const isImmediate = 'immediate' in job && job.immediate;
    
    res.json({
      success: true,
      message: isImmediate 
        ? 'Shopify inventory sync executed immediately (Redis not available)'
        : 'Shopify inventory sync job added to queue',
      jobId: job.id,
      immediate: isImmediate,
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  } catch (error) {
    console.error('Error adding Shopify inventory sync job:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to add Shopify inventory sync job',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Add product sync job
router.post('/product-sync', async (req, res) => {
  try {
    const { operation, data, priority, delay, attempts, productId } = req.body;
    
    if (!operation || !data) {
      return res.status(400).json({ 
        error: 'Operation and data are required' 
      });
    }

    const job = await jobQueueService.addProductSyncJob(operation, data, {
      priority,
      delay,
      attempts,
      productId
    });
    const isImmediate = 'immediate' in job && job.immediate;
    
    res.json({
      success: true,
      message: isImmediate 
        ? `Product ${operation} executed immediately (Redis not available)`
        : `Product ${operation} job added to queue`,
      jobId: job.id,
      immediate: isImmediate,
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  } catch (error) {
    console.error('Error adding product sync job:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to add product sync job',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Schedule recurring inventory sync
router.post('/schedule-inventory-sync', async (req, res) => {
  try {
    const { cronExpression } = req.body;
    
    if (!jobQueueService.isRedisAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'Redis not available',
        message: 'Cannot schedule recurring jobs without Redis. Jobs will execute immediately when requested.',
        redisAvailable: false,
        recommendations: [
          'Install Redis to enable scheduled background jobs',
          'Set REDIS_HOST, REDIS_PORT environment variables',
          'Use Docker: docker run -d --name redis -p 6379:6379 redis:alpine'
        ]
      });
    }
    
    const job = await jobQueueService.scheduleRecurringInventorySync(cronExpression);
    
    res.json({
      success: true,
      message: 'Recurring inventory sync scheduled',
      jobId: job.id,
      cronExpression: cronExpression || '0 */6 * * *',
      redisAvailable: true
    });
  } catch (error) {
    console.error('Error scheduling recurring inventory sync:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to schedule recurring inventory sync',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Schedule recurring Shopify inventory sync
router.post('/schedule-shopify-inventory-sync', async (req, res) => {
  try {
    const { cronExpression } = req.body;
    
    if (!jobQueueService.isRedisAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'Redis not available',
        message: 'Cannot schedule recurring jobs without Redis. Jobs will execute immediately when requested.',
        redisAvailable: false,
        recommendations: [
          'Install Redis to enable scheduled background jobs',
          'Set REDIS_HOST, REDIS_PORT environment variables',
          'Use Docker: docker run -d --name redis -p 6379:6379 redis:alpine'
        ]
      });
    }
    
    const job = await jobQueueService.scheduleRecurringShopifyInventorySync(cronExpression);
    
    res.json({
      success: true,
      message: 'Recurring Shopify inventory sync scheduled',
      jobId: job.id,
      cronExpression: cronExpression || '0 */6 * * *',
      redisAvailable: true
    });
  } catch (error) {
    console.error('Error scheduling recurring Shopify inventory sync:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to schedule recurring Shopify inventory sync',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Schedule recurring product sync from Shopify
router.post('/schedule-product-sync', async (req, res) => {
  try {
    const { cronExpression } = req.body;
    
    if (!jobQueueService.isRedisAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'Redis not available',
        message: 'Cannot schedule recurring jobs without Redis. Jobs will execute immediately when requested.',
        redisAvailable: false,
        recommendations: [
          'Install Redis to enable scheduled background jobs',
          'Set REDIS_HOST, REDIS_PORT environment variables',
          'Use Docker: docker run -d --name redis -p 6379:6379 redis:alpine'
        ]
      });
    }
    
    const job = await jobQueueService.scheduleRecurringProductSync(cronExpression);
    
    res.json({
      success: true,
      message: 'Recurring product sync scheduled',
      jobId: job.id,
      cronExpression: cronExpression || '*/6 * * * *',
      redisAvailable: true
    });
  } catch (error) {
    console.error('Error scheduling recurring product sync:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to schedule recurring product sync',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Get recurring jobs information
router.get('/recurring', async (req, res) => {
  try {
    if (!jobQueueService.isRedisAvailable()) {
      return res.json({
        success: false,
        error: 'Redis not available',
        message: 'Cannot get recurring jobs without Redis',
        redisAvailable: false
      });
    }
    
    const recurringJobs = await jobQueueService.getRecurringJobs();
    
    res.json({
      success: true,
      recurringJobs,
      count: recurringJobs.length,
      redisAvailable: true
    });
  } catch (error) {
    console.error('Error getting recurring jobs:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to get recurring jobs',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Clear existing recurring inventory sync jobs
router.delete('/recurring-inventory-sync', async (req, res) => {
  try {
    const result = await jobQueueService.clearRecurringInventorySync();
    res.json({
      success: true,
      message: 'Recurring inventory sync jobs cleared',
      details: result
    });
  } catch (error) {
    console.error('Error clearing recurring inventory sync jobs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear recurring inventory sync jobs',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear existing recurring Shopify inventory sync jobs
router.delete('/recurring-shopify-inventory-sync', async (req, res) => {
  try {
    const result = await jobQueueService.clearRecurringShopifyInventorySync();
    res.json({
      success: true,
      message: 'Recurring Shopify inventory sync jobs cleared',
      details: result
    });
  } catch (error) {
    console.error('Error clearing recurring Shopify inventory sync jobs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear recurring Shopify inventory sync jobs',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear existing recurring product sync jobs
router.delete('/recurring-product-sync', async (req, res) => {
  try {
    const result = await jobQueueService.clearRecurringProductSync();
    res.json({
      success: true,
      message: 'Recurring product sync jobs cleared',
      details: result
    });
  } catch (error) {
    console.error('Error clearing recurring product sync jobs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear recurring product sync jobs',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clean up old jobs
router.post('/cleanup', async (req, res) => {
  try {
    if (!jobQueueService.isRedisAvailable()) {
      return res.json({
        success: true,
        message: 'No jobs to clean up (Redis not available)',
        redisAvailable: false
      });
    }
    
    await jobQueueService.cleanupOldJobs();
    
    res.json({
      success: true,
      message: 'Old jobs cleaned up successfully',
      redisAvailable: true
    });
  } catch (error) {
    console.error('Error cleaning up old jobs:', error);
    res.status(500).json({ 
      error: (error as Error).message,
      message: 'Failed to clean up old jobs',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Add delayed Shopify product import job
router.post('/delayed-shopify-import', async (req, res) => {
  try {
    const { 
      limit = 50, 
      syncDeletions = true, 
      delay = 360000, // Default 6 minutes (360000ms)
      priority = 1 
    } = req.body;

    if (!jobQueueService.isRedisAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'Redis not available',
        message: 'Cannot schedule delayed jobs without Redis. Jobs will execute immediately.',
        redisAvailable: false,
        recommendations: [
          'Install Redis to enable delayed job execution',
          'Set REDIS_HOST, REDIS_PORT environment variables',
          'Use Docker: docker run -d --name redis -p 6379:6379 redis:alpine'
        ]
      });
    }

    const job = await jobQueueService.addDelayedShopifyImportJob({
      limit,
      syncDeletions,
      delay,
      priority
    });

    res.json({
      success: true,
      message: `Shopify product import scheduled for ${delay/1000} seconds from now`,
      jobId: job.id,
      delay: delay,
      delayInSeconds: delay/1000,
      scheduledFor: new Date(Date.now() + delay).toISOString(),
      redisAvailable: true
    });
  } catch (error) {
    console.error('Error scheduling delayed Shopify import:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to schedule delayed Shopify import',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

// Clean up missing Shopify products (manual trigger)
router.post('/cleanup-missing-shopify', async (req, res) => {
  try {
    console.log('🧹 Manual cleanup of missing Shopify products requested');
    
    const result = await jobQueueService.cleanupMissingShopifyProducts();
    
    res.json({
      success: true,
      message: 'Cleanup of missing Shopify products completed',
      result,
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  } catch (error) {
    console.error('Error cleaning up missing Shopify products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean up missing Shopify products',
      error: error instanceof Error ? error.message : 'Unknown error',
      redisAvailable: jobQueueService.isRedisAvailable()
    });
  }
});

export { router as jobRoutes };
