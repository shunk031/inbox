import type { JSX } from 'preact'
import { prMarkId } from '../../hooks/pr-rows'
import { timelinePage } from '../../hooks/timeline-page'
import type { TabView } from './core'
import { pendingLocal, act } from './tab-rows'
import { closingFolds, drawnRows, timelineFolded } from './tab-state'
import { outPending } from './tab-press'
import { closeTimelineDetail, openTimelineDetail, timelinePageOf, timelineRowForm, toggleTimelineFold } from './rows'

export function TimelineTab({ view }: { view: TabView }) {
  const page = timelinePageOf(view)
  const detail = page.selected
  const all = timelinePage(view.timeline, null, [], view.lastActions).rows
  const visible = new Map(page.rows.map(row => [row.task.id, row]))
  const hidden = new Set([...timelineFolded].filter(id => !closingFolds.has(`timeline-${id}`)))
  const children = (parentId: string | null) =>
    all.filter(row => row.task.parentId === parentId && !hidden.has(parentId ?? ''))
  const drawRow = (row: (typeof all)[number]): JSX.Element => {
    const id = `timeline:${row.task.id}`
    const track = drawnRows.get(id)?.track
    const selected = page.selected?.row.task.id === row.task.id
    const branchAction = visible.get(row.task.id)?.actions.find(action => action.action === 'toggle-branch')
    const form = timelineRowForm(row, visible.get(row.task.id))
    const isClosing = track?.state === 'closing' || track?.state === 'leaving'

    return (
      <section class={`timeline-tree-item${row.alternate ? ' alternate' : ''}`} key={row.task.id}>
        {form.ancestorGuides.map(depth => (
          <span
            key={`ancestor-${depth}`}
            class="timeline-tree-guide"
            style={{ '--timeline-guide-depth': depth } as JSX.CSSProperties}
            aria-hidden="true"
          />
        ))}
        {form.childGuide !== null ? (
          <span
            key="children"
            class="timeline-tree-guide timeline-child-guide"
            style={{ '--timeline-guide-depth': form.childGuide } as JSX.CSSProperties}
            aria-hidden="true"
          />
        ) : null}
        <div class={`row timeline-node${selected ? ' selected' : ''}${isClosing ? ' closing' : ''}`} data-motion={id}>
          <div class="content tight">
            <div class="timeline-task-line">
              <div class="timeline-task-title">
                <span class="muted timeline-tree-prefix">{`  ${form.prefix}`}</span>
                <span class={`timeline-task-mark tone-${row.tone}`}>{row.mark} </span>
                <button
                  type="button"
                  class={`timeline-title tone-${row.tone}${isClosing ? '' : ' timeline-title-link'}`}
                  disabled={isClosing}
                  onClick={() => openTimelineDetail(row.task.id)}
                >
                  {row.task.title}
                </button>
              </div>
              <div class="timeline-row-progress" aria-label={`${row.percent} complete`}>
                <span class="timeline-row-bar">
                  {(row.progressBar.length
                    ? row.progressBar
                    : [{ tone: 'muted' as const, mark: '─', count: 10, state: 'queued' as const }]
                  ).map((part, index) => (
                    <span class={`tone-${part.tone}`} key={`${row.task.id}-bar-${index}`}>
                      {part.mark.repeat(part.count)}
                    </span>
                  ))}
                </span>
                <span class={`timeline-percent tone-${row.tone}`}>{row.percent}</span>
              </div>
            </div>
            <div class="timeline-status-line">
              <span class={`timeline-chip tone-${row.tone}`}>{row.statusLabel}</span>
              {branchAction && !isClosing ? (
                <button type="button" class="key quiet" onClick={() => toggleTimelineFold(view, branchAction.id)}>
                  {hidden.has(branchAction.id) ? '▸' : '▾'}
                </button>
              ) : null}
            </div>
            {row.warnings.map((warning, index) => (
              <div class="warning" key={`${row.task.id}-warning-${index}`}>
                <span class="muted timeline-tree-prefix">{`${form.detailLead}⚠ `}</span>
                {warning}
              </div>
            ))}
          </div>
        </div>
        {row.hasChildren && !hidden.has(row.task.id) ? (
          <div class="timeline-children" data-motion={`closed-timeline-${row.task.id}`}>
            {children(row.task.id).map(drawRow)}
          </div>
        ) : null}
      </section>
    )
  }

  const progressCard = (
    <section class="timeline-progress-card">
      <div class="timeline-progress-head">
        <strong>Progress</strong>
        <span class={`timeline-chip tone-${page.progressCard.tone}`}>{page.progressCard.statusLabel}</span>
      </div>
      <div class="timeline-progress-line">
        <div class="timeline-progress-bar">
          {(page.progressCard.bar.length
            ? page.progressCard.bar
            : [{ tone: 'muted' as const, mark: '─', count: 28, state: 'queued' as const }]
          ).map((part, index) => (
            <span class={`tone-${part.tone}`} key={`progress-${index}`}>
              {part.mark.repeat(part.count)}
            </span>
          ))}
        </div>
        <strong>{page.progressCard.percentLabel}</strong>
      </div>
      <div class="timeline-progress-meta">
        <span>{`${page.progressCard.leavesDone}/${page.progressCard.leavesTotal} leaf tasks completed`}</span>
        <span>{`Elapsed: ${page.progressCard.elapsed}`}</span>
      </div>
    </section>
  )

  if (page.mode === 'detail' && detail) {
    return (
      <main class="status-page timeline-page timeline-detail-page">
        <header class="timeline-detail-head">
          <button type="button" class="key quiet" onClick={closeTimelineDetail}>
            ‹ Back
          </button>
          <h1>{detail.row.task.title}</h1>
          <span class={`timeline-chip tone-${detail.row.tone}`}>{detail.row.statusLabel}</span>
        </header>
        <div class="timeline-stat-grid">
          {(
            [
              ['Progress', detail.stats.progress],
              ['Weight', detail.stats.weight],
              ['Completed units', detail.stats.completedUnits],
            ] as const
          ).map(([label, value]) => (
            <section class="timeline-stat" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </section>
          ))}
        </div>
        <div class="timeline-detail-content">
          {detail.details.map((line, index) => (
            <section class="timeline-detail-section" key={`${line.label}-${index}`}>
              <strong>{line.label}</strong>
              {line.label === 'Links' ? (
                line.actions.map(link => {
                  const press = link.press
                  if (press.action !== 'pr-open') return null
                  const ref = press.ref
                  const pending = outPending(view, prMarkId(ref))
                  const isOpening =
                    link.result?.state === 'pending' || (pending?.is === 'local' && pending.result.state === 'pending')
                  return (
                    <span class="timeline-link" key={`${line.label}-${link.label}`}>
                      <button
                        type="button"
                        class="key"
                        disabled={link.isOut || isOpening}
                        onClick={() =>
                          void act(
                            prMarkId(ref),
                            press,
                            undefined,
                            pendingLocal({ kind: 'open', target: ref, name: link.label }),
                          )
                        }
                      >
                        {isOpening ? 'Opening…' : link.label}
                      </button>
                      {!isOpening && link.result?.state === 'done' ? <span class="tone-done">✓ Opened</span> : null}
                      {!isOpening && link.result?.state === 'failed' ? (
                        <span class="tone-error">{link.result.parts.find(part => part.error)?.error}</span>
                      ) : null}
                    </span>
                  )
                })
              ) : (
                <div class="timeline-detail-copy">
                  <span class="timeline-detail-prefix" aria-hidden="true">
                    {detail.row.detailLead}
                  </span>
                  {(line.label === 'History' ? line.text.split('\n') : [line.text]).map((text, index) => (
                    <p key={index}>{text}</p>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </main>
    )
  }

  return (
    <main class="status-page timeline-page">
      {progressCard}
      {page.isEmpty ? (
        <div class="empty">
          <h1>{page.empty.title}</h1>
          <p>{page.empty.hint}</p>
        </div>
      ) : (
        <div class="list timeline-list">{children(null).map(drawRow)}</div>
      )}
    </main>
  )
}
