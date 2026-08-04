const sanitizeFileName = (fileName) => {
    return fileName
        .toLowerCase() // Convert to lowercase
        .replace(/\s+/g, '_') // Replace spaces with underscore
        .replace(/[^a-z0-9._-]/g, '') // Remove all special characters except dots, underscores, and hyphens
};

module.exports = {sanitizeFileName}