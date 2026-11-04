import { useState } from 'react'

import type { AutomaticBackupStatus, MaintenanceAction } from '@shared/contract'
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
  automaticBackup,
  mode = 'all',
}: {
  onRun: (action: MaintenanceAction) => void
  busy: MaintenanceAction | null
  /** The holdings store the actions read and write. */
  sourcePath: string
  lastBackupAt?: number
  automaticBackup?: AutomaticBackupStatus
  mode?: 'all' | 'backups' | 'maintenance'
}) {
  const [pending, setPending] = useState<MaintenanceAction | null>(null)
  const confirmation = pending ? CONFIRMATIONS[pending] : undefined
  const latestBackupAt = Math.max(lastBackupAt ?? 0, automaticBackup?.savedAt ?? 0)
  const backupDue = !latestBackupAt || Date.now() - latestBackupAt >= 7 * 24 * 60 * 60 * 1000

  const start = (action: MaintenanceAction) => {
    if (CONFIRMATIONS[action]) setPending(action)
    else onRun(action)
  }

  return (
    <Panel title={mode === 'maintenance' ? 'Maintenance' : 'Backups & saved data'} className={mode === 'maintenance' ? 'settings-maintenance' : ''}>
      <div className="flex flex-col gap-2 p-2">
        <SectionHeader
          title={mode === 'maintenance' ? 'Recover safely' : 'Protect your saved work'}
          hint={mode === 'maintenance' ? 'Review the scope before resetting or removing data. Both actions require confirmation.' : 'Export or restore one JSON file holding portfolios, personal finance, Cards and these settings.'}
        />
        {mode !== 'maintenance' && <>
        {automaticBackup ? (
          <div className="text-2xs text-text-muted">
            <p>Automatic backup updates the same file after every saved change.</p>
            <details className="settings-path"><summary>Show backup location</summary><p className="break-all select-text">{automaticBackup.path}</p></details>
            {automaticBackup.error ? (
              <p role="alert" className="text-warn">Automatic backup failed: {automaticBackup.error}</p>
            ) : null}
          </div>
        ) : null}
        <p className={`text-2xs ${backupDue ? 'text-warn' : 'text-text-muted'}`}>
          {backupDue ? 'Backup recommended. ' : ''}
          {latestBackupAt ? `Last backup prepared: ${timestampLabel(latestBackupAt)}.` : 'No backup export recorded yet.'}
          {' Keep a copy outside this computer.'}
        </p>
        </>}
        <div className="grid grid-cols-2 gap-2">
          {mode !== 'maintenance' && <>
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
          </>}
          {mode !== 'backups' && <>
          <Button variant="danger" disabled={busy !== null} onClick={() => start('clearUserData')}>
            {busy === 'clearUserData' ? 'Clearing...' : 'Clear All User Data and Cards'}
          </Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => start('resetCache')}>
            {busy === 'resetCache' ? 'Resetting...' : 'Reset Cache'}
          </Button>
          </>}
        </div>
        {mode !== 'backups' && <p className="text-2xs text-text-muted">Reset Cache keeps saved work. Clear User Data keeps settings and creates a rollback copy first.</p>}
        {mode !== 'maintenance' && <details className="settings-path"><summary>Show saved data location</summary>
          <p className="break-all select-text">{sourcePath || 'Not resolved'}</p>
        </details>}
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
