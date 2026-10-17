// 올가미 옮기기 · 쪽 서랍 G · Esc 겹침(⌘K → 서랍 → 선택 → 종이) · 내보내기 팝오버 · 테이프 붙이기·걷기 (열린 필기 노트에서)
const R = (k, v) => print(k, typeof v === 'string' ? v : JSON.stringify(v))
const step = async (name, fn) => { try { await fn() } catch (e) { R(name + ' ERR', e.message) } }
const cnt = (store) => ev(`new Promise((ok) => { const q = indexedDB.open('gyeol'); q.onsuccess = () => { const t = q.result.transaction('${store}').objectStore('${store}').count(); t.onsuccess = () => { ok(t.result); q.result.close() } } })`)
const L = () => ev(`(() => { const v = (s) => [...document.querySelectorAll(s)].some(e => { const r = e.getBoundingClientRect(); return r.width > 2 && +getComputedStyle(e).opacity > 0.05 && !e.closest('[inert]') }); const o = { pie: v('.ink-pie'), drawer: v('[class*=ink-drawer]'), sel: v('[aria-label="고른 것"]'), pop: v('.ink-pop'), palette: v('.palette'), canvas: v('.ink-canvas') }; return Object.keys(o).filter(k => o[k]).join('+') })()`)
const tool = async (name) => { if (!(await find(`[aria-label="${name}"]`)).length) { const b = await find('.ink-bead'); if (b[0]) { setMode('mouse'); await tap(b[0].x, b[0].y); await sleep(300) } } setMode('mouse'); await tapSel(`[aria-label="${name}"]`); await sleep(200) }
await step('I6', async () => {
  await tool('올가미')
  setMode('pen'); await down(270, 170); for (const [x, y] of [[730, 170], [730, 260], [270, 260], [270, 175]]) { await move(x, y); await sleep(30) } await up(270, 175); await sleep(500)
  R('I6 lasso', await L())
  const bx = async () => ev(`(() => { const e = document.querySelector('[aria-label="고른 것"]'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)] })()`)
  const b0 = await bx(); await drag(500, 215, 560, 600, { steps: 10, stepMs: 14 }); await sleep(600); R('I6 sel box before/after drag', [b0, await bx()])
  await shot('qa-r2-ink-lasso-moved_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.4 })
})
await step('I7-9', async () => {
  setMode('mouse'); await key('g'); await sleep(500); R('I7 G', await L())
  await key('k', 4); await sleep(400); R('I9 +⌘K', await L())
  for (let i = 1; i <= 4; i++) { await key('Escape'); await sleep(500); R('  Esc' + i, (await L()) + ' path=' + (await st()).path) }
})
await nav('/notes', 2500); { const [n] = await find('#stage li button:not(.notes-today-row)'); setMode('mouse'); await tap(n.x, n.y); await sleep(1800) }
await step('I8', async () => { await tool('더 보기'); R('I8 more', await ev(`[...document.querySelectorAll('.ink-pop button')].filter(b => b.getBoundingClientRect().width).map(b => b.getAttribute('aria-label') || b.innerText.trim()).join('/')`)); const ex = await find('.ink-pop button', '내보내기'); await tap(ex[0].x, ex[0].y); await sleep(500); R('  after 내보내기', (await L()) + ' items=' + await ev(`[...document.querySelectorAll('.ink-pop button')].filter(b => b.getBoundingClientRect().width).map(b => b.getAttribute('aria-label') || b.innerText.trim()).join('/')`)); await shot('qa-r2-ink-export2_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.4 }); await key('Escape'); await sleep(300); R('  Esc', await L()) })
await step('I5', async () => {
  const p0 = await cnt('pageItems'); await tool('테이프')
  setMode('pen'); await drag(300, 640, 700, 690, { steps: 8, stepMs: 14 }); await sleep(700); R('I5 tape items +', (await cnt('pageItems')) - p0)
  await shot('qa-r2-ink-tape_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.4 })
  setMode('touch'); await tap(500, 665); await sleep(600); await shot('qa-r2-ink-tape-peel_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.4 }); R('I5 tap tape', await L())
})
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)))
