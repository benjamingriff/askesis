import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { BottomSheet } from '../../components/BottomSheet';
import { useTabBarInset } from '../../components/FloatingTabBar';
import { PlanView } from '../../components/PlanView';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PressableScale,
  Screen,
  Text,
} from '../../components/ui';
import { StartPlanButton } from '../../components/StartPlanButton';
import { useCoachWord } from '../../data/account';
import { useActivePlans } from '../../data/plan-data';
import { formatRange } from '../../lib/format';
import { usePlanSelection } from '../../state/plan-selection';
import { useTheme } from '../../state/settings';
import { Ionicons } from '@expo/vector-icons';

/** The Plan tab: the active plan the athlete is following, with any others one switch away. */
export default function PlanScreen() {
  const tabInset = useTabBarInset();
  const theme = useTheme();
  const client = useQueryClient();
  const { selection, select } = usePlanSelection();
  const plans = useActivePlans();
  const active = plans.data ?? [];
  const plan = active.find((item) => item.id === selection?.planId) ?? active[0];
  const view =
    selection?.planId === plan?.id && selection?.view === 'draft' && plan?.draft
      ? 'draft'
      : 'locked';
  const coach = useCoachWord();
  const [switching, setSwitching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabInset }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.accentText}
            onRefresh={() => {
              setRefreshing(true);
              void client.invalidateQueries().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        {plans.error ? (
          <ErrorState
            style={{ margin: 20 }}
            message={plans.error.message}
            onRetry={() => void plans.refetch()}
          />
        ) : null}
        {plans.isPending ? (
          <LoadingState label="Loading your plan…" style={{ padding: 20 }} />
        ) : plan ? (
          <PlanView
            key={plan.id}
            plan={plan}
            view={view}
            onViewChange={(next) => select({ planId: plan.id, view: next })}
            title="Plan"
            menuActions={[
              ...(active.length > 1
                ? [
                    {
                      label: 'Switch active plan',
                      icon: 'swap-vertical' as const,
                      // iOS presents one modal at a time: open after the options sheet closes.
                      onPress: () => setTimeout(() => setSwitching(true), 350),
                    },
                  ]
                : []),
              { label: 'All plans', icon: 'library-outline', onPress: () => router.push('/plans') },
            ]}
          />
        ) : plans.data ? (
          <>
            <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
              <Text variant="title">Plan</Text>
            </View>
            <EmptyState
              style={{ margin: 20 }}
              icon="calendar-outline"
              title="No active plans"
              action={
                <>
                  <StartPlanButton coachLabel="Plan with your coach" />
                  <Button
                    label="All plans"
                    icon="library-outline"
                    variant="ghost"
                    onPress={() => router.push('/plans')}
                  />
                </>
              }
            >
              {`Lock and activate a plan from your library to see its schedule here, or start one with your ${coach}.`}
            </EmptyState>
          </>
        ) : null}
      </ScrollView>
      <BottomSheet visible={switching} onClose={() => setSwitching(false)} title="Active plans">
        <View style={{ gap: 8 }}>
          {active.map((item) => {
            const selected = item.id === plan?.id;
            const version = item.locked ?? item.draft;
            return (
              <PressableScale
                key={item.id}
                onPress={() => {
                  select({ planId: item.id, view: 'locked' });
                  setSwitching(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderRadius: 18,
                  backgroundColor: selected ? theme.accentSoft : theme.colors.surfaceRaised,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="subheading">{item.displayName}</Text>
                  <Text variant="caption">
                    {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
                  </Text>
                </View>
                {selected ? <Ionicons name="checkmark" size={18} color={theme.accentText} /> : null}
              </PressableScale>
            );
          })}
          <Button
            label="All plans"
            icon="library-outline"
            variant="ghost"
            onPress={() => {
              setSwitching(false);
              router.push('/plans');
            }}
          />
        </View>
      </BottomSheet>
    </Screen>
  );
}
