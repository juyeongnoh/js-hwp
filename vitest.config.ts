import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    // 테스트가 소스에 대고 돌아서, 패키지를 편집하고 그것에 의존하는 패키지를
    // 테스트하는 사이에 빌드 단계가 없다.
    alias: {
      '@js-hwp/core': pkg('core'),
      '@js-hwp/hwp': pkg('hwp'),
      'js-hwp': pkg('js-hwp'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
})
