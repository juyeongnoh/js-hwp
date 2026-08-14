/**
 * 작은 XML 리더와 라이터.
 *
 * OWPML은 각 루트 요소에 한 번 선언되는 고정된 네임스페이스 접두사 집합을
 * 쓴다. 그래서 이 코드는 네임스페이스를 해석하지 않고 접두사 붙은 이름(`hp:p`)을
 * 불투명한 문자열로 취급한다. 한글 자신이 이 포맷을 쓰고 읽는 방식이 정확히
 * 그것이고, 왕복을 바이트 수준에서 안정적으로 유지해준다.
 *
 * 파서를 끌어오는 대신 직접 쓰면 ZIP 코덱 말고는 패키지에 의존성이 없어지고,
 * 라이터가 속성 순서를 통제할 수 있다. 이게 중요한 이유는 우리가 내보낸 것과
 * 한글이 내보낸 것 사이의 diff가 정확도를 확인하는 주된 도구이기 때문이다.
 *
 */

export interface XmlElement {
  type: 'element'
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}

export interface XmlText {
  type: 'text'
  value: string
}

export type XmlNode = XmlElement | XmlText

export class XmlError extends Error {
  override name = 'XmlError'
}

// ---------------------------------------------------------------------------
// 파싱
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10))
    return NAMED_ENTITIES[body] ?? match
  })
}

/** XML 문서를 파싱하고 루트 요소를 반환한다. */
export function parseXml(source: string): XmlElement {
  let offset = 0
  const stack: XmlElement[] = []
  let root: XmlElement | undefined

  const skipUntil = (marker: string): void => {
    const index = source.indexOf(marker, offset)
    offset = index === -1 ? source.length : index + marker.length
  }

  while (offset < source.length) {
    const lt = source.indexOf('<', offset)

    if (lt === -1) break

    if (lt > offset) {
      const text = source.slice(offset, lt)
      const parent = stack[stack.length - 1]
      // 요소 사이의 공백은 내용이 아니라 배치다.
      if (parent && text.trim() !== '') {
        parent.children.push({ type: 'text', value: decodeEntities(text) })
      }
    }
    offset = lt

    if (source.startsWith('<?', offset)) {
      skipUntil('?>')
      continue
    }
    if (source.startsWith('<!--', offset)) {
      skipUntil('-->')
      continue
    }
    if (source.startsWith('<![CDATA[', offset)) {
      const end = source.indexOf(']]>', offset)
      const text = source.slice(offset + 9, end === -1 ? source.length : end)
      stack[stack.length - 1]?.children.push({ type: 'text', value: text })
      offset = end === -1 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<!', offset)) {
      skipUntil('>')
      continue
    }

    if (source.startsWith('</', offset)) {
      const end = source.indexOf('>', offset)
      if (end === -1) throw new XmlError('Unterminated closing tag')
      const name = source.slice(offset + 2, end).trim()
      const open = stack.pop()
      if (!open) throw new XmlError(`Closing tag </${name}> with no matching open tag`)
      if (open.name !== name) {
        throw new XmlError(`Mismatched tags: <${open.name}> closed by </${name}>`)
      }
      offset = end + 1
      continue
    }

    // 여는 태그. 따옴표 안의 것은 무시하면서 짝이 되는 '>'까지 훑는다.
    let cursor = offset + 1
    let quote: string | undefined
    while (cursor < source.length) {
      const char = source[cursor]!
      if (quote) {
        if (char === quote) quote = undefined
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
      cursor++
    }
    if (cursor >= source.length) throw new XmlError('Unterminated tag')

    const selfClosing = source[cursor - 1] === '/'
    const body = source.slice(offset + 1, selfClosing ? cursor - 1 : cursor)
    offset = cursor + 1

    const nameEnd = body.search(/[\s/]/)
    const name = nameEnd === -1 ? body : body.slice(0, nameEnd)
    const attrs = nameEnd === -1 ? {} : parseAttributes(body.slice(nameEnd))

    const element: XmlElement = { type: 'element', name, attrs, children: [] }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(element)
    else if (root) throw new XmlError('Document has more than one root element')
    else root = element

    if (!selfClosing) stack.push(element)
  }

  if (!root) throw new XmlError('Document has no root element')
  if (stack.length > 0) throw new XmlError(`Unclosed element <${stack[stack.length - 1]!.name}>`)
  return root
}

const ATTRIBUTE = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  ATTRIBUTE.lastIndex = 0
  for (let m = ATTRIBUTE.exec(source); m !== null; m = ATTRIBUTE.exec(source)) {
    attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? '')
  }
  return attrs
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

/** 주어진 태그 이름을 가진 직속 자식들. */
export function children(element: XmlElement | undefined, name: string): XmlElement[] {
  if (!element) return []
  return element.children.filter(
    (child): child is XmlElement => child.type === 'element' && child.name === name,
  )
}

/** 주어진 태그 이름을 가진 첫 직속 자식. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return children(element, name)[0]
}

/** 자식 이름의 사슬을 따라간다. 예: `path(root, 'hh:refList', 'hh:fontfaces')`. */
export function path(element: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let current = element
  for (const name of names) {
    current = child(current, name)
    if (!current) return undefined
  }
  return current
}

/** 주어진 태그 이름을 가진 모든 자손. 깊이 우선. */
export function descendants(element: XmlElement | undefined, name: string): XmlElement[] {
  const out: XmlElement[] = []
  const visit = (node: XmlElement): void => {
    for (const item of node.children) {
      if (item.type !== 'element') continue
      if (item.name === name) out.push(item)
      visit(item)
    }
  }
  if (element) visit(element)
  return out
}

/** 요소의 텍스트 내용을 이어 붙인 것. */
export function textContent(element: XmlElement | undefined): string {
  if (!element) return ''
  let out = ''
  for (const node of element.children) {
    if (node.type === 'text') out += node.value
    else out += textContent(node)
  }
  return out
}

export const attr = (element: XmlElement | undefined, name: string): string | undefined =>
  element?.attrs[name]

export function numAttr(element: XmlElement | undefined, name: string, fallback = 0): number {
  const raw = element?.attrs[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/** HWPX는 불리언을 `"0"` / `"1"`로 쓰고, 가끔 `"true"`로도 쓴다. */
export function boolAttr(element: XmlElement | undefined, name: string, fallback = false): boolean {
  const raw = element?.attrs[name]
  if (raw === undefined) return fallback
  return raw === '1' || raw === 'true' || raw === 'TRUE'
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

export function escapeXml(value: string): string {
  let out = ''
  for (const char of value) {
    switch (char) {
      case '&':
        out += '&amp;'
        break
      case '<':
        out += '&lt;'
        break
      case '>':
        out += '&gt;'
        break
      case '"':
        out += '&quot;'
        break
      default: {
        const code = char.codePointAt(0)!
        // XML 1.0은 대부분의 제어 문자를 아예 금지한다.
        if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
          out += ' '
        } else {
          out += char
        }
      }
    }
  }
  return out
}

export type AttrValue = string | number | boolean | undefined | null

/**
 * 요소를 만든다. 값이 `undefined`나 `null`인 속성은 버려지므로, 호출 지점이
 * 조건부 스프레드로 지저분해지지 않는다.
 */
export function el(
  name: string,
  attrs: Record<string, AttrValue> = {},
  children: (XmlNode | string | undefined | null | false)[] = [],
): XmlElement {
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue
    cleaned[key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  }
  const nodes: XmlNode[] = []
  for (const item of children) {
    if (item === undefined || item === null || item === false) continue
    nodes.push(typeof item === 'string' ? { type: 'text', value: item } : item)
  }
  return { type: 'element', name, attrs: cleaned, children: nodes }
}

export const text = (value: string): XmlText => ({ type: 'text', value })

export interface SerializeOptions {
  /** XML 선언을 내보낸다. 기본값 `true`. */
  declaration?: boolean
  /** 읽기 좋게 출력을 들여쓴다. 한글은 전부 한 줄로 쓴다. */
  indent?: boolean
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'

export function serializeXml(root: XmlElement, options: SerializeOptions = {}): string {
  const parts: string[] = []
  if (options.declaration !== false) parts.push(DECLARATION)
  writeNode(root, parts, options.indent === true ? 0 : -1)
  return parts.join('')
}

function writeNode(node: XmlNode, out: string[], depth: number): void {
  if (node.type === 'text') {
    out.push(escapeXml(node.value))
    return
  }

  const pad = depth >= 0 ? `\n${'  '.repeat(depth)}` : ''
  out.push(`${pad}<${node.name}`)
  for (const [key, value] of Object.entries(node.attrs)) {
    out.push(` ${key}="${escapeXml(value)}"`)
  }

  if (node.children.length === 0) {
    out.push('/>')
    return
  }

  out.push('>')
  const hasText = node.children.some((c) => c.type === 'text')
  for (const item of node.children) {
    writeNode(item, out, hasText || depth < 0 ? -1 : depth + 1)
  }
  out.push(`${hasText ? '' : pad}</${node.name}>`)
}
