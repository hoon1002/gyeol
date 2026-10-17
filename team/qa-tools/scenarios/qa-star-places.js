// 지도·집중·복습·계획에서 별 누르기 → 빈 하늘 끌기 → 휠 → 상태
await size(1440, 900); setMode('mouse')
for (const p of ['/map', '/focus', '/review', '/plan']) {
  await nav(p, 3500)
  const list = await stars(36, 28)
  const s = list.find((x) => x.x > 500 && x.x < 1350 && x.y > 120 && x.y < 800)
  if (!s) { print(p, 'no star', list.length); continue }
  await tap(s.x, s.y); await sleep(1600)
  const a = await st()
  await drag(1380, 120, 1250, 220, { steps: 14 }); await sleep(1000)
  const b = await st()
  await wheel(1300, 160, 100, 3); await sleep(800)
  const c = await st()
  await shot(`star-place${p.replace('/', '-')}_1440x900`, { clip: { x: 0, y: 0, width: 1440, height: 900 }, scale: 0.5 })
  print(p, s.layer, s.id, '| press:', a.star, a.focus, '| drag:', b.star, '| wheel:', c.star)
  await key('Escape'); await sleep(800)
}
print(logs().filter((l) => !/Failed to load resource/.test(l.text)))
