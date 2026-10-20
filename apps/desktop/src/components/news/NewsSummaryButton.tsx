import type { NewsArticle, NewsPreviewPayload } from '@shared/contract'
import { buildNewsSummaryPrompt } from '@shared/news'
import { useAgentComposer } from '@/api/agentComposer'
import { useAgentDraft } from '@/stores/agentDraft'
import { Button } from '@/components/ui/Button'

export function NewsSummaryButton({ article, preview, loading }: {
  article: NewsArticle
  preview: NewsPreviewPayload | undefined
  loading: boolean
}) {
  const { agent, pending, readingImages, chatAvailable, update, perform } = useAgentComposer()
  const reason = !chatAvailable ? 'Reveal Agent chat to summarize this story.'
    : loading ? 'Waiting for the article preview to finish loading.'
    : !agent?.connected ? 'Connect Codex in Agent chat to enable AI summaries.'
    : pending || readingImages || agent.busy ? 'Wait for the current Agent task to finish.'
    : agent.portfolioProposal ? 'Review the pending portfolio update in Agent chat first.'
    : ''

  return <Button variant="accent" disabled={!!reason}
    title={reason || 'Summarize this article in Agent chat using your connected model.'}
    onClick={() => {
      // Recheck the shared lock before sending; never replace the user's draft or attachments.
      const current = useAgentDraft.getState()
      if (reason || !current.chatAvailable || current.pendingCommands || current.readingImages) return
      update({ chatOpenRequested: true })
      void perform({ type: 'send', text: buildNewsSummaryPrompt(article, preview) })
    }}>
    AI Summary
  </Button>
}
