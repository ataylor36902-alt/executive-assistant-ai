const logger = require('../src/utils/logger');

/**
 * Database seed script
 * Creates test data for development
 */
async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');

    // TODO: Create test users, contacts, emails, etc.

    logger.info('Database seeding completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();
