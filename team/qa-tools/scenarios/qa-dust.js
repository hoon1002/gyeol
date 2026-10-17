// 별가루함 키: 줄 포커스에서 E(보관) · T(할 일로) · Enter(노트로) — 포커스가 다음 줄로 가는지, 수가 맞는지
await size(1440, 900); setMode('mouse'); await nav('/', 2500)
const out = []
const cnt = async () => +(await ev(`(document.querySelector('[aria-label^="별가루"]')?.getAttribute('aria-label') || '').match(/\\d+/)?.[0] ?? -1`))
const rows = () => ev(`[...document.querySelectorAll('.dust-row')].length`)
await tapSel('[aria-label^="별가루"]'); await sleep(700)
await key('ArrowDown'); await sleep(200)
out.push(`open: rows=${await rows()} focus=${(await st()).focus} badge=${await cnt()}`)
for (const k of ['e', 't', 'Enter']) {
  const before = await rows()
  const f0 = await ev(`document.activeElement.innerText?.split('\\n')[0].slice(0, 20)`)
  await key(k); await sleep(700)
  out.push(`${k}: rows ${before}→${await rows()} '${f0}' → focus=${(await st()).focus} '${await ev(`document.activeElement.innerText?.split('\\n')[0].slice(0, 20)`)}'`)
}
await key('Escape'); await sleep(500)
out.push('after close badge=' + await cnt())
// 폰: 메모 칸 아래로 쓸기 닫기
await size(390, 844, { touch: true }); setMode('touch'); await nav('/', 2500)
await tapSel('[aria-label="메모"]'); await sleep(500)
const [ta] = await find('.memo-layer .memo-row, .memo-layer textarea')
out.push('phone memo open: ' + JSON.stringify((await st()).layers.filter((l) => /memo-layer/.test(l))) + ' at y=' + ta?.y)
await drag(195, ta.y - 30, 195, ta.y + 260, { steps: 10 }); await sleep(600)
out.push('swipe down → ' + JSON.stringify((await st()).layers.filter((l) => /memo-layer/.test(l))))
setMode('mouse'); await size(1440, 900)
print(out.join('\n'))
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)))
