import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DateField, Field, FormScreen, FormSection, useLeaveGuard } from '../components/forms';
import { ErrorState, Text } from '../components/ui';
import { api } from '../lib/api';
import { useRequestKey } from '../lib/request-key';
import { result } from '../lib/result';

/** Name a plan and set its dates; the coach talks it through before writing any workouts. */
export default function NewPlanScreen() {
  const client = useQueryClient();
  const requestKey = useRequestKey();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const create = useMutation({
    mutationFn: async () =>
      result(
        await api.POST('/api/v1/plans', {
          params: { header: { 'idempotency-key': requestKey([name.trim(), startDate, endDate]) } },
          body: { displayName: name.trim(), startDate, endDate, createConversation: true },
        }),
      ),
    onSuccess: async (plan) => {
      await client.invalidateQueries({ queryKey: ['plans'] });
      guard.exit(() =>
        plan.conversationId
          ? router.replace({ pathname: '/chat/[id]', params: { id: plan.conversationId } })
          : router.replace({ pathname: '/plans/[id]', params: { id: plan.id } }),
      );
    },
  });
  const guard = useLeaveGuard(!!(name || startDate || endDate), { busy: create.isPending });
  const canSave = !!name.trim() && !!startDate && !!endDate && endDate >= startDate;
  return (
    <FormScreen
      title="New plan"
      guard={guard}
      saveLabel="Create"
      canSave={canSave}
      saving={create.isPending}
      onSave={() => create.mutate()}
    >
      <Text variant="body" color="dim">
        Name it and set the dates. Your coach will talk it through with you before writing any
        workouts.
      </Text>
      <FormSection>
        <Field
          label="Plan name"
          value={name}
          onChangeText={setName}
          placeholder="Spring half marathon"
          maxLength={200}
          autoFocus
        />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DateField
            label="Start date"
            value={startDate}
            onChange={setStartDate}
            max={endDate || undefined}
            style={{ flex: 1 }}
          />
          <DateField
            label="End date"
            value={endDate}
            onChange={setEndDate}
            min={startDate || undefined}
            style={{ flex: 1 }}
          />
        </View>
      </FormSection>
      {create.error ? <ErrorState message={create.error.message} /> : null}
    </FormScreen>
  );
}
