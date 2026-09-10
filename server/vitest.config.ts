import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // env.ts validates and exits on boot, so the suite needs a valid-looking
    // environment. These are never used to reach the network: every test that
    // touches TMDB stubs global fetch.
    env: {
      NODE_ENV: 'test',
      TMDB_ACCESS_TOKEN: 'test-token',
      DATABASE_URL: 'postgresql://trackzio:trackzio@localhost:5433/trackzio?schema=public',
      SESSION_SECRET: 'test-secret-value-long-enough',
      LOG_LEVEL: 'fatal',
    },
  },
});
