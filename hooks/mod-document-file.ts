import { documentBytes } from './document'
import type { DocumentFile } from './document'

type Stat = (path: string) => Promise<{ realPath?: string; kind: string; size: number }>
type Read = (path: string) => Promise<{ base64: string }>

/** Adapts the mod filesystem without passing its engine object to another file's function. */
export function modDocumentFile(stat: Stat, read: Read): DocumentFile {
  return {
    stat: path =>
      stat(path).then(({ realPath, kind, size }) => ({ path: realPath ?? '', isFile: kind === 'file', size })),
    read: (path, limit) => read(path).then(({ base64 }) => documentBytes(base64, limit)),
  }
}
