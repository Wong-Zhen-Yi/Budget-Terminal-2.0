/** Compare small serializable request inputs before scheduling an all-page plan. */
export function subscribeRequestInputs<T>(store: {
  getState: () => T
  subscribe: (listener: (state: T) => void) => () => void
}, select: (state: T) => unknown, changed: () => void): () => void {
  let previous = JSON.stringify(select(store.getState()))
  return store.subscribe(state => {
    const next = JSON.stringify(select(state))
    if (next === previous) return
    previous = next
    changed()
  })
}
