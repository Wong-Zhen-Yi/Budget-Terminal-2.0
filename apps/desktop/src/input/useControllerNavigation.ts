import { useEffect, useRef } from 'react'
import { startControllerNavigation, type ControllerNavigationOptions } from './controllerNavigation'

export function useControllerNavigation(options: ControllerNavigationOptions) {
  const latest = useRef(options)
  useEffect(() => { latest.current = options })
  useEffect(() => startControllerNavigation(() => latest.current), [])
}
