/**
 * 글 구역 (design-m1 2-1 · 리더 결정 4): 장소 × 화면 종류(가로·세로·폰)마다 사각형 1–2개, 화면 비율 (x0, y0, x1, y1).
 * 렌더러 안전 마스크와 같은 숫자여야 한다 → 숫자는 한 곳(@/fx SKY_ZONES)에만 둔다.
 *
 * TODO(M1·fx 대기): @/fx가 SKY_ZONES를 내보내면 아래 임시 표(TEMP_ZONES)를 지우고 그 값으로 installZones를 부른다.
 *   지금 숫자는 design-m1 2-1 그대로다.
 *
 * 앱은 CSS 변수로만 받는다: 각 장소 `.space[data-path]`에 --za-x0 … --za-y1(첫 사각형), --zb-*(둘째, 없으면 첫째).
 * 별 정보 패널(StarPress)은 [data-zone-place]에 --zs-*(지도 = 둘째 사각형, 그 밖 = 첫째).
 * 화면 종류: 폰 = 너비 < 600 · 세로 = 600 이상이고 높이 ≥ 너비 · 가로 = 그 밖. 숨은 장소도 자기 값을 가지므로 장소를 바꿀 때 배치 계산이 없다.
 */
import type { SpacePath } from '@/shell/spaces'

export type ZoneRect = readonly [x0: number, y0: number, x1: number, y1: number]
export type ZoneLayout = 'wide' | 'tall' | 'phone'
export type ZoneTable = Record<SpacePath, Record<ZoneLayout, readonly ZoneRect[]>>

/** design-m1 2-1 '글 구역' (임시 — SKY_ZONES로 바꿀 것) */
export const TEMP_ZONES: ZoneTable = {
  '/': {
    wide: [[0.08, 0.3, 0.4, 0.8]],
    tall: [[0.11, 0.66, 0.9, 0.88]],
    phone: [[0.06, 0.65, 0.94, 0.84], [0.06, 0.84, 0.94, 0.88]], // 둘째 = 계획 줄
  },
  '/plan': {
    wide: [[0.08, 0.08, 0.94, 0.5]],
    tall: [[0.11, 0.07, 0.92, 0.62]],
    phone: [[0.05, 0.07, 0.95, 0.66]],
  },
  '/notes': {
    wide: [[0.08, 0.1, 0.28, 0.92], [0.3, 0.08, 0.76, 0.94]], // 목록 + 종이
    tall: [[0.11, 0.07, 0.72, 0.94]],
    phone: [[0.04, 0.07, 0.88, 0.86]],
  },
  '/review': {
    wide: [[0.08, 0.22, 0.4, 0.78]],
    tall: [[0.14, 0.56, 0.86, 0.88]],
    phone: [[0.05, 0.48, 0.95, 0.84]],
  },
  '/map': {
    wide: [[0.08, 0.06, 0.36, 0.28], [0.6, 0.72, 0.94, 0.9]], // 머리 + 별 정보
    tall: [[0.11, 0.04, 0.7, 0.13], [0.11, 0.7, 0.92, 0.86]],
    phone: [[0.05, 0.06, 0.8, 0.14], [0.05, 0.68, 0.95, 0.84]],
  },
  '/focus': {
    wide: [[0.08, 0.3, 0.32, 0.74]],
    tall: [[0.14, 0.72, 0.94, 0.9]],
    phone: [[0.06, 0.58, 0.94, 0.84]],
  },
}

const MEDIA: Record<ZoneLayout, string> = {
  phone: '(max-width: 599px)',
  tall: '(min-width: 600px) and (max-aspect-ratio: 1/1)',
  wide: '(min-width: 600px) and (min-aspect-ratio: 1001/1000)',
}

export function zoneLayout(w = innerWidth, h = innerHeight): ZoneLayout {
  if (w < 600) return 'phone'
  return h >= w ? 'tall' : 'wide'
}

const vars = (k: string, r: ZoneRect) => `--z${k}-x0:${r[0]};--z${k}-y0:${r[1]};--z${k}-x1:${r[2]};--z${k}-y1:${r[3]};`

export function zonesCss(table: ZoneTable): string {
  const out: string[] = []
  ;(Object.keys(MEDIA) as ZoneLayout[]).forEach((layout) => {
    const rules: string[] = []
    ;(Object.keys(table) as SpacePath[]).forEach((path) => {
      const rects = table[path][layout]
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
export function installZones(table: ZoneTable = TEMP_ZONES): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById('gyeol-zones') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'gyeol-zones'
    document.head.appendChild(el)
  }
  el.textContent = zonesCss(table)
}
