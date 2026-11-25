// 빌더(DocumentBuilder.image)로 그림 문서를 만든다. 한글이 여는지, 다시 저장하면 값을 바꾸는지 보려는 파일이다.
// 그림은 experiments/shape-picture/quadrants.png(120×80)다.
// 사용: npx tsx docs/experiments/scripts/make-builder-pictures.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { serializeHwp } from '../../../packages/hwp/src/index.ts'
import { DocumentBuilder } from '../../../packages/core/src/index.ts'

const dir = 'docs/experiments/builder-picture'
const png = new Uint8Array(readFileSync('docs/experiments/shape-picture/quadrants.png'))

const files: [string, (b: DocumentBuilder) => DocumentBuilder][] = [
  ['inline.hwp', (b) => b.paragraph('인라인 그림').image(png)],
  ['floating.hwp', (b) => b.paragraph('떠 있는 그림').image(png, { inline: false })],
  ['caption.hwp', (b) => b.paragraph('캡션 있는 그림').image(png, { caption: '그림 1. 네 색' })],
  ['resized.hwp', (b) => b.paragraph('크기를 바꾼 그림').image(png, { width: '60mm', alt: '네 색 사각형' })],
]
for (const [name, make] of files) {
  writeFileSync(`${dir}/${name}`, serializeHwp(make(new DocumentBuilder()).build()))
  console.log(name)
}
