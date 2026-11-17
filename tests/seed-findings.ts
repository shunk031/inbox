import type { Closed, ClosedFinding, Finding, Ledger } from '../types'
import { raisesOnly, repeatsSubject, restates, sameAsk } from '../hooks/ask-match'
import { closeFinding } from '../hooks/ledger-close'

/** Builds historical ledger fixtures without exposing a finding creation path to a shipped host. */
export function addLegacyFinding(
  ledger: Ledger,
  finding: Omit<Finding, 'id'>,
): {
  ledger: Ledger
  id: string
  isAdded: boolean
  expired: Finding | null
  dismissed: ClosedFinding | Pick<Closed, 'id' | 'outcome'> | null
} {
  const sourceManaged =
    ledger.findings.find(f => f.sourceManaged && sameAsk(f.title, finding.title)) ??
    ledger.items.find(i => i.sourceManaged && restates(i.ask, finding.title))
  if (sourceManaged) return { ledger, id: sourceManaged.id, isAdded: false, expired: null, dismissed: null }

  const sameFinding = ledger.findings.find(f => sameAsk(f.title, finding.title))
  const same = sameFinding ?? ledger.items.find(i => restates(i.ask, finding.title))
  if (same) {
    const findings =
      finding.document && sameFinding
        ? ledger.findings.map(f =>
            f.id === same.id ? { ...f, document: finding.document, documentPreview: finding.documentPreview } : f,
          )
        : ledger.findings
    return {
      ledger: findings === ledger.findings ? ledger : { ...ledger, findings },
      id: same.id,
      isAdded: false,
      expired: null,
      dismissed: null,
    }
  }
  const dismissed =
    ledger.closedFindings.findLast(f => f.how === 'dismissed' && repeatsSubject(f.title, finding.title)) ??
    ledger.closed.findLast(c => c.how === 'dismissed' && raisesOnly(c.ask, finding.title)) ??
    null
  if (dismissed) return { ledger, id: dismissed.id, isAdded: false, expired: null, dismissed }
  const id = `f${ledger.nextId}`
  const ordinary = ledger.findings.filter(f => !f.feedOwned)
  const expired = ordinary.length >= 30 ? ordinary[0]! : null
  const room = expired ? closeFinding(ledger, expired.id, { how: 'expired', outcome: 'list full' }, finding.at) : ledger

  return {
    ledger: { ...room, findings: [...room.findings, { ...finding, id }], nextId: ledger.nextId + 1 },
    id,
    isAdded: true,
    expired,
    dismissed: null,
  }
}
