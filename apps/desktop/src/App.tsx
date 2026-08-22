import { useCallback, useEffect, useState } from 'react'

import { TABS } from '@shared/contract'
import { useReloadAll } from '@/api/queries'
import { StatusBar, type PanelStatus } from '@/components/chrome/StatusBar'
import { TabBar } from '@/components/chrome/TabBar'
import { DashboardPage } from '@/pages/DashboardPage'
import { PersonalFinancePage } from '@/pages/PersonalFinancePage'
import { PortfolioPage } from '@/pages/PortfolioPage'

export function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [panels, setPanels] = useState<PanelStatus[]>([])
  const [sourcePath, setSourcePath] = useState('')
  const [reloading, setReloading] = useState(false)
  const reloadAll = useReloadAll()

  const handleStatusChange = useCallback((next: PanelStatus[], path: string) => {
    setPanels(next)
    setSourcePath(path)
  }, [])

  const reload = useCallback(async () => {
    setReloading(true)
    try {
      await reloadAll()
    } finally {
      setReloading(false)
    }
  }, [reloadAll])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F5') {
        event.preventDefault()
        void reload()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reload])

  return (
    <div className="flex h-full flex-col bg-bg">
      <TabBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onReload={() => void reload()}
        reloading={reloading}
      />

      {activeTab === 'dashboard' ? (
        <DashboardPage onStatusChange={handleStatusChange} />
      ) : activeTab === 'portfolio' ? (
        <PortfolioPage onStatusChange={handleStatusChange} />
      ) : activeTab === 'personal-finance' ? (
        <PersonalFinancePage onStatusChange={handleStatusChange} />
      ) : (
        <PlaceholderPage tabId={activeTab} />
      )}

      <StatusBar panels={panels} sourcePath={sourcePath} />
    </div>
  )
}

/** Every other page is still in the PySide6 app; this says so rather than showing blank. */
function PlaceholderPage({ tabId }: { tabId: string }) {
  const label = TABS.find((tab) => tab.id === tabId)?.label ?? tabId
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <p className="text-2xs text-text-dim">{label} has not been migrated yet.</p>
    </div>
  )
}
