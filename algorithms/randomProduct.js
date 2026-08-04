const zingoPool = require("../database/pgZingo");

// Add these debug logs in your GetRandomProducts function
const GetRandomProducts = async (page, limit, seed = null, sex, userId) => {
  const offset = (page - 1) * limit;
  
  console.log(`Fetching page ${page} with limit ${limit}, offset ${offset}, sex ${sex}, userId ${userId}`);
  
  // First, get total count with better error handling
  const countQuery = `
    SELECT COUNT(*) 
    FROM products 
    WHERE "isDeleted" = false 
  `;
  
  let totalItems = 0;
  try {
    const countResult = await zingoPool.query(countQuery);
    totalItems = parseInt(countResult.rows[0].count);
    console.log(`Total products count: ${totalItems}`);
  } catch (countError) {
    console.error("Error counting products:", countError);
    throw countError;
  }

  // Calculate totalPages properly
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  console.log(`Total pages calculated: ${totalPages}`);
  
  // Validate page number is within bounds
  const validatedPage = Math.min(Math.max(1, page), totalPages);
  if (validatedPage !== page) {
    console.log(`Page ${page} out of bounds, using page ${validatedPage} instead`);
    page = validatedPage;
  }
  
  // Recalculate offset with validated page
  const validatedOffset = (validatedPage - 1) * limit;
  
  // Get or create a random seed
  let randomSeed;
  if (seed !== null) {
    randomSeed = seed;
  } else {
    // Generate a random seed between 0 and 1
    randomSeed = Math.random();
  }
  
  console.log(`Using random seed: ${randomSeed}`);

  try {
    // First set the seed in a separate query
    if (randomSeed !== null) {
      await zingoPool.query(`SELECT setseed($1)`, [randomSeed]);
    }
    
    // Then execute the main query with random() - now using the seed we just set
    const query = `
    SELECT 
      p.id, p."productName", p."productCategory", p."phoneNumber", 
      p."productPrice", p."availableQuantity", p."productDescription", 
      p."productImagePaths", p."productMediaPaths" , p."productStockStatus",p."saleState", p."reviewState", p."verifyState", 
      p."featureState", p."slug", p."isSold", p."soldAt", p."postedBy",
      p."isDeleted", p."createdAt", p."inStock", p."discountedPrice", p."quantitySold", p."directToSeller",
      u."bio", u."fullName", u."instagram"
    FROM products p
    LEFT JOIN users u ON p."postedBy" = u.id
    WHERE p."isDeleted" = false
    AND  p."isPrivate" = false
    AND p."sex" = $3
    ORDER BY random()
    LIMIT $1 OFFSET $2
    `;

    const result = await zingoPool.query(query, [limit, validatedOffset, sex]);
    console.log(`Retrieved ${result.rows.length} products`);
    
    // Double check hasMore calculation
    const hasMore = validatedPage < totalPages;
    console.log(`Has more pages: ${hasMore} (page ${validatedPage} of ${totalPages})`);
    
    return {
      products: result.rows,
      totalItems,
      totalPages,
      seed: randomSeed,
      hasMore
    };
  } catch (queryError) {
    console.error("Error querying products:", queryError);
    throw queryError;
  }
};
  module.exports = {
    GetRandomProducts
  };
