const express = require("express");
const zingoPool = require("../../database/pgZingo");
const router = express.Router();


router.get('/hotels', async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM affiliate_offers
      WHERE category = 'hotels'
        AND (
          description ILIKE '%Siem Reap%'
          OR description ILIKE '%Phnom Penh%'
        )
      ORDER BY
        CASE
          WHEN description ILIKE '%Phnom Penh%' THEN 1
          WHEN description ILIKE '%Siem Reap%' THEN 2
          ELSE 3
        END,
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