import { Fragment, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useTheme } from '../../state/settings';
import { Text } from '../ui';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** Inline markdown: **bold**, *italic* / _italic_ and `code`. */
function Inline({ text }: { text: string }) {
  const theme = useTheme();
  const parts = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g)
    .filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return (
            <Text key={i} style={{ fontWeight: '700' }}>
              {part.slice(2, -2)}
            </Text>
          );
        if (part.startsWith('`') && part.endsWith('`'))
          return (
            <Text
              key={i}
              style={{
                fontFamily: MONO,
                fontSize: 13.5,
                backgroundColor: theme.colors.surfaceRaised,
              }}
            >
              {part.slice(1, -1)}
            </Text>
          );
        if (
          (part.startsWith('*') && part.endsWith('*')) ||
          (part.startsWith('_') && part.endsWith('_'))
        )
          return (
            <Text key={i} style={{ fontStyle: 'italic' }}>
              {part.slice(1, -1)}
            </Text>
          );
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string }
  | { kind: 'rule' };

function parse(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
    } else if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1]! });
    } else if (bullet || numbered) {
      flush();
      const ordered = !!numbered;
      const text = (bullet ?? numbered)![1]!;
      const last = blocks.at(-1);
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(text);
      else blocks.push({ kind: 'list', ordered, items: [text] });
    } else paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** The markdown the coach writes: paragraphs, headings, lists, bold, italic and code. */
export function RichText({ text, cursor }: { text: string; cursor?: boolean }) {
  const theme = useTheme();
  const blocks = parse(text);
  const caret: ReactNode = cursor ? <Text color="accent"> ▍</Text> : null;
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, bi) => {
        const last = bi === blocks.length - 1;
        if (block.kind === 'rule')
          return <View key={bi} style={{ height: 1, backgroundColor: theme.colors.border }} />;
        if (block.kind === 'heading')
          return (
            <Text key={bi} variant="subheading" style={{ fontWeight: '800' }}>
              <Inline text={block.text} />
              {last ? caret : null}
            </Text>
          );
        if (block.kind === 'list')
          return (
            <View key={bi} style={{ gap: 4 }}>
              {block.items.map((item, li) => (
                <View key={li} style={{ flexDirection: 'row', gap: 10, paddingRight: 8 }}>
                  <Text color="muted" numeric style={{ lineHeight: 22, minWidth: 12 }}>
                    {block.ordered ? `${li + 1}.` : '•'}
                  </Text>
                  <Text style={{ flex: 1 }}>
                    <Inline text={item} />
                    {last && li === block.items.length - 1 ? caret : null}
                  </Text>
                </View>
              ))}
            </View>
          );
        return (
          <Text key={bi}>
            <Inline text={block.text} />
            {last ? caret : null}
          </Text>
        );
      })}
      {!blocks.length && cursor ? caret : null}
    </View>
  );
}
