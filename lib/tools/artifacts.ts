import { defineTool, TOOL_GATE } from './registry';

export const documentGenerateTool = defineTool({
  name: 'document_generate',
  description: '用户要生成、导出 Word 文档（.docx、Word、文档、报告、方案、合同、简历、说明书）时调用。内容要么用 markdown 直接写（推荐），要么用 sections 结构化提供；多章节的长文档需要目录时传 toc=true。不要用 file_generate 生成 .docx。',
  permissions: ['artifact:write'],
  tags: ['artifact'],
  source: 'native',
  gating: TOOL_GATE.delivery,
  schema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: '文件名，建议带 .docx 后缀。' },
      title: { type: 'string', description: '文档主标题。' },
      subtitle: { type: 'string', description: '副标题，可选。' },
      author: { type: 'string', description: '作者/单位，可选，默认 SANMAO.AI。' },
      toc: { type: 'boolean', description: '默认 false；长文档传 true，会在正文前插入目录，Word 打开时自动刷新页码。' },
      markdown: { type: 'string', description: '正文 Markdown。支持 #/##/### 标题、- 列表、1. 列表、| 表格、``` 代码块。插图单独占一行写 ![说明](图片ref)，ref 必须来自图片工具返回的 ref。已经写过一遍的内容直接放这里，不要重复改写。' },
      sections: {
        type: 'array',
        description: '结构化章节；与 markdown 二选一或同时使用。',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            level: { type: 'integer', enum: [1, 2, 3] },
            paragraphs: { type: 'array', items: { type: 'string' } },
            bullets: { type: 'array', items: { type: 'string' } },
            orderedBullets: { type: 'array', items: { type: 'string' }, description: '有序列表，按 1. 2. 3. 编号排版。' },
            code: { type: 'array', items: { type: 'string' }, description: '代码块，每项一段，用等宽字体加底纹排版。' },
            images: {
              type: 'array',
              description: '本章节插图；ref 必须来自图片工具返回的 ref，caption 可选。',
              items: {
                type: 'object',
                properties: {
                  ref: { type: 'string', description: '图片工具返回的 ref，例如 /api/storage/file?name=xxx.png。' },
                  caption: { type: 'string', description: '图注，可选。' },
                },
                required: ['ref'],
              },
            },
            tables: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  columns: { type: 'array', items: { type: 'string' } },
                  rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } },
                },
                required: ['rows'],
              },
            },
          },
        },
      },
    },
    required: [],
  },
});

export const spreadsheetGenerateTool = defineTool({
  name: 'spreadsheet_generate',
  description: '用户要生成、导出 Excel 表格（.xlsx、Excel、表格、销售数据、报表、台账）时调用。报表类需求建议打开 totals 自动合计，并给状态列加 options 下拉、给关键数值列加 highlight 条件格式。不要用 file_generate 生成 .xlsx。',
  permissions: ['artifact:write'],
  tags: ['artifact'],
  source: 'native',
  gating: TOOL_GATE.delivery,
  schema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: '文件名，建议带 .xlsx 后缀。' },
      sheets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '工作表名，最长 31 字。' },
            columns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', description: '与 rows 里对象字段同名。' },
                  header: { type: 'string' },
                  width: { type: 'number' },
                  format: { type: 'string', description: 'Excel 数字格式，如 #,##0、0.00%、yyyy-mm-dd。' },
                  total: { type: 'string', enum: ['sum', 'average', 'count', 'max', 'min', 'none'], description: '该列的合计方式；none 表示这列不参与合计（如排名、编号）。' },
                  options: { type: 'array', items: { type: 'string' }, description: '该列候选值，会写成下拉选择，最多 32 项且不能含逗号。' },
                  highlight: { type: 'string', enum: ['dataBar', 'colorScale', 'negative', 'top10', 'bottom10', 'aboveAverage', 'belowAverage'], description: '该列条件格式：dataBar 数据条、colorScale 色阶、negative 负数标红、top10/bottom10 前后 10%、aboveAverage/belowAverage 高于/低于平均。' },
                },
                required: ['header'],
              },
            },
            rows: {
              type: 'array',
              description: '对象数组（按 columns.key 取值）或数组的数组。单元格可以是字符串、数字、布尔、null；公式必须写成 { "formula": "SUM(B2:B10)" }；链接写成 { "url": "https://...", "text": "..." }。',
              items: { type: ['object', 'array'] },
            },
            freezeHeader: { type: 'boolean', description: '默认 true，冻结首行。' },
            autoFilter: { type: 'boolean', description: '默认 true，首行开启筛选。' },
            totals: { type: 'boolean', description: '默认 false；打开后在数据末尾追加合计行，数值列默认求和（表头含率/占比的取平均，排名/编号/日期列跳过）。' },
          },
        },
      },
    },
    required: ['sheets'],
  },
});

export const presentationGenerateTool = defineTool({
  name: 'presentation_generate',
  description: '用户要生成、导出 PPT / 演示文稿 / 幻灯片（.pptx、PPT、deck）时调用。需要图表时用 layout=chart，在 chart 里给数值数据；需要配图时用 layout=image 并传 image.ref（来自图片工具返回的 ref），subtitle 作为图注。不要用 file_generate 生成 .pptx。',
  permissions: ['artifact:write'],
  tags: ['artifact'],
  source: 'native',
  gating: TOOL_GATE.delivery,
  schema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: '文件名，建议带 .pptx 后缀。' },
      title: { type: 'string' },
      subtitle: { type: 'string' },
      theme: { type: 'string', enum: ['sanmao-dark', 'sanmao-light'], description: '默认 sanmao-dark。' },
      markdown: { type: 'string', description: '用 Markdown 快速成稿：# 标题页、##/### 内容页、- 要点。' },
      slides: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            layout: { type: 'string', enum: ['title', 'section', 'bullets', 'two-column', 'table', 'chart', 'image'] },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' }, description: '每页建议不超过 6 条，超出会自动续页。' },
            leftTitle: { type: 'string' },
            leftBullets: { type: 'array', items: { type: 'string' } },
            rightTitle: { type: 'string' },
            rightBullets: { type: 'array', items: { type: 'string' } },
            columns: { type: 'array', items: { type: 'string' }, description: 'layout=table 时的表头。' },
            rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } },
            chart: {
              type: 'object',
              description: 'layout=chart 时的图表数据，只给数值，不需要图片。',
              properties: {
                type: { type: 'string', enum: ['bar', 'line', 'pie', 'doughnut', 'area'], description: '默认 bar。' },
                categories: { type: 'array', items: { type: ['string', 'number'] }, description: '横轴或分片标签，最多 24 个；不给则自动编号。' },
                series: {
                  type: 'array',
                  description: '数据系列，最多 6 组；饼图只用第一组。',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: '系列名，用作图例。' },
                      values: { type: 'array', items: { type: ['number', 'null'] } },
                    },
                    required: ['values'],
                  },
                },
              },
              required: ['series'],
            },
            image: {
              type: 'object',
              description: 'layout=image 时的插图；ref 必须来自图片工具返回的 ref。',
              properties: {
                ref: { type: 'string', description: '图片工具返回的 ref，例如 /api/storage/file?name=xxx.png。' },
              },
              required: ['ref'],
            },
            notes: { type: 'string', description: '演讲者备注，可选。' },
          },
        },
      },
    },
    required: [],
  },
});

export const archiveGenerateTool = defineTool({
  name: 'archive_generate',
  description: '用户要把多个文件打成 ZIP 压缩包（.zip、打包、压缩、资料包）时调用。必须最后调用：先生成 Word/Excel/PPT/文本文件，再用本工具打包。',
  permissions: ['artifact:write', 'artifact:read'],
  tags: ['artifact', 'archive'],
  source: 'native',
  gating: TOOL_GATE.delivery,
  schema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: '压缩包文件名，建议带 .zip 后缀。' },
      artifactIds: { type: 'array', items: { type: 'string' }, description: '要打包的文件 id；必须是之前工具返回过的 artifactId，不要编造。' },
      includeGeneratedThisTurn: { type: 'boolean', description: '默认 true，把本轮刚生成的文件一并打包。' },
    },
    required: [],
  },
});
