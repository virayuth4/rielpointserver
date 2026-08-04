const axios = require('axios');

/**
 * Use this is productRoutes.js
 * Helper function to generate and update product tags. 
 * @param {object} params - Parameters for tag generation
 * @param {number} params.productId - ID of the product to generate tags for
 * @param {object} params.pool - Database connection pool
 * @param {string} params.fastapiUrl - URL of the FastAPI endpoint
 * @returns {Promise<string[]>} Array of generated tags
 * @throws {Error} If tag generation or database update fails
 */
async function generateAndUpdateProductTags({ productId, pool, fastapiUrl }) {
    try {
        // Generate tags using FastAPI
        const tagResponse = await axios.post(
            `${fastapiUrl}/fastapi/product/tags/generator/${productId}`
        );

        // Ensure tags is an array
        const tags = Array.isArray(tagResponse.data.tags) ? tagResponse.data.tags : [];
        console.log('Tags to be inserted', tags)
        if (tags && tags.length > 0) {
            // Update the product with generated tags
            const updateQuery = `
                UPDATE products
                SET "productTags" = $1
                WHERE id = $2
                RETURNING "productTags"
            `;
            
            const result = await pool.query(updateQuery, [tags, productId]);
            
            // Return the updated tags
            return result.rows[0].productTags;
        }
        
        return tags;
    } catch (error) {
        console.error('Error in generateAndUpdateProductTags:', error);
        return []
        
    }
}

module.exports = {
    generateAndUpdateProductTags
};