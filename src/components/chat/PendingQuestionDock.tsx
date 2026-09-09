import { useMemo } from 'react'
import { QuestionsBlock } from './QuestionCard'
import { pendingForSession, toAskQuestions, isComplete } from '../../lib/questions'
import { useQuestionsStore } from '../../store/questions'

// A question the GATEWAY is holding open for this session, pinned directly above the
// composer — the run is parked on it, so it is not something to scroll back for.
//
// Distinct from the cards inside a message: those come from an <ask> block or an
// ask_user tool call and are answered by sending an ordinary chat turn. This one is
// answered with `question.resolve`, which is what the parked run is actually waiting on.
// Sending the answer as a chat message instead is the failure OpenClaw 2026.9's
// "recover lost answer confirmations" fix describes.

export function PendingQuestionDock({ sessionKey }: { sessionKey?: string }) {
  const records = useQuestionsStore(s => s.records)
  const setAnswer = useQuestionsStore(s => s.setAnswer)
  const resolve = useQuestionsStore(s => s.resolve)

  const record = useMemo(
    () => pendingForSession(Object.values(records), sessionKey),
    [records, sessionKey],
  )
  if (!record) return null

  const questions = toAskQuestions(record)

  return (
    <div className="px-4 pb-2 shrink-0">
      <QuestionsBlock
        questions={questions}
        active
        onAnswer={(_text, detail) => {
          setAnswer(record.id, detail.id, detail.labels)
          // A record resolves in ONE call, so hold until every question in it has an
          // answer. Reading the store back rather than trusting `drafts` from this
          // render avoids resolving on a stale snapshot when two cards are answered
          // in quick succession.
          const collected = {
            ...useQuestionsStore.getState().drafts[record.id],
            [detail.id]: detail.labels,
          }
          if (isComplete(record, collected)) void resolve(record)
        }}
      />
    </div>
  )
}
