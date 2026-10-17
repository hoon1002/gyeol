// 집중: 시작 → 다른 장소 → 돌아옴 → 탭 숨김 6초 → 멈춤 → 이어서 → 끝
await size(1440, 900); setMode('mouse'); await nav('/focus', 3000)
const out = []
const T = () => ev(`(() => { const s = document.querySelector('#stage'); const t = s.innerText.match(/\\d{1,2}:\\d{2}/g); return (t || []).join(',') + ' | ' + [...s.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width && !b.closest('[inert]')).map(b => (b.getAttribute('aria-label') || b.innerText || '').trim()).join('/') })()`)
out.push('idle: ' + await T())
const [b] = await find('#stage button', '^시작|집중 시작')
if (b) { await tap(b.x, b.y); await sleep(2200) }
out.push('started +2s: ' + await T())
out.push('rail visible while running: ' + JSON.stringify(await find('[aria-label="오늘"]')))
await key('k', 4); await sleep(300); await insert('오늘'); await sleep(300); await key('Enter'); await sleep(2500)
out.push('went: ' + (await st()).path)
await key('k', 4); await sleep(300); await insert('집중'); await sleep(300); await key('Enter'); await sleep(3000)
out.push('away 2.5s, back +3s: ' + await T())
const nt = await send('Target.createTarget', { url: 'about:blank' }); await sleep(6000)
await send('Target.closeTarget', { targetId: nt.targetId }); await send('Page.bringToFront'); await sleep(1200)
out.push('hidden 6s, back: ' + await T())
await shot('qa-focus-running_1440x900', { clip: { x: 0, y: 0, width: 1440, height: 900 }, scale: 0.5 })
const [p] = await find('#stage button', '일시정지|멈춤')
if (p) { await tap(p.x, p.y); await sleep(2500); out.push('paused +2.5s: ' + await T()); const [r] = await find('#stage button', '이어|계속|재개|시작'); if (r) { await tap(r.x, r.y); await sleep(1200); out.push('resumed: ' + await T()) } }
const [e] = await find('#stage button', '끝|그만|종료|마치')
if (e) { await tap(e.x, e.y); await sleep(1500); out.push('ended: ' + await T()) }
print(out.join('\n'))
print(logs().filter((l) => !/Failed to load resource/.test(l.text)))
