import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { BottomSheet } from '../../components/BottomSheet';
import { Button, IconButton, PressableScale, Screen, Segmented, Text } from '../../components/ui';
import { relativeTime } from '../../data/dates';
import type { Conversation } from '../../data/types';
import { useChat } from '../../state/chat';
import { useTheme } from '../../state/settings';

function preview(c: Conversation): string {
  const last = c.messages[c.messages.length - 1];
  if (!last) return '';
  const text = last.parts.find((p) => p.type === 'text');
  if (c.run === 'running') return 'Coach is working on your plan…';
  const raw =
    text?.type === 'text'
      ? text.text
      : last.parts.some((p) => p.type === 'planUpdate')
        ? 'Updated your plan draft'
        : '';
  return `${last.role === 'user' ? 'You: ' : ''}${raw.replace(/\*\*/g, '').replace(/\n+/g, ' ')}`;
}

export default function CoachScreen() {
  const theme = useTheme();
  const { conversations, createConversation, archive } = useChat();
  const [tab, setTab] = useState<'open' | 'archived'>('open');
  const [menu, setMenu] = useState<Conversation | null>(null);

  const list = useMemo(
    () =>
      conversations
        .filter((c) => c.archived === (tab === 'archived'))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, tab],
  );

  return (
    <Screen>
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text variant="title">Coach</Text>
        <IconButton
          icon="create-outline"
          tone="accent"
          accessibilityLabel="New chat"
          onPress={() => router.push(`/chat/${createConversation()}`)}
        />
      </View>
      <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </View>
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 32,
          gap: 10,
          flexGrow: 1,
        }}
        ListEmptyComponent={
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 80,
              gap: 8,
            }}
          >
            <Ionicons name="chatbubbles-outline" size={40} color={theme.colors.textMuted} />
            <Text variant="heading">{tab === 'open' ? 'No chats yet' : 'Nothing archived'}</Text>
            <Text variant="body" color="dim" style={{ textAlign: 'center', maxWidth: 260 }}>
              {tab === 'open'
                ? 'Start a conversation to talk through your training.'
                : 'Archived chats are kept here and can be restored.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const hasPlan = item.messages.some((m) => m.parts.some((p) => p.type === 'planUpdate'));
          return (
            <PressableScale
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => setMenu(item)}
              accessibilityRole="button"
              scaleTo={0.985}
              style={{
                padding: 16,
                borderRadius: 22,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: item.unread ? theme.accentBorder : theme.colors.border,
                gap: 6,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {item.unread ? (
                  <View
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent }}
                  />
                ) : null}
                <Text variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
                  {item.title}
                </Text>
                <Text variant="caption" color="muted">
                  {relativeTime(item.updatedAt)}
                </Text>
              </View>
              <Text
                variant="body"
                color="dim"
                numberOfLines={2}
                style={{ fontSize: 14, lineHeight: 20 }}
              >
                {preview(item)}
              </Text>
              {hasPlan || item.run === 'running' ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  {item.run === 'running' ? <Tag icon="sync" label="Working" accent /> : null}
                  {hasPlan ? <Tag icon="calendar" label="Plan draft" /> : null}
                </View>
              ) : null}
            </PressableScale>
          );
        }}
      />
      <BottomSheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.title}>
        <View style={{ gap: 10 }}>
          <Button
            label={menu?.archived ? 'Restore chat' : 'Archive chat'}
            icon={menu?.archived ? 'arrow-undo' : 'archive'}
            variant="secondary"
            onPress={() => {
              if (menu) archive(menu.id, !menu.archived);
              setMenu(null);
            }}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setMenu(null)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

function Tag({
  icon,
  label,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 24,
        paddingHorizontal: 9,
        borderRadius: 12,
        backgroundColor: accent ? theme.accentSoft : theme.colors.surfaceRaised,
      }}
    >
      <Ionicons name={icon} size={11} color={accent ? theme.accentText : theme.colors.textDim} />
      <Text
        variant="caption"
        style={{
          fontSize: 11.5,
          fontWeight: '700',
          color: accent ? theme.accentText : theme.colors.textDim,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
