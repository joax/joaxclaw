import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Run only pure lib tests — no DOM, no Electron, no React
    environment: 'node',
    include: ['src/lib/__tests__/**/*.test.ts'],
  },
})
