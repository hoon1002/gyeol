/**
 * 노트 틀 2종 (design-m2 7장) — 편집기(ProseMirror) JSON. TipTap을 import하지 않는다(첫 화면 번들에 들어가도 가볍게).
 * 자리표시(placeholder)는 문서에 넣지 않고, 편집기가 바로 위 제목 이름으로 고른다(PLACEHOLDER_BY_HEADING).
 */
export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

export type TemplateName = 'class' | 'concept'

const h2 = (text: string): PMNode => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const p = (): PMNode => ({ type: 'paragraph' })
const bullets = (): PMNode => ({ type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] })
const checks = (): PMNode => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p()] }] })

export function templateDoc(name: TemplateName): PMNode {
  if (name === 'class') {
    return {
      type: 'doc',
      content: [h2('핵심'), bullets(), h2('질문'), checks(), { type: 'horizontalRule' }, h2('한 줄 요약'), { type: 'blockquote', content: [p()] }],
    }
  }
  return {
    type: 'doc',
    content: [h2('정의'), p(), h2('예시'), bullets(), h2('헷갈리는 점'), bullets(), h2('연결'), p()],
  }
}

/** 빈 블록 자리표시: 바로 위(가장 가까운 앞) 제목 → 글 */
export const PLACEHOLDER_BY_HEADING: Record<string, string> = {
  핵심: '남길 것',
  질문: '모르는 것',
  '한 줄 요약': '오늘 수업을 한 문장으로',
  정의: '한 문장으로',
  연결: '[[ 로 잇기',
}

/** 제목 자리표시 */
export function titlePlaceholder(t: TemplateName | null | undefined): string {
  return t === 'concept' ? '개념 이름' : '제목'
}
