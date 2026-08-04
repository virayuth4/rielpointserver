
const zingoPool = require("./pgZingo")


async function initializeDatabases() {

    const zingoClient = await zingoPool.connect();
    
    try {
        // Initialize users database
        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                "email" VARCHAR(255) UNIQUE NOT NULL,
                "role" VARCHAR(50) NOT NULL,
                "firstName" VARCHAR(100),
                "lastName" VARCHAR (100),
                "userProfilePath" TEXT DEFAULT NULL,
                "address" TEXT,
                "city" TEXT,
                "phoneNumber" VARCHAR(100),
                "verified" BOOLEAN NOT NULL DEFAULT FALSE, 
                "isCompleted" BOOLEAN DEFAULT FALSE,
                "totalRating" INTEGER DEFAULT 0,
                "ratingCount" INTEGER DEFAULT 0, 
                "points" DECIMAL(10,2),
                "itemsSold" INTEGER DEFAULT 0,              
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // console.log('Users database initialized successfully');

        await zingoClient.query (`
            CREATE TABLE IF NOT EXISTS refund_requests (
            id SERIAL PRIMARY KEY,              -- Unique identifier for the refund request
            "orderId" BIGINT NOT NULL,              -- Reference to the order
            "userId" INT NOT NULL,               -- Reference to the user requesting the refund
            "refundReason" TEXT NOT NULL,               -- Reason for the refund
            "imagePaths" TEXT,                     -- URL to the attached image (optional)
            status VARCHAR(50) DEFAULT 'pending', -- Status of the refund (pending, approved, rejected, etc.)
            "createdAt" TIMESTAMP DEFAULT NOW(), -- Timestamp for when the request was created
            "updatedAt" TIMESTAMP DEFAULT NOW(), -- Timestamp for when the request was last updated
            CONSTRAINT fk_order FOREIGN KEY ("orderId") REFERENCES orders("orderId") ON DELETE CASCADE,
            CONSTRAINT fk_user FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
        );
        `
        );
            
        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS user_comments (
                id SERIAL PRIMARY KEY,
                "commenterUserId" INT REFERENCES users(id) ON DELETE CASCADE, -- The user who posted the comment
                "commentedUserId" INT REFERENCES users(id) ON DELETE CASCADE, -- The user being commented on
                "commentText" TEXT NOT NULL,
                "createdAt" TIMESTAMP DEFAULT NOW()
            );
            `);
            // console.log('user_comments table initialized successfully');

        // Initialize product table
        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                "productName" VARCHAR(255) NOT NULL,
                "productCategory" VARCHAR(255) NOT NULL,
                "phoneNumber" VARCHAR(100),
                "sellerAddress" TEXT NOT NULL,
                "sellerCity" VARCHAR (150) NOT NULL,
                "productPrice" DECIMAL(10, 2) NOT NULL,
                "purchasedQuantity" INTEGER NOT NULL DEFAULT 1,
                "productBrand" VARCHAR(100) DEFAULT NULL,
                "productCondition" TEXT,
                "productDescription" TEXT NOT NULL,
                "productImagePaths" JSONB NOT NULL,
                "cardProvider" VARCHAR(100) NOT NULL DEFAULT 'aba',
                "bankAccountNumber" TEXT NOT NULL DEFAULT '000 000 000',
                "bankAccountName" VARCHAR(255) NOT NULL DEFAULT 'bank_account_name',
                "saleState" BOOLEAN NOT NULL,
                "reviewState" BOOLEAN NOT NULL,
                "verifyState" BOOLEAN NOT NULL,
                "featureState" BOOLEAN,
                "slug" TEXT NOT NULL,
                "postedBy" INTEGER NOT NULL,
                "isDeleted" BOOLEAN DEFAULT FALSE,
                "deletedAt" TIMESTAMP NULL,
                "restoredAt" TIMESTAMP NULL,
                "isSold" BOOLEAN DEFAULT FALSE,
                "soldAt" TIMESTAMP NULL,
                "productTags" TEXT[], 
                "offeredPrice" DECIMAL (10,2),
                "onSale" BOOLEAN DEFAULT FALSE,
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP DEFAULT NULL
            );
        `);
        // console.log('products table initialized successfully');

        // Initialize offers table
        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS offers(
            id SERIAL PRIMARY KEY,
            "productId" INTEGER REFERENCES products(id),
            "userId" INTEGER REFERENCES users(id),
            "offerAmount" DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            "expiresAt" TIMESTAMP,
            "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "validStatus" CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'))
            )
            `)
            // console.log('offres table initialized successfully');

        //Initialize cart table to track shopping carts for each user
        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS carts(
            id SERIAL PRIMARY KEY,
            "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE,
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE("userId")
            )
            `)
        // console.log('Cart Table initialized successfully');

        //Initialize cart_items to store individual items in each cart
        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS cart_items (
            id SERIAL PRIMARY KEY,
            "cartId" INTEGER REFERENCES carts(id) ON DELETE CASCADE,
            "productId" INTEGER REFERENCES products(id) ON DELETE CASCADE,
            "purchasedQuantity" INTEGER NOT NULL CHECK (quantity > 0),
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE("cartId", "productId")
            )
            `)
        // console.log('Cart items table initialized successfully');
        
         // Create the update_updated_at_timestamp() function
        await zingoClient.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_timestamp()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW."updatedAt" = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        // console.log('update_updated_at_timestamp function created successfully');

        // A function that will update the timestamp
        await zingoClient.query(`
            DROP TRIGGER IF EXISTS update_cart_items_timestamp ON cart_items;
            CREATE TRIGGER update_cart_items_timestamp
                BEFORE UPDATE ON cart_items
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_timestamp();
        `);
        // console.log('Cart items trigger created successfully');


        // Create Order Table. orderStatus should be "ordered", "outForDelivery", "delivered", 
        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                "orderId" BIGINT UNIQUE NOT NULL,
                "userId" INTEGER NOT NULL,
                "orderStatus" VARCHAR(50) NOT NULL, 
                "totalAmount" DECIMAL (10,2) NOT NULL,
                "paymentMethod" VARCHAR (100) NOT NULL,
                "buyerPhoneNumber" VARCHAR(100) NOT NULL,
                "buyerAddress" TEXT NOT NULL,
                "buyerCity" VARCHAR(100) NOT NULL,
                "buyerFirstName" VARCHAR(100) NOT NULL,
                "buyerLastName" VARCHAR(100) NOT NULL,
                "assignedDriver" INT,
                "assignedTime" TIMESTAMP,
                "outForDeliveryTime" TIMESTAMP ,
                "deliveredTime" TIMESTAMP ,
                "paymentComplete" BOOLEAN NOT NULL DEFAULT FALSE,
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            `)
        // console.log('orders table created successfully');

        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS order_items(
             id SERIAL PRIMARY KEY,
                "orderId" BIGINT REFERENCES orders("orderId"),
                "productId" INTEGER NOT NULL REFERENCES products(id),
                "purchasedQuantity" INTEGER DEFAULT 1,
                "productPrice" DECIMAL (10,2) NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
                )
            `)
        // console.log('order_items table created successfully');

        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS drivers (
                id SERIAL PRIMARY KEY,
                "firstName" VARCHAR(100) NOT NULL,
                "lastName" VARCHAR(100) NOT NULL,
                "phoneNumber" VARCHAR(20),
                "email" VARCHAR(255),
                "address" TEXT,
                "status" VARCHAR(50) DEFAULT 'active', -- active, inactive, suspended
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            `)
        console.log('drivers table created successfully');

        await zingoClient.query(`
            CREATE TABLE IF NOT EXISTS search_history (
            id SERIAL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            query VARCHAR(255) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            `)

        

  
        // Prevent deletion of products that have orders
        // Prevent deletion of products that have orders
        const constraintExists = await zingoClient.query(`
            SELECT 1
            FROM information_schema.table_constraints
            WHERE constraint_name = 'fkProduct'
            AND table_name = 'order_items';
        `);

        if (constraintExists.rowCount === 0) {
            await zingoClient.query(`
                ALTER TABLE order_items
                ADD CONSTRAINT "fkProduct"
                FOREIGN KEY ("productId")
                REFERENCES products(id)
                ON DELETE RESTRICT;
            `);
        }

        try {
            //Create Indexes for easier DATABASE QUERY
            await zingoClient.query(`
                --Indexes for orders and order_items tables
                CREATE INDEX IF NOT EXISTS "idx_orders_user_id" ON orders("userId");
                CREATE INDEX IF NOT EXISTS "idx_order_items_order_id" ON order_items("orderId");
                CREATE INDEX IF NOT EXISTS "idx_order_items_product_id" ON order_items("productId");

                --Indexes for frequently queried columns in products
                CREATE INDEX IF NOT EXISTS "idx_products_category" ON products("productCategory");
                CREATE INDEX IF NOT EXISTS "idx_product_posted_by" ON products("postedBy");
                CREATE INDEX IF NOT EXISTS "idx_orders_sale_state" ON products("saleState");
             

                -- Indexes for cart tables
                CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items("cartId");
                CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items("productId");

                -- Indexes for offers table
                CREATE INDEX IF NOT EXISTS idx_offers_product_id ON offers("productId");
                CREATE INDEX IF NOT EXISTS idx_offers_user_id ON offers("userId");
                CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);

    -- Index for search history
                CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history("userId", "createdAt" DESC);

         
                `)

        } catch (error) {
            console.error(`Error with initializing INDEXES FOR EASIER DATA QUERIES: ${error}`)
        }

     
    } catch (err) {
        console.error('Error initializing databases:', err);
    } finally {
        zingoClient.release();
    }
}


// -- User Preferences Table
// CREATE TABLE user_preferences (
//     "id" SERIAL PRIMARY KEY,
//     "userId" BIGINT NOT NULL,
//     "primaryCategory" VARCHAR(100),
//     "secondaryCategory" VARCHAR(100),
//     "priceRangePreference" VARCHAR(20), -- budget, low, medium, high, premium
//     "minPriceObserved" DECIMAL(10,2),
//     "maxPriceObserved" DECIMAL(10,2),
//     "avgPricePreference" DECIMAL(10,2),
//     "stylePreferences" JSONB, -- Array of style preferences
//     "demographics" JSONB, -- Gender, age group, etc.
//     "categoryScores" JSONB, -- Scores for different categories
//     "priceRangeScores" JSONB, -- Scores for different price ranges
//     "styleScores" JSONB, -- Scores for different styles
//     "tagFrequency" JSONB, -- Frequency count of tags
//     "interactionCount" INTEGER DEFAULT 1,
//     "lastInteractionDate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//     "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//     "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// );

// -- Indexes for better performance
// CREATE INDEX idx_user_preferences_user_id ON user_preferences("userId");
// CREATE INDEX idx_user_preferences_primary_category ON user_preferences("primaryCategory");
// CREATE INDEX idx_user_preferences_price_range ON user_preferences("priceRangePreference");

// -- Function to update the updatedAt timestamp
// CREATE OR REPLACE FUNCTION update_updated_at()
// RETURNS TRIGGER AS $$
// BEGIN
//     NEW."updatedAt" = CURRENT_TIMESTAMP;
//     RETURN NEW;
// END;
// $$ language 'plpgsql';

// -- Trigger to automatically update updatedAt
// CREATE TRIGGER update_user_preferences_updated_at
//     BEFORE UPDATE ON user_preferences
//     FOR EACH ROW
//     EXECUTE FUNCTION update_updated_at();

module.exports = initializeDatabases;