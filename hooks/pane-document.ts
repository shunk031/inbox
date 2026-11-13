import type { UiScrollInput } from 'claude-code'
import { readDocument } from './document'
import type { DocumentFile } from './document'
import type { KeyAction } from './pane-keys'
import type { ActionView, RowView } from './rows'
import { conversation } from './mod-sessions'
import { paneState } from './mod-state'

const DOCUMENT_LINKS = /\b([a-z][a-z\d+.-]*)(\\*)(:|&#0*58;|&#x0*3a;|&colon;)|www(?=(?:\.|&#0*46;|&#x0*2e;|&period;))/gi
const ANGLE_AUTOLINK =
  /<(?=(?:[a-z][a-z\d+.-]*:|www(?:\.|&#0*46;|&#x0*2e;|&period;)|[^\s<>@]+@[^\s<>]+>|&#(?:\d+|x[\da-f]+);))/gi

export function safeDocumentMarkdown(text: string): string {
  return text
    .replace(/\](?=[(:])/g, ']\u200b')
    .replace(
      DOCUMENT_LINKS,
      (match, scheme: string | undefined, escaped: string | undefined, separator: string | undefined) =>
        scheme ? `${scheme}\u200b${escaped}${separator}` : match.replace(/^www/i, 'www\u200b'),
    )
    .replace(/:\/\//g, ':\u200b//')
    .replace(/@(?=[\w-]+(?:\.[\w-]+)+)/g, '@\u200b')
    .replace(ANGLE_AUTOLINK, '<\u200b')
}

let documentScrollBy: number | null = null
let documentScrollQueue: Promise<void> = Promise.resolve()

// The plugin API takes a target; its scroll event lets this action move one row.
export function scrollBy(by: number, scroll: () => Promise<unknown>) {
  const run = documentScrollQueue.then(async () => {
    documentScrollBy = by
    try {
      await scroll()
    } finally {
      documentScrollBy = null
    }
  })
  documentScrollQueue = run.catch(() => undefined)
  return run
}

export function adjustScroll(e: UiScrollInput): UiScrollInput {
  if (documentScrollBy === null || e.origin.kind !== 'plugin' || e.origin.name !== 'inbox') return e
  return {
    ...e,
    offset: Math.max(0, Math.min(e.contentRows - e.bodyRows, e.offset - e.by + documentScrollBy)),
  }
}

export async function showDocument(file: DocumentFile, row: RowView, redraw: () => Promise<unknown>) {
  if (!row.document) return
  const sessionId = conversation.id
  const document = { sessionId, title: row.title, text: null, error: null }
  paneState.document = document
  await redraw()
  const result = await readDocument(row.document, file)
  if (paneState.document !== document || conversation.id !== sessionId) return
  paneState.document = { ...document, ...result }
  await redraw()
}

export function clearDocument() {
  paneState.document = null
}

export function documentActions(
  file: DocumentFile,
  redraw: () => Promise<unknown>,
  scroll: (by: number) => Promise<unknown>,
) {
  const document = paneState.document?.sessionId === conversation.id ? paneState.document : null
  const close = () => {
    clearDocument()
    return redraw()
  }
  return {
    document,
    open: (row: RowView, action: ActionView, hotkey: string | undefined): KeyAction => ({
      key: `read-document-${row.id}`,
      label: action.label,
      hotkey,
      kind: 'view',
      emphasis: action.emphasis,
      isOut: action.isOut,
      onPress: () => void showDocument(file, row, redraw),
    }),
    close,
    back: (): KeyAction => ({
      key: 'document-back',
      label: 'Back to inbox',
      hotkey: 'b',
      kind: 'view',
      onPress: () => void close(),
    }),
    scroll: (by: number): KeyAction => ({
      key: `document-scroll-${by < 0 ? 'up' : 'down'}`,
      label: 'Scroll report',
      hotkey: by < 0 ? 'k' : 'j',
      kind: 'view',
      onPress: () => void scroll(by),
    }),
  }
}
