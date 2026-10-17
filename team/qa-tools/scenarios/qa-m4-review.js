// M4 복습: 평가마다 FSRS due 변화 · reviewLogs +1 · 진행선 단조 · 같은 과목 연속 ≤ 3 · ✓ 길게 → 쉬움 · 끝 화면
const DB = (code) => ev(`new Promise((ok) => { const q = indexedDB.open('gyeol'); q.onsuccess = () => { const db = q.result; (${code})(db, (v) => { ok(v); db.close() }) } })`)
const all = (s) => `(db, done) => { const r = db.transaction('${s}').objectStore('${s}').getAll(); r.onsuccess = () => done(r.result) }`
const cards = async () => DB(`(db, done) => { const r = db.transaction('cards').objectStore('cards').getAll(); r.onsuccess = () => done(r.result.map(c => ({ id: c.id, f: String(c.front || '').slice(0, 14), s: c.subjectId, due: c.due, st: c.state, reps: c.reps }))) }`)
const logsN = async () => DB(`(db, done) => { const r = db.transaction('reviewLogs').objectStore('reviewLogs').count(); r.onsuccess = () => done(r.result) }`)
const face = () => ev(`(() => { const s = document.querySelector('.rv-stage'); const p = document.querySelector('.rv-prog'); const cs = p && getComputedStyle(p); return { t: s ? s.innerText.replace(/\\n+/g, ' / ').slice(0, 60) : null, prog: p ? (p.getAttribute('aria-valuenow') || cs.transform + '|' + cs.width + '|' + p.style.cssText) : null } })()`)
let C = await cards(); const pre = Object.fromEntries(C.map((c) => [c.id, c]))
const seq = []; const progs = []; const issues = []
let l0 = await logsN()
const pattern = ['3', '1', '3', '4', '2', 'hold', '3', '1']
for (let i = 0; i < 45; i++) {
  const f = await face(); if (!f.t) break
  const card = C.find((c) => c.f && f.t.includes(c.f.slice(0, 10)))
  if (!f.prog) { print('end at', i, f.t); break }
  progs.push(f.prog)
  seq.push(card ? card.s : '?')
  await key(' '); await sleep(350)
  const k = pattern[i % pattern.length]
  if (k === 'hold') {
    const ok = (await find('#stage button', '알았음'))[0]
    if (ok) { await m('mouseMoved', ok.x, ok.y); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ok.x, y: ok.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(750); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ok.x, y: ok.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300); if (i < 8) await shot('../m4-app/review-card-hold_1440x900', { q: 80 }); const e = (await find('#stage button', '쉬움'))[0]; if (e) await tap(e.x, e.y); else issues.push('hold: 쉬움 없음') }
  } else await key(k)
  await sleep(700)
  if (i === 1) await shot('../m4-app/review-card_1440x900', { q: 80 })
  const l1 = await logsN(); const C2 = await cards(); const after = card && C2.find((c) => c.id === card.id)
  if (card && after) { const ch = after.due !== card.due || after.reps !== card.reps; if (!ch) issues.push(`#${i} ${k}: due 그대로 ${card.f}`); if (l1 !== l0 + 1) issues.push(`#${i} ${k}: logs ${l0}→${l1}`) } else issues.push(`#${i}: 카드 못 찾음 '${f.t}'`)
  l0 = l1; C = C2
}
await sleep(800); const endF = await face(); await shot('../m4-app/review-end_1440x900', { q: 80 })
let run = 1, maxRun = 1; for (let i = 1; i < seq.length; i++) { run = seq[i] === seq[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run) }
print('cards seen', seq.length, 'maxSameSubjectRun', maxRun, 'subjects', seq.map((s) => String(s).slice(-4)).join(','))
print('progress', progs.slice(0, 40).join(' ; ').slice(0, 900))
print('issues', issues.slice(0, 12))
print('end face', endF, 'end buttons', (await find('#stage button')).map((b) => b.t).join('/'))
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)).slice(0, 5))
