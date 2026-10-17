/**
 * 글 구역 (design-m1 2-1 · 리더 결정 4): 숫자는 한 곳 — @/fx의 SKY_ZONES(렌더러 안전 마스크와 같은 값)만 쓴다.
 * 앱은 CSS 변수로만 받는다: 각 장소 `.space[data-path]`에 --za-x0 … --za-y1(첫 사각형), --zb-*(둘째, 없으면 첫째).
 * 별 정보 패널(StarPress)은 [data-zone-place]에 --zs-*(지도 = 둘째 사각형, 그 밖 = 첫째).
 * 화면 종류는 fx의 zoneLayout과 같다: phone = 너비 < 600 · land = 600 이상이고 너비 ≥ 높이 · port = 그 밖.
 * 숨은 장소도 자기 값을 가지므로 장소를 바꿀 때 배치 계산이 없다.
 */
import { SKY_ZONES, zoneLayout as fxZoneLayout } from '@/fx'
import type { SpacePath } from '@/shell/spaces'

type Rect = readonly number[]
type Layout = 'land' | 'port' | 'phone'

/** 앱 주소 → SKY_ZONES 장소 이름 */
const PLACE_OF: Record<SpacePath, keyof typeof SKY_ZONES> = {
  '/': 'today',
  '/notes': 'notes',
  '/map': 'map',
  '/review': 'review',
  '/plan': 'plan',
  '/focus': 'focus',
}

const MEDIA: Record<Layout, string> = {
  phone: '(max-width: 599px)',
  port: '(min-width: 600px) and (max-aspect-ratio: 999/1000)',
  land: '(min-width: 600px) and (min-aspect-ratio: 1/1)',
}

export function zoneLayout(w = innerWidth, h = innerHeight): Layout {
  return fxZoneLayout(w, h)
}

const vars = (k: string, r: Rect) => `--z${k}-x0:${r[0]};--z${k}-y0:${r[1]};--z${k}-x1:${r[2]};--z${k}-y1:${r[3]};`

export function zonesCss(): string {
  const out: string[] = []
  ;(Object.keys(MEDIA) as Layout[]).forEach((layout) => {
    const rules: string[] = []
    ;(Object.keys(PLACE_OF) as SpacePath[]).forEach((path) => {
      const rects = SKY_ZONES[PLACE_OF[path]][layout]
      const a = rects[0]!
      const b = rects[1] ?? a
      const star = path === '/map' ? b : a
      rules.push(`.space[data-path="${path}"]{${vars('a', a)}${vars('b', b)}}`)
      rules.push(`[data-zone-place="${path}"]{${vars('s', star)}}`)
    })
    out.push(`@media ${MEDIA[layout]}{${rules.join('')}}`)
  })
  return out.join('\n')
}

/** 글 구역 CSS 변수를 한 번 심는다(HMR로 다시 불려도 같은 style 하나) */
export function installZones(): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById('gyeol-zones') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'gyeol-zones'
    document.head.appendChild(el)
  }
  el.textContent = zonesCss()
}
