// 손글씨 종이(태블릿 1180×820, 펜): 쓰기·닫고 다시 열기·두/세 손가락 탭·둥근 메뉴·쪽 서랍·내보내기·Esc 겹침·오므려 닫기
const R = (k, v) => print(k, typeof v === 'string' ? v : JSON.stringify(v))
const step = async (name, fn) => { try { await fn() } catch (e) { R(name + ' ERR', e.message) } }
const cnt = (store) => ev(`new Promise((ok) => { const q = indexedDB.open('gyeol'); q.onsuccess = () => { const t = q.result.transaction('${store}').objectStore('${store}').count(); t.onsuccess = () => { ok(t.result); q.result.close() } } })`)
const L = () => ev(`(() => { const v = (s) => [...document.querySelectorAll(s)].some(e => { const r = e.getBoundingClientRect(); return r.width > 2 && +getComputedStyle(e).opacity > 0.05 && !e.closest('[inert]') }); const o = { pie: v('.ink-pie'), drawer: v('[class*=ink-drawer]'), sel: v('[aria-label="고른 것"]'), pop: v('.ink-pop'), palette: v('.palette'), undo: v('[class*=undo], [aria-label*="되돌"]'), tape: v('[class*=tape-chip], [class*=ink-tape]'), canvas: v('.ink-canvas') }; return Object.keys(o).filter(k => o[k]).join('+') })()`)
const cv = async () => (await find('.ink-canvas'))[0]
const pen = async (x1, y1, x2, y2) => { setMode('pen'); await drag(x1, y1, x2, y2, { steps: 10, stepMs: 12, force: 0.6 }) }
const tapN = async (pts) => { await t('touchStart', pts); await sleep(60); await t('touchEnd', []); await sleep(500) }
await size(1180, 820, { touch: true }); await nav('/notes', 2500)
setMode('pen'); await tapSel('#stage button', '새 노트'); await sleep(1800)
let c = await cv(); R('canvas', c)
const s0 = await cnt('strokes')
await step('I1', async () => { await pen(c.x - 200, c.y - 100, c.x - 60, c.y - 60); await pen(c.x - 200, c.y, c.x - 40, c.y + 20); await pen(c.x - 200, c.y + 80, c.x - 20, c.y + 90); await sleep(800); R('I1 strokes +', (await cnt('strokes')) - s0) })
await shot('qa-r2-ink-written_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.5 })
await step('I3', async () => { const a = await cnt('strokes'); setMode('touch'); await tapN([[c.x + 100, c.y, 0], [c.x + 160, c.y, 1]]); await sleep(600); const b = await cnt('strokes'); await tapN([[c.x + 100, c.y, 0], [c.x + 160, c.y, 1], [c.x + 220, c.y, 2]]); await sleep(600); R('I3 2-finger undo / 3-finger redo strokes', [a, b, await cnt('strokes')]) })
await step('I4', async () => {
  setMode('pen'); await down(c.x + 150, c.y + 150); await sleep(750); R('I4 pen hold 750ms', await L()); await up(c.x + 150, c.y + 150); await sleep(300); R('  after lift', await L()); await key('Escape'); await sleep(300)
  setMode('touch'); await down(c.x + 150, c.y + 150); await sleep(600); R('I4 finger hold 600ms', await L()); await up(c.x + 150, c.y + 150); await sleep(300); await key('Escape'); await sleep(300)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x + 150, y: c.y + 150, button: 'right', buttons: 2, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x + 150, y: c.y + 150, button: 'right', buttons: 0, clickCount: 1 }); await sleep(400)
  R('I4 right click', await L()); await shot('qa-r2-ink-pie_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.5 }); await key('Escape'); await sleep(300); R('  Esc', await L())
})
await step('I7', async () => { setMode('mouse'); await key('g'); await sleep(500); R('I7 G', await L()); await shot('qa-r2-ink-drawer_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.5 }) })
await step('I9', async () => { await key('k', 4); await sleep(400); R('I9 +⌘K', await L()); await key('Escape'); await sleep(400); R('  Esc1', await L()); await key('Escape'); await sleep(400); R('  Esc2', await L()); await key('Escape'); await sleep(900); R('  Esc3', (await L()) + ' canvas=' + (await find('.ink-canvas')).length + ' path=' + (await st()).path) })
await step('I2', async () => { await nav('/notes', 2500); const [n] = await find('#stage li button:not(.notes-today-row)'); R('I2 first list item', n.t); await tap(n.x, n.y); await sleep(1800); R('I2 reopened canvas', (await find('.ink-canvas')).length + ' strokes total ' + await cnt('strokes')); await shot('qa-r2-ink-reopen_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.5 }) })
await step('I8', async () => { setMode('mouse'); await tapSel('.ink-tools [aria-label="더 보기"], [class*=ink] [aria-label="더 보기"]'); await sleep(400); const ex = await find('button', '내보내기'); R('I8 more menu has 내보내기', ex.length); if (ex[0]) { await tap(ex[0].x, ex[0].y); await sleep(400); R('  export pop', await ev(`[...document.querySelectorAll('.ink-pop button')].filter(b => b.getBoundingClientRect().width).map(b => b.getAttribute('aria-label') || b.innerText).join('/')`)) } await key('Escape'); await sleep(300); await key('Escape'); await sleep(300) })
await step('I10', async () => {
  c = await cv(); if (!c) { R('I10', 'no canvas'); return }
  setMode('touch'); await pinch(c.x, c.y, 300, 270); await sleep(900); R('I10 pinch 300→270 (90%) → canvas', (await find('.ink-canvas')).length)
  await pinch(c.x, c.y, 300, 180); await sleep(1200); R('I10 pinch 300→180 (60%) → canvas', (await find('.ink-canvas')).length + ' path=' + (await st()).path)
})
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)))
