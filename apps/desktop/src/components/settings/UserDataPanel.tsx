import { useState } from 'react'

import type { MaintenanceAction } from '@shared/contract'
import { SectionHeader } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'

/** The two destructive actions confirm first, the way the reference's QMessageBox does. */
const CONFIRMATIONS: Partial<Record<MaintenanceAction, { title: string; body: string; verb: string }>> =
  {
    importUserData: {
      title: 'Import User Data',
      body:
        'Importing replaces the saved holdings, options tracker and personal finance book with the contents of the backup file. A rollback copy of the current store is written beside it first.',
      verb: 'Choose Backup File',
    },
    clearUserData: {
      title: 'Clear All User Data',
      body:
        'This removes every saved portfolio, holding, options position and personal finance row. Settings — navigation order, privacy and the clock — are kept, and a rollback copy is written first.',
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
}: {
  onRun: (action: MaintenanceAction) => void
  busy: MaintenanceAction | null
  /** The holdings store the actions read and write. */
  sourcePath: string
}) {
  const [pending, setPending] = useState<MaintenanceAction | null>(null)
  const confirmation = pending ? CONFIRMATIONS[pending] : undefined

  const start = (action: MaintenanceAction) => {
    if (CONFIRMATIONS[action]) setPending(action)
    else onRun(action)
  }

  return (
    <Panel title="User Data">
      <div className="flex flex-col gap-2 p-2">
        <SectionHeader
          title="Backups and Maintenance"
          hint="Export or restore one JSON file holding the portfolios, the personal finance book and these settings."
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="accent"
            className="col-span-2"
            disabled={busy !== null}
            onClick={() => start('exportUserData')}
          >
            {busy === 'exportUserData' ? 'Exporting...' : 'Export User Data'}
          </Button>
          <Button
            variant="accent"
            className="col-span-2"
            disabled={busy !== null}
            onClick={() => start('importUserData')}
          >
            {busy === 'importUserData' ? 'Importing...' : 'Import User Data'}
          </Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => start('clearUserData')}>
            {busy === 'clearUserData' ? 'Clearing...' : 'Clear All User Data'}
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
