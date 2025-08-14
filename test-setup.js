// Test script to verify environment setup
console.log('🧪 Testing Yupsis E-commerce Backend Setup...\n');

// Check environment variables
console.log('📋 Environment Variables Check:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ Set' : '❌ Missing');
console.log('SHOPIFY_SHOP_NAME:', process.env.SHOPIFY_SHOP_NAME ? '✅ Set' : '❌ Missing (optional)');
console.log('SHOPIFY_ACCESS_TOKEN:', process.env.SHOPIFY_ACCESS_TOKEN ? '✅ Set' : '❌ Missing (optional)');
console.log('SHOPIFY_WEBHOOK_SECRET:', process.env.SHOPIFY_WEBHOOK_SECRET ? '✅ Set' : '❌ Missing (optional)');
console.log('PORT:', process.env.PORT || '3001 (default)');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development (default)');

console.log('\n🔧 To fix missing environment variables:');
console.log('1. Create a .env file in your project root');
console.log('2. Add the required variables (see SETUP_GUIDE.md)');
console.log('3. Restart your application');

console.log('\n📚 For detailed setup instructions, see SETUP_GUIDE.md');
console.log('🚀 After setup, test with: curl http://localhost:3001/api/products');
