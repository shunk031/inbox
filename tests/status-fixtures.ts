export const DEFAULT_STATUS_REPLY = 'UNCHANGED'

function unchangedStatusReply(prompt: string): string {
  const head = /<head>\n([^\n]+)\n<\/head>/.exec(prompt)?.[1]
  return head && head !== '(none yet)' ? `HEAD: ${head}` : 'HEAD: Current work | Continuing the current work'
}

export function defaultStatusReply(prompt: string): string {
  return prompt.startsWith('The turn is still running.') ? 'UNCHANGED' : unchangedStatusReply(prompt)
}
