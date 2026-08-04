const sanitizeHtml = require('sanitize-html');

// Sanitization function
function sanitizeProductDescription(dirtyHtml) {
    const cleanHtml = sanitizeHtml(dirtyHtml, {
        allowedTags: ['b', 'i', 'em', 'strong', 'div', 'br', 'p'],
        allowedAttributes: {},
        disallowedTagsMode: 'escape'
    });
    return cleanHtml;
}

module.exports = {sanitizeProductDescription}
