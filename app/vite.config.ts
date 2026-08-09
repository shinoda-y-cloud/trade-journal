import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages などサブパス配信でも動くよう相対パスで出力する
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Trade Journal — SBI証券 収支分析',
        short_name: 'Trade Journal',
        description: 'SBI証券のCSVから、株式トレードの収支を端末内だけで集計・分析します',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0d0d0d',
        theme_color: '#0d0d0d',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリ本体を全てキャッシュし、通信が無くても起動できるようにする
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // iframe読み込みもナビゲーション扱いになるため、SPAのindex.htmlに
        // 差し替えられないよう除外する
        navigateFallbackDenylist: [/timeframe\.html$/],
      },
    }),
  ],
})
