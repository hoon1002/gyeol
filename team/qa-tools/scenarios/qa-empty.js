// 빈 상태: 다른 출처(127.0.0.1)는 DB가 비어 있다 → 첫 실행 건너뛰기 → 장소 6곳 + 별가루함 + ⌘K
const B = 'http://127.0.0.1:5173'
logs()
for (const [w, h, touch] of [[1440, 900, false], [390, 844, true]]) {
  await size(w, h, { touch }); setMode(touch ? 'touch' : 'mouse')
  await nav(B + '/', 3000)
  const sk = await find('.onb-corner button'); print('corner', sk.map((b) => b.t).join('/')); if (sk.length) { const b = sk[sk.length - 1]; await tap(b.x, b.y); await sleep(1800) }
  for (const p of ['/', '/notes', '/map', '/review', '/plan', '/focus']) {
    await nav(B + p, 2600)
    const t = await ev(`(() => { const s = document.querySelector('#stage'); const txt = [...s.querySelectorAll('h1,h2,p,button,li,span')].filter(e => { const r = e.getBoundingClientRect(); return r.width && !e.closest('[inert],[aria-hidden=true]') && +getComputedStyle(e).opacity > 0.05 }).map(e => (e.getAttribute('aria-label') || e.innerText || '').trim()).filter(Boolean); const bad = /NaN|undefined|Invalid|null|\\[object/.test(s.innerText); return [...new Set(txt)].slice(0, 10).join(' / ').slice(0, 220) + (bad ? '  ⚠ ' + s.innerText.match(/.{0,20}(NaN|undefined|Invalid|null|\\[object).{0,20}/)[0] : '') })()`)
    print(`${w} ${p}: ${t}`)
    await shot(`qa-empty${p === '/' ? '-today' : p.replace('/', '-')}_${w}x${h}`, { clip: { x: 0, y: 0, width: w, height: h }, scale: 0.5 })
  }
  await key('k', 4); await sleep(500)
  print(`${w} ⌘K empty: ` + await ev(`(document.querySelector('.palette')?.innerText || '').replace(/\\n+/g, ' / ').slice(0, 160)`))
  await key('Escape'); await sleep(300)
}
setMode('mouse'); await size(1440, 900)
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)))
