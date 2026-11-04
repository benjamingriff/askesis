import { View } from 'react-native';
import type { EffortStep, Step } from '../data/types';
import { formatCompletion, formatPaceRange, PACE_GUIDES } from '../lib/metrics';
import { useSettings, useTheme } from '../state/settings';
import { ZONE_COLORS } from '../theme/palette';
import { Text } from './ui';

function EffortRow({ step, last }: { step: EffortStep; last: boolean }) {
  const theme = useTheme();
  const { settings } = useSettings();
  const color = step.zone ? ZONE_COLORS[step.zone] : theme.colors.textDim;
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <View style={{ alignItems: 'center', width: 14 }}>
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 3,
            borderColor: color,
            marginTop: 4,
            backgroundColor: theme.colors.bg,
          }}
        />
        {!last ? (
          <View
            style={{ flex: 1, width: 2, backgroundColor: theme.colors.border, marginVertical: 2 }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <Text variant="subheading" style={{ flex: 1 }}>
            {step.label}
          </Text>
          {step.detail ? null : (
            <Text variant="subheading" numeric style={{ fontWeight: '800' }}>
              {formatCompletion(step, settings.units)}
            </Text>
          )}
        </View>
        {step.zone ? (
          <Text variant="caption" numeric>
            <Text variant="caption" style={{ color, fontWeight: '700' }}>
              {PACE_GUIDES[step.zone].label}
            </Text>
            {'  ·  '}
            {formatPaceRange(step.zone, settings.units)}
          </Text>
        ) : null}
        {step.detail ? (
          <Text variant="caption" numeric>
            {step.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function StepList({ steps }: { steps: Step[] }) {
  const theme = useTheme();
  return (
    <View>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        if (step.type === 'effort') return <EffortRow key={i} step={step} last={last} />;
        return (
          <View key={i} style={{ marginBottom: last ? 0 : 16 }}>
            <View
              style={{
                borderRadius: 18,
                backgroundColor: theme.colors.surfaceRaised,
                padding: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}
              >
                <View
                  style={{
                    paddingHorizontal: 9,
                    height: 24,
                    borderRadius: 12,
                    justifyContent: 'center',
                    backgroundColor: theme.accent,
                  }}
                >
                  <Text variant="label" color="onAccent" style={{ fontSize: 11 }}>
                    Repeat {step.count}×
                  </Text>
                </View>
              </View>
              <StepList steps={step.steps} />
            </View>
          </View>
        );
      })}
    </View>
  );
}
