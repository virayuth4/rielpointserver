// Complete User Preference System with Scoring
// This includes all functions needed for preference processing and scoring

const { styleTermGroups } = require("../utils/styleTermGroups");

const extractPreferences = (userId, eventData) => {
    // Handle both direct object and stringified JSON
    let data = eventData;
    if (typeof eventData === 'string') {
        try {
            data = JSON.parse(eventData);
        } catch (e) {
            console.error('Failed to parse event data:', e);
            return null;
        }
    }
    
    // console.log('Parsed data:', data); // Debug log
    
    const {
        productName,
        productPrice,
        productCategory,
        productSubCategory,
        productTags,
        
    } = data;
    
    // Parse price as number
    const price = parseFloat(productPrice);
    console.log('Parsed price:', price, 'from:', productPrice); // Debug log
    
    // Parse tags (handle stringified JSON array)
    let parsedTags = [];
    console.log('Raw productTags:', productTags, 'Type:', typeof productTags); // Debug log
    
  // In your extractPreferences function, replace the tag parsing section with this:

try {
    if (Array.isArray(productTags) && productTags.length > 0) {
        // Handle array of stringified JSON or comma-separated strings
        parsedTags = productTags.flatMap(tagString => {
            console.log('Processing tag string:', tagString); // Debug log
            try {
                if (typeof tagString === 'string') {
                    // First try to parse as JSON
                    try {
                        const parsed = JSON.parse(tagString);
                        return Array.isArray(parsed) ? parsed : [parsed];
                    } catch (jsonError) {
                        // If JSON parsing fails, treat as comma-separated string
                        return tagString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
                    }
                }
                return [tagString];
            } catch (parseError) {
                console.warn('Could not parse individual tag:', tagString, parseError);
                // Fallback: split by comma if it's a string
                if (typeof tagString === 'string') {
                    return tagString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
                }
                return [tagString];
            }
        });
    } else if (Array.isArray(productTags) && productTags.length === 0) {
        // Handle empty array case
        parsedTags = [];
    } else if (typeof productTags === 'string' && productTags.trim() !== '') {
        // Handle direct string input
        try {
            // Try JSON parsing first
            parsedTags = JSON.parse(productTags);
        } catch (jsonError) {
            // If not JSON, split by comma
            parsedTags = productTags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        }
    } else if (productTags && !Array.isArray(productTags)) {
        parsedTags = [productTags];
    }
    } catch (e) {
        console.warn("Could not parse product tags:", productTags, e);
        // Final fallback
        if (typeof productTags === 'string') {
            parsedTags = productTags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        } else {
            parsedTags = Array.isArray(productTags) ? productTags : [];
        }
    }
    
    console.log('Final parsed tags:', parsedTags); // Debug log
    
    // Determine price range category
    const priceRange = categorizePriceRange(price);
    
    // Extract style preferences from tags
    const stylePreferences = extractStylePreferences(parsedTags);
    
    // Extract demographic info from tags
    const demographics = extractDemographics(parsedTags);
    
    return {
        userId,
        categories: {
            primary: productCategory,
            secondary: productSubCategory
        },
        pricePreferences: {
            range: priceRange,
            recentPrice: price,
            minObserved: price,
            maxObserved: price
        },
        stylePreferences,
        demographics,
        tags: parsedTags,
        lastUpdated: new Date().toISOString()
    };
};

const categorizePriceRange = (price) => {
    if (price < 10) return 'budget';
    if (price < 35) return 'low';
    if (price < 20) return 'medium';
    if (price < 30) return 'high';
    return 'premium';
};

const extractStylePreferences = (tags) => {
    // Flatten all your term groups into one array
    const allStyleKeywords = styleTermGroups.flat();
    
    return tags.filter(tag => 
        allStyleKeywords.some(keyword => 
            tag.toLowerCase().includes(keyword.toLowerCase())
        )
    );
};

const extractDemographics = (tags) => {
    const demographics = {
        gender: null,
        ageGroup: null
    };
    
    // Extract gender
    const genderKeywords = ['men', 'women', 'unisex', 'male', 'female'];
    const genderTag = tags.find(tag => 
        genderKeywords.some(keyword => 
            tag.toLowerCase().includes(keyword.toLowerCase())
        )
    );
    if (genderTag) {
        demographics.gender = genderTag.toLowerCase();
    }
    
    // Extract age group (you can expand this based on your tags)
    const ageKeywords = ['teen', 'youth', 'adult', 'senior'];
    const ageTag = tags.find(tag => 
        ageKeywords.some(keyword => 
            tag.toLowerCase().includes(keyword.toLowerCase())
        )
    );
    if (ageTag) {
        demographics.ageGroup = ageTag.toLowerCase();
    }
    
    return demographics;
};

const calculateCategoryScores = (interactions) => {
    const categoryCount = {};
    const categoryRecency = {};
    const now = new Date();
    
    interactions.forEach((interaction, index) => {
        const category = interaction.categories?.primary || 'unknown';
        const interactionDate = new Date(interaction.lastUpdated || interaction.createdAt);
        const daysSince = (now - interactionDate) / (1000 * 60 * 60 * 24);
        
        // Count frequency
        categoryCount[category] = (categoryCount[category] || 0) + 1;
        
        // Calculate recency weight (more recent = higher weight)
        const recencyWeight = Math.exp(-daysSince / 30); // 30-day decay
        categoryRecency[category] = (categoryRecency[category] || 0) + recencyWeight;
    });
    
    const categoryScores = {};
    const totalInteractions = interactions.length;
    
    Object.keys(categoryCount).forEach(category => {
        const frequency = categoryCount[category] / totalInteractions;
        const recency = categoryRecency[category] / categoryCount[category];
        
        // Combined score: 60% frequency + 40% recency
        categoryScores[category] = (frequency * 0.6 + recency * 0.4) * 100;
    });
    
    return categoryScores;
};

const calculatePriceRangeScores = (interactions) => {
    const priceRangeCount = {};
    const priceRangeTotal = {};
    
    interactions.forEach(interaction => {
        const priceRange = interaction.pricePreferences?.range || 'unknown';
        const price = interaction.pricePreferences?.recentPrice || 0;
        
        priceRangeCount[priceRange] = (priceRangeCount[priceRange] || 0) + 1;
        priceRangeTotal[priceRange] = (priceRangeTotal[priceRange] || 0) + price;
    });
    
    const priceRangeScores = {};
    const totalInteractions = interactions.length;
    
    Object.keys(priceRangeCount).forEach(range => {
        const frequency = priceRangeCount[range] / totalInteractions;
        const avgPrice = priceRangeTotal[range] / priceRangeCount[range];
        
        // Score based on frequency and consistency
        priceRangeScores[range] = {
            score: frequency * 100,
            avgPrice: avgPrice,
            frequency: priceRangeCount[range]
        };
    });
    
    return priceRangeScores;
};

const calculateStyleScores = (interactions) => {
    const styleCount = {};
    const totalStyles = interactions.reduce((total, interaction) => {
        return total + (interaction.stylePreferences?.length || 0);
    }, 0);
    
    interactions.forEach(interaction => {
        const styles = interaction.stylePreferences || [];
        styles.forEach(style => {
            styleCount[style] = (styleCount[style] || 0) + 1;
        });
    });
    
    const styleScores = {};
    Object.keys(styleCount).forEach(style => {
        styleScores[style] = (styleCount[style] / totalStyles) * 100;
    });
    
    return styleScores;
};

const calculateTagScores = (interactions) => {
    const tagCount = {};
    const tagWeight = {};
    
    interactions.forEach((interaction, index) => {
        const tags = interaction.tags || [];
        const interactionWeight = 1 + (index * 0.1); // More recent interactions have slightly higher weight
        
        tags.forEach(tag => {
            tagCount[tag] = (tagCount[tag] || 0) + 1;
            tagWeight[tag] = (tagWeight[tag] || 0) + interactionWeight;
        });
    });
    
    const tagScores = {};
    const totalTags = Object.values(tagCount).reduce((sum, count) => sum + count, 0);
    
    Object.keys(tagCount).forEach(tag => {
        const frequency = tagCount[tag] / totalTags;
        const weight = tagWeight[tag] / tagCount[tag];
        
        tagScores[tag] = {
            score: frequency * weight * 100,
            frequency: tagCount[tag],
            weight: weight
        };
    });
    
    return tagScores;
};

const calculateOverallStrength = (interactions) => {
    if (interactions.length === 0) return 0;
    
    // Base strength on number of interactions
    const interactionStrength = Math.min(interactions.length / 10, 1) * 40;
    
    // Consistency bonus (how consistent are the preferences)
    const categories = interactions.map(i => i.categories?.primary).filter(Boolean);
    const uniqueCategories = new Set(categories).size;
    const consistencyBonus = uniqueCategories <= 3 ? 30 : Math.max(0, 30 - (uniqueCategories - 3) * 5);
    
    // Recency bonus (recent activity)
    const now = new Date();
    const recentInteractions = interactions.filter(i => {
        const interactionDate = new Date(i.lastUpdated || i.createdAt);
        const daysSince = (now - interactionDate) / (1000 * 60 * 60 * 24);
        return daysSince <= 7;
    });
    const recencyBonus = Math.min(recentInteractions.length / interactions.length, 1) * 30;
    
    return Math.min(interactionStrength + consistencyBonus + recencyBonus, 100);
};

const calculatePreferenceScores = (userPreferences, allUserInteractions = []) => {
    const scores = {
        categoryScores: {},
        priceRangeScores: {},
        styleScores: {},
        tagScores: {},
        overallPreferenceStrength: 0
    };
    
    // 1. Category Scoring (based on frequency and recency)
    scores.categoryScores = calculateCategoryScores(allUserInteractions);
    
    // 2. Price Range Scoring
    scores.priceRangeScores = calculatePriceRangeScores(allUserInteractions);
    
    // 3. Style Preference Scoring
    scores.styleScores = calculateStyleScores(allUserInteractions);
    
    // 4. Tag Frequency Scoring
    scores.tagScores = calculateTagScores(allUserInteractions);
    
    // 5. Overall preference strength (confidence score)
    scores.overallPreferenceStrength = calculateOverallStrength(allUserInteractions);
    
    return scores;
};

// Database functions
const getUserInteractions = async (userId, zingoPool) => {
    if (!userId) return [];
    
    try {
        const query = `
            SELECT * FROM user_preferences 
            WHERE "userId" = $1 
            ORDER BY "lastInteractionDate" DESC
        `;
        
        const result = await zingoPool.query(query, [userId]);
        
        // Parse JSONB fields back to objects
        return result.rows.map(row => ({
            ...row,
            stylePreferences: row.stylePreferences || [],
            demographics: row.demographics || {},
            categoryScores: row.categoryScores || {},
            priceRangeScores: row.priceRangeScores || {},
            styleScores: row.styleScores || {},
            tagScores: row.tagFrequency || {},
            categories: {
                primary: row.primaryCategory,
                secondary: row.secondaryCategory
            },
            pricePreferences: {
                range: row.priceRangePreference,
                recentPrice: row.avgPricePreference,
                minObserved: row.minPriceObserved,
                maxObserved: row.maxPriceObserved
            }
        }));
    } catch (error) {
        console.error('Error fetching user interactions:', error);
        return [];
    }
};

const saveUserPreferences = async (userId, preferences, zingoPool) => {
    if (!userId) return;
    
    try {
        // Check if user preferences already exist
        const existingQuery = `
            SELECT id FROM user_preferences WHERE "userId" = $1
        `;
        
        const existingResult = await zingoPool.query(existingQuery, [userId]);
        
        if (existingResult.rows.length > 0) {
            // Update existing preferences
            const updateQuery = `
                UPDATE user_preferences SET
                    "primaryCategory" = $2,
                    "secondaryCategory" = $3,
                    "priceRangePreference" = $4,
                    "minPriceObserved" = LEAST("minPriceObserved", $5),
                    "maxPriceObserved" = GREATEST("maxPriceObserved", $6),
                    "avgPricePreference" = $7,
                    "stylePreferences" = $8,
                    "demographics" = $9,
                    "categoryScores" = $10,
                    "priceRangeScores" = $11,
                    "styleScores" = $12,
                    "tagFrequency" = $13,
                    "interactionCount" = "interactionCount" + 1,
                    "lastInteractionDate" = CURRENT_TIMESTAMP
                WHERE "userId" = $1
            `;
            
            await zingoPool.query(updateQuery, [
                userId,
                preferences.categories?.primary || null,
                preferences.categories?.secondary || null,
                preferences.pricePreferences?.range || null,
                preferences.pricePreferences?.minObserved || 0,
                preferences.pricePreferences?.maxObserved || 0,
                preferences.pricePreferences?.recentPrice || 0,
                JSON.stringify(preferences.stylePreferences || []),
                JSON.stringify(preferences.demographics || {}),
                JSON.stringify(preferences.categoryScores || {}),
                JSON.stringify(preferences.priceRangeScores || {}),
                JSON.stringify(preferences.styleScores || {}),
                JSON.stringify(preferences.tagScores || {})
            ]);
            
            console.log(`Updated preferences for user ${userId}`);
        } else {
            // Insert new preferences
            const insertQuery = `
                INSERT INTO user_preferences (
                    "userId", "primaryCategory", "secondaryCategory", "priceRangePreference",
                    "minPriceObserved", "maxPriceObserved", "avgPricePreference",
                    "stylePreferences", "demographics", "categoryScores", 
                    "priceRangeScores", "styleScores", "tagFrequency"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `;
            
            await zingoPool.query(insertQuery, [
                userId,
                preferences.categories?.primary || null,
                preferences.categories?.secondary || null,
                preferences.pricePreferences?.range || null,
                preferences.pricePreferences?.minObserved || 0,
                preferences.pricePreferences?.maxObserved || 0,
                preferences.pricePreferences?.recentPrice || 0,
                JSON.stringify(preferences.stylePreferences || []),
                JSON.stringify(preferences.demographics || {}),
                JSON.stringify(preferences.categoryScores || {}),
                JSON.stringify(preferences.priceRangeScores || {}),
                JSON.stringify(preferences.styleScores || {}),
                JSON.stringify(preferences.tagScores || {})
            ]);
            
            console.log(`Inserted new preferences for user ${userId}`);
        }
    } catch (error) {
        console.error('Error saving user preferences:', error);
        throw error;
    }
};

// Main function that processes user preferences with scoring
const processUserPreferencesWithScoring = async (userId, eventData, zingoPool) => {
    try {
        console.log("Event data to process user preferences", eventData);
        
        // Get existing user interactions
        const existingInteractions = await getUserInteractions(userId, zingoPool);
        
        // Extract and process preferences from event data
        const newPreferences = extractPreferences(userId, eventData);
        
        if (!newPreferences) {
            console.log("Could not extract preferences from event data");
            return null;
        }
        
        // Add this interaction to the list for scoring
        const allInteractions = [...existingInteractions, newPreferences];
        
        // Calculate preference scores
        const scores = calculatePreferenceScores(newPreferences, allInteractions);
        
        // Combine preferences with scores
        const enhancedPreferences = {
            ...newPreferences,
            ...scores,
            interactionCount: allInteractions.length
        };
        
        // Save enhanced preferences to database
        await saveUserPreferences(userId, enhancedPreferences, zingoPool);
        
        console.log(`Processed preferences with scores for user ${userId}:`, enhancedPreferences);
        return enhancedPreferences;
        
    } catch (e) {
        console.error("Error with processing User Preferences:", e);
        throw e;
    }
};

// Product matching algorithm
const calculateProductMatchScore = (userScores, product) => {
    let matchScore = 0;
    let maxPossibleScore = 0;
    
    // Category matching (40% weight)
    const categoryWeight = 40;
    if (userScores.categoryScores[product.category]) {
        matchScore += (userScores.categoryScores[product.category] / 100) * categoryWeight;
    }
    maxPossibleScore += categoryWeight;
    
    // Price range matching (25% weight)
    const priceWeight = 25;
    const productPriceRange = categorizePriceRange(product.price);
    if (userScores.priceRangeScores[productPriceRange]) {
        matchScore += (userScores.priceRangeScores[productPriceRange].score / 100) * priceWeight;
    }
    maxPossibleScore += priceWeight;
    
    // Style matching (20% weight)
    const styleWeight = 20;
    const productStyles = product.tags?.filter(tag => 
        Object.keys(userScores.styleScores).some(style => 
            tag.toLowerCase().includes(style.toLowerCase())
        )
    ) || [];
    
    if (productStyles.length > 0) {
        const styleScore = productStyles.reduce((sum, style) => {
            const matchingUserStyle = Object.keys(userScores.styleScores).find(userStyle =>
                style.toLowerCase().includes(userStyle.toLowerCase())
            );
            return sum + (userScores.styleScores[matchingUserStyle] || 0);
        }, 0) / productStyles.length;
        
        matchScore += (styleScore / 100) * styleWeight;
    }
    maxPossibleScore += styleWeight;
    
    // Tag matching (15% weight)
    const tagWeight = 15;
    const productTags = product.tags || [];
    const matchingTags = productTags.filter(tag => userScores.tagScores[tag]);
    
    if (matchingTags.length > 0) {
        const tagScore = matchingTags.reduce((sum, tag) => {
            return sum + (userScores.tagScores[tag]?.score || 0);
        }, 0) / matchingTags.length;
        
        matchScore += (tagScore / 100) * tagWeight;
    }
    maxPossibleScore += tagWeight;
    
    // Normalize score to 0-100
    const normalizedScore = maxPossibleScore > 0 ? (matchScore / maxPossibleScore) * 100 : 0;
    
    // Apply confidence multiplier based on overall preference strength
    const confidenceMultiplier = userScores.overallPreferenceStrength / 100;
    
    return {
        matchScore: normalizedScore * confidenceMultiplier,
        rawScore: normalizedScore,
        confidence: userScores.overallPreferenceStrength,
        breakdown: {
            categoryMatch: userScores.categoryScores[product.category] || 0,
            priceMatch: userScores.priceRangeScores[productPriceRange]?.score || 0,
            styleMatches: productStyles.length,
            tagMatches: matchingTags.length
        }
    };
};

module.exports = {
    processUserPreferencesWithScoring,
    calculateProductMatchScore,
    getUserInteractions,
    saveUserPreferences,
    extractPreferences,
    calculatePreferenceScores,
    categorizePriceRange,
    extractStylePreferences,
    extractDemographics
};