import { Fragment } from 'react';
import { View } from 'react-native';
import { Text } from '../ui';

function inline(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <Text key={`${key}-${i}`} style={{ fontWeight: '700' }}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      <Fragment key={`${key}-${i}`}>{part}</Fragment>
    ),
  );
}

/** Tiny markdown subset the coach uses: paragraphs, **bold** and "- " bullets. */
export function RichText({ text, cursor }: { text: string; cursor?: boolean }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => l.trim().startsWith('- '));
        const last = bi === blocks.length - 1;
        if (isList) {
          return (
            <View key={bi} style={{ gap: 4 }}>
              {lines.map((line, li) => (
                <View key={li} style={{ flexDirection: 'row', gap: 10, paddingRight: 8 }}>
                  <Text color="muted" style={{ lineHeight: 22 }}>
                    •
                  </Text>
                  <Text style={{ flex: 1 }}>
                    {inline(line.trim().slice(2), `${bi}-${li}`)}
                    {cursor && last && li === lines.length - 1 ? (
                      <Text color="accent"> ▍</Text>
                    ) : null}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={bi}>
            {inline(block.replace(/\n/g, ' '), String(bi))}
            {cursor && last ? <Text color="accent"> ▍</Text> : null}
          </Text>
        );
      })}
    </View>
  );
}
