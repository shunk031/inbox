import { DARK_BANNER_TINTS, DARK_TONES, LIGHT_BANNER_TINTS, LIGHT_TONES } from '../../hooks/tones'
import type { Style, Tone } from './panel'

/** The slice of omp's theme the panel's style uses. */
type OmpTheme = {
  isLight: boolean
  bold(text: string): string
  inverse(text: string): string
  underline(text: string): string
  fg(color: 'accent' | 'statusLineSep', text: string): string
}

type TimelineTone = 'done' | 'key' | 'error' | 'muted'

const ESC = '\x1b['

function rgbOf(hex: string): string {
  return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')
}

function truecolor(hex: string, text: string): string {
  return `${ESC}38;2;${rgbOf(hex)}m${text}${ESC}39m`
}

function truecolorFill(hex: string, text: string): string {
  return `${ESC}48;2;${rgbOf(hex)}m${text}${ESC}49m`
}

const TIMELINE_FILLS: Record<'dark' | 'light', Record<TimelineTone, string>> = {
  dark: { done: '#294431', key: '#2b3b57', error: '#4a2c33', muted: '#393939' },
  light: { done: '#e5f3e7', key: '#e9edff', error: '#f7e8eb', muted: '#e9e9e9' },
}

/** Maps the panel's styles onto omp's theme. The separator and the accent follow the theme; the tones follow `hooks/tones.ts`. */
export function styleOf(theme: OmpTheme, link?: Style['link']): Style {
  const tones = theme.isLight ? LIGHT_TONES : DARK_TONES
  const tints = theme.isLight ? LIGHT_BANNER_TINTS : DARK_BANNER_TINTS

  return {
    bold: theme.bold.bind(theme),
    dim: text => `${ESC}2m${text}${ESC}22m`,
    inverse: theme.inverse.bind(theme),
    underline: theme.underline.bind(theme),
    tone: (name: Tone, text) =>
      name === 'sep' || name === 'accent'
        ? theme.fg(name === 'sep' ? 'statusLineSep' : 'accent', text)
        : name === 'muted'
          ? `${ESC}2m${text}${ESC}22m`
          : truecolor(tones[name], text),
    timelineChip: (tone, text) =>
      truecolorFill(
        TIMELINE_FILLS[theme.isLight ? 'light' : 'dark'][tone],
        ` ${truecolor(tone === 'muted' ? (theme.isLight ? '#595959' : '#bdbdbd') : tones[tone], text)} `,
      ),
    timelineRow: (text, alternate) => (alternate ? truecolorFill(theme.isLight ? '#f4f4f4' : '#242424', text) : text),
    banner: (tone, part, text) =>
      part === 'line' ? truecolor(tints[tone].line, text) : truecolorFill(tints[tone].fill, text),
    ...(link ? { link } : {}),
  }
}
