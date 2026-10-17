// 재시험 묶음: #11 #12 #13 #14 #18 · 오늘의 별(today:N) 누르기 · #6 #7 #17 #19(빈 출처)
const R = (k, v) => print(k, typeof v === 'string' ? v : JSON.stringify(v))
await size(1440, 900); setMode('mouse')
// #12 별가루함 Esc 포커스
await nav('/', 2500)
await tapSel('[aria-label^="별가루"]').catch(() => null); await sleep(600); await key('Escape'); await sleep(500)
R('#12 dust Esc focus', (await st()).focus)
// #13 .ics Esc 포커스
await nav('/plan', 2500); await tapSel('#stage button[aria-label="더 보기"]'); await sleep(300)
const doc = await send('DOM.getDocument', { depth: 1 })
const { nodeId } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })
await send('DOM.setFileInputFiles', { nodeId, files: [process.cwd() + '/team/test-timetable.ics'] }); await sleep(1000)
await key('Escape'); await sleep(500); R('#13 ics Esc focus', (await st()).focus)
// #18 커서
await nav('/', 2500); await m('mouseMoved', 1300, 200); await sleep(200)
const c1 = await ev(`getComputedStyle(document.elementFromPoint(1300, 200)).cursor`)
await down(1300, 200); await move(1330, 230); await move(1350, 250); await sleep(80)
R('#18 cursor sky/drag', c1 + ' / ' + await ev(`getComputedStyle(document.elementFromPoint(1350, 250)).cursor`)); await up(1350, 250); await sleep(300)
// 오늘의 별 today:N 누르기
await nav('/', 2800)
const ts = (await stars(30, 24)).filter((s) => /^today:/.test(s.id))
if (ts[0]) { await tap(ts[0].x, ts[0].y); await sleep(1400); R('today:N press', ts[0].id + ' → star=' + (await st()).star + ' hover=' + await ev(`(() => { return document.documentElement.classList.contains('star-hover') })()`)); await key('Escape'); await sleep(800) }
// #11 집중 중 오늘 · #14 끝내기 포커스
await nav('/focus', 2500)
const sb = await find('#stage button', '^시작$'); if (sb[0]) { await tap(sb[0].x, sb[0].y); await sleep(1500) }
await nav('/', 2500)
R('#11 today while running', await ev(`[...document.querySelectorAll('#stage button, #stage h1, #stage p')].filter(e => e.getBoundingClientRect().width && !e.closest('[inert]')).map(e => (e.getAttribute('aria-label') || e.innerText).trim().slice(0, 24)).join(' / ')`))
await nav('/focus', 2500); await tapSel('#stage button', '일시정지'); await sleep(400); await tapSel('#stage button', '끝내기'); await sleep(1200)
R('#14 after 끝내기 focus', (await st()).focus)
// 빈 출처: #6 #7 #19
const O = 'http://127.0.0.1:5173'
await send('Storage.clearDataForOrigin', { origin: O, storageTypes: 'all' })
await nav(O + '/', 3500)
const seen = []
for (let i = 0; i < 12; i++) { await key('Tab'); seen.push(await ev(`(() => { const a = document.activeElement; let o = 1, e = a; while (e && e !== document.body) { o *= +getComputedStyle(e).opacity; e = e.parentElement } return (a.getAttribute('aria-label') || a.innerText || a.tagName).trim().slice(0, 8) + (o < 0.05 ? '(투명)' : '') + (a.closest('.onb, .onb-layer') ? '' : '(뒤)') })()`)) }
R('#6 onb tab', seen.join(' → '))
const smp = (await find('.onb-corner button')).find((b) => /샘플/.test(b.t)); await tap(smp.x, smp.y)
const marks = []; for (let i = 0; i < 24; i++) { await sleep(250); marks.push(await ev(`document.querySelector('.onb') ? 1 : 0`)) }
R('#7 onb visible/250ms', marks.join(''))
await send('Storage.clearDataForOrigin', { origin: O, storageTypes: 'all' })
await nav(O + '/', 3500); const sk = (await find('.onb-corner button')).find((b) => /건너/.test(b.t)); await tap(sk.x, sk.y); await sleep(1500)
await nav(O + '/plan', 2500); R('#19 plan', await ev(`document.querySelector('#stage').innerText.slice(0, 40).replace(/\\n+/g, ' / ')`))
await nav(O + '/review', 2500); R('#19 review', await ev(`document.querySelector('#stage').innerText.slice(0, 40).replace(/\\n+/g, ' / ')`))
// #17 개발용 dry 모드 샘플
await nav('/?onboarding=1', 3500)
const d = (await find('.onb-corner button')).find((b) => /샘플/.test(b.t)); if (d) { await tap(d.x, d.y); let k = 0; for (; k < 40; k++) { await sleep(250); if (!(await ev(`!!document.querySelector('.onb')`))) break } R('#17 dry sample closes after', k * 250 + 'ms') }
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)))
