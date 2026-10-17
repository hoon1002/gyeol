// M4 후보: 글 노트에 규칙 3종 → 2초 뒤 후보 · 받기 → 카드 · 버리기 → 다시 저장해도 안 생김 · 5초 되돌리기
const R = (k, v) => print(k, typeof v === 'string' ? v : JSON.stringify(v))
const DB = (code) => ev(`new Promise((ok) => { const q = indexedDB.open('gyeol'); q.onsuccess = () => { const db = q.result; (${code})(db, (v) => { ok(v); db.close() }) } })`)
const cands = () => DB(`(db, done) => { const r = db.transaction('cardCandidates').objectStore('cardCandidates').getAll(); r.onsuccess = () => done(r.result.map(c => ({ id: c.id.slice(-6), st: c.status, f: String(c.front || '').slice(0, 16), b: String(c.back || '').slice(0, 16), k: c.kind || c.rule || c.source }))) }`)
const ncards = () => DB(`(db, done) => { const r = db.transaction('cards').objectStore('cards').count(); r.onsuccess = () => done(r.result) }`)
await size(1440, 900); setMode('mouse'); await nav('/notes', 2500)
const c0 = (await cands()).length
await tapSel('#stage button', '새 노트'); await sleep(1500)
await insert('QA 광합성 노트'); await sleep(200)
const [ed] = await find('.ProseMirror'); await tap(ed.x, ed.y); await sleep(200)
await type('광합성 :: 빛으로 양분을 만드는 과정', 5); await key('Enter')
await type('{{미토콘드리아}}는 세포의 발전소', 5); await key('Enter')
await type('엽록체는 **틸라코이드**를 가진다', 5); await sleep(3000)
const C1 = await cands(); R('후보 after 3s', C1.slice(c0))
await shot('../m4-app/candidates-note_1440x900', { q: 80 })
await key('k', 4); await sleep(300); await insert('후보'); await sleep(400); await key('Enter'); await sleep(1200)
R('후보함 open', (await st()).path + ' ' + await ev(`[...document.querySelectorAll('#stage [class*=cand] li, #stage [class*=cand-row], #stage li')].filter(e => e.getBoundingClientRect().width).slice(0, 6).map(e => e.innerText.replace(/\\n+/g, '/').slice(0, 40)).join(' | ')`))
await shot('../m4-app/candidates-box_1440x900', { q: 80 })
const n0 = await ncards()
await key('ArrowDown'); await sleep(150); R('focus', (await st()).focus)
await key('a'); await sleep(900); R('받기 A → cards +', (await ncards()) - n0)
await key('x'); await sleep(900); const C2 = await cands(); R('버리기 X → statuses', C2.slice(c0).map((c) => c.st + ':' + c.f))
R('undo btn', JSON.stringify(await find('button', '되돌리기')))
const u = (await find('button', '되돌리기'))[0]; if (u) { await tap(u.x, u.y); await sleep(800); R('되돌리기 → statuses', (await cands()).slice(c0).map((c) => c.st + ':' + c.f)) }
await sleep(5500); R('6s later undo still?', (await find('button', '되돌리기')).length)
// 버린 것 다시 저장해도 안 생기나: 다시 버리고 노트 고침
await nav('/notes', 2500); const [it] = await find('#stage li button:not(.notes-today-row)', 'QA 광합성'); if (it) { await tap(it.x, it.y); await sleep(1200); const [e2] = await find('.ProseMirror'); await tap(e2.x, e2.y + e2.h / 2); await key('End', 4); await type(' 추가', 5); await sleep(3000) }
R('after re-save', (await cands()).slice(c0).map((c) => c.st + ':' + c.f))
print(logs().filter((l) => !/Failed to load resource|\[vite\]/.test(l.text)).slice(0, 5))
