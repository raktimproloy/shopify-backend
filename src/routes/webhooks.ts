import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db/connection';
import { orders, orderItems, syncLogs } from '../db/schema';

const router = Router();

// Shopify webhook handler
router.post('/shopify/orders', async (req, res) => {
  try {
    // Verify webhook signature
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = JSON.stringify(req.body);
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET!)
      .update(body, 'utf8')
      .digest('base64');

    if (hash !== hmac) {
      return res.status(401).send('Unauthorized');
    }

    const order = req.body;

    // Save order to database
    const [savedOrder] = await db.insert(orders).values({
      orderNumber: order.order_number.toString(),
      channel: 'shopify',
      channelOrderId: order.id.toString(),
      customerEmail: order.email,
      totalAmount: order.total_price.toString(),
      status: order.fulfillment_status || 'pending',
      orderData: order,
    }).returning();

    // Save order items
    for (const lineItem of order.line_items) {
      await db.insert(orderItems).values({
        orderId: savedOrder.id,
        variantId: null, // Would need to map from Shopify variant ID
        quantity: lineItem.quantity,
        price: lineItem.price.toString(),
        totalPrice: (parseFloat(lineItem.price) * lineItem.quantity).toString(),
      });
    }

    // Log the webhook
    await db.insert(syncLogs).values({
      channel: 'shopify',
      operation: 'webhook',
      status: 'success',
      message: `Received order webhook for order ${order.order_number}`,
      details: { orderId: savedOrder.id, shopifyOrderId: order.id },
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Shopify webhook error:', error);
    res.status(500).send('Error processing webhook');
  }
});

export { router as webhookRoutes };