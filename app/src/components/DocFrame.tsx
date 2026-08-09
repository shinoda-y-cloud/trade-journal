/**
 * 単一ファイルで完結したHTMLを、そのまま埋め込むための枠。
 *
 * iframe を固定の高さにすると内側と外側で二重にスクロールすることになり、
 * 特にスマホで扱いにくい。同一オリジンなので中身の高さを測れるため、
 * それに合わせて iframe 自体を伸ばし、スクロールはページ側だけにする。
 *
 * 測れなかった場合（別オリジンなど）は、CSS側の固定高にそのまま落ちる。
 */
import { useEffect, useRef, useState } from 'react'

export function DocFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let observer: ResizeObserver | null = null

    const measure = () => {
      try {
        const doc = el.contentDocument
        if (!doc?.documentElement) return
        const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0)
        // 1px単位の揺れで再描画が往復しないようにする
        if (h > 0) setHeight((prev) => (prev !== null && Math.abs(prev - h) < 2 ? prev : h))
      } catch {
        // 中身を読めない場合は測らない。CSSの固定高が使われる
      }
    }

    const onLoad = () => {
      measure()
      try {
        const body = el.contentDocument?.body
        if (body) {
          observer = new ResizeObserver(measure)
          observer.observe(body)
        }
      } catch {
        /* 同上 */
      }
    }

    el.addEventListener('load', onLoad)
    if (el.contentDocument?.readyState === 'complete') onLoad()
    window.addEventListener('resize', measure)

    return () => {
      el.removeEventListener('load', onLoad)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [])

  return (
    <iframe
      ref={ref}
      className={`doc-frame${height === null ? '' : ' is-sized'}`}
      style={height === null ? undefined : { height }}
      src={src}
      title={title}
      // 高さを内容に合わせるので、内側のスクロールは不要
      scrolling="no"
    />
  )
}
