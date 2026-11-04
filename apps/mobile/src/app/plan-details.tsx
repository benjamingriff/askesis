import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DateField, Field, FormScreen, FormSection, useLeaveGuard } from '../components/forms';
import { Button, ErrorState, LoadingState, Notice, Text } from '../components/ui';
import { usePlan, writePlan, type Plan } from '../data/plan-data';
import { api } from '../lib/api';
import { result } from '../lib/result';
import { useTheme } from '../state/settings';

/** Rename a plan and edit its draft's dates and description. */
export default function PlanDetailsScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const plan = usePlan(planId ?? null);
  if (!plan.data)
    return (
      <FormScreen title="Plan details">
        {plan.error ? (
          <ErrorState message={plan.error.message} onRetry={() => void plan.refetch()} />
        ) : (
          <LoadingState label="Loading plan…" />
        )}
      </FormScreen>
    );
  return <DetailsForm plan={plan.data} />;
}

function DetailsForm({ plan }: { plan: Plan }) {
  const theme = useTheme();
  const client = useQueryClient();
  // The saved plan this form is editing. Saves send its concurrency values, so a background
  // refresh never silently overwrites someone else's change; only Refresh replaces it.
  const [baseline, setBaseline] = useState(plan);
  const version = baseline.draft ?? baseline.locked;
  const [name, setName] = useState(plan.displayName);
  const [description, setDescription] = useState(version?.description ?? '');
  const [startDate, setStartDate] = useState(version?.startDate ?? '');
  const [endDate, setEndDate] = useState(version?.endDate ?? '');
  const contentDirty =
    description !== (version?.description ?? '') ||
    startDate !== (version?.startDate ?? '') ||
    endDate !== (version?.endDate ?? '');
  const nameDirty = name.trim() !== baseline.displayName;
  const adopt = (latest: Plan) => {
    setBaseline(latest);
    writePlan(client, latest);
  };
  const save = useMutation({
    mutationFn: async () => {
      let latest = baseline;
      if (contentDirty && latest.draft) {
        latest = result(
          await api.PATCH('/api/v1/plans/{planId}/draft', {
            params: { path: { planId: plan.id } },
            body: {
              expectedDraftId: latest.draft.id,
              expectedEditNumber: latest.draft.editNumber,
              description: description || null,
              startDate: startDate || null,
              endDate: endDate || null,
            },
          }),
        );
        // If the rename below fails, a retry continues from the saved content.
        adopt(latest);
      }
      // Only rename when the user changed the name; never undo a rename made elsewhere.
      if (nameDirty && name.trim() !== latest.displayName)
        latest = result(
          await api.PATCH('/api/v1/plans/{planId}', {
            params: { path: { planId: plan.id } },
            body: { displayName: name.trim(), expectedStateVersion: latest.stateVersion },
          }),
        );
      return latest;
    },
    onSuccess: async (latest) => {
      writePlan(client, latest);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans'] }),
        client.invalidateQueries({ queryKey: ['plan-workouts'] }),
      ]);
      guard.exit(() => router.back());
    },
  });
  const refresh = useMutation({
    mutationFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}', { params: { path: { planId: plan.id } } })),
    onSuccess: (latest) => {
      adopt(latest);
      save.reset();
    },
  });
  const busy = save.isPending || refresh.isPending;
  const unsavable = baseline.archived
    ? 'This plan is archived. Copy your edits, then unarchive it to save them.'
    : !baseline.draft && contentDirty
      ? 'There is no editable draft any more. Copy your edits, then unlock the plan to save them.'
      : null;
  const datesInvalid = !!startDate && !!endDate && endDate < startDate;
  const canSave =
    !busy && !unsavable && !datesInvalid && !!name.trim() && (nameDirty || contentDirty);
  const draftLocked = !baseline.draft || busy;
  const guard = useLeaveGuard(nameDirty || contentDirty, { busy: save.isPending });
  return (
    <FormScreen
      title="Plan details"
      subtitle={plan.displayName}
      guard={guard}
      saveLabel="Save"
      canSave={canSave}
      saving={save.isPending}
      onSave={() => save.mutate()}
    >
      <Text variant="caption" color="muted">
        The name is not versioned. Dates and description belong to the draft.
      </Text>
      <FormSection>
        <Field
          label="Plan name"
          value={name}
          onChangeText={setName}
          maxLength={200}
          disabled={busy}
        />
      </FormSection>
      <FormSection title="Draft">
        {!baseline.draft ? (
          <Notice icon="lock-closed" tone="locked">
            Unlock the plan to change its dates or description.
          </Notice>
        ) : null}
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={20000}
          disabled={draftLocked}
        />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DateField
            label="Start date"
            value={startDate}
            onChange={setStartDate}
            max={endDate || undefined}
            disabled={draftLocked}
            clearable
            style={{ flex: 1 }}
          />
          <DateField
            label="End date"
            value={endDate}
            onChange={setEndDate}
            min={startDate || undefined}
            disabled={draftLocked}
            clearable
            style={{ flex: 1 }}
          />
        </View>
        {datesInvalid ? (
          <Text variant="caption" color={theme.danger}>
            The end date must be on or after the start date.
          </Text>
        ) : null}
      </FormSection>
      {unsavable ? (
        <Notice tone="warning" icon="warning">
          {unsavable}
        </Notice>
      ) : null}
      {save.error || refresh.error ? (
        <View style={{ gap: 10 }}>
          <ErrorState
            message={
              refresh.error
                ? `Couldn’t refresh the plan: ${refresh.error.message}`
                : (save.error?.message ?? '')
            }
          />
          <Button
            label="Refresh latest plan"
            icon="refresh"
            variant="secondary"
            size="md"
            busy={refresh.isPending}
            disabled={busy}
            onPress={() => refresh.mutate()}
          />
        </View>
      ) : null}
      {refresh.isSuccess ? (
        <Notice tone="warning" title="Latest plan loaded">
          {`Your edits are kept and will replace it when you save.\nSaved name: ${baseline.displayName}\nSaved description: ${version?.description || 'None'}\nSaved dates: ${version?.startDate ?? 'None'} – ${version?.endDate ?? 'None'}`}
        </Notice>
      ) : null}
    </FormScreen>
  );
}
