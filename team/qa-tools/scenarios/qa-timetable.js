// 시간표: 겹치게 그리기, 아주 짧은 끌기, 격자 아래로 넘기기
await size(1440, 900); setMode('mouse'); await nav('/plan', 2500)
const out = []
const slots = () => ev(`[...document.querySelectorAll('.tt-slot')].map(e => { const r = e.getBoundingClientRect(); return e.innerText.split('\\n')[0] + '@' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.height) })`)
const pop = () => ev(`(() => { const p = document.querySelector('[class*=tt-pop], [class*=slot-pop], [role=dialog]'); if (!p) return null; const r = p.getBoundingClientRect(); return { t: p.innerText.replace(/\\n+/g, '/').slice(0, 80), r: [r.x, r.y, r.width, r.height].map(Math.round), vh: innerHeight } })()`)
const n0 = (await slots()).length
// T1: 월요일 빈 칸(270)에서 위로 글쓰기(215–262) 안까지
await drag(540, 300, 540, 228, { steps: 10 }); await sleep(400)
out.push('T1 overlap draw → pop=' + JSON.stringify(await pop()))
await type('QA겹침', 10); await key('Enter'); await sleep(600)
const s1 = await slots(); out.push(`  slots ${n0}→${s1.length} ` + s1.filter((s) => /QA|글쓰기/.test(s)).join(' '))
await shot('qa-tt-overlap_1440x900', { clip: { x: 440, y: 60, width: 920, height: 440 } })
// T2: 3px 끌기
await drag(910, 300, 910, 303, { steps: 2 }); await sleep(400)
out.push('T2 3px drag → pop=' + JSON.stringify(await pop()))
await key('Escape'); await sleep(300)
// T3: 금요일, 격자 아래 넘어서
await drag(1040, 430, 1040, 700, { steps: 12 }); await sleep(400)
out.push('T3 past bottom → pop=' + JSON.stringify(await pop()))
await type('QA밤', 10); await key('Enter'); await sleep(600)
out.push('  ' + (await slots()).filter((s) => /QA밤/.test(s)).join(' ') + ' grid=' + JSON.stringify(await ev(`(() => { const g = document.querySelector('.tt-grid').getBoundingClientRect(); return [Math.round(g.y), Math.round(g.height)] })()`)))
await shot('qa-tt-bottom_1440x900', { clip: { x: 0, y: 0, width: 1440, height: 900 }, scale: 0.5 })
print(out.join('\n'))
print(logs().filter((l) => !/Failed to load resource/.test(l.text)))
