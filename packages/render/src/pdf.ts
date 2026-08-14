/**
 * PDF 내보내기.
 *
 * PDF는 실제 브라우저 엔진에 문서를 배치하고 인쇄해서 만든다. 지름길이 아니다.
 * 크로미움의 줄바꿈 처리, 폰트 셰이핑, 페이지 분할은 여기서 다시 구현한 어떤
 * 것보다 훨씬 낫고, Electron 앱은 이미 엔진을 하나 품고 있다.
 *
 *
 * 엔진은 꽂을 수 있게 만들어서 같은 코드 경로가 세 곳에서 동작한다. Electron
 * (숨긴 창의 `printToPDF`), Playwright나 Puppeteer가 설치된 Node, 그리고
 * 브라우저(`window.print()`).
 */

import type { HwpDocument } from '@js-hwp/core'
import { toPt } from '@js-hwp/core'
import { renderToHtml, type RenderOptions } from './html.js'

export interface PdfOptions extends RenderOptions {
  /** 배경색과 이미지를 인쇄한다. 기본값 `true`. */
  printBackground?: boolean
  /** 크로미움 인쇄 템플릿 문법으로 된 머리말/꼬리말 HTML. */
  headerTemplate?: string
  footerTemplate?: string
  /** 크로미움 기본 머리말과 꼬리말을 보여준다. 기본값 `false`. */
  displayHeaderFooter?: boolean
  /** 배율, 0.1-2. */
  scale?: number
  /** 인쇄 전에 글꼴과 이미지를 이만큼(ms) 기다린다. */
  timeout?: number
}

/** 백엔드가 HTML을 PDF 바이트로 바꾸는 데 필요한 전부. */
export interface PdfRequest {
  html: string
  /** 포인트 단위 쪽 크기. 문서의 첫 구역에서 가져온다. */
  pageWidth: number
  pageHeight: number
  landscape: boolean
  options: PdfOptions
}

export type PdfBackend = (request: PdfRequest) => Promise<Uint8Array>

export class PdfExportError extends Error {
  override name = 'PdfExportError'
}

/** 인쇄에 맞춘 HTML: paged-media 규칙, 화면용 장식 없음. */
export function renderPrintableHtml(doc: HwpDocument, options: PdfOptions = {}): string {
  return renderToHtml(doc, {
    ...options,
    mode: 'print',
    standalone: true,
    editable: false,
  })
}

/**
 * 문서를 PDF로 내보낸다.
 *
 * HTML을 어떻게 렌더링할지 통제하려면 `backend`를 넘겨라. 백엔드가 없으면
 * Playwright를 찾고 그다음 Puppeteer를 찾으며, 둘 다 없으면 무엇을 설치해야
 * 하는지 설명한다.
 */
export async function exportPdf(
  doc: HwpDocument,
  options: PdfOptions & { backend?: PdfBackend } = {},
): Promise<Uint8Array> {
  const first = doc.sections[0]
  if (!first) throw new PdfExportError('Document has no sections')

  const { pageDef } = first
  const landscape = pageDef.landscape
  const html = renderPrintableHtml(doc, options)

  const backend = options.backend ?? (await autoBackend())
  return backend({
    html,
    pageWidth: toPt(landscape ? pageDef.height : pageDef.width),
    pageHeight: toPt(landscape ? pageDef.width : pageDef.height),
    landscape,
    options,
  })
}

/**
 * Electron `BrowserWindow` 생성자로 백엔드를 만든다.
 *
 * ```ts
 * import { BrowserWindow } from 'electron'
 * const pdf = await exportPdf(doc, { backend: electronBackend(BrowserWindow) })
 * ```
 */
export function electronBackend(BrowserWindow: ElectronBrowserWindowCtor): PdfBackend {
  return async ({ html, pageWidth, pageHeight, landscape, options }) => {
    const win = new BrowserWindow({
      show: false,
      // 한 번도 보여주지 않을 창에는 `offscreen: true`가 맞아 보이지만, 그러면
      // printToPDF가 영영 끝나지 않는다. 그냥 숨긴 창이 동작한다.
      webPreferences: { javascript: false, sandbox: true },
    })

    // HTML은 data: URL이 아니라 임시 파일을 거친다. 이미지가 임베드된 문서는
    // 크로미움의 data URL 탐색 한계를 쉽게 넘고, 그러면 실패하는 게 아니라
    // 불러오기가 멈춰버리기 때문이다.
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'js-hwp-pdf-'))
    const file = join(dir, 'document.html')

    try {
      await writeFile(file, html, 'utf8')
      await win.loadFile(file)
      const buffer = await win.webContents.printToPDF({
        printBackground: options.printBackground ?? true,
        landscape,
        // 크로미움은 여기서 인치를 원하고 문서는 포인트를 준다.
        pageSize: { width: pageWidth / 72, height: pageHeight / 72 },
        margins: { marginType: 'none' },
        displayHeaderFooter: options.displayHeaderFooter ?? false,
        headerTemplate: options.headerTemplate,
        footerTemplate: options.footerTemplate,
        scale: options.scale ?? 1,
        preferCSSPageSize: true,
      })
      return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer)
    } finally {
      win.destroy()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** 이미 실행된 Playwright나 Puppeteer 브라우저로 백엔드를 만든다. */
export function browserBackend(browser: HeadlessBrowser): PdfBackend {
  return async ({ html, options }) => {
    const page = await browser.newPage()
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' as never })
      const buffer = await page.pdf({
        printBackground: options.printBackground ?? true,
        preferCSSPageSize: true,
        displayHeaderFooter: options.displayHeaderFooter ?? false,
        headerTemplate: options.headerTemplate,
        footerTemplate: options.footerTemplate,
        scale: options.scale ?? 1,
      })
      return new Uint8Array(buffer)
    } finally {
      await page.close()
    }
  }
}

async function autoBackend(): Promise<PdfBackend> {
  for (const name of ['playwright', 'playwright-core', 'puppeteer', 'puppeteer-core']) {
    try {
      const mod = (await import(/* @vite-ignore */ name)) as PlaywrightLike & PuppeteerLike
      const launcher = mod.chromium ?? mod.default?.chromium ?? mod
      if (typeof launcher.launch !== 'function') continue
      const browser = (await launcher.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      })) as HeadlessBrowser
      const backend = browserBackend(browser)
      return async (request) => {
        try {
          return await backend(request)
        } finally {
          await browser.close()
        }
      }
    } catch {
      // 다음 후보를 시도한다.
    }
  }
  throw new PdfExportError(
    'No PDF engine available. Either pass a backend (electronBackend(BrowserWindow) inside ' +
      'Electron) or install one: `npm i -D playwright && npx playwright install chromium`.',
  )
}

// ---------------------------------------------------------------------------
// 구조적 타입. 그래서 이 패키지가 Electron이나 Playwright의 모양을 서술하는 데
// 그것들에 대한 의존성이 필요 없다.
// ---------------------------------------------------------------------------

export interface ElectronBrowserWindowCtor {
  new (options: Record<string, unknown>): {
    loadURL(url: string): Promise<void>
    loadFile(path: string): Promise<void>
    destroy(): void
    webContents: {
      printToPDF(options: Record<string, unknown>): Promise<Uint8Array | ArrayBufferLike>
    }
  }
}

export interface HeadlessBrowser {
  newPage(): Promise<{
    setContent(html: string, options?: Record<string, unknown>): Promise<void>
    pdf(options: Record<string, unknown>): Promise<Uint8Array>
    close(): Promise<void>
  }>
  close(): Promise<void>
}

interface Launcher {
  launch?(options?: Record<string, unknown>): Promise<unknown>
}

interface PlaywrightLike extends Launcher {
  chromium?: Launcher
  default?: { chromium?: Launcher }
}

type PuppeteerLike = Launcher
