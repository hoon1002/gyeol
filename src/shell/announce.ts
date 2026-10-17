/** 토스트 대신 스크린리더 알림 (design-quiet 5장): 화면에는 보이지 않고 aria-live로 읽힌다(Chrome.tsx Toaster) */
import { useUi } from '@/stores/ui'

export function announce(text: string): void {
  useUi.getState().showToast(text)
}
