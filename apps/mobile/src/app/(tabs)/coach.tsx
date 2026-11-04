import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useTabBarInset } from '../../components/FloatingTabBar';
import {
  Badge,
  Button,
  ErrorState,
  IconButton,
  LoadingState,
  PressableScale,
  Screen,
  Segmented,
  Text,
  type IconName,
} from '../../components/ui';
import { useConversations } from '../../data/chat';
import { relativeTime } from '../../lib/format';
import { useTheme } from '../../state/settings';

/** The Coach list: open and archived conversations, newest activity first. */
export default function CoachScreen() {
  const tabInset = useTabBarInset();
  const theme = useTheme();
  const [tab, setTab] = useState<'open' | 'archived'>('open');
  const list = useConversations(tab === 'archived');
  const rows = [
    ...new Map(
      list.data?.pages.flatMap((page) => page.conversations).map((row) => [row.id, row]),
    ).values(),
  ];

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
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: 'new' } })}
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
      {list.error ? (
        <ErrorState
          style={{ marginHorizontal: 20, marginTop: 16 }}
          message={list.error.message}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            tintColor={theme.accentText}
            onRefresh={() => void list.refetch()}
          />
        }
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: tabInset,
          gap: 10,
          flexGrow: 1,
        }}
        ListEmptyComponent={
          list.isPending ? (
            <LoadingState label="Loading conversations…" />
          ) : (
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
          )
        }
        ListFooterComponent={
          list.hasNextPage ? (
            <Button
              label="More conversations"
              size="sm"
              variant="ghost"
              busy={list.isFetchingNextPage}
              onPress={() => void list.fetchNextPage()}
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <PressableScale
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
            accessibilityRole="button"
            scaleTo={0.985}
            style={{
              padding: 16,
              borderRadius: 22,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
                {item.title}
              </Text>
              <Text variant="caption" color="muted">
                {relativeTime(item.activityAt)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Tag
                icon={item.planName ? 'calendar' : 'chatbubble-outline'}
                label={item.planName ?? 'Standalone chat'}
                accent={!!item.planName && item.context?.state === 'draft'}
              />
              {item.context ? (
                <Tag
                  icon={item.context.state === 'locked' ? 'lock-closed' : 'create-outline'}
                  label={item.context.state === 'locked' ? 'Locked' : 'Draft'}
                />
              ) : null}
            </View>
          </PressableScale>
        )}
      />
    </Screen>
  );
}

function Tag({ icon, label, accent }: { icon: IconName; label: string; accent?: boolean }) {
  const theme = useTheme();
  return (
    <Badge
      label={label}
      icon={icon}
      size="sm"
      color={accent ? theme.accentText : theme.colors.textDim}
      background={accent ? theme.accentSoft : theme.colors.surfaceRaised}
      style={{ flexShrink: 1 }}
    />
  );
}
