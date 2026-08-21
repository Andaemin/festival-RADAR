import path from "path";
import { defineConfig } from "vitest/config";

/**
 * 최소 구성 - Route Handler(app/api/**)를 실제 함수 호출로 검증하는 contract/integration
 * 테스트 전용이다. 프레임워크를 과도하게 확장하지 않는다(플러그인 없이 alias만 해결).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
