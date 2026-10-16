/**
 * AI 경계 (MVP 제외 — 타입만, 구현·키 없음). team/architecture.md 10장.
 * 원칙: 키는 브라우저에 두지 않는다. 나중에 서버 게이트웨이(환경변수 AI_PROVIDER_API_KEY)를 통해서만 부른다.
 * 비밀 환경변수 이름은 절대 VITE_로 시작하지 않는다(Vite가 클라이언트 번들에 넣는다).
 */

export type AiTaskKind = 'summarize' | 'cards' | 'explain' | 'ocr'

export interface AiTask {
  kind: AiTaskKind
  pageId: string
  /** 사용자가 고른 부분만 보낸다 */
  selection?: string
  image?: Blob
}

export type AiChunk =
  | { type: 'text'; text: string }
  | { type: 'card'; front: string; back: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done' }

export interface AiEstimate {
  inputTokens: number
  maxOutputTokens: number
}

export interface AiClient {
  /** 기능이 켜져 있고 게이트웨이가 설정되어 있는가 (기본 꺼짐) */
  isEnabled(): boolean
  /** 실행 전 예상 토큰 (비용 범위 표시용) */
  estimate(task: AiTask): Promise<AiEstimate>
  /** 결과를 조각으로 흘려보낸다. 출력은 데이터로만 다루고, DB에 쓰기 전 사용자 확인을 거친다. */
  run(task: AiTask, opts: { signal: AbortSignal }): AsyncIterable<AiChunk>
}

/** 동기화도 같은 방식의 경계 (M3 이후) */
export interface SyncAdapter {
  push(changes: unknown[]): Promise<void>
  pull(since: number): Promise<unknown[]>
  subscribe(cb: () => void): () => void
}
