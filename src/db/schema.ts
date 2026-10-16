/**
 * 결 — 로컬 데이터베이스 (Dexie 4 / IndexedDB). M0 최소 스키마.
 * 근거: team/architecture.md 6.2. 이후 버전은 db.version(n+1)로 올린다(기존 버전 줄은 지우지 않는다).
 *
 * 모든 시각은 epoch ms(number). 요일은 Date#getDay() 기준(0 = 일요일).
 *
 * M1 예고(아직 테이블 없음):
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

export class GyeolDB extends Dexie {
  subjects!: EntityTable<Subject, 'id'>
  courseSlots!: EntityTable<CourseSlot, 'id'>
  tasks!: EntityTable<Task, 'id'>
  notes!: EntityTable<Note, 'id'>
  cards!: EntityTable<Card, 'id'>
  focusSessions!: EntityTable<FocusSession, 'id'>
  dailyStats!: EntityTable<DailyStat, 'day'>
  meta!: EntityTable<Meta, 'key'>

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
