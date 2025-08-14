import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { productRoutes } from './routes/products';
import { integrationRoutes } from './routes/integrations';
import { inventoryRoutes } from './routes/inventory';
import { webhookRoutes } from './routes/webhooks';
import { jobRoutes } from './routes/jobs';
import { errorHandler } from './middleware/errorHandler';
import { JobQueueService } from './services/jobQueue';

dotenv.config();

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize job queue service
const jobQueueService = new JobQueueService();

// Routes
app.use('/api/products', productRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/jobs', jobRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      shopify: process.env.SHOPIFY_SHOP_NAME ? 'configured' : 'not configured',
      redis: jobQueueService.isRedisAvailable() ? 'connected' : 'not available',
      backgroundJobs: jobQueueService.isRedisAvailable() ? 'enabled' : 'disabled (no Redis)'
    }
  });
});

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Graceful shutdown
process.on('SIGTERM', async () => {
  await jobQueueService.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await jobQueueService.shutdown();
  process.exit(0);
});

app.listen(PORT, () => {
  
  if (jobQueueService.isRedisAvailable()) {
    console.log(`Background jobs enabled with Redis`);
  } else {
    console.log(`Background jobs disabled (Redis not available)`);
    console.log(`Jobs will execute immediately without queuing`);
  }
});

export default app;