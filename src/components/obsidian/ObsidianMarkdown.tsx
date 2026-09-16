import { StyleSheet, Text, View } from 'react-native'

type Block =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'ordered'; n: number; text: string }
  | { type: 'paragraph'; text: string }

function stripHeadingMarks(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').trim()
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd().trim()
    if (!trimmed) continue
    if (/^#\s+/.test(trimmed)) {
      blocks.push({ type: 'h1', text: stripHeadingMarks(trimmed) })
      continue
    }
    if (/^#{2,6}\s+/.test(trimmed)) {
      blocks.push({ type: 'h2', text: stripHeadingMarks(trimmed) })
      continue
    }
    const ordered = trimmed.match(/^(\d+)\.\s+(.+)$/)
    if (ordered) {
      blocks.push({ type: 'ordered', n: Number(ordered[1]), text: ordered[2] })
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      blocks.push({ type: 'bullet', text: trimmed.replace(/^[-*]\s+/, '') })
      continue
    }
    blocks.push({ type: 'paragraph', text: trimmed })
  }
  return blocks
}

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={key} style={styles.strong}>
          {part.slice(2, -2)}
        </Text>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <Text key={key} style={styles.code}>
          {part.slice(1, -1)}
        </Text>
      )
    }
    return <Text key={key}>{part}</Text>
  })
}

type Props = {
  text: string
}

export default function ObsidianMarkdown({ text }: Props) {
  const blocks = parseBlocks(text)
  if (blocks.length === 0) return null

  return (
    <View style={styles.wrap}>
      {blocks.map((block, index) => {
        const key = `block-${index}`
        if (block.type === 'h1') {
          return (
            <Text key={key} style={styles.h1}>
              {renderInline(block.text, key)}
            </Text>
          )
        }
        if (block.type === 'h2') {
          return (
            <Text key={key} style={styles.h2}>
              {renderInline(block.text, key)}
            </Text>
          )
        }
        if (block.type === 'bullet') {
          return (
            <View key={key} style={styles.listItem}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.body}>{renderInline(block.text, key)}</Text>
            </View>
          )
        }
        if (block.type === 'ordered') {
          return (
            <View key={key} style={styles.listItem}>
              <Text style={styles.orderedIndex}>{block.n}.</Text>
              <Text style={styles.body}>{renderInline(block.text, key)}</Text>
            </View>
          )
        }
        return (
          <Text key={key} style={styles.paragraph}>
            {renderInline(block.text, key)}
          </Text>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
  },
  body: {
    flexShrink: 1,
    color: '#e8e8ea',
    fontSize: 16,
    lineHeight: 23,
  },
  paragraph: {
    color: '#e8e8ea',
    fontSize: 16,
    lineHeight: 23,
    marginTop: 0,
    marginBottom: 10,
  },
  h1: {
    color: '#ffffff',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 8,
  },
  h2: {
    color: '#ffffff',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
  },
  strong: {
    fontWeight: '700',
    color: '#ffffff',
  },
  code: {
    color: '#fde68a',
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 0,
    marginBottom: 6,
    paddingRight: 8,
  },
  bulletDot: {
    color: '#a1a1aa',
    fontSize: 16,
    lineHeight: 23,
    width: 16,
  },
  orderedIndex: {
    color: '#a1a1aa',
    fontSize: 16,
    lineHeight: 23,
    width: 22,
    fontVariant: ['tabular-nums'],
  },
})
