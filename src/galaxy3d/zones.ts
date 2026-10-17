/**
 * 글 구역 (design-m1 2-1 · 2-2, 리더 결정 4: 숫자는 한 곳에만) — 렌더러 안전 마스크와 앱 배치가 같은 값을 쓴다.
 * 화면 비율 [x0, y0, x1, y1], 왼쪽 위가 (0, 0). 화면 종류: land = 너비 ≥ 600 가로(태블릿 가로·데스크톱) ·
 * port = 너비 ≥ 600 세로(태블릿 세로) · phone = 너비 < 600.
 * 앱이 배치를 바꾸려면 리더를 거쳐 모션 개발자가 이 값을 바꾼다.
 */
export type ZoneRect = [number, number, number, number]
export type ZoneLayout = 'land' | 'port' | 'phone'
export type ZonePlace = 'today' | 'plan' | 'notes' | 'review' | 'map' | 'focus' | 'sheet'

export const SKY_ZONES: Record<ZonePlace, Record<ZoneLayout, ZoneRect[]>> = {
  today: {
    land: [[0.08, 0.3, 0.4, 0.8]],
    port: [[0.11, 0.66, 0.9, 0.88]],
    phone: [[0.06, 0.65, 0.94, 0.84], [0.06, 0.84, 0.94, 0.88]],
  },
  plan: {
    land: [[0.08, 0.08, 0.94, 0.5]],
    port: [[0.11, 0.07, 0.92, 0.62]],
    phone: [[0.05, 0.07, 0.95, 0.66]],
  },
  notes: {
    land: [[0.08, 0.1, 0.28, 0.92], [0.3, 0.08, 0.76, 0.94]],
    port: [[0.11, 0.07, 0.72, 0.94]],
    phone: [[0.04, 0.07, 0.88, 0.86]],
  },
  review: {
    land: [[0.08, 0.22, 0.4, 0.78]],
    port: [[0.14, 0.56, 0.86, 0.88]],
    phone: [[0.05, 0.48, 0.95, 0.84]],
  },
  map: {
    land: [[0.08, 0.06, 0.36, 0.28], [0.6, 0.72, 0.94, 0.9]],
    port: [[0.11, 0.04, 0.7, 0.13], [0.11, 0.7, 0.92, 0.86]],
    phone: [[0.05, 0.06, 0.8, 0.14], [0.05, 0.68, 0.95, 0.84]],
  },
  focus: {
    land: [[0.08, 0.3, 0.32, 0.74]],
    port: [[0.14, 0.72, 0.94, 0.9]],
    phone: [[0.06, 0.58, 0.94, 0.84]],
  },
  /** 설정 시트: 가로는 오른쪽 패널(데스크톱 420px · 태블릿 380px ≈ 폭 29–32%), 세로는 아래 64%, 폰은 아래 88% */
  sheet: {
    land: [[0.7, 0, 1, 1]],
    port: [[0, 0.36, 1, 1]],
    phone: [[0, 0.12, 1, 1]],
  },
}

/** 화면 크기(CSS px) → 화면 종류 */
export function zoneLayout(w: number, h: number): ZoneLayout {
  if (w < 600) return 'phone'
  return w >= h ? 'land' : 'port'
}
