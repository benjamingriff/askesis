import { Maximize2, PanelRightClose } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { usePlan, type PlanView as View } from '../../plan-data';
import { PlanView } from '../PlanView';
import { Button, IconButton, LoadingState, Notice } from '../ui';

/**
 * The plan a conversation is bound to, reviewed beside the chat (or in its Plan tab on narrow
 * screens). It stays mounted while hidden, so the selected week and scroll position survive.
 */
export function ConversationPlanPanel({
  id,
  planId,
  onClose,
  onAskCoach,
}: {
  id: string;
  planId: string;
  onClose: () => void;
  onAskCoach: (prompt: string) => void;
}) {
  const plan = usePlan(planId);
  const [view, setView] = useState<View>('draft');
  return (
    <aside id={id} className="conversation-plan" aria-label="Plan">
      <div className="plan-panel-header">
        <Link
          className="icon-btn icon-btn-plain"
          to={`/plans/${planId}`}
          aria-label="Open the full plan page"
          title="Open the full plan page"
        >
          <Maximize2 size={16} aria-hidden="true" />
        </Link>
        <IconButton
          icon={PanelRightClose}
          label="Hide plan"
          className="plan-panel-close"
          size={17}
          onClick={onClose}
        />
      </div>
      {plan.data ? (
        <PlanView
          plan={plan.data}
          view={view}
          onViewChange={setView}
          embedded
          onAskCoach={onAskCoach}
        />
      ) : plan.error ? (
        <Notice
          tone="danger"
          role="alert"
          action={
            <Button size="sm" variant="ghost" onClick={() => void plan.refetch()}>
              Retry
            </Button>
          }
        >
          {plan.error.message}
        </Notice>
      ) : (
        <LoadingState>Loading plan…</LoadingState>
      )}
    </aside>
  );
}
