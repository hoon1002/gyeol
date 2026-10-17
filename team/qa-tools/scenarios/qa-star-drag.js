// 사용자 버그 재현: 오늘에서 별 누르기 → 다가감 → 빈 하늘 끌기(회전) → 떼기 → 별 패널/다가감이 유지돼야 한다
// curl -s --data-binary @team/qa-tools/scenarios/star-drag.js 127.0.0.1:9387
const cases = [
  { name: 'desk-mouse', w: 1440, h: 900, touch: false, mode: 'mouse' },
  { name: 'tab-pen', w: 1180, h: 820, touch: true, mode: 'pen' },
  { name: 'phone-touch', w: 390, h: 844, touch: true, mode: 'touch' },
]
for (const c of cases) {
  await size(c.w, c.h, { touch: c.touch })
  setMode('mouse')
  await nav('/', 2500)
  setMode(c.mode)
  const list = (await stars(40, 30)).filter((s) => /^today:|seed-focus|^seed-task/.test(s.id))
  const s = list[0]
  if (!s) { print(c.name, 'no star', await stars()); continue }
  await tap(s.x, s.y)
  await sleep(1500)
  const a = await st()
  // 빈 하늘 찾기: 별에서 먼 곳
  const ex = c.w < 600 ? [60, 200, 300, 260] : [c.w - 160, 140, c.w - 40, 260]
  await drag(ex[0], ex[1], ex[2], ex[3], { steps: 14, stepMs: 20 })
  await sleep(1200)
  const b = await st()
  await shot(`star-drag-${c.name}_${c.w}x${c.h}`)
  // 짧게 움직인 누르기(4px) — 탭으로 봐야 함(닫힘이 맞음)
  print(c.name, 'star', s.id, s.x, s.y, '| after press:', a.star, a.focus, '| after drag:', b.star, b.focus)
}
setMode('mouse')
