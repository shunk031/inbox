export const DOCUMENT_LIMIT = 64 * 1024

export function documentBytes(base64: string, limit: number): Uint8Array {
  if (base64.length > Math.ceil((limit + 1) / 3) * 4) return new Uint8Array(limit + 1)
  return Uint8Array.from(atob(base64), byte => byte.charCodeAt(0))
}

export type DocumentFile = {
  stat(path: string): Promise<{ path: string; isFile: boolean; size: number }>
  read(path: string, limit: number): Promise<Uint8Array>
}

export type DocumentResult = { text: string } | { error: string }

export async function readDocument(path: string, file: DocumentFile): Promise<DocumentResult> {
  try {
    const target = await file.stat(path)
    if (!target.isFile || !/\.md$/i.test(target.path))
      return { error: 'The document must resolve to a regular .md file.' }
    if (target.size > DOCUMENT_LIMIT) return { error: 'The document is larger than the 64 KiB limit.' }
    const bytes = await file.read(target.path, DOCUMENT_LIMIT)
    if (bytes.byteLength > DOCUMENT_LIMIT) return { error: 'The document is larger than the 64 KiB limit.' }
    return { text: new TextDecoder().decode(bytes) }
  } catch (error) {
    return {
      error:
        (error as { code?: string }).code === 'ENOENT'
          ? 'The document file is missing.'
          : 'The document could not be read.',
    }
  }
}

export function documentExcerpt(text: string): string {
  const excerpt = text.trim().replace(/\s+/gu, ' ')
  const chars = [...excerpt]
  return chars.length > 180 ? `${chars.slice(0, 180).join('')}…` : excerpt
}

export async function withDocumentPreview(input: Record<string, unknown>, file: DocumentFile) {
  const path = typeof input.document === 'string' ? input.document.trim() : ''
  if (!path) return input
  if (path.length > 4096) return { ...input, document: undefined, document_error: 'The document path is too long.' }

  const result = await readDocument(path, file)
  return 'text' in result
    ? { ...input, document: path, document_preview: documentExcerpt(result.text) }
    : { ...input, document: undefined, document_error: result.error }
}
