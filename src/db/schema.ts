/**
 * 결 — 로컬 데이터베이스 (Dexie 4 / IndexedDB). M0 최소 스키마.
 * 근거: team/architecture.md 6.2. 이후 버전은 db.version(n+1)로 올린다(기존 버전 줄은 지우지 않는다).
 *
 * 모든 시각은 epoch ms(number). 요일은 Date#getDay() 기준(0 = 일요일).
 *
 * v2(M2): noteBodies · links · memos · assets 추가, notes에 classKey·title 인덱스.
 *
 * v3(손글씨 라운드): pages · strokes · pageItems 추가.
 *
 * 이후 예고(아직 테이블 없음):
 *  - strokes: 'id, pageId, [pageId+layer], updatedAt'
 *    획 1개 = 행 1개, points는 ArrayBuffer(Float32: x, y, pressure, t).
 *    ※ 획의 '점마다' 절대 시각 t(ms)를 저장한다 — 녹음–필기 싱크(필기 되감기)용. 빼먹지 말 것.
 *  - pages / blocks / links / assets / reviewLogs / changeLog (architecture 6.2 그대로)
 */
import Dexie, { type EntityTable } from 'dexie'

/** 과목 색 토큰 이름 (tokens.css의 --s-*) */
export type SubjectColor = 'phys' | 'math' | 'chem' | 'bio' | 'econ' | 'writing' | 'eng' | 'hist'

export interface Subject {
  id: string
  name: string
  /** 짧은 이름 (렌즈 알약·칩) */
  short: string
  color: SubjectColor
  /** 자연어 파서가 알아듣는 별칭 */
  aliases: string[]
  order: number
  createdAt: number
  updatedAt: number
}

export interface CourseSlot {
  id: string
  subjectId: string
  /** 0 = 일요일 … 6 = 토요일 */
  weekday: number
  /** 'HH:MM' */
  start: string
  end: string
  room: string
  kind?: 'lecture' | 'lab'
  createdAt: number
  updatedAt: number
}

export type TaskKind = 'exam' | 'assignment' | 'quiz'

export interface Task {
  id: string
  subjectId: string | null
  kind: TaskKind
  title: string
  dueAt: number
  /** 0 = 남음, 1 = 끝 (Dexie 인덱스용 숫자) */
  done: 0 | 1
  createdAt: number
  updatedAt: number
}

export type NoteKind = 'ink' | 'doc' | 'pdf' | 'deck'

/** 노트 메타데이터만 (본문·획은 M1) */
export interface Note {
  id: string
  title: string
  subjectId: string | null
  kind: NoteKind
  /** PDF 등: 지금 쪽 / 전체 쪽 */
  page?: number
  pages?: number
  /** 필기 노트 미리보기용 짧은 발췌 (M0 표시용) */
  excerpt?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
  /** M2: 오늘 수업 노트면 '과목id|YYYY-MM-DD' (학습일 기준) */
  classKey?: string | null
  /** M2: 템플릿으로 만들었으면 그 이름 */
  template?: 'class' | 'concept' | null
}

export type CardState = 'new' | 'learning' | 'review' | 'relearning'

/** 복습 카드 (FSRS 필드는 M2에서 ts-fsrs로 채움. 지금은 due 등 최소) */
export interface Card {
  id: string
  subjectId: string
  noteId?: string | null
  /** 시험 범위 카드면 그 시험(Task) id */
  examId?: string | null
  front: string
  back: string
  due: number
  state: CardState
  reps: number
  lapses: number
  lastReview?: number | null
  createdAt: number
  updatedAt: number
}

export interface FocusSession {
  id: string
  subjectId: string | null
  plannedMs: number
  startedAt: number
  endedAt: number
  completed: boolean
  createdAt: number
}

/** 일별 롤업 (하루 경계 새벽 4시). day = 'YYYY-MM-DD' (학습일 기준) */
export interface DailyStat {
  day: string
  focusMin: number
  reviews: number
  topSubjectId: string | null
}

export interface Meta {
  key: string
  value: unknown
}

/* ---------- M2 (v2): 노트 본문 · 링크 · 1초 메모 · 첨부 ---------- */

/** 노트 본문 (목록 조회를 가볍게 하려고 notes와 나눔). doc = 편집기(ProseMirror) JSON */
export interface NoteBody {
  noteId: string
  doc: unknown
  /** 검색·발췌용 평문 (블록 사이 줄바꿈) */
  text: string
  /** 저장마다 +1 (가져오기·충돌 확인용) */
  version: number
  updatedAt: number
}

/** [[링크]] 한 개 = 행 하나. to가 null이면 아직 없는 노트(제목만 기억) */
export interface NoteLink {
  id: string
  from: string
  to: string | null
  toTitle: string
  createdAt: number
}

export type MemoState = 'inbox' | 'filed' | 'archived'

/** 1초 메모 (별가루). 밤에 노트·할 일·카드로 나눈다 */
export interface Memo {
  id: string
  text: string
  /** 사진 메모면 assets id */
  assetId?: string | null
  subjectId?: string | null
  state: MemoState
  /** 나눈 곳 */
  filedTo?: { type: 'note' | 'task' | 'card'; id: string } | null
  /** M3: 메모 종류 (없으면 'text'). 손글씨 메모는 pageId의 쪽에 획이 있다 */
  kind?: 'text' | 'check' | 'photo' | 'voice' | 'ink'
  /** M3: 체크리스트 줄 */
  items?: Array<{ id: string; text: string; done: boolean }> | null
  /** M3: 고정 (색인 없음 — 메모 수가 적어 메모리에서 정렬) */
  pinned?: boolean
  /** M3: 손글씨 메모의 쪽 (pages.noteId = 'memo:' + 메모 id) */
  pageId?: string | null
  /** M3: 음성 메모 길이(ms), 소리는 assetId */
  durationMs?: number | null
  createdAt: number
  updatedAt: number
}

/** 사진 등 첨부 (Blob) */
export interface Asset {
  id: string
  ownerId: string | null
  mime: string
  blob: Blob
  createdAt: number
}

/* ---------- v3 (손글씨 라운드): 페이지 · 획 · 페이지 위 물건 ---------- */

/** 쪽 배경 틀 */
export type PageTemplate = 'blank' | 'ruled' | 'grid' | 'dot' | 'cornell'

/** 필기·PDF 노트의 한 쪽. 크기는 pt(1/72in), A4 = 595×842 */
export interface Page {
  id: string
  noteId: string
  /** 노트 안 순서 (0부터, 정렬용 실수 허용: 사이에 끼우기) */
  index: number
  template: PageTemplate
  w: number
  h: number
  /** PDF 쪽이면 원본 파일(assets)과 쪽 번호(1부터) */
  pdf?: { assetId: string; pageNo: number } | null
  /** 종이 색 토큰 (없으면 기본 종이) */
  paper?: string | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export type InkTool = 'pen' | 'pencil' | 'marker' | 'highlighter' | 'tape'

/**
 * 획 1개 = 행 1개. points = Float32Array 버퍼 [x, y, pressure, t] 반복.
 * x·y는 쪽 좌표(pt), t는 획 시작부터 ms가 아니라 **절대 시각 epoch ms − createdAt** (녹음–필기 싱크용, 지우지 말 것).
 */
export interface Stroke {
  id: string
  pageId: string
  /** 'ink' 위, 'highlight'는 글 아래(곱하기) */
  layer: 'ink' | 'highlight'
  tool: InkTool
  /** '#RRGGBB' */
  color: string
  /** 기본 굵기(pt) */
  width: number
  points: ArrayBuffer
  /** [x0, y0, x1, y1] 쪽 좌표 */
  bbox: [number, number, number, number]
  /** 도형으로 바뀐 획이면 그 모양 (다시 고치기용) */
  shape?: { kind: 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle' | 'polyline'; params: number[] } | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

/** 쪽 위 물건: 사진 · 글 상자 · 가리개 테이프 */
export interface PageItem {
  id: string
  pageId: string
  kind: 'image' | 'text' | 'tape'
  x: number
  y: number
  w: number
  h: number
  rot: number
  assetId?: string | null
  /** 글 상자 내용 (평문) */
  text?: string | null
  /** 테이프: 가려진 상태인지 */
  hidden?: boolean
  /** 테이프: '헷갈림' 표시 (M4에서 복습 카드 후보로) */
  flag?: boolean
  z: number
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export class GyeolDB extends Dexie {
  subjects!: EntityTable<Subject, 'id'>
  courseSlots!: EntityTable<CourseSlot, 'id'>
  tasks!: EntityTable<Task, 'id'>
  notes!: EntityTable<Note, 'id'>
  cards!: EntityTable<Card, 'id'>
  focusSessions!: EntityTable<FocusSession, 'id'>
  dailyStats!: EntityTable<DailyStat, 'day'>
  meta!: EntityTable<Meta, 'key'>
  noteBodies!: EntityTable<NoteBody, 'noteId'>
  links!: EntityTable<NoteLink, 'id'>
  memos!: EntityTable<Memo, 'id'>
  assets!: EntityTable<Asset, 'id'>
  pages!: EntityTable<Page, 'id'>
  strokes!: EntityTable<Stroke, 'id'>
  pageItems!: EntityTable<PageItem, 'id'>

  constructor() {
    super('gyeol')
    this.version(1).stores({
      subjects: 'id, order',
      courseSlots: 'id, subjectId, weekday',
      tasks: 'id, subjectId, kind, dueAt, done',
      notes: 'id, subjectId, kind, updatedAt',
      cards: 'id, subjectId, due, examId, noteId, state',
      focusSessions: 'id, startedAt, endedAt, subjectId',
      dailyStats: 'day',
      meta: 'key',
    })
    // M2: 노트 본문·링크·메모·첨부. notes에 classKey('과목id|YYYY-MM-DD', 오늘 수업 노트 중복 막기)와 title 인덱스
    this.version(2).stores({
      notes: 'id, subjectId, kind, updatedAt, classKey, title',
      noteBodies: 'noteId, updatedAt',
      links: 'id, from, to, toTitle, [from+to]',
      memos: 'id, state, createdAt, subjectId',
      assets: 'id, ownerId, createdAt',
    })
    // v3 (손글씨 라운드): 쪽 · 획 · 쪽 위 물건
    this.version(3).stores({
      pages: 'id, noteId, [noteId+index], updatedAt',
      strokes: 'id, pageId, [pageId+layer], updatedAt',
      pageItems: 'id, pageId, updatedAt',
    })
  }
}

export const db = new GyeolDB()

/** 짧은 고유 id (ULID 대용, M0) */
export function uid(prefix = ''): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 18)
  return prefix + Date.now().toString(36) + rnd
}

/** 저장소 영구화 요청. 실패해도 조용히. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
