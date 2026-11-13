import { useEffect, useRef } from 'preact/hooks'
import { documentHtml } from './document-markdown'
import type { DocumentView } from './tab-state'

export function DocumentReader({ document, close }: { document: DocumentView; close: () => void }) {
  const reader = useRef<HTMLElement>(null)
  useEffect(() => reader.current?.focus(), [])

  return (
    <main class="document-reader" ref={reader} tabIndex={-1}>
      <header class="keys">
        <h1>{document.title}</h1>
        <button type="button" class="key ghost" onClick={close}>
          Back to inbox <kbd>b</kbd>
        </button>
      </header>
      {document.error ? (
        <p class="tone-error">{document.error}</p>
      ) : document.text === null ? (
        <p class="muted">Opening report…</p>
      ) : document.text ? (
        <div class="body" dangerouslySetInnerHTML={{ __html: documentHtml(document.text) }} />
      ) : null}
    </main>
  )
}
