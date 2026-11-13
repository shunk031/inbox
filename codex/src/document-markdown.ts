import createDOMPurify from 'dompurify'
import { marked, Renderer } from 'marked'

const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function documentHtml(text: string): string {
  const renderer = new Renderer()
  renderer.html = token => escapeText(token.text)
  renderer.image = token => escapeText(token.text)
  renderer.link = function ({ tokens }) {
    return this.parser.parseInline(tokens)
  }

  return createDOMPurify(window).sanitize(marked.parse(text, { renderer, async: false }))
}
