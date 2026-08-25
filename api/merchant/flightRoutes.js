const express = require("express");
const zingoPool = require("../../database/pgZingo");
const router = express.Router();


router.get('/flights', async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM affiliate_offers
      WHERE category = 'travel'
        
      ORDER BY
        created_at DESC
    `;

    const result = await zingoPool.query(query);

    return res.status(200).json({
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching promos:', error);

    return res.status(500).json({
      error: 'Failed to fetch promos',
    });
  }
});

module.exports = router;