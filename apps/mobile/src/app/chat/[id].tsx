import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type TextInputInstance,
} from 'react-native';
import { BottomSheet } from '../../components/BottomSheet';
import { Composer, SUGGESTIONS } from '../../components/chat/Composer';
import {
  AssistantMessage,
  emptyTurn,
  OtherChatRun,
  TurnView,
  UserMessage,
} from '../../components/chat/MessageView';
import { FeedbackCards } from '../../components/chat/FeedbackCards';
import { PlanView } from '../../components/PlanView';
import {
  AccentFill,
  Button,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  Screen,
  Text,
  useHaptics,
} from '../../components/ui';
import {
  ChatRequestError,
  chatResult,
  isActive,
  type Message,
  type Target,
  type Turn,
} from '../../data/chat';
import { useDraftChanges, usePlan } from '../../data/plan-data';
import { api } from '../../lib/api';
import { newRequestKey } from '../../lib/request-key';
import { useLiveState } from '../../state/live';
import type { PlanView as View_ } from '../../state/plan-selection';
import { useTheme } from '../../state/settings';

const TABS = ['Chat', 'Plan'] as const;

export default function ChatScreen() {
  const { id, prefill } = useLocalSearchParams<{ id: string; prefill?: string }>();
  const conversationId = id && id !== 'new' ? id : undefined;
  return (
    <Conversation key={conversationId ?? 'new'} conversationId={conversationId} prefill={prefill} />
  );
}

function Conversation({
  conversationId,
  prefill,
}: {
  conversationId: string | undefined;
  prefill: string | undefined;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  const client = useQueryClient();
  const live = useLiveState();
  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState(prefill ?? '');
  const [target, setTarget] = useState<Target | undefined>(undefined);
  const [attempt, setAttempt] = useState<{ key: string; content: string; target: Target } | null>(
    null,
  );
  const [actionKey] = useState(newRequestKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [planView, setPlanView] = useState<View_>('draft');
  const scrollX = useRef(new Animated.Value(0)).current;
  const pagerRef = useRef<ScrollViewInstance>(null);
  const listRef = useRef<ScrollViewInstance>(null);
  const stick = useRef(true);

  // A new prefill (from "ask your coach about this") replaces the composer text.
  useEffect(() => {
    if (prefill) setText(prefill);
  }, [prefill]);

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

  const capabilities = useQuery({
    queryKey: ['chat', 'capabilities'],
    refetchInterval: 10000,
    queryFn: async () => chatResult(await api.GET('/api/v1/chat-capabilities')),
  });
  const detail = useQuery({
    queryKey: ['chat', 'detail', conversationId],
    enabled: !!conversationId,
    queryFn: async () =>
      chatResult(
        await api.GET('/api/v1/conversations/{conversationId}', {
          params: { path: { conversationId: conversationId! } },
        }),
      ),
  });
  const conversation = detail.data;
  const planId = conversation?.planId ?? null;
  const plan = usePlan(planId);
  const draftChanges = useDraftChanges(planId ?? '', (planId && plan.data?.draft) || null);
  const run = conversation?.activeRun ?? conversation?.latestRun;
  const history = useInfiniteQuery({
    queryKey: ['chat', 'messages', conversationId],
    enabled: !!conversationId,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) =>
      chatResult(
        await api.GET('/api/v1/conversations/{conversationId}/messages', {
          params: {
            path: { conversationId: conversationId! },
            query: { ...(pageParam === undefined ? {} : { beforeSequence: pageParam }) },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextBeforeSequence ?? undefined,
  });
  const messages: Message[] = [
    ...new Map(
      history.data?.pages.flatMap((page) => page.messages).map((message) => [message.id, message]),
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const earliestMessage = messages[0]?.sequence;
  const runs = useQuery({
    queryKey: ['chat', 'runs', conversationId, earliestMessage],
    enabled: !!conversationId,
    queryFn: async () => {
      const rows: Turn[] = [];
      let beforeSequence: number | undefined;
      do {
        const page = chatResult(
          await api.GET('/api/v1/conversations/{conversationId}/runs', {
            params: {
              path: { conversationId: conversationId! },
              query: { limit: 100, ...(beforeSequence ? { beforeSequence } : {}) },
            },
          }),
        );
        rows.push(...page.runs);
        beforeSequence = page.nextBeforeSequence ?? undefined;
      } while (beforeSequence && earliestMessage !== undefined && beforeSequence > earliestMessage);
      // Seed each turn's own cache; only working turns refetch it individually.
      for (const turn of rows) client.setQueryData(['chat', 'turn', turn.id], turn);
      return rows;
    },
  });
  const turns = new Map((runs.data ?? []).map((turn) => [turn.userMessageId, turn]));
  if (run && run.conversationId === conversationId)
    turns.set(run.userMessageId, { ...(turns.get(run.userMessageId) ?? emptyTurn(run)), ...run });
  const replies = new Map(
    messages.flatMap((m) =>
      m.role === 'assistant' && m.producingRunId ? [[m.producingRunId, m]] : [],
    ),
  );
  const loaded = new Set(messages.map((m) => m.id));
  const shownInTurn = new Set(
    [...turns.values()].flatMap((turn) => {
      const reply = replies.get(turn.id);
      return reply && loaded.has(turn.userMessageId) ? [reply.id] : [];
    }),
  );

  const refresh = () => client.invalidateQueries({ queryKey: ['chat'] });
  const send = useMutation({
    mutationFn: async (request: { key: string; content: string; target: Target }) => {
      if (conversationId) {
        chatResult(
          await api.POST('/api/v1/conversations/{conversationId}/messages', {
            params: { path: { conversationId }, header: { 'idempotency-key': request.key } },
            body: { content: request.content, target: request.target },
          }),
        );
        return conversationId;
      }
      return chatResult(
        await api.POST('/api/v1/conversations', {
          params: { header: { 'idempotency-key': request.key } },
          body: { initialMessage: { content: request.content, target: null } },
        }),
      ).conversation.id;
    },
    onSuccess: (newId) => {
      setAttempt(null);
      setText('');
      setTarget(undefined);
      void refresh();
      stick.current = true;
      if (!conversationId) router.replace({ pathname: '/chat/[id]', params: { id: newId } });
    },
    onError: (error) => {
      if (error instanceof ChatRequestError && error.status >= 400 && error.status < 500)
        setAttempt(null);
    },
  });
  const change = useMutation({
    mutationFn: async (action: 'rename' | 'archive' | 'unarchive' | 'new') => {
      if (!conversation) throw new Error('Load the conversation first.');
      const params = { path: { conversationId: conversation.id } };
      if (action === 'new')
        return chatResult(
          await api.POST('/api/v1/conversations', {
            params: { header: { 'idempotency-key': actionKey } },
            body: { ...(conversation.planId ? { planId: conversation.planId } : {}) },
          }),
        ).conversation.id;
      if (action === 'rename')
        chatResult(
          await api.PATCH('/api/v1/conversations/{conversationId}', {
            params,
            body: { title: title.trim(), expectedStateVersion: conversation.stateVersion },
          }),
        );
      else
        chatResult(
          await api.POST(`/api/v1/conversations/{conversationId}/${action}`, {
            params,
            body: { expectedStateVersion: conversation.stateVersion },
          }),
        );
      return null;
    },
    onSuccess: async (newId, action) => {
      setRenaming(false);
      setMenuOpen(false);
      await refresh();
      if (newId) router.replace({ pathname: '/chat/[id]', params: { id: newId } });
      else if (action === 'archive') router.back();
    },
    onError: (_error, action) => {
      if (action === 'rename') void detail.refetch();
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (run)
        chatResult(
          await api.POST('/api/v1/agent-runs/{runId}/cancel', {
            params: { path: { runId: run.id } },
          }),
        );
    },
    onSuccess: refresh,
  });

  const running = isActive(run);
  // An uncertain send must remain retryable even when its accepted run is now active.
  const canSend =
    !send.isPending &&
    (!!attempt ||
      (!!capabilities.data?.executionAvailable &&
        !conversation?.archived &&
        !(conversationId && !conversation) &&
        !running));
  function submit() {
    if (!canSend || !text.trim()) return;
    const next = attempt ?? {
      key: newRequestKey(),
      content: text.trim(),
      target: target ?? conversation?.context ?? null,
    };
    setAttempt(next);
    send.mutate(next);
  }
  const testMode = capabilities.data?.mode === 'test';
  const locked = conversation?.context?.state === 'locked';
  const subtitle = !conversationId
    ? 'Starts when you send'
    : running
      ? 'Coach is working…'
      : planId
        ? locked
          ? `Locked v${conversation?.context?.versionNumber ?? ''} · unlock to edit`
          : 'Draft · coach can edit'
        : 'Standalone chat';
  const pending = draftChanges.data
    ? draftChanges.data.workouts.length + (draftChanges.data.omittedWorkouts ?? 0)
    : 0;

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
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const hasPlan = !!planId;
  const otherRun = run && run.conversationId !== conversationId ? run : undefined;

  const askCoach = (prompt: string) => {
    setText(prompt);
    goTo(0);
    setTimeout(() => input.current?.focus(), 250);
  };

  const transcript = (
    <ScrollView
      ref={listRef}
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 22, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      onScroll={onListScroll}
      scrollEventThrottle={32}
      onContentSizeChange={() => {
        if (stick.current) listRef.current?.scrollToEnd({ animated: true });
      }}
      showsVerticalScrollIndicator={false}
    >
      {live === 'reconnecting' && conversationId ? (
        <Text variant="caption" color="muted">
          Reconnecting live updates…
          {running ? ' Your coach keeps working and saved changes are kept.' : ''}
        </Text>
      ) : null}
      {conversationId && detail.isPending ? <LoadingState label="Loading conversation…" /> : null}
      {detail.error ? (
        <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
      ) : null}
      {conversation?.archived ? (
        <Notice
          icon="archive-outline"
          action={conversation.planArchived ? undefined : 'Restore conversation'}
          onAction={() => change.mutate('unarchive')}
        >
          {conversation.planArchived
            ? 'This conversation is archived with its plan. Restore the plan to continue.'
            : 'This conversation is archived and read-only.'}
        </Notice>
      ) : null}
      {history.hasNextPage ? (
        <Button
          label="Load older messages"
          size="sm"
          variant="ghost"
          busy={history.isFetchingNextPage}
          onPress={() => {
            stick.current = false;
            void history.fetchNextPage();
          }}
        />
      ) : null}
      {history.error ? (
        <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />
      ) : null}
      {runs.error ? (
        <Notice tone="warning" action="Retry" onAction={() => void runs.refetch()}>
          {`Could not load coaching activity and saved changes. ${runs.error.message}`}
        </Notice>
      ) : null}
      {!messages.length && !otherRun && !(conversationId && history.isPending) ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            paddingVertical: 40,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <AccentFill />
            <Ionicons name="sparkles" size={22} color={theme.onAccent} />
          </View>
          <Text variant="heading" style={{ textAlign: 'center' }}>
            How can I help with your training?
          </Text>
          <Text variant="body" color="dim" style={{ textAlign: 'center', maxWidth: 300 }}>
            {testMode
              ? 'Try a conversation. Your messages are saved, with simulated replies for now.'
              : 'Talk through your goals, your plan, your workouts and your week.'}
          </Text>
        </View>
      ) : null}
      {messages.map((message) => {
        if (shownInTurn.has(message.id)) return null;
        const turn = message.role === 'user' ? turns.get(message.id) : undefined;
        return (
          <View key={message.id} style={{ gap: 22 }}>
            {message.role === 'user' ? (
              <View style={{ gap: 8 }}>
                {message.references?.length ? (
                  <View style={{ paddingLeft: 48 }}>
                    <FeedbackCards references={message.references} />
                  </View>
                ) : null}
                <UserMessage content={message.content} />
              </View>
            ) : (
              <AssistantMessage content={message.content} testMode={testMode} />
            )}
            {turn ? (
              <TurnView
                turn={turn}
                reply={replies.get(turn.id)}
                conversation={conversation}
                testMode={testMode}
                onReview={hasPlan ? () => goTo(1) : undefined}
              />
            ) : null}
          </View>
        );
      })}
      {otherRun && conversation ? (
        <OtherChatRun run={otherRun} conversation={conversation} />
      ) : null}
    </ScrollView>
  );

  const composer = (
    <Composer
      input={input}
      text={text}
      onTextChange={(next) => {
        if (!text) setTarget(running ? undefined : (conversation?.context ?? null));
        setText(next);
      }}
      onSubmit={submit}
      placeholder={
        conversation?.context?.state === 'draft'
          ? 'Ask for a change, or just talk it through…'
          : 'Ask your coach anything…'
      }
      keyboardOpen={keyboardOpen}
      locked={!!attempt || send.isPending || !!conversation?.archived}
      canSend={canSend}
      sending={send.isPending}
      onStop={running && !attempt ? () => cancel.mutate() : undefined}
      stopping={cancel.isPending || run?.status === 'cancelling'}
      suggestions={!conversationId && !send.isPending && !attempt ? SUGGESTIONS : undefined}
      notices={
        <>
          {capabilities.data && !capabilities.data.executionAvailable ? (
            <Notice tone="warning">
              Coaching is not available yet. Your conversation history is still available.
            </Notice>
          ) : null}
          {capabilities.error ? (
            <ErrorState
              message="Could not connect to chat."
              onRetry={() => void capabilities.refetch()}
            />
          ) : null}
          {cancel.error ? <ErrorState message={cancel.error.message} /> : null}
          {send.error ? (
            <Notice
              tone="danger"
              action={
                conversation?.planId && !attempt ? 'Refresh context' : attempt ? 'Retry' : undefined
              }
              onAction={() => {
                if (attempt) submit();
                else
                  void detail.refetch().then((latest) => {
                    setTarget(latest.data?.context ?? null);
                    send.reset();
                  });
              }}
            >
              {`${send.error.message}${attempt ? ' Retry sends the same request safely.' : ''}`}
            </Notice>
          ) : null}
          {testMode && !text ? (
            <Text variant="caption" color="muted" style={{ paddingHorizontal: 4 }}>
              Test mode · replies are simulated. Try /test slow to test Stop.
            </Text>
          ) : null}
        </>
      }
    />
  );

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
              {conversation?.title ?? 'New conversation'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: running
                    ? theme.accent
                    : locked
                      ? theme.locked
                      : theme.colors.textMuted,
                }}
              />
              <Text variant="caption" numberOfLines={1}>
                {conversation?.planName ? `${conversation.planName} · ` : ''}
                {subtitle}
              </Text>
            </View>
          </View>
          {conversation ? (
            <IconButton
              icon="ellipsis-horizontal"
              accessibilityLabel="Conversation options"
              onPress={() => {
                change.reset();
                setMenuOpen(true);
              }}
            />
          ) : null}
        </View>

        {hasPlan ? (
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
                  {i === 1 && pending > 0 ? (
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
                        {pending}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={{ flex: 1 }} onLayout={onLayout}>
          {!hasPlan ? (
            <View style={{ flex: 1 }}>
              {transcript}
              {composer}
            </View>
          ) : width > 0 ? (
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
                {transcript}
                {composer}
              </View>
              <View style={{ width, flex: 1 }}>
                <ScrollView
                  contentContainerStyle={{ paddingBottom: 60 }}
                  showsVerticalScrollIndicator={false}
                >
                  {plan.data ? (
                    <PlanView
                      plan={plan.data}
                      view={planView}
                      onViewChange={setPlanView}
                      embedded
                      onAskCoach={askCoach}
                    />
                  ) : plan.error ? (
                    <ErrorState
                      style={{ margin: 20 }}
                      message={plan.error.message}
                      onRetry={() => void plan.refetch()}
                    />
                  ) : (
                    <LoadingState label="Loading plan…" style={{ padding: 20 }} />
                  )}
                </ScrollView>
              </View>
            </Animated.ScrollView>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <BottomSheet
        visible={menuOpen}
        onClose={() => {
          if (!change.isPending) {
            setMenuOpen(false);
            setRenaming(false);
          }
        }}
        title={renaming ? 'Rename conversation' : 'Conversation options'}
      >
        {conversation && renaming ? (
          <View style={{ gap: 12 }}>
            <TextInput
              autoFocus
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              editable={!change.isPending}
              accessibilityLabel="Conversation title"
              style={{
                height: 50,
                borderRadius: 16,
                paddingHorizontal: 14,
                fontSize: 16,
                color: theme.colors.text,
                backgroundColor: theme.colors.surfaceRaised,
                ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
              }}
            />
            {change.error ? <ErrorState message={change.error.message} /> : null}
            <Button
              label="Save"
              busy={change.isPending}
              disabled={!title.trim()}
              onPress={() => change.mutate('rename')}
            />
            <Button label="Cancel" variant="ghost" onPress={() => setRenaming(false)} />
          </View>
        ) : conversation ? (
          <View style={{ gap: 10 }}>
            <Button
              label="Rename conversation"
              icon="create-outline"
              variant="secondary"
              disabled={conversation.archived || change.isPending}
              onPress={() => {
                change.reset();
                setTitle(conversation.title);
                setRenaming(true);
              }}
            />
            <Button
              label={conversation.planId ? 'New chat for this plan' : 'New standalone chat'}
              icon="add-circle-outline"
              variant="secondary"
              busy={change.isPending && change.variables === 'new'}
              disabled={conversation.planArchived || change.isPending}
              onPress={() => change.mutate('new')}
            />
            <Button
              label={conversation.archived ? 'Restore conversation' : 'Archive conversation'}
              icon={conversation.archived ? 'arrow-undo' : 'archive'}
              variant={conversation.archived ? 'secondary' : 'danger'}
              busy={change.isPending && change.variables !== 'new'}
              disabled={conversation.planArchived || change.isPending || running}
              onPress={() => change.mutate(conversation.archived ? 'unarchive' : 'archive')}
            />
            {change.error ? <ErrorState message={change.error.message} /> : null}
            <Button label="Close" variant="ghost" onPress={() => setMenuOpen(false)} />
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}
