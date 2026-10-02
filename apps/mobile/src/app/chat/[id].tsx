import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { BottomSheet } from '../../components/BottomSheet';
import { DraftPlanPage } from '../../components/chat/DraftPlanPage';
import { Composer } from '../../components/chat/Composer';
import { MessageView } from '../../components/chat/MessageView';
import { Button, IconButton, Screen, Text, useHaptics } from '../../components/ui';
import { changedWorkouts } from '../../lib/plan-selectors';
import { useChat } from '../../state/chat';
import { usePlan } from '../../state/plan';
import { useTheme } from '../../state/settings';

const TABS = ['Chat', 'Plan'] as const;

export default function ChatScreen() {
  const { id, prefill, page } = useLocalSearchParams<{
    id: string;
    prefill?: string;
    page?: string;
  }>();
  const theme = useTheme();
  const buzz = useHaptics();
  const { getConversation, send, cancel, markRead, archive, runUnlockAction } = useChat();
  const { status, version, workouts } = usePlan();
  const conversation = getConversation(String(id));

  const [width, setWidth] = useState(0);
  const [pageIndex, setPageIndex] = useState(page === 'plan' ? 1 : 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState<string | undefined>(
    prefill ? String(prefill) : undefined,
  );
  const scrollX = useRef(new Animated.Value(0)).current;
  const pagerRef = useRef<ScrollView>(null);
  const listRef = useRef<ScrollView>(null);
  const stick = useRef(true);

  const draftChanges = status === 'draft' ? changedWorkouts(workouts).length : 0;
  const running = conversation?.run === 'running';

  useEffect(() => {
    if (conversation?.unread) markRead(conversation.id);
  }, [conversation?.id, conversation?.unread, markRead]);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Land on the requested page once the pager has been measured.
  useEffect(() => {
    if (width > 0 && pageIndex === 1) {
      const t = setTimeout(() => pagerRef.current?.scrollTo({ x: width, animated: false }), 0);
      return () => clearTimeout(t);
    }
    // only on first measurement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width > 0]);

  const goTo = useCallback(
    (index: number) => {
      pagerRef.current?.scrollTo({ x: index * width, animated: true });
      setPageIndex(index);
      Keyboard.dismiss();
    },
    [width],
  );

  const onPagerEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / (width || 1));
    if (index !== pageIndex) {
      buzz('select');
      setPageIndex(index);
      Keyboard.dismiss();
    }
  };

  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    stick.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 140;
  };

  const tabWidth = useMemo(() => (width ? (width - 40) / 2 : 0), [width]);

  if (!conversation) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 20 }}>
          <IconButton
            icon="chevron-back"
            tone="filled"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          />
          <Text variant="heading">Conversation not found</Text>
        </View>
      </Screen>
    );
  }

  const subtitle = running
    ? 'Coach is working…'
    : status === 'draft'
      ? `Draft v${version} · coach can edit`
      : `Locked v${version} · unlock to edit`;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 6,
            gap: 4,
          }}
        >
          <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {conversation.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: running
                    ? theme.accent
                    : status === 'draft'
                      ? theme.colors.textMuted
                      : '#34D399',
                }}
              />
              <Text variant="caption" numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
          </View>
          <IconButton
            icon="ellipsis-horizontal"
            accessibilityLabel="Chat options"
            onPress={() => setMenuOpen(true)}
          />
        </View>

        {/* Page tabs, driven by the pager scroll position */}
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 8,
            height: 40,
            borderRadius: 14,
            padding: 3,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            flexDirection: 'row',
          }}
        >
          {width > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 3,
                bottom: 3,
                left: 3,
                width: tabWidth - 3,
                borderRadius: 11,
                backgroundColor: theme.colors.surfaceRaised,
                transform: [
                  {
                    translateX: scrollX.interpolate({
                      inputRange: [0, width],
                      outputRange: [0, tabWidth - 3],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              }}
            />
          ) : null}
          {TABS.map((label, i) => {
            const active = pageIndex === i;
            return (
              <Pressable
                key={label}
                onPress={() => goTo(i)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Ionicons
                  name={i === 0 ? 'chatbubble-ellipses' : 'calendar'}
                  size={14}
                  color={active ? theme.colors.text : theme.colors.textMuted}
                />
                <Text
                  variant="caption"
                  style={{
                    fontWeight: '800',
                    color: active ? theme.colors.text : theme.colors.textMuted,
                  }}
                >
                  {label}
                </Text>
                {i === 1 && draftChanges > 0 ? (
                  <View
                    style={{
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      paddingHorizontal: 5,
                      backgroundColor: theme.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text variant="label" numeric style={{ fontSize: 10, color: theme.onAccent }}>
                      {draftChanges}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Pager: Chat <-> Plan */}
        <View style={{ flex: 1 }} onLayout={onLayout}>
          {width > 0 ? (
            <Animated.ScrollView
              ref={pagerRef as never}
              horizontal
              pagingEnabled
              bounces={false}
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
                useNativeDriver: false,
              })}
              onMomentumScrollEnd={onPagerEnd}
              contentContainerStyle={{ width: width * 2 }}
            >
              <View style={{ width, flex: 1 }}>
                <ScrollView
                  ref={listRef}
                  style={{ flex: 1 }}
                  contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 22 }}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                  onScroll={onListScroll}
                  scrollEventThrottle={32}
                  onContentSizeChange={() => {
                    if (stick.current) listRef.current?.scrollToEnd({ animated: true });
                  }}
                  showsVerticalScrollIndicator={false}
                >
                  {conversation.messages.map((m) => (
                    <MessageView
                      key={m.id}
                      message={m}
                      onViewPlan={() => goTo(1)}
                      onUnlock={(mid) => runUnlockAction(conversation.id, mid)}
                    />
                  ))}
                </ScrollView>
                <Composer
                  running={!!running}
                  keyboardOpen={keyboardOpen}
                  initialText={composerSeed}
                  placeholder={
                    status === 'locked'
                      ? 'Ask your coach anything…'
                      : 'Ask for a change, or just talk it through…'
                  }
                  onSend={(text) => {
                    stick.current = true;
                    setComposerSeed(undefined);
                    send(conversation.id, text);
                  }}
                  onStop={() => cancel(conversation.id)}
                />
              </View>
              <DraftPlanPage
                width={width}
                onAskPlanRest={() => {
                  setComposerSeed('Plan the final two weeks');
                  goTo(0);
                }}
              />
            </Animated.ScrollView>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Chat options">
        <View style={{ gap: 10 }}>
          <Button
            label={conversation.archived ? 'Restore chat' : 'Archive chat'}
            icon={conversation.archived ? 'arrow-undo' : 'archive'}
            variant="secondary"
            onPress={() => {
              archive(conversation.id, !conversation.archived);
              setMenuOpen(false);
              if (!conversation.archived) router.back();
            }}
          />
          <Button label="Close" variant="ghost" onPress={() => setMenuOpen(false)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}
