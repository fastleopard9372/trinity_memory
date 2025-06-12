import { createApp } from './app';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 3000;

(async () => {
  const app = await createApp();
  app.listen(PORT, () => {
    logger.info(`🚀 Trinity AI server running on port ${PORT}`);
  });
})();