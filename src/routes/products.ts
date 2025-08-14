import { Router } from 'express';
import { ProductService } from '../services/product';

const router = Router();
const productService = new ProductService();

// Get all products with pagination, filtering, and search
router.get('/', async (req, res) => {
  try {
    const { 
      limit = 100, 
      offset = 0, 
      includeDeleted = false,
      search,
      category,
      brand,
      status,
      minPrice,
      maxPrice,
      color,
      size
    } = req.query;
    
    const result = await productService.getAllProducts(
      parseInt(limit as string),
      parseInt(offset as string),
      includeDeleted === 'true',
      {
        search: search as string,
        category: category as string,
        brand: brand as string,
        status: status as string,
        minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
        color: color as string,
        size: size as string
      }
    );
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get product by ID
router.get('/:id', async (req, res) => {
  try {
    const product = await productService.getById(parseInt(req.params.id));
    res.json({ success: true, product });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});


export { router as productRoutes };