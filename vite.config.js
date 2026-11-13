import { defineConfig } from 'vite';

export default defineConfig({
  // dist/를 어느 경로에 올려도 동작하도록 상대 경로로 빌드합니다.
  base: './',
  build: {
    // three.js만으로 600kB 정도라 경고 기준을 올려 둡니다.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
  },
});
