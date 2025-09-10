import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
    test: {
        poolOptions: {
            workers: {
                // Use the existing Worker config
                wrangler: { configPath: './wrangler.toml' },
            },
        },
    },
});
