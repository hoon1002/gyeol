/**
 * 입구(메모·별가루함·첫 실행·백업)의 하늘 다리. 컴포넌트 밖(saveMemo 등)에서도 하늘 사건을 부를 수 있게
 * RootLayout의 <CaptureSky/>가 지금의 useSkyEvent() 묶음을 여기에 넣어 둔다.
 * 계약(@/fx SkyEvents, design-m2 10장): dust · setDust · fileDust · bloomNebula · revealGalaxy · importNotes. 모두 멱등, 실패하지 않는다.
 */
import type { SkyEvents } from '@/fx'

export type FileTo = 'note' | 'task' | 'archive'

let current: SkyEvents | null = null

export function setSkyBridge(ev: SkyEvents | null): void {
  current = ev
}

/** D1: 메모 저장 → 나의 자리 둘레 별가루 한 점 */
export function skyDust(id: string, subjectId?: string | null): void {
  current?.dust({ id, subjectId: subjectId ?? undefined })
}

/** D2: 보관하지 않은 별가루(inbox) 수 */
export function skySetDust(n: number): void {
  current?.setDust(n)
}

/** D3–D5: 노트로 · 할 일로 · 보관 */
export function skyFileDust(id: string, subjectId: string | null, to: FileTo): void {
  current?.fileDust(id, subjectId, to)
}

/** D9: 과목 성운 피기 */
export function skyBloom(subjectId: string, color: string): void {
  current?.bloomNebula(subjectId, color)
}

/** D10: 은하 보이기(2.6초, 끝나면 resolve) */
export async function skyReveal(): Promise<void> {
  try {
    await current?.revealGalaxy()
  } catch {
    /* 하늘이 없어도 흐름은 계속 */
  }
}

/** D11: 가져오기로 새로 생긴 노트 */
export function skyImportNotes(ids: string[]): void {
  if (ids.length) current?.importNotes(ids)
}

/** 과목 색 토큰 → 실제 CSS 색 문자열 (하늘은 CSS 변수가 아니라 색 값이 필요) */
export function subjectColorValue(token: string): string {
  if (typeof document === 'undefined') return '#DCE4FF'
  return getComputedStyle(document.documentElement).getPropertyValue(`--s-${token}`).trim() || '#DCE4FF'
}
