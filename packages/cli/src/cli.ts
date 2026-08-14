#!/usr/bin/env node
/**
 * `js-hwp` 명령줄 도구.
 *
 * 한글을 열지 않고 HWP 문서를 일괄 처리한다. 텍스트 추출, 포맷 변환, HTML이나
 * 마크다운으로 렌더링, 템플릿 채우기, 그리고 파일에 실제로 뭐가 들었는지
 * 들여다보기.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  type DocumentFormat,
  type HwpDocument,
  convert,
  detectFormat,
  documentText,
  formatFromPath,
  open,
  renderToHtml,
  renderToMarkdown,
  replaceText,
  save,
  statistics,
  tableToArray,
  tables,
} from 'js-hwp'

const USAGE = `js-hwp — Hangul document tools

Usage
  js-hwp <command> [options] <file>

Commands
  text <file>                    Print the document's plain text
  info <file>                    Show format, version, fonts, styles and counts
  convert <file> -o <out>        Convert between .hwp and .hwpx
  html <file> [-o <out>]         Render to HTML
  markdown <file> [-o <out>]     Render to Markdown
  tables <file>                  Print every table as TSV
  replace <file> -o <out> <find> <replace>
                                 Replace text throughout the document

Options
  -o, --output <path>            Where to write the result
  -f, --format <hwp|hwpx>        Force the output format for 'convert'
      --no-tables                Exclude table contents from 'text'
      --notes                    Include footnotes and headers in 'text'
  -h, --help                     Show this message
`

interface Options {
  output?: string
  format?: DocumentFormat
  tables: boolean
  notes: boolean
}

async function main(argv: string[]): Promise<number> {
  const positional: string[] = []
  const options: Options = { tables: true, notes: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '-h':
      case '--help':
        process.stdout.write(USAGE)
        return 0
      case '-o':
      case '--output':
        options.output = argv[++i]
        break
      case '-f':
      case '--format': {
        const value = argv[++i]
        if (value !== 'hwp' && value !== 'hwpx') {
          process.stderr.write(`Unknown format: ${value}\n`)
          return 2
        }
        options.format = value
        break
      }
      case '--no-tables':
        options.tables = false
        break
      case '--notes':
        options.notes = true
        break
      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`Unknown option: ${arg}\n`)
          return 2
        }
        positional.push(arg)
        break
    }
  }

  const [command, file, ...rest] = positional
  if (!command) {
    process.stdout.write(USAGE)
    return 1
  }
  if (!file) {
    process.stderr.write('No input file given.\n')
    return 2
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(file))
  } catch (error) {
    process.stderr.write(`Cannot read ${file}: ${(error as Error).message}\n`)
    return 2
  }

  try {
    switch (command) {
      case 'text': {
        const doc = open(bytes)
        const text = documentText(doc, {
          includeTables: options.tables,
          includeNotes: options.notes,
        })
        await emit(text, options.output)
        return 0
      }

      case 'info': {
        await emit(describe(file, bytes, open(bytes)), options.output)
        return 0
      }

      case 'convert': {
        const target = options.format ?? (options.output ? formatFromPath(options.output) : 'hwpx')
        const out = options.output ?? `${stripExtension(file)}.${target}`
        await writeFile(out, convert(bytes, target))
        process.stderr.write(`Wrote ${out}\n`)
        return 0
      }

      case 'html': {
        await emit(renderToHtml(open(bytes), { mode: 'print' }), options.output)
        return 0
      }

      case 'markdown': {
        await emit(renderToMarkdown(open(bytes)), options.output)
        return 0
      }

      case 'tables': {
        const found = tables(open(bytes))
        if (found.length === 0) {
          process.stderr.write('No tables in this document.\n')
          return 0
        }
        const out = found
          .map((table, index) => {
            const rows = tableToArray(table)
              .map((row) => row.map((cell) => cell.replace(/\t|\n/g, ' ')).join('\t'))
              .join('\n')
            return `# table ${index + 1}\n${rows}`
          })
          .join('\n\n')
        await emit(out, options.output)
        return 0
      }

      case 'replace': {
        const [find, replacement] = rest
        if (find === undefined || replacement === undefined) {
          process.stderr.write('Usage: js-hwp replace <file> -o <out> <find> <replace>\n')
          return 2
        }
        const doc = open(bytes)
        const { count } = replaceText(doc, find, replacement)
        const out = options.output ?? file
        await writeFile(out, save(doc, options.format ?? formatFromPath(out)))
        process.stderr.write(`Replaced ${count} occurrence${count === 1 ? '' : 's'}; wrote ${out}\n`)
        return 0
      }

      default:
        process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`)
        return 2
    }
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    return 1
  }
}

async function emit(text: string, output?: string): Promise<void> {
  if (output) {
    await writeFile(output, text, 'utf8')
    process.stderr.write(`Wrote ${output}\n`)
    return
  }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

const stripExtension = (path: string): string => path.slice(0, path.length - extname(path).length)

function describe(path: string, bytes: Uint8Array, doc: HwpDocument): string {
  const s = statistics(doc)
  const { major, minor, build, revision } = doc.version
  const lines = [
    `file        ${basename(path)}`,
    `size        ${bytes.length.toLocaleString()} bytes`,
    `format      ${detectFormat(bytes) ?? 'unknown'}`,
    `version     ${major}.${minor}.${build}.${revision}`,
    '',
    `title       ${doc.meta.title ?? '(none)'}`,
    `author      ${doc.meta.author ?? '(none)'}`,
    `modified    ${doc.meta.modifiedAt ?? '(unknown)'}`,
    '',
    `sections    ${doc.sections.length}`,
    `paragraphs  ${s.paragraphs}`,
    `words       ${s.words}`,
    `characters  ${s.characters} (${s.charactersNoSpaces} without spaces)`,
    `tables      ${s.tables}`,
    `images      ${s.images}`,
    '',
    `fonts       ${doc.fonts.length}  ${doc.fonts.slice(0, 8).map((f) => f.name).join(', ')}${doc.fonts.length > 8 ? ', …' : ''}`,
    `char shapes ${doc.charShapes.length}`,
    `para shapes ${doc.paraShapes.length}`,
    `styles      ${doc.styles.length}  ${doc.styles.slice(0, 6).map((s2) => s2.name).join(', ')}${doc.styles.length > 6 ? ', …' : ''}`,
  ]

  const page = doc.sections[0]?.pageDef
  if (page) {
    const mm = (value: number): string => (value / (7200 / 25.4)).toFixed(1)
    lines.push(
      '',
      `page        ${mm(page.width)} × ${mm(page.height)} mm, ${page.landscape ? 'landscape' : 'portrait'}`,
      `margins     L ${mm(page.margins.left)}  R ${mm(page.margins.right)}  T ${mm(page.margins.top)}  B ${mm(page.margins.bottom)} mm`,
    )
  }

  return lines.join('\n')
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`)
    process.exitCode = 1
  })
