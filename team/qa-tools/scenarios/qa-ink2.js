// 종이 기능: 둥근 메뉴(펜 600·손가락 450·오른쪽 클릭) · 쪽 서랍 G · Esc 겹침 · 내보내기 · 테이프 · 올가미 · 다시 열기
const R = (k, v) => print(k, typeof v === 'string' ? v : JSON.stringify(v))
const step = async (name, fn) => { try { await fn() } catch (e) { R(name + ' ERR', e.message) } }
const cnt = (store) => ev(`new Promise((ok) => { const q = indexedDB.open('gyeol'); q.onsuccess = () => { const t = q.result.transaction('${store}').objectStore('${store}').count(); t.onsuccess = () => { ok(t.result); q.result.close() } } })`)
const L = () => ev(`(() => { const v = (s) => [...document.querySelectorAll(s)].some(e => { const r = e.getBoundingClientRect(); return r.width > 2 && +getComputedStyle(e).opacity > 0.05 && !e.closest('[inert]') }); const o = { pie: v('.ink-pie'), drawer: v('[class*=ink-drawer]'), sel: v('[aria-label="고른 것"]'), pop: v('.ink-pop'), palette: v('.palette'), canvas: v('.ink-canvas') }; return Object.keys(o).filter(k => o[k]).join('+') })()`)
const open = async () => { await nav('/notes', 2500); const [n] = await find('#stage li button:not(.notes-today-row)'); setMode('mouse'); await tap(n.x, n.y); await sleep(1800) }
await size(1180, 820, { touch: true }); await open()
await step('I4', async () => {
  setMode('pen'); await down(800, 500); await sleep(700); R('I4 pen hold 700ms', await L()); await up(800, 500); await sleep(300); R('  lift', await L()); await key('Escape'); await sleep(300); R('  Esc', await L())
  setMode('touch'); await t('touchStart', [[800, 500, 0]]); await sleep(520); R('I4 finger hold 520ms', await L()); await t('touchEnd', []); await sleep(300); await key('Escape'); await sleep(300)
  setMode('mouse'); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 500, button: 'right', buttons: 2, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 500, button: 'right', buttons: 0, clickCount: 1 }); await sleep(400)
  R('I4 right click', await L()); R('  pie items', await ev(`[...document.querySelectorAll('.ink-pie button')].map(b => b.getAttribute('aria-label') || b.innerText).join('/')`))
  await shot('qa-r2-ink-pie_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.5 }); await key('Escape'); await sleep(300); R('  Esc', await L())
})
await step('I9', async () => {
  setMode('pen'); await drag(300, 250, 420, 300, { steps: 8, stepMs: 12 }); await sleep(300)
  setMode('mouse'); await tapSel('[aria-label="올가미"]'); await sleep(200)
  setMode('pen'); await down(270, 220); for (const [x, y] of [[460, 220], [460, 330], [270, 330], [270, 225]]) { await move(x, y); await sleep(30) } await up(270, 225); await sleep(500)
  R('I6 lasso → ', await L())
  const before = await ev(`document.querySelector('[aria-label="고른 것"]')?.getBoundingClientRect().x`)
  await drag(360, 275, 560, 375, { steps: 10, stepMs: 14 }); await sleep(600)
  R('I6 drag selection moved by', Math.round((await ev(`document.querySelector('[aria-label="고른 것"]')?.getBoundingClientRect().x`) ?? 0) - (before ?? 0)))
  setMode('mouse'); await key('g'); await sleep(500); R('I7 G', await L())
  await key('k', 4); await sleep(400); R('I9 +⌘K', await L())
  for (let i = 1; i <= 4; i++) { await key('Escape'); await sleep(500); R('  Esc' + i, await L()) }
})
await open()
await step('I8', async () => { setMode('mouse'); await tapSel('[class*=ink] [aria-label="더 보기"]'); await sleep(400); R('I8 more', await ev(`[...document.querySelectorAll('.ink-pop button')].filter(b => b.getBoundingClientRect().width).map(b => b.getAttribute('aria-label') || b.innerText).join('/')`)); const ex = await find('.ink-pop button', '내보내기'); if (ex[0]) { await tap(ex[0].x, ex[0].y); await sleep(400); R('  export', await ev(`[...document.querySelectorAll('.ink-pop button, .ink-pop [role=menuitem]')].filter(b => b.getBoundingClientRect().width).map(b => b.getAttribute('aria-label') || b.innerText).join('/')`)); await shot('qa-r2-ink-export_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.5 }) } await key('Escape'); await sleep(300); R('  Esc', await L()) })
await step('I5', async () => {
  const p0 = await cnt('pageItems'); setMode('mouse'); await tapSel('[aria-label="테이프"]'); await sleep(200)
  setMode('pen'); await drag(300, 520, 520, 560, { steps: 8, stepMs: 14 }); await sleep(600); R('I5 tape items +', (await cnt('pageItems')) - p0)
  setMode('touch'); await tap(410, 540); await sleep(500); await shot('qa-r2-ink-tape-peel_1180x820', { clip: { x: 0, y: 0, width: 1180, height: 820 }, scale: 0.5 }); R('I5 tap tape → canvas', await L())
})
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)))
