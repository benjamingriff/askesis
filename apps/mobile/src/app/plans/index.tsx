import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { planProgress } from '../../components/PlanView';
import { StatusPill } from '../../components/PlanWidgets';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  PressableScale,
  Screen,
  ScreenHeader,
  Segmented,
  Text,
} from '../../components/ui';
import { useCoachWord } from '../../data/account';
import { useRestorePlan } from '../../data/plan-actions';
import { useActivePlans, usePlans, type PlanSummary } from '../../data/plan-data';
import { formatInstantShort, formatRange, planName } from '../../lib/format';
import { useLocalToday } from '../../lib/use-local-today';
import { usePlanSelection } from '../../state/plan-selection';
import { useTheme } from '../../state/settings';

type Collection = 'library' | 'archive' | 'deleted';

const EMPTY: Record<
  Collection,
  { icon: 'library-outline' | 'archive-outline' | 'trash-outline'; title: string; body: string }
> = {
  library: {
    icon: 'library-outline',
    title: 'No plans yet',
    body: 'Start a plan with your {coach}.',
  },
  archive: {
    icon: 'archive-outline',
    title: 'Nothing archived',
    body: 'Archived plans are kept here and can be restored.',
  },
  deleted: {
    icon: 'trash-outline',
    title: 'Nothing deleted',
    body: 'Deleted plans stay here for 30 days so you can restore them, then they are gone for good.',
  },
};

/** Every plan: the library (active and inactive), the archive and recently deleted plans. */
export default function PlansScreen() {
  const theme = useTheme();
  const coach = useCoachWord();
  // Set when a plan was just deleted, so it can be undone from here.
  const params = useLocalSearchParams<{ deleted?: string; deletedName?: string }>();
  const [collection, setCollection] = useState<Collection>('library');
  const [deleted, setDeleted] = useState(
    params.deleted ? { id: params.deleted, name: params.deletedName ?? 'Plan' } : null,
  );
  const [restored, setRestored] = useState<string | null>(null);
  const restore = useRestorePlan();
  const plans = usePlans(collection);
  const empty = EMPTY[collection];
  // The plan Today and the Plan tab follow, chosen as Today chooses it.
  const { selection } = usePlanSelection();
  const active = useActivePlans();
  const shown = (active.data?.find((p) => p.id === selection?.planId) ?? active.data?.[0])?.id;

  const undo = (plan: { id: string; name: string }) =>
    restore.mutate(plan.id, {
      onSuccess: () => {
        setDeleted(null);
        setRestored(plan.name);
        setCollection('archive');
      },
    });

  return (
    <Screen>
      <ScreenHeader
        title="All plans"
        onBack={() => router.back()}
        right={
          <IconButton
            icon="add"
            tone="filled"
            accessibilityLabel="New plan"
            onPress={() => router.push('/new-plan')}
          />
        }
      />
      <View style={{ paddingHorizontal: 20, marginTop: 14, gap: 10 }}>
        <Segmented
          value={collection}
          onChange={(next) => {
            setRestored(null);
            setCollection(next);
          }}
          options={[
            { value: 'library', label: 'Library' },
            { value: 'archive', label: 'Archived' },
            { value: 'deleted', label: 'Deleted' },
          ]}
        />
        {deleted ? (
          <Notice
            icon="trash-outline"
            action={restore.isPending ? 'Restoring…' : 'Undo'}
            onAction={restore.isPending ? undefined : () => undo(deleted)}
          >
            {`Deleted “${deleted.name}”. You can restore it from Deleted for 30 days.`}
          </Notice>
        ) : null}
        {restored ? (
          <Notice tone="accent" icon="checkmark-circle">
            {`Restored “${restored}” to Archived. Unarchive it to use it again.`}
          </Notice>
        ) : null}
        {restore.error ? <ErrorState message={restore.error.message} /> : null}
      </View>
      {plans.isPending ? <LoadingState label="Loading plans…" style={{ padding: 20 }} /> : null}
      {plans.error ? (
        <ErrorState
          style={{ margin: 20 }}
          message={plans.error.message}
          onRetry={() => void plans.refetch()}
        />
      ) : null}
      <FlatList
        data={plans.data ?? []}
        keyExtractor={(plan) => plan.id}
        contentContainerStyle={{ padding: 20, gap: 10, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={plans.isRefetching}
            onRefresh={() => void plans.refetch()}
            tintColor={theme.colors.textDim}
          />
        }
        ListEmptyComponent={
          plans.data ? (
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              action={
                collection === 'library' ? (
                  <Button label="New plan" icon="add" onPress={() => router.push('/new-plan')} />
                ) : undefined
              }
            >
              {empty.body.replace('{coach}', coach)}
            </EmptyState>
          ) : undefined
        }
        renderItem={({ item }) =>
          collection === 'deleted' ? (
            <DeletedPlanCard
              plan={item}
              busy={restore.isPending && restore.variables === item.id}
              disabled={restore.isPending}
              onRestore={() => undo({ id: item.id, name: item.displayName })}
            />
          ) : (
            <PlanCard plan={item} shown={item.id === shown} />
          )
        }
      />
    </Screen>
  );
}

function PlanCard({ plan, shown }: { plan: PlanSummary; shown: boolean }) {
  const theme = useTheme();
  const today = useLocalToday();
  const version = plan.locked ?? plan.draft;
  const progress = planProgress(version?.startDate ?? null, version?.endDate ?? null, today);
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/plans/[id]', params: { id: plan.id } })}
      accessibilityRole="button"
      scaleTo={0.985}
      style={{
        padding: 16,
        borderRadius: 22,
        backgroundColor: theme.colors.surface,
        borderColor: shown ? theme.accentBorder : theme.colors.border,
        borderWidth: shown ? 1.5 : 1,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="subheading" numberOfLines={2} style={{ flex: 1 }}>
          {planName(plan.displayName)}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {/* Locked is the normal state: a lock by the dates says it. Drafts and archives get a pill. */}
        {plan.draft || plan.archived ? <StatusPill plan={plan} /> : null}
        {shown ? (
          <Badge
            label="On Today"
            icon="flash"
            color={theme.accentText}
            background={theme.accentSoft}
            border={theme.accentBorder}
          />
        ) : (
          <Badge
            label={plan.active ? 'Active' : 'Inactive'}
            color={theme.colors.textDim}
            background={theme.colors.surfaceRaised}
          />
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {plan.locked && !plan.draft && !plan.archived ? (
          <Ionicons
            name="lock-closed"
            size={12}
            color={theme.colors.textMuted}
            accessibilityLabel="Locked"
          />
        ) : null}
        <Text variant="caption" numeric style={{ flexShrink: 1 }}>
          {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
          {progress ? ` · ${progress.text}` : ''}
        </Text>
      </View>
    </PressableScale>
  );
}

/** A deleted plan can't be opened, only restored to the archive before it is purged. */
function DeletedPlanCard({
  plan,
  busy,
  disabled,
  onRestore,
}: {
  plan: PlanSummary;
  busy: boolean;
  disabled: boolean;
  onRestore: () => void;
}) {
  const theme = useTheme();
  const version = plan.draft ?? plan.locked;
  return (
    <View
      style={{
        padding: 16,
        borderRadius: 22,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row' }}>
        <Badge
          label={
            plan.purgeAfter
              ? `Deleted for good on ${formatInstantShort(plan.purgeAfter)}`
              : 'Deleted'
          }
          icon="trash"
          color={theme.danger}
          background={theme.dangerSoft}
        />
      </View>
      <Text variant="subheading" numberOfLines={1}>
        {plan.displayName}
      </Text>
      <Text variant="caption">
        {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
      </Text>
      <Button
        label="Restore to archive"
        icon="arrow-undo"
        variant="secondary"
        size="sm"
        busy={busy}
        disabled={disabled}
        onPress={onRestore}
        style={{ alignSelf: 'flex-start' }}
      />
    </View>
  );
}
