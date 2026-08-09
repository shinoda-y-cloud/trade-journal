/**
 * 配色テーマ。白基調 / 紺基調 / 黒基調 の3種。
 *
 * 選択は data-theme 属性として <html> に載せ、実際の色は CSS 変数で切り替える。
 * 起動時のちらつきを避けるため、初期値の適用は index.html のインラインスクリプトが
 * 描画前に行う。ここはその後の切り替えと保存を受け持つ。
 */

export type Theme = 'light' | 'navy' | 'black'

export const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: '白' },
  { value: 'navy', label: '紺' },
  { value: 'black', label: '黒' },
]

/** index.html のインラインスクリプトと同じキーを使う */
export const THEME_KEY = 'trade-journal.theme'

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'navy' || v === 'black'
}

/** 保存済みの選択。無ければOSの設定から決める */
export function currentTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (isTheme(saved)) return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'black' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(THEME_KEY, theme)
  // iOSでステータスバーやアドレスバーの色を合わせる
  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
  if (meta) {
    meta.setAttribute(
      'content',
      getComputedStyle(document.documentElement).getPropertyValue('--plane').trim() || '#000000',
    )
  }
}
