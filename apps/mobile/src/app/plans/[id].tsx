import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlanView } from '../../components/PlanView';
import { ErrorState, IconButton, LoadingState, Screen } from '../../components/ui';
import { usePlan } from '../../data/plan-data';
import { usePlanSelection, type PlanView as View_ } from '../../state/plan-selection';

/** One plan from the library, active or not. */
export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const plan = usePlan(id ?? null);
  const [view, setView] = useState<View_>('draft');
  // Follow later selections of this plan (a restore elsewhere opens its new draft here).
  const { selection } = usePlanSelection();
  const initial = useRef(selection);
  useEffect(() => {
    if (selection !== initial.current && selection?.planId === id) setView(selection.view);
  }, [selection, id]);
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {plan.data ? (
          <PlanView
            plan={plan.data}
            view={view}
            onViewChange={setView}
            headerLeft={
              <IconButton
                icon="chevron-back"
                tone="filled"
                size={18}
                accessibilityLabel="Back"
                onPress={() => router.back()}
              />
            }
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
    </Screen>
  );
}
