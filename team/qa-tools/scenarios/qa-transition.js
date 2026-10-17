// 전환 도중 입력: 비행 중 다른 장소, 빠른 연타, 비행 중 크기·테마·⌘K, 뒤로·앞으로
await size(1440, 900); setMode('mouse'); await nav('/', 3000)
const out = { push: (x) => print(x) }
const rail = async (label) => { const [b] = await find(`[aria-label="${label}"]`); await tap(b.x, b.y, { hold: 30, after: 0 }) }
const shown = () => ev(`(() => { const s = document.querySelector('#stage'); const vis = [...s.children].filter(c => { const cs = getComputedStyle(c); return +cs.opacity > 0.05 && cs.visibility !== 'hidden' && c.getBoundingClientRect().height > 0 && !c.closest('[inert]') }).map(c => c.className.split(' ')[0]); return location.pathname + ' visible=' + vis.join(',') })()`)
// 1) 비행 중 다른 장소
await rail('지도'); await sleep(400); await rail('복습'); await sleep(3500)
out.push('map→(0.4s)review: ' + await shown())
// 2) 빠른 연타 6곳
for (const l of ['노트', '지도', '복습', '계획', '집중', '오늘']) await rail(l)
await sleep(300); out.push('rapid 6 (+0.3s): ' + await shown())
await sleep(3500); out.push('rapid 6 (+3.8s): ' + await shown())
await shot('qa-trans-rapid_1440x900', { clip: { x: 0, y: 0, width: 1440, height: 900 }, scale: 0.5 })
// 3) 비행 중 크기 바꾸기
await rail('집중'); await sleep(500); await size(820, 1180, { touch: true }); await sleep(3500)
out.push('resize mid-flight → ' + await shown() + ' ring=' + JSON.stringify(await ev(`(() => { const r = document.querySelector('svg circle, .focus-ring, [class*=ring]'); if (!r) return null; const b = r.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round) })()`)))
await shot('qa-trans-resize-focus_820x1180', { clip: { x: 0, y: 0, width: 820, height: 1180 }, scale: 0.5 })
await size(1440, 900); await sleep(1500)
// 4) 비행 중 ⌘K → Esc
await rail('노트'); await sleep(300); await key('k', 4); await sleep(500); await key('Escape'); await sleep(3000)
out.push('cmdK mid-flight → ' + await shown())
// 5) 뒤로 · 앞으로 빠르게
await send('Runtime.evaluate', { expression: 'history.back()' }); await sleep(250)
await send('Runtime.evaluate', { expression: 'history.back()' }); await sleep(250)
await send('Runtime.evaluate', { expression: 'history.forward()' }); await sleep(3500)
out.push('back,back,forward → ' + await shown())
// 6) 비행 중 테마 바꾸기 (설정 시트에서 낮/밤)
await key(',', 4); await sleep(500)
const th = await find('.settings-sheet button, .settings-sheet [role=radio], .settings-sheet label')
print('theme controls: ' + th.map((b) => b.t).filter((t) => /낮|밤|밝|어둡|자동|테마/.test(t)).join('/'))
const day = th.find((b) => /^낮|밝/.test(b.t))
await key('Escape'); await sleep(400)
if (day) {
  await rail('지도'); await sleep(250); await key(',', 4); await sleep(200)
  const d2 = (await find('.settings-sheet button, .settings-sheet [role=radio], .settings-sheet label')).find((b) => /^낮|밝/.test(b.t))
  await tap(d2.x, d2.y); await sleep(150); await key('Escape'); await sleep(3500)
  out.push('theme mid-flight → ' + await shown() + ' theme=' + await ev(`document.documentElement.dataset.theme || document.documentElement.className`))
  await shot('qa-trans-theme_1440x900', { clip: { x: 0, y: 0, width: 1440, height: 900 }, scale: 0.5 })
  await key(',', 4); await sleep(400)
  const n2 = (await find('.settings-sheet button, .settings-sheet [role=radio], .settings-sheet label')).find((b) => /^밤|어둡/.test(b.t))
  if (n2) await tap(n2.x, n2.y)
  await sleep(200); await key('Escape'); await sleep(500)
}
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)))
