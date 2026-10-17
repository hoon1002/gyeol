/** 입자 만들기 Web Worker — 메인 스레드 긴 작업 0 (plan-v4-final Q7). 결과 버퍼는 복사 없이 넘긴다(transfer). */
import { makeGalaxy } from './galaxy'

interface Req {
  id: number
  stars: number
  clouds: number
}
const post = (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage.bind(self)
self.onmessage = (e: MessageEvent<Req>) => {
  const t0 = performance.now()
  const g = makeGalaxy(e.data.stars, e.data.clouds)
  post({ id: e.data.id, ms: performance.now() - t0, ...g }, [g.stars.buffer, g.clouds.buffer])
}
