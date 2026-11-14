import { describe, expect, test } from 'claude-code/testing'

import { fetchAccountPrs } from '../hooks/pr-fetch'
import { accountPrText, botPrSummaryText } from '../hooks/pr-rows'
import { emptySession } from '../hooks/session-files'
import { withFetchedPrs } from '../hooks/session-presses'
import { sessionView } from '../hooks/session-view'
import type { GhRun } from '../hooks/pr-fetch'
import { BLOCKED_PR } from './session-helpers'

const ownedPrs = [
  ['skills', 188],
  ['skills', 187],
  ['skills', 179],
  ['skills', 110],
  ['dotfiles', 808],
  ['dotfiles', 800],
  ['dotfiles-private', 253],
  ['dotfiles-private', 149],
].map(([name, number]) => ({
  author: { login: 'shunk031', type: 'User' },
  isDraft: number === 149,
  number,
  repository: { nameWithOwner: `shunk031/${name}` },
  title: `Open ${name} #${number}`,
}))

const renovatePrs = [837, 826, 815, 794, 780].map(number => ({
  author: { is_bot: false, login: 'shunk031-renovate[bot]', type: 'Bot' },
  number,
  repository: { nameWithOwner: 'shunk031/dotfiles' },
  title: `Update dependencies #${number}`,
}))

function runFor(own: unknown[], byOwner: Record<string, unknown[]>): { run: GhRun; calls: string[][] } {
  const calls: string[][] = []
  const run: GhRun = async args => {
    calls.push(args)
    if (args[0] === 'api' && args[1] === 'user') return { exitCode: 0, stdout: 'shunk031\n', stderr: '' }
    if (args[0] === 'api' && args[1] === 'user/orgs')
      return { exitCode: 0, stdout: 'creative-graphic-design\n', stderr: '' }
    if (args[0] === 'search' && args.includes('--author'))
      return { exitCode: 0, stdout: JSON.stringify(own), stderr: '' }
    if (args[0] === 'search' && args.includes('--owner')) {
      const owner = args[args.indexOf('--owner') + 1]!
      return { exitCode: 0, stdout: JSON.stringify(byOwner[owner] ?? []), stderr: '' }
    }
    return { exitCode: 2, stdout: '', stderr: `Unexpected gh args: ${args.join(' ')}` }
  }

  return { run, calls }
}

describe('fetchAccountPrs', () => {
  test('shows the 13 missed PRs as eight individual PRs and one five-PR Renovate summary', async () => {
    const { run, calls } = runFor(ownedPrs, { shunk031: [...ownedPrs, ...renovatePrs] })

    const result = await fetchAccountPrs(run)

    expect(result?.accountPrs.map(pr => pr.ref).sort()).toEqual(
      [
        'shunk031/skills#188',
        'shunk031/skills#187',
        'shunk031/skills#179',
        'shunk031/skills#110',
        'shunk031/dotfiles#808',
        'shunk031/dotfiles#800',
        'shunk031/dotfiles-private#253',
        'shunk031/dotfiles-private#149',
      ].sort(),
    )
    expect(result?.botPrSummaries).toEqual([{ name: 'Renovate', count: 5 }])

    const ownSearch = calls.find(args => args[0] === 'search' && args.includes('--author'))!
    expect(ownSearch).toContain('@me')
    expect(ownSearch).not.toContain('--owner')
    expect(
      calls.some(args => args[0] === 'search' && args.includes('--owner') && args.includes('creative-graphic-design')),
    ).toBe(true)
    expect(result?.accountPrs).toHaveLength(8)
    expect(result?.botPrSummaries.reduce((sum, bot) => sum + bot.count, 0)).toBe(5)
    const session = withFetchedPrs(emptySession(), {}, null, false, result!)
    const prsTab = sessionView(session, 1_000_000, 1000, false).prs
    expect(prsTab.accountPrs).toHaveLength(8)
    expect(prsTab.botPrSummaries).toEqual([{ name: 'Renovate', count: 5 }])
    expect(prsTab.accountPrs.map(accountPrText)).toContain('shunk031/skills#188 · Open skills #188')
    expect(prsTab.botPrSummaries.map(botPrSummaryText)).toEqual(['Renovate: 5 open PRs'])
  })

  test('keeps an account PR from another organization and groups bots by bot author', async () => {
    const crossOrg = {
      author: { login: 'shunk031', type: 'User' },
      isDraft: false,
      number: 537,
      repository: { nameWithOwner: 'creative-graphic-design/design-generators' },
      title: 'Account PR in an organization',
    }
    const dependabot = {
      author: { login: 'dependabot[bot]', type: 'Bot' },
      number: 11,
      repository: { nameWithOwner: 'creative-graphic-design/design-generators' },
      title: 'Bump a dependency',
    }
    const { run } = runFor([crossOrg], { shunk031: [], 'creative-graphic-design': [dependabot] })

    const result = await fetchAccountPrs(run)

    expect(result?.accountPrs.map(pr => pr.ref)).toEqual(['creative-graphic-design/design-generators#537'])
    expect(result?.botPrSummaries).toEqual([{ name: 'Dependabot', count: 1 }])
  })

  test('keeps detailed blocks for session-linked PRs without repeating them in the account list', () => {
    const ref = 'shunk031/dotfiles#808'
    const pr = {
      ...BLOCKED_PR,
      ref,
      number: 808,
      title: 'Linked PR detail',
      url: 'https://github.com/shunk031/dotfiles/pull/808',
    }
    const base = emptySession()
    const session = {
      ...base,
      ledger: { ...base.ledger, prs: [ref] },
      prViews: {
        ...base.prViews,
        views: { [ref]: pr },
        accountPrs: [{ ref, title: pr.title, url: pr.url, isDraft: false }],
      },
    }

    const prsTab = sessionView(session, 1_000_000, 1000, false).prs

    expect(prsTab.drawn.map(block => [block.pr.ref, block.pr.title])).toEqual([[ref, 'Linked PR detail']])
    expect(prsTab.accountPrs).toEqual([])
  })

  test('keeps the prior snapshot when any account-wide search fails', async () => {
    const run: GhRun = async args =>
      args[0] === 'api' && args[1] === 'user'
        ? { exitCode: 0, stdout: 'shunk031', stderr: '' }
        : args[0] === 'api'
          ? { exitCode: 0, stdout: 'creative-graphic-design', stderr: '' }
          : { exitCode: 1, stdout: '', stderr: 'search failed' }

    expect(await fetchAccountPrs(run)).toBeNull()
  })
})
