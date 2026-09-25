import { useState } from 'react'

import type { MaintenanceAction } from '@shared/contract'
import { SectionHeader } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { timestampLabel } from '@/lib/format'

/** The two destructive actions confirm first, the way the reference's QMessageBox does. */
const CONFIRMATIONS: Partial<Record<MaintenanceAction, { title: string; body: string; verb: string }>> =
  {
    importUserData: {
      title: 'Import User Data',
      body:
        'Importing replaces the saved holdings, options tracker, personal finance book and Cards data with the contents of the backup file. A rollback copy of the current holdings store is written beside it first.',
      verb: 'Choose Backup File',
    },
    clearUserData: {
      title: 'Clear All User Data',
      body:
        'This removes every saved portfolio, holding, options position, personal finance row and custom Card. Settings — navigation order, privacy and the clock — are kept, and a rollback copy of the holdings store is written first.',
      verb: 'Clear Everything',
    },
    resetCache: {
      title: 'Reset Cache',
      body:
        'This drops the cached quotes, charts and options data only. Saved user data is not changed; fresh market data is fetched again on the next refresh.',
      verb: 'Reset Cache',
    },
  }

/** `_build_settings_user_data_box`. */
export function UserDataPanel({
  onRun,
  busy,
  sourcePath,
  lastBackupAt,
}: {
  onRun: (action: MaintenanceAction) => void
  busy: MaintenanceAction | null
  /** The holdings store the actions read and write. */
  sourcePath: string
  lastBackupAt?: number
}) {
  const [pending, setPending] = useState<MaintenanceAction | null>(null)
  const confirmation = pending ? CONFIRMATIONS[pending] : undefined
  const backupDue = !lastBackupAt || Date.now() - lastBackupAt >= 7 * 24 * 60 * 60 * 1000

  const start = (action: MaintenanceAction) => {
    if (CONFIRMATIONS[action]) setPending(action)
    else onRun(action)
  }

  return (
    <Panel title="User Data">
      <div className="flex flex-col gap-2 p-2">
        <SectionHeader
          title="Backups and Maintenance"
          hint="Export or restore one JSON file holding portfolios, personal finance, Cards and these settings."
        />
        <p className={`text-2xs ${backupDue ? 'text-warn' : 'text-text-muted'}`}>
          {backupDue ? 'Backup recommended. ' : ''}
          {lastBackupAt ? `Last export prepared: ${timestampLabel(lastBackupAt)}.` : 'No backup export recorded yet.'}
          {' Keep a copy outside this computer.'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="accent"
            className="col-span-2"
            disabled={busy !== null}
            onClick={() => start('exportUserData')}
          >
            {busy === 'exportUserData' ? 'Exporting...' : 'Export User Data and Cards'}
          </Button>
          <Button
            variant="accent"
            className="col-span-2"
            disabled={busy !== null}
            onClick={() => start('importUserData')}
          >
            {busy === 'importUserData' ? 'Importing...' : 'Import User Data and Cards'}
          </Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => start('clearUserData')}>
            {busy === 'clearUserData' ? 'Clearing...' : 'Clear All User Data and Cards'}
          </Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => start('resetCache')}>
            {busy === 'resetCache' ? 'Resetting...' : 'Reset Cache'}
          </Button>
        </div>
        <p className="truncate text-2xs text-text-dim" title={sourcePath}>
          Store: {sourcePath || 'not resolved'}
        </p>
      </div>

      {pending && confirmation ? (
        <Modal
          title={confirmation.title}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button
                variant={pending === 'resetCache' ? 'accent' : 'danger'}
                onClick={() => {
                  const action = pending
                  setPending(null)
                  onRun(action)
                }}
              >
                {confirmation.verb}
              </Button>
            </>
          }
        >
          <p className="text-2xs text-text-muted">{confirmation.body}</p>
        </Modal>
      ) : null}
    </Panel>
  )
}
