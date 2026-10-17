/**
 * 개발용 한글 조합(IME) 시험 — 새 패키지 없이 compositionstart/update/end와 조합 중 Enter(keyCode 229)를 흉내 낸다.
 * 노트를 하나 열어 둔 상태에서 콘솔: await __gyeolImeTest()  → { pass, checks }
 * 시험이 끝나면 본문을 시험 전으로 되돌린다(자동 저장 한 번).
 * 실기기(iOS·Android·macOS 한글 입력기) 확인은 따로 필요하다.
 */
import type { Editor } from '@tiptap/react'
import type { TriggerState } from './extensions'

interface Ctx {
  editor: Editor
  stats: { saves: number; dirty: boolean }
  trigger: () => TriggerState | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runImeTest(ctx: Ctx): Promise<{ pass: boolean; checks: Array<[string, boolean, unknown?]> }> {
  const { editor: ed, stats } = ctx
  const view = ed.view
  const dom = view.dom as HTMLElement
  const original = ed.getJSON()
  const checks: Array<[string, boolean, unknown?]> = []
  const paras = () => {
    let n = 0
    ed.state.doc.descendants((x) => {
      if (x.type.name === 'paragraph') n++
    })
    return n
  }
  /** IME처럼: 커서 자리 텍스트 노드에 조합 글자를 바꿔 넣고 DOM 선택을 옮긴다 */
  const compose = async (steps: string[], during?: () => void) => {
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    const { node, offset } = view.domAtPos(ed.state.selection.from)
    let text: Text
    let at: number
    if (node.nodeType === 3) {
      text = node as Text
      at = offset
    } else {
      const ref = node.childNodes[offset] ?? null
      if (ref && ref.nodeName === 'BR') node.removeChild(ref)
      text = document.createTextNode('')
      node.insertBefore(text, node.childNodes[offset] ?? null)
      at = 0
    }
    const base = text.data
    for (const s of steps) {
      dom.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: s }))
      text.data = base.slice(0, at) + s + base.slice(at)
      getSelection()?.collapse(text, at + s.length)
      dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: s, isComposing: true }))
      await sleep(30)
      during?.()
    }
    return () => dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: steps[steps.length - 1] }))
  }

  try {
    ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: true })
    ed.commands.focus('end')
    await sleep(700)

    // 1) `[[` 뒤 조합: 제안은 조합 중 그대로, 끝난 뒤 한 번 거른다
    ed.commands.insertContent('[[')
    await sleep(30)
    const qs: Array<string | undefined> = []
    const end1 = await compose(['ㅋ', '카', '칼', '카르'], () => qs.push(ctx.trigger()?.query))
    checks.push(['조합 중 [[ 제안 멈춤', qs.every((q) => q === ''), qs])
    end1()
    await sleep(60)
    checks.push(['조합 끝 뒤 제안 다시 거름', ctx.trigger()?.query === '카르', ctx.trigger()?.query])
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await sleep(30)
    checks.push(['Esc로 제안 닫힘(글자는 남음)', ctx.trigger() === null && ed.state.doc.textContent.includes('[[카르')])

    // 2) 조합 중 Enter: 문단을 자르지 않고, 0.6초가 지나도 저장하지 않는다
    const s0 = stats.saves
    const p0 = paras()
    const end2 = await compose(['ㅎ', '하', '한', '한ㄱ', '한그', '한글'])
    const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, isComposing: true, bubbles: true, cancelable: true } as KeyboardEventInit)
    dom.dispatchEvent(enter)
    await sleep(800)
    checks.push(['조합 중 Enter가 문단을 자르지 않음', paras() === p0, [p0, paras()]])
    checks.push(['조합 중 자동 저장 멈춤', stats.saves === s0 && stats.dirty, stats.saves - s0])
    end2()
    await sleep(60)
    checks.push(['조합 글자 그대로', ed.state.doc.textContent.endsWith('[[카르한글'), ed.state.doc.textContent])
    await sleep(800)
    checks.push(['조합 끝 뒤 0.6초에 저장', stats.saves === s0 + 1, stats.saves - s0])

    // 3) 조합이 끝난 뒤의 Enter는 평소대로 문단을 나눈다
    const p1 = paras()
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
    await sleep(30)
    checks.push(['평소 Enter는 문단 나눔', paras() === p1 + 1, [p1, paras()]])

    // 4) '/' 메뉴: 빈 줄 맨 앞에서만, 조합 중 거르기 멈춤
    ed.commands.insertContent('/')
    await sleep(30)
    checks.push(['빈 줄 / 메뉴 열림', ctx.trigger()?.kind === 'slash'])
    const sq: Array<string | undefined> = []
    const end3 = await compose(['ㅈ', '제'], () => sq.push(ctx.trigger()?.query))
    checks.push(['조합 중 / 거르기 멈춤', sq.every((q) => q === ''), sq])
    end3()
    await sleep(60)
    checks.push(['조합 끝 뒤 / 거름', ctx.trigger()?.query === '제', ctx.trigger()?.query])
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    ed.commands.deleteRange({ from: ed.state.selection.from - 2, to: ed.state.selection.from })
    ed.commands.insertContent('1/2 ')
    await sleep(30)
    checks.push(['글 중간 / 는 메뉴 아님(1/2)', ctx.trigger() === null])
  } finally {
    ed.commands.setContent(original, { emitUpdate: true })
  }
  return { pass: checks.every((c) => c[1]), checks }
}
