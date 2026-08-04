import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Windows上で以前のdistが使用中でもビルドを妨げないよう、成果物はbuildへ出力する。
  build: {
    outDir: 'build',
    // ウイルス対策ソフトなどが既存成果物を一時的に参照していても、削除処理で失敗しないようにする。
    emptyOutDir: false,
  },
})
