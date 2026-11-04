import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { StatusPill } from '../../components/PlanWidgets';
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PressableScale,
  Screen,
  ScreenHeader,
  Segmented,
  Text,
} from '../../components/ui';
import { usePlans } from '../../data/plan-data';
import { formatRange } from '../../lib/format';
import { useTheme } from '../../state/settings';

/** Every plan: the library (active and inactive) and the archive. */
export default function PlansScreen() {
  const theme = useTheme();
  const [collection, setCollection] = useState<'library' | 'archive'>('library');
  const plans = usePlans(collection);
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
      <View style={{ paddingHorizontal: 20, marginTop: 6 }}>
        <Segmented
          value={collection}
          onChange={setCollection}
          options={[
            { value: 'library', label: 'Library' },
            { value: 'archive', label: 'Archived' },
          ]}
        />
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
              icon="library-outline"
              title={collection === 'archive' ? 'Nothing archived' : 'No plans yet'}
              action={
                collection === 'library' ? (
                  <Button label="New plan" icon="add" onPress={() => router.push('/new-plan')} />
                ) : undefined
              }
            >
              {collection === 'archive'
                ? 'Archived plans are kept here and can be restored.'
                : 'Start a plan with your coach.'}
            </EmptyState>
          ) : undefined
        }
        renderItem={({ item }) => {
          const version = item.locked ?? item.draft;
          return (
            <PressableScale
              onPress={() => router.push({ pathname: '/plans/[id]', params: { id: item.id } })}
              accessibilityRole="button"
              scaleTo={0.985}
              style={{
                padding: 16,
                borderRadius: 22,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: item.active ? theme.accentBorder : theme.colors.border,
                gap: 10,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
                  {item.displayName}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <StatusPill plan={item} />
                <Text
                  variant="caption"
                  color={item.active ? 'accent' : 'muted'}
                  style={{ fontWeight: '700' }}
                >
                  {item.active ? 'Active' : 'Inactive'}
                </Text>
              </View>
              <Text variant="caption">
                {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
              </Text>
            </PressableScale>
          );
        }}
      />
    </Screen>
  );
}
