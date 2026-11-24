import { ToolCallState } from "core";
import { normalizeQuestions } from "core/tools/askUser";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { useAppDispatch } from "../../../redux/hooks";
import { answerAgentQuestion } from "../../../redux/thunks/answerAgentQuestion";

interface Draft {
  picked: number[];
  custom: string;
}

/** In-chat question form for ask_user; once answered it shows the answers read-only. */
export function AskUserQuestions({
  toolCallState,
}: {
  toolCallState: ToolCallState;
}) {
  const dispatch = useAppDispatch();
  const questions = useMemo(
    () => normalizeQuestions(toolCallState.parsedArgs?.questions),
    [toolCallState.parsedArgs],
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);

  if (questions.length === 0) return null;

  if (toolCallState.status !== "calling") {
    const answered = toolCallState.output?.[0]?.content;
    return (
      <div className="text-description flex flex-col gap-1 whitespace-pre-wrap px-3 py-2 text-xs">
        {answered ?? questions.map((q) => q.question).join("\n")}
      </div>
    );
  }

  const draftFor = (i: number): Draft =>
    drafts[i] ?? { picked: [], custom: "" };
  const update = (i: number, next: Draft) =>
    setDrafts((prev) => {
      const copy = questions.map(
        (_, k) => prev[k] ?? { picked: [], custom: "" },
      );
      copy[i] = next;
      return copy;
    });

  const answerFor = (i: number): string => {
    const d = draftFor(i);
    const chosen = d.picked.map((k) => questions[i].options[k]);
    return [...chosen, d.custom.trim()].filter(Boolean).join("; ");
  };
  const ready = questions.every((_, i) => answerFor(i) !== "");

  return (
    <div className="border-chat-border bg-chat-fill rounded-chat mx-2 my-1 flex min-w-0 flex-col gap-3 border border-solid px-3 py-2.5 text-sm">
      {questions.map((q, i) => {
        const d = draftFor(i);
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="font-medium [overflow-wrap:anywhere]">
              {q.question}
            </div>
            {q.options.map((opt, k) => {
              const checked = d.picked.includes(k);
              return (
                <label
                  key={k}
                  className="flex min-w-0 cursor-pointer items-center gap-2 text-xs [overflow-wrap:anywhere]"
                >
                  <input
                    className="accent-primary"
                    type={q.multiple ? "checkbox" : "radio"}
                    name={`${toolCallState.toolCallId}-${i}`}
                    checked={checked}
                    onChange={() =>
                      update(i, {
                        ...d,
                        picked: q.multiple
                          ? checked
                            ? d.picked.filter((x) => x !== k)
                            : [...d.picked, k]
                          : [k],
                        // choosing an option replaces a typed answer for single-choice questions
                        custom: q.multiple ? d.custom : "",
                      })
                    }
                  />
                  {opt}
                </label>
              );
            })}
            <input
              className="border-chat-border bg-input text-input-foreground focus:border-border-focus box-border w-full rounded-md border border-solid px-2 py-1 text-xs"
              placeholder={
                q.options.length ? "Or type your own answer" : "Your answer"
              }
              value={d.custom}
              onChange={(e) =>
                update(i, {
                  picked: q.multiple
                    ? d.picked
                    : e.target.value
                      ? []
                      : d.picked,
                  custom: e.target.value,
                })
              }
            />
          </div>
        );
      })}
      <div>
        <Button
          disabled={!ready}
          onClick={() =>
            void dispatch(
              answerAgentQuestion({
                toolCallId: toolCallState.toolCallId,
                answers: questions.map((_, i) => answerFor(i)),
              }),
            )
          }
        >
          Send answers
        </Button>
      </div>
    </div>
  );
}
