/**
 * HWPX 쓰기.
 *
 * 출력이 한컴오피스 한글이 만드는 것을 요소 하나하나, 속성 하나하나까지
 * 그대로 따라간다. 정확도를 확인하는 가장 빠른 방법이 우리 출력을 한글이 쓴
 * 파일과 diff하는 것이기 때문이다.
 *
 * HWPX의 id 관례 둘이 모델의 평범한 배열 인덱스와 다르고, 다른 데가 아니라
 * 여기서 변환한다.
 *
 * - `borderFill` id는 **1부터 시작**
 * - `numbering` id는 **1부터 시작**
 *
 * 나머지 전부 — 글자 모양, 문단 모양, 스타일, 탭 정의, 글꼴 — 는 0부터
 * 시작하고 그대로 통과한다.
 */

import {
  Align,
  type BorderFill,
  type BorderLine,
  type Bullet,
  type CharShape,
  type Control,
  FillKind,
  type FontFace,
  HeadingKind,
  type HwpDocument,
  type InlineItem,
  type ObjectPlacement,
  LineSpacingKind,
  LineStyle,
  type Numbering,
  type ParaShape,
  type Paragraph,
  type Section,
  type Style,
  StrikeoutKind,
  type TabDef,
  type TableCell,
  PageBreakInTable,
  UnderlineKind,
  VerticalAlign,
  documentText,
} from '@js-hwp/core'
import { zipSync } from 'fflate'
import {
  CONTENT_NAMESPACES,
  ENTRY,
  HEADING_TYPE,
  HORIZONTAL_ALIGN,
  LANG_ATTRS,
  LINE_SPACING_TYPE,
  LINE_TYPE,
  LINE_WIDTH,
  MIMETYPE,
  MIMETYPE as MIME,
  NS,
  NUMBER_FORMAT_NAMES,
  PACKAGE_MEDIA_TYPE,
  PAGE_DIRECTION,
  TABLE_PAGE_BREAK,
  CELL_VERTICAL_ALIGN,
  UNDERLINE_TYPE,
  VERTICAL_ALIGN,
  binDataEntry,
  colorAttr,
  enumName,
  sectionEntry,
} from './constants.js'
import { el, serializeXml, type XmlElement, type XmlNode } from './xml.js'

export interface SerializeHwpxOptions {
  /** 생산 애플리케이션으로 `version.xml`에 쓰는 값. */
  application?: string
  applicationVersion?: string
  /** ZIP 엔트리의 deflate 레벨, 0-9. */
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /** `Preview/PrvText.txt`를 포함한다. 기본값 `true`. */
  preview?: boolean
  /** XML을 예쁘게 출력한다. 한글은 한 줄로 쓴다. 디버깅에 유용하다. */
  indent?: boolean
}

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)

/** 문서를 `.hwpx` 패키지로 직렬화한다. */
export function serializeHwpx(doc: HwpDocument, options: SerializeHwpxOptions = {}): Uint8Array {
  const indent = options.indent === true
  const xml = (root: XmlElement): Uint8Array => utf8(serializeXml(root, { indent }))

  const files: Record<string, Uint8Array> = {
    [ENTRY.mimetype]: utf8(MIMETYPE),
    [ENTRY.version]: xml(buildVersion(doc, options)),
    [ENTRY.manifest]: xml(el('odf:manifest', { 'xmlns:odf': NS.odf })),
    [ENTRY.container]: xml(buildContainer()),
    [ENTRY.contentHpf]: xml(buildContentHpf(doc)),
    [ENTRY.header]: xml(buildHeader(doc)),
    [ENTRY.settings]: xml(buildSettings(doc)),
  }

  doc.sections.forEach((section, index) => {
    files[sectionEntry(index)] = xml(buildSection(doc, section, index))
  })

  for (const item of doc.binData) {
    if (!item.data || !item.id) continue
    files[binDataEntry(`${item.id}.${item.extension}`)] = item.data
  }

  if (options.preview !== false) {
    files[ENTRY.previewText] = utf8(doc.preview ?? documentText(doc).slice(0, 2000))
  }

  return zipSync(files, { level: options.compressionLevel ?? 6 })
}

// ---------------------------------------------------------------------------
// 패키지 수준 파트
// ---------------------------------------------------------------------------

function buildVersion(doc: HwpDocument, options: SerializeHwpxOptions): XmlElement {
  const { major, minor, build, revision } = doc.version
  return el('hv:HCFVersion', {
    'xmlns:hv': NS.hv,
    tagetApplication: 'WORDPROCESSOR', // The spec's own spelling; not a typo here.
    major,
    minor,
    micro: build,
    buildNumber: revision,
    xmlVersion: '1.4',
    application: options.application ?? 'js-hwp',
    appVersion: options.applicationVersion ?? '0.1.0',
  })
}

function buildContainer(): XmlElement {
  return el('ocf:container', { 'xmlns:ocf': NS.ocf, 'xmlns:hpf': NS.hpf }, [
    el('ocf:rootfiles', {}, [
      el('ocf:rootfile', { 'full-path': ENTRY.contentHpf, 'media-type': PACKAGE_MEDIA_TYPE }),
    ]),
  ])
}

function buildContentHpf(doc: HwpDocument): XmlElement {
  const items: XmlNode[] = [
    el('opf:item', { id: 'header', href: 'Contents/header.xml', 'media-type': 'application/xml' }),
  ]
  const spine: XmlNode[] = [el('opf:itemref', { idref: 'header' })]

  doc.sections.forEach((_section, index) => {
    items.push(
      el('opf:item', {
        id: `section${index}`,
        href: sectionEntry(index),
        'media-type': 'application/xml',
      }),
    )
    spine.push(el('opf:itemref', { idref: `section${index}` }))
  })

  items.push(
    el('opf:item', { id: 'settings', href: ENTRY.settings, 'media-type': 'application/xml' }),
  )

  for (const item of doc.binData) {
    if (!item.data || !item.id) continue
    items.push(
      el('opf:item', {
        id: item.id,
        href: binDataEntry(`${item.id}.${item.extension}`),
        'media-type': mediaTypeFor(item.extension),
        isEmbeded: '1',
      }),
    )
  }

  const meta = doc.meta
  return el('opf:package', { ...CONTENT_NAMESPACES, version: '', 'unique-identifier': '', id: '' }, [
    el('opf:metadata', {}, [
      el('opf:title', {}, [meta.title ?? '']),
      el('opf:language', {}, [meta.language ?? 'ko']),
      el('opf:meta', { name: 'creator', content: 'text' }, [meta.author ?? meta.creator ?? '']),
      el('opf:meta', { name: 'subject', content: 'text' }, [meta.subject ?? '']),
      el('opf:meta', { name: 'description', content: 'text' }, [meta.description ?? '']),
      el('opf:meta', { name: 'lastsaveby', content: 'text' }, [meta.lastSavedBy ?? '']),
      el('opf:meta', { name: 'CreatedDate', content: 'text' }, [meta.createdAt ?? '']),
      el('opf:meta', { name: 'ModifiedDate', content: 'text' }, [meta.modifiedAt ?? '']),
      el('opf:meta', { name: 'keyword', content: 'text' }, [(meta.keywords ?? []).join(', ')]),
    ]),
    el('opf:manifest', {}, items),
    el('opf:spine', {}, spine),
  ])
}

function buildSettings(doc: HwpDocument): XmlElement {
  const caret = doc.properties.caret
  return el('ha:HWPApplicationSetting', { 'xmlns:ha': NS.ha, 'xmlns:config': NS.config }, [
    el('ha:CaretPosition', {
      listIDRef: caret?.list ?? 0,
      paraIDRef: caret?.paragraph ?? 0,
      pos: caret?.position ?? 0,
    }),
  ])
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const mediaTypeFor = (extension: string): string =>
  MEDIA_TYPES[extension.toLowerCase()] ?? 'application/octet-stream'

// ---------------------------------------------------------------------------
// header.xml
// ---------------------------------------------------------------------------

function buildHeader(doc: HwpDocument): XmlElement {
  const p = doc.properties
  return el(
    'hh:head',
    { ...CONTENT_NAMESPACES, version: '1.4', secCnt: doc.sections.length },
    [
      el('hh:beginNum', {
        page: p.startPage,
        footnote: p.startFootnote,
        endnote: p.startEndnote,
        pic: p.startPicture,
        tbl: p.startTable,
        equation: p.startEquation,
      }),
      el('hh:refList', {}, [
        buildFontFaces(doc.fonts),
        buildBorderFills(doc.borderFills),
        buildCharProperties(doc),
        buildTabProperties(doc.tabDefs),
        buildNumberings(doc.numberings, doc.bullets),
        buildParaProperties(doc.paraShapes),
        buildStyles(doc.styles),
      ]),
      el('hh:compatibleDocument', { targetProgram: 'HWP201X' }, [el('hh:layoutCompatibility')]),
    ],
  )
}

/**
 * HWPX는 글꼴을 문자 체계별로 묶고 각 묶음이 자기 글꼴에 0부터 번호를 매긴다.
 * 같은 목록을 일곱 묶음 전부에 쓰면 어느 문자 체계가 참조하든 글꼴 id가 같은
 * 글꼴을 뜻하게 되고, 그래서 모델의 평평한 글꼴 표가 양방향에서 의미를
 * 유지한다.
 */
function buildFontFaces(fonts: FontFace[]): XmlElement {
  const list = fonts.length > 0 ? fonts : [{ name: '함초롬바탕' }]
  const groups = LANG_ATTRS.map((_lang, index) =>
    el(
      'hh:fontface',
      { lang: ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'][index], fontCnt: list.length },
      list.map((font, id) =>
        el(
          'hh:font',
          { id, face: font.name, type: font.kind === 2 ? 'HFT' : 'TTF', isEmbedded: 0 },
          [
            el('hh:typeInfo', {
              familyType: 'FCAT_GOTHIC',
              weight: font.typeInfo?.weight ?? 8,
              proportion: font.typeInfo?.proportion ?? 4,
              contrast: font.typeInfo?.contrast ?? 0,
              strokeVariation: font.typeInfo?.strokeVariation ?? 1,
              armStyle: font.typeInfo?.armStyle ?? 1,
              letterform: font.typeInfo?.letterform ?? 1,
              midline: font.typeInfo?.midline ?? 1,
              xHeight: font.typeInfo?.xHeight ?? 1,
            }),
          ],
        ),
      ),
    ),
  )
  return el('hh:fontfaces', { itemCnt: groups.length }, groups)
}

const borderLine = (name: string, line: BorderLine | undefined): XmlElement =>
  el(name, {
    type: enumName(LINE_TYPE, line?.style ?? LineStyle.None, 'NONE'),
    width: LINE_WIDTH[line?.width ?? 0] ?? '0.1 mm',
    color: colorAttr(line?.color ?? 0),
  })

function buildBorderFills(borderFills: BorderFill[]): XmlElement {
  return el(
    'hh:borderFills',
    { itemCnt: borderFills.length },
    borderFills.map((fill, index) =>
      el(
        'hh:borderFill',
        {
          // 이 포맷의 다른 모든 id와 달리 1부터 시작한다.
          id: index + 1,
          threeD: fill.threeD ?? false,
          shadow: fill.shadow ?? false,
          centerLine: 'NONE',
          breakCellSeparateLine: fill.breakCellSeparateLine ?? false,
        },
        [
          el('hh:slash', { type: 'NONE', Crooked: 0, isCounter: 0 }),
          el('hh:backSlash', { type: 'NONE', Crooked: 0, isCounter: 0 }),
          borderLine('hh:leftBorder', fill.left),
          borderLine('hh:rightBorder', fill.right),
          borderLine('hh:topBorder', fill.top),
          borderLine('hh:bottomBorder', fill.bottom),
          el('hh:diagonal', { type: 'SOLID', width: '0.1 mm', color: colorAttr(0) }),
          buildFillBrush(fill),
        ],
      ),
    ),
  )
}

function buildFillBrush(fill: BorderFill): XmlElement | undefined {
  const value = fill.fill
  if (!value || value.kind === FillKind.None) return undefined

  if (value.kind === FillKind.Color) {
    return el('hc:fillBrush', {}, [
      el('hc:winBrush', {
        faceColor: colorAttr(value.background),
        hatchColor: colorAttr(value.pattern?.color ?? 0),
        alpha: (value.alpha ?? 0) / 100,
      }),
    ])
  }

  if (value.kind === FillKind.Gradient) {
    return el('hc:fillBrush', {}, [
      el(
        'hc:gradation',
        {
          type: ['', 'LINEAR', 'RADIAL', 'CONICAL', 'SQUARE'][value.type] ?? 'LINEAR',
          angle: value.angle,
          centerX: value.centerX,
          centerY: value.centerY,
          step: value.step,
          alpha: (value.alpha ?? 0) / 100,
        },
        value.colors.map((color) => el('hc:color', { value: colorAttr(color) })),
      ),
    ])
  }

  return undefined
}

const perLangAttrs = (values: readonly number[]): Record<string, number> =>
  Object.fromEntries(LANG_ATTRS.map((lang, index) => [lang, values[index] ?? values[0] ?? 0]))

function buildCharProperties(doc: HwpDocument): XmlElement {
  return el(
    'hh:charProperties',
    { itemCnt: doc.charShapes.length },
    doc.charShapes.map((shape, id) => buildCharPr(shape, id)),
  )
}

function buildCharPr(shape: CharShape, id: number): XmlElement {
  return el(
    'hh:charPr',
    {
      id,
      height: shape.height,
      textColor: colorAttr(shape.textColor),
      shadeColor: shape.shadeColor === 0xffffff ? 'none' : colorAttr(shape.shadeColor),
      useFontSpace: shape.useFontSpace ?? false,
      useKerning: shape.useKerning ?? false,
      symMark: enumName(
        ['NONE', 'DOT_ABOVE', 'RING_ABOVE', 'TILDE', 'CARON', 'SIDE', 'COLON'],
        shape.emphasis ?? 0,
        'NONE',
      ),
      borderFillIDRef: (shape.borderFillId ?? 0) + 1,
    },
    [
      el('hh:fontRef', perLangAttrs(shape.fontIds)),
      el('hh:ratio', perLangAttrs(shape.ratios)),
      el('hh:spacing', perLangAttrs(shape.spacings)),
      el('hh:relSz', perLangAttrs(shape.relSizes)),
      el('hh:offset', perLangAttrs(shape.offsets)),
      shape.bold ? el('hh:bold') : undefined,
      shape.italic ? el('hh:italic') : undefined,
      el('hh:underline', {
        type: enumName(UNDERLINE_TYPE, shape.underline?.kind ?? UnderlineKind.None, 'NONE'),
        shape: enumName(LINE_TYPE, shape.underline?.style ?? LineStyle.Solid, 'SOLID'),
        color: colorAttr(shape.underline?.color ?? 0),
      }),
      el('hh:strikeout', {
        shape:
          shape.strikeout && shape.strikeout.kind !== StrikeoutKind.None
            ? enumName(LINE_TYPE, shape.strikeout.style, 'SOLID')
            : 'NONE',
        color: colorAttr(shape.strikeout?.color ?? 0),
      }),
      el('hh:outline', { type: enumName(LINE_TYPE, shape.outline ?? 0, 'NONE') }),
      el('hh:shadow', {
        type: shape.shadow ? 'DROP' : 'NONE',
        color: colorAttr(shape.shadow?.color ?? 0xb2b2b2),
        offsetX: shape.shadow?.offsetX ?? 10,
        offsetY: shape.shadow?.offsetY ?? 10,
      }),
      shape.emboss ? el('hh:emboss') : undefined,
      shape.engrave ? el('hh:engrave') : undefined,
      shape.superscript ? el('hh:supscript') : undefined,
      shape.subscript ? el('hh:subscript') : undefined,
    ],
  )
}

function buildTabProperties(tabDefs: TabDef[]): XmlElement {
  const list = tabDefs.length > 0 ? tabDefs : [{ stops: [] }]
  return el(
    'hh:tabProperties',
    { itemCnt: list.length },
    list.map((def, id) =>
      el(
        'hh:tabPr',
        { id, autoTabLeft: def.autoTabLeft ?? false, autoTabRight: def.autoTabRight ?? false },
        def.stops.map((stop) =>
          el('hh:tabItem', {
            pos: stop.position,
            type: ['LEFT', 'RIGHT', 'CENTER', 'DECIMAL'][stop.kind] ?? 'LEFT',
            leader: enumName(LINE_TYPE, stop.fillStyle, 'NONE'),
          }),
        ),
      ),
    ),
  )
}

function buildNumberings(numberings: Numbering[], bullets: Bullet[]): XmlElement {
  const nodes = numberings.map((numbering, index) =>
    el(
      'hh:numbering',
      { id: index + 1, start: numbering.startNumber ?? 1 },
      numbering.levels.map((level, depth) =>
        el(
          'hh:paraHead',
          {
            start: level.startNumber ?? 1,
            level: depth + 1,
            align: enumName(HORIZONTAL_ALIGN, level.align, 'LEFT'),
            useInstWidth: 1,
            autoIndent: 1,
            widthAdjust: level.widthAdjust,
            textOffsetType: level.distanceIsRatio ? 'PERCENT' : 'HWPUNIT',
            textOffset: level.distance,
            numFormat: NUMBER_FORMAT_NAMES[level.numberFormat] ?? 'DIGIT',
            charPrIDRef: level.charShapeId ?? 4294967295,
            checkable: 0,
          },
          [level.format],
        ),
      ),
    ),
  )
  void bullets
  return el('hh:numberings', { itemCnt: nodes.length }, nodes)
}

function buildParaProperties(paraShapes: ParaShape[]): XmlElement {
  return el(
    'hh:paraProperties',
    { itemCnt: paraShapes.length },
    paraShapes.map((shape, id) => buildParaPr(shape, id)),
  )
}

function buildParaPr(shape: ParaShape, id: number): XmlElement {
  const margin = el('hh:margin', {}, [
    el('hc:intent', { value: shape.indent, unit: 'HWPUNIT' }),
    el('hc:left', { value: shape.marginLeft, unit: 'HWPUNIT' }),
    el('hc:right', { value: shape.marginRight, unit: 'HWPUNIT' }),
    el('hc:prev', { value: shape.marginTop, unit: 'HWPUNIT' }),
    el('hc:next', { value: shape.marginBottom, unit: 'HWPUNIT' }),
  ])
  const lineSpacing = el('hh:lineSpacing', {
    type: enumName(LINE_SPACING_TYPE, shape.lineSpacing.kind, 'PERCENT'),
    value: shape.lineSpacing.value,
    unit: shape.lineSpacing.kind === LineSpacingKind.Percent ? 'HWPUNIT' : 'HWPUNIT',
  })

  return el(
    'hh:paraPr',
    {
      id,
      tabPrIDRef: shape.tabDefId ?? 0,
      condense: shape.condense ?? 0,
      fontLineHeight: shape.fontLineHeight ?? false,
      snapToGrid: shape.snapToGrid ?? true,
      suppressLineNumbers: 0,
      checked: 0,
    },
    [
      el('hh:align', {
        horizontal: enumName(HORIZONTAL_ALIGN, shape.align ?? Align.Justify, 'JUSTIFY'),
        vertical: enumName(VERTICAL_ALIGN, shape.verticalAlign ?? 0, 'BASELINE'),
      }),
      el('hh:heading', {
        type: enumName(HEADING_TYPE, shape.headingKind ?? HeadingKind.None, 'NONE'),
        idRef: (shape.headingId ?? 0) + (shape.headingKind === HeadingKind.None ? 0 : 1),
        level: shape.headingLevel ?? 0,
      }),
      el('hh:breakSetting', {
        breakLatinWord: shape.lineBreakLatin === 2 ? 'BREAK_WORD' : 'KEEP_WORD',
        breakNonLatinWord: shape.lineBreakHangul === 1 ? 'BREAK_WORD' : 'KEEP_WORD',
        widowOrphan: shape.widowOrphan ?? false,
        keepWithNext: shape.keepWithNext ?? false,
        keepLines: shape.keepLines ?? false,
        pageBreakBefore: shape.pageBreakBefore ?? false,
        lineWrap: 'BREAK',
      }),
      // 한글은 2016 HwpUnitChar 네임스페이스를 이해하는 리더가 더 세밀한
      // 단위를 쓸 수 있도록 여백과 줄 간격을 switch로 감싼다. 여기서는 두
      // 분기가 같은 값을 담는다.
      el('hp:switch', {}, [
        el('hp:case', { 'hp:required-namespace': NS.hwpunitchar }, [margin, lineSpacing]),
        el('hp:default', {}, [clone(margin), clone(lineSpacing)]),
      ]),
      el('hh:autoSpacing', {
        eAsianEng: shape.autoSpaceLatin ?? false,
        eAsianNum: shape.autoSpaceNumber ?? false,
      }),
      el('hh:border', {
        borderFillIDRef: (shape.border?.borderFillId ?? 0) + 1,
        offsetLeft: shape.border?.offsetLeft ?? 0,
        offsetRight: shape.border?.offsetRight ?? 0,
        offsetTop: shape.border?.offsetTop ?? 0,
        offsetBottom: shape.border?.offsetBottom ?? 0,
        connect: shape.border?.connect ?? false,
        ignoreMargin: shape.border?.ignoreMargin ?? false,
      }),
    ],
  )
}

const clone = (element: XmlElement): XmlElement => JSON.parse(JSON.stringify(element)) as XmlElement

function buildStyles(styles: Style[]): XmlElement {
  return el(
    'hh:styles',
    { itemCnt: styles.length },
    styles.map((style, id) =>
      el('hh:style', {
        id,
        type: style.kind === 1 ? 'CHAR' : 'PARA',
        name: style.name,
        engName: style.englishName,
        paraPrIDRef: style.paraShapeId,
        charPrIDRef: style.charShapeId,
        nextStyleIDRef: style.nextStyleId,
        langID: style.langId ?? 1042,
        lockForm: style.lockForm ?? false,
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// section{N}.xml
// ---------------------------------------------------------------------------

let paragraphIdCounter = 0x10000000
const nextParagraphId = (): number => ++paragraphIdCounter

function buildSection(doc: HwpDocument, section: Section, index: number): XmlElement {
  const paragraphs = section.paragraphs.map((paragraph, i) =>
    buildParagraph(doc, paragraph, i === 0 ? section : undefined),
  )
  void index
  return el('hs:sec', CONTENT_NAMESPACES, paragraphs)
}

function buildParagraph(
  doc: HwpDocument,
  paragraph: Paragraph,
  sectionForProperties?: Section,
): XmlElement {
  const runs: XmlNode[] = []

  paragraph.runs.forEach((run, runIndex) => {
    const children: XmlNode[] = []

    // 구역 속성은 첫 문단의 첫 run 안에 있다. 한글이 그렇게 넣는다.

    if (sectionForProperties && runIndex === 0) {
      children.push(buildSectionProperties(sectionForProperties))
      children.push(el('hp:ctrl', {}, [buildColumnProperties(sectionForProperties)]))
    }

    for (const item of run.items) {
      const node = buildInlineItem(doc, item)
      if (node) children.push(node)
    }

    // 텍스트 없는 run도 빈 <hp:t/>가 있어야 한글이 뭔가 보여준다.
    if (!children.some((c) => c.type === 'element' && c.name === 'hp:t')) {
      children.push(el('hp:t'))
    }
    runs.push(el('hp:run', { charPrIDRef: run.charShapeId }, children))
  })

  if (runs.length === 0) {
    runs.push(el('hp:run', { charPrIDRef: 0 }, [el('hp:t')]))
  }

  return el(
    'hp:p',
    {
      id: paragraph.id ?? nextParagraphId(),
      paraPrIDRef: paragraph.paraShapeId,
      styleIDRef: paragraph.styleId,
      pageBreak: paragraph.pageBreak ?? false,
      columnBreak: paragraph.columnBreak ?? false,
      merged: paragraph.merged ?? false,
    },
    runs,
  )
}

function buildSectionProperties(section: Section): XmlElement {
  const { pageDef, properties } = section
  const m = pageDef.margins

  return el(
    'hp:secPr',
    {
      id: '',
      textDirection: 'HORIZONTAL',
      spaceColumns: 1134,
      tabStop: 8000,
      tabStopVal: properties?.defaultTabStop ?? 4000,
      tabStopUnit: 'HWPUNIT',
      outlineShapeIDRef: 1,
      memoShapeIDRef: 0,
      textVerticalWidthHead: 0,
      masterPageCnt: 0,
    },
    [
      el('hp:grid', {
        lineGrid: properties?.lineGrid ?? 0,
        charGrid: properties?.charGrid ?? 0,
        wonggojiFormat: 0,
      }),
      el('hp:startNum', {
        pageStartsOn: 'BOTH',
        page: properties?.startNumbers?.page ?? 0,
        pic: properties?.startNumbers?.picture ?? 0,
        tbl: properties?.startNumbers?.table ?? 0,
        equation: properties?.startNumbers?.equation ?? 0,
      }),
      el('hp:visibility', {
        hideFirstHeader: properties?.hideFirstHeader ?? false,
        hideFirstFooter: properties?.hideFirstFooter ?? false,
        hideFirstMasterPage: properties?.hideFirstMasterPage ?? false,
        border: 'SHOW_ALL',
        fill: 'SHOW_ALL',
        hideFirstPageNum: properties?.hideFirstPageNumber ?? false,
        hideFirstEmptyLine: 0,
        showLineNumber: 0,
      }),
      el('hp:lineNumberShape', { restartType: 0, countBy: 0, distance: 0, startNumber: 0 }),
      el(
        'hp:pagePr',
        {
          // 이름과 달리 WIDELY가 세로이고 NARROWLY가 가로다.
          landscape: pageDef.landscape ? PAGE_DIRECTION.landscape : PAGE_DIRECTION.portrait,
          width: pageDef.width,
          height: pageDef.height,
          gutterType: ['LEFT_ONLY', 'LEFT_RIGHT', 'TOP_BOTTOM'][pageDef.gutterKind] ?? 'LEFT_ONLY',
        },
        [
          el('hp:margin', {
            header: m.header,
            footer: m.footer,
            gutter: m.gutter,
            left: m.left,
            right: m.right,
            top: m.top,
            bottom: m.bottom,
          }),
        ],
      ),
      buildNoteProperties('hp:footNotePr', 'EACH_COLUMN'),
      buildNoteProperties('hp:endNotePr', 'END_OF_DOCUMENT'),
    ],
  )
}

function buildNoteProperties(name: string, place: string): XmlElement {
  return el(name, {}, [
    el('hp:autoNumFormat', {
      type: 'DIGIT',
      userChar: '',
      prefixChar: '',
      suffixChar: ')',
      supscript: 0,
    }),
    el('hp:noteLine', { length: -1, type: 'SOLID', width: '0.12 mm', color: colorAttr(0) }),
    el('hp:noteSpacing', { betweenNotes: 283, belowLine: 567, aboveLine: 850 }),
    el('hp:numbering', { type: 'CONTINUOUS', newNum: 1 }),
    el('hp:placement', { place, beneathText: 0 }),
  ])
}

function buildColumnProperties(section: Section): XmlElement {
  const columns = section.columnDef
  return el('hp:colPr', {
    id: '',
    type: 'NEWSPAPER',
    layout: 'LEFT',
    colCount: columns?.count ?? 1,
    sameSz: columns?.sameWidth ?? true,
    sameGap: columns?.gap ?? 0,
  })
}

// ---------------------------------------------------------------------------
// 인라인 항목
// ---------------------------------------------------------------------------

function buildInlineItem(doc: HwpDocument, item: InlineItem): XmlNode | undefined {
  switch (item.type) {
    case 'text':
      return el('hp:t', {}, [item.value])
    case 'tab':
      return el('hp:t', {}, [el('hp:tab', { width: item.width ?? 8000, leader: 'NONE' })])
    case 'lineBreak':
      return el('hp:t', {}, [el('hp:lineBreak')])
    case 'specialChar':
      return el('hp:t', {}, [
        item.char === 'nbsp'
          ? el('hp:nbSpace')
          : item.char === 'fixedWidthSpace'
            ? el('hp:fwSpace')
            : item.char === 'hyphen'
              ? el('hp:hyphen')
              : el('hp:titleMark'),
      ])
    case 'pageBreak':
    case 'columnBreak':
      return undefined
    default:
      return buildControl(doc, item)
  }
}

function buildControl(doc: HwpDocument, control: Control): XmlNode | undefined {
  switch (control.type) {
    case 'table':
      return buildTable(doc, control)
    case 'picture':
      return buildPicture(doc, control)
    case 'header':
    case 'footer':
      return el(
        control.type === 'header' ? 'hp:header' : 'hp:footer',
        { id: '', applyPageType: ['BOTH', 'EVEN', 'ODD'][control.applyTo] ?? 'BOTH' },
        [el('hp:subList', {}, control.paragraphs.map((p) => buildParagraph(doc, p)))],
      )
    case 'footnote':
    case 'endnote':
      return el(
        control.type === 'footnote' ? 'hp:footNote' : 'hp:endNote',
        { number: 0, suffixChar: ')', prefixChar: '', instId: 0 },
        [el('hp:subList', {}, control.paragraphs.map((p) => buildParagraph(doc, p)))],
      )
    case 'bookmark':
      return el('hp:ctrl', {}, [el('hp:bookmark', { name: control.name })])
    case 'fieldBegin':
      return el('hp:ctrl', {}, [
        el(
          'hp:fieldBegin',
          {
            id: control.id,
            type: fieldTypeName(control.fieldKind),
            name: control.name ?? '',
            editable: control.editable ?? true,
            dirty: control.dirty ?? false,
            fieldid: control.id,
          },
          control.command
            ? [el('hp:parameters', { count: 1 }, [
                el('hp:stringParam', { name: 'Command' }, [control.command]),
              ])]
            : [],
        ),
      ])
    case 'fieldEnd':
      return el('hp:ctrl', {}, [
        el('hp:fieldEnd', { beginIDRef: control.id, fieldid: control.id }),
      ])
    case 'equation':
      return el(
        'hp:equation',
        { id: '', version: 'Equation Version 60', baseLine: control.baseLine ?? 85, textColor: colorAttr(control.color ?? 0), baseUnit: control.charSize ?? 1000, lineMode: 'CHAR' },
        [el('hp:script', {}, [control.script])],
      )
    case 'autoNumber':
      return el('hp:ctrl', {}, [
        el('hp:autoNum', {
          num: 0,
          numType: ['PAGE', 'FOOTNOTE', 'ENDNOTE', 'PICTURE', 'TABLE', 'EQUATION', 'TOTAL_PAGE'][control.numberKind] ?? 'PAGE',
        }),
      ])
    case 'pageNumberPosition':
      return el('hp:ctrl', {}, [
        el('hp:pageNum', {
          pos: control.position,
          formatType: NUMBER_FORMAT_NAMES[control.numberFormat] ?? 'DIGIT',
          sideChar: control.prefix ?? '',
        }),
      ])
    default:
      return undefined
  }
}

const FIELD_TYPE_NAMES: Record<number, string> = {
  1: 'DATE',
  2: 'DOCDATE',
  3: 'PATH',
  4: 'BOOKMARK',
  5: 'MAILMERGE',
  6: 'CROSSREF',
  7: 'FORMULA',
  8: 'CLICKHERE',
  9: 'SUMMARY',
  10: 'USERINFO',
  11: 'HYPERLINK',
  22: 'MEMO',
  24: 'TABLEOFCONTENTS',
}

const fieldTypeName = (kind: number): string => FIELD_TYPE_NAMES[kind] ?? 'UNKNOWN'

function buildTable(doc: HwpDocument, table: Extract<Control, { type: 'table' }>): XmlElement {
  const rows = table.rows.map((row) =>
    el('hp:tr', {}, row.cells.map((cell) => buildCell(doc, cell, table))),
  )

  return el(
    'hp:tbl',
    {
      id: '',
      zOrder: table.placement.zOrder ?? 0,
      numberingType: 'TABLE',
      textWrap: 'TOP_AND_BOTTOM',
      textFlow: 'BOTH_SIDES',
      lock: 0,
      dropcapstyle: 'None',
      pageBreak: TABLE_PAGE_BREAK[table.pageBreak ?? PageBreakInTable.Cell] ?? 'CELL',
      repeatHeader: (table.repeatHeaderRows ?? 0) > 0,
      rowCnt: table.rows.length,
      colCnt: Math.max(...table.rows.map((r) => r.cells.reduce((n, c) => n + c.colSpan, 0)), 1),
      cellSpacing: table.cellSpacing ?? 0,
      borderFillIDRef: (table.borderFillId ?? 0) + 1,
      noAdjust: table.noAdjust ?? false,
    },
    [
      ...buildPlacementElements(table.placement),
      el('hp:inMargin', {
        left: table.cellMargins.left,
        right: table.cellMargins.right,
        top: table.cellMargins.top,
        bottom: table.cellMargins.bottom,
      }),
      ...rows,
    ],
  )
}

function buildCell(
  doc: HwpDocument,
  cell: TableCell,
  table: Extract<Control, { type: 'table' }>,
): XmlElement {
  const margins = cell.margins ?? table.cellMargins
  return el(
    'hp:tc',
    {
      name: '',
      header: cell.header ?? false,
      hasMargin: cell.margins ? 1 : 0,
      protect: 0,
      editable: 0,
      dirty: 0,
      borderFillIDRef: (cell.borderFillId ?? table.borderFillId ?? 0) + 1,
    },
    [
      el('hp:subList', {
        id: '',
        textDirection: 'HORIZONTAL',
        lineWrap: 'BREAK',
        vertAlign: CELL_VERTICAL_ALIGN[cell.verticalAlign ?? VerticalAlign.Top] ?? 'TOP',
        linkListIDRef: 0,
        linkListNextIDRef: 0,
        textWidth: 0,
        textHeight: 0,
        hasTextRef: 0,
        hasNumRef: 0,
      }, cell.paragraphs.map((p) => buildParagraph(doc, p))),
      el('hp:cellAddr', { colAddr: cell.col, rowAddr: cell.row }),
      el('hp:cellSpan', { colSpan: cell.colSpan, rowSpan: cell.rowSpan }),
      el('hp:cellSz', { width: cell.width, height: cell.height }),
      el('hp:cellMargin', {
        left: margins.left,
        right: margins.right,
        top: margins.top,
        bottom: margins.bottom,
      }),
    ],
  )
}

function buildPicture(doc: HwpDocument, picture: Extract<Control, { type: 'picture' }>): XmlElement {
  const item = doc.binData[picture.binDataId]
  const { width, height } = picture.placement

  return el(
    'hp:pic',
    {
      id: '',
      zOrder: picture.placement.zOrder ?? 0,
      numberingType: 'PICTURE',
      textWrap: 'TOP_AND_BOTTOM',
      textFlow: 'BOTH_SIDES',
      lock: 0,
      dropcapstyle: 'None',
      href: '',
      groupLevel: 0,
      instid: picture.placement.instanceId ?? 0,
      reverse: 0,
    },
    [
      ...buildPlacementElements(picture.placement),
      el('hp:imgRect', {}, [
        el('hc:pt0', { x: 0, y: 0 }),
        el('hc:pt1', { x: width, y: 0 }),
        el('hc:pt2', { x: width, y: height }),
        el('hc:pt3', { x: 0, y: height }),
      ]),
      el('hp:imgClip', { left: 0, right: width, top: 0, bottom: height }),
      el('hp:inMargin', { left: 0, right: 0, top: 0, bottom: 0 }),
      el('hp:imgDim', {
        dimwidth: picture.originalSize?.width ?? width,
        dimheight: picture.originalSize?.height ?? height,
      }),
      el('hc:img', {
        binaryItemIDRef: item?.id ?? `image${picture.binDataId + 1}`,
        bright: picture.brightness ?? 0,
        contrast: picture.contrast ?? 0,
        effect: 'REAL_PIC',
        alpha: (picture.alpha ?? 0) / 100,
      }),
      el('hp:effects'),
    ],
  )
}

/** 떠 있는 개체마다 갖는 `hp:sz`, `hp:pos`, `hp:outMargin` 블록. */
function buildPlacementElements(placement: ObjectPlacement): XmlElement[] {
  const p = placement as {
    width: number
    height: number
    treatAsChar?: boolean
    offsetX: number
    offsetY: number
    vertRelTo: number
    horzRelTo: number
    marginLeft?: number
    marginRight?: number
    marginTop?: number
    marginBottom?: number
    flowWithText?: boolean
    allowOverlap?: boolean
  }
  const REL = ['PAPER', 'PAGE', 'COLUMN', 'PARA']
  return [
    el('hp:sz', {
      width: p.width,
      widthRelTo: 'ABSOLUTE',
      height: p.height,
      heightRelTo: 'ABSOLUTE',
      protect: 0,
    }),
    el('hp:pos', {
      treatAsChar: p.treatAsChar ?? true,
      affectLSpacing: 0,
      flowWithText: p.flowWithText ?? true,
      allowOverlap: p.allowOverlap ?? false,
      holdAnchorAndSO: 0,
      vertRelTo: REL[p.vertRelTo] ?? 'PARA',
      horzRelTo: REL[p.horzRelTo] ?? 'COLUMN',
      vertAlign: 'TOP',
      horzAlign: 'LEFT',
      vertOffset: p.offsetY,
      horzOffset: p.offsetX,
    }),
    el('hp:outMargin', {
      left: p.marginLeft ?? 0,
      right: p.marginRight ?? 0,
      top: p.marginTop ?? 0,
      bottom: p.marginBottom ?? 0,
    }),
  ]
}

export { MIME }
