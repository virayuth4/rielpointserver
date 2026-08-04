/**
 * Utility function to find similar terms for search expansion using term groups
 * 
 * This module provides a function that returns an array of similar terms
 * for a given search query to improve search relevance and results.
 * Terms are organized in groups, and any term in a group will return all other terms in that group.
 */

const { styleTermGroups } = require("../styleTermGroups");


/**
 * Returns an array of similar terms for a given search term
 * @param {string} query - The search query to find similar terms for
 * @returns {string[]} - Array containing the original terms and similar terms
 */
const getSimilarStyleTerms = (query) => {
    // Lowercased term groups for case-insensitive comparison


    const queryLower = query.toLowerCase();
    const similarTerms = [];

    for (const group of styleTermGroups) {
        const groupLower = group.map(term => term.toLowerCase());
        if (groupLower.includes(queryLower)) {
            groupLower.forEach(term => {
                if (term !== queryLower) {
                    similarTerms.push(term);
                }
            });
            break;
        }
    }

    return similarTerms;
};

module.exports = {
    getSimilarStyleTerms
};