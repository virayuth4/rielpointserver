const config = loadEnvironmentVariables();

// Add helper method to check environment
config.isProductionTest = () => process.env.IS_PRODUCTION_TEST === 'true';
config.isRealProduction = () => process.env.NODE_ENV === 'production' && !config.isProductionTest();

module.exports = config;
