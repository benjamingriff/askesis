import { useClerk } from '@clerk/react';
import { Download, LogOut, RotateCcw } from 'lucide-react';
import { useAccountDeletion, useDataExport } from '../account';
import { formatInstantLong } from '../lib/format';
import { Button, Notice } from './ui';

/** Shown instead of the app while a requested account deletion can still be cancelled. */
export function AccountDeletionPending({ purgeAfter }: { purgeAfter: string }) {
  const clerk = useClerk();
  const { cancel } = useAccountDeletion();
  const download = useDataExport();
  return (
    <main className="account-pending">
      <span className="brand-mark">A</span>
      <span className="label">Account deletion scheduled</span>
      <h1>Your account will be deleted on {formatInstantLong(purgeAfter)}</h1>
      <p className="muted">
        Your plans, coach conversations, training log and fitness history will be permanently
        deleted then, along with your sign-in. Until then you can change your mind, or download a
        copy of your data first.
      </p>
      <div className="account-pending-actions">
        <Button
          variant="primary"
          icon={RotateCcw}
          busy={cancel.isPending}
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          Keep my account
        </Button>
        <Button
          icon={Download}
          busy={download.isPending}
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          Download my data
        </Button>
        <Button
          variant="plain"
          icon={LogOut}
          onClick={() => void clerk.signOut({ redirectUrl: '/sign-in' })}
        >
          Sign out
        </Button>
      </div>
      {cancel.error || download.error ? (
        <Notice tone="danger" role="alert">
          {(cancel.error ?? download.error)!.message}
        </Notice>
      ) : null}
    </main>
  );
}
