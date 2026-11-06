import { router } from 'expo-router';
import { useAskAgent, useInAppCoach } from '../data/account';
import { agentPrompt, START_PLAN_REQUEST } from '../lib/coach';
import { Button } from './ui';

/** The primary way to start a plan: a chat with the in-app coach, or the athlete's own agent. */
export function StartPlanButton({ coachLabel }: { coachLabel: string }) {
  const coach = useInAppCoach();
  const askAgent = useAskAgent();
  return coach ? (
    <Button label={coachLabel} icon="chatbubble-ellipses" onPress={() => router.push('/coach')} />
  ) : (
    <Button
      label="Ask your agent"
      icon="chatbubble-ellipses"
      onPress={() => askAgent(agentPrompt(START_PLAN_REQUEST))}
    />
  );
}
