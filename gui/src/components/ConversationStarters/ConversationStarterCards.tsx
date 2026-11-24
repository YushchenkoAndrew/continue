import { SlashCommandDescWithSource } from "core";
import { useState } from "react";
import { useBookmarkedSlashCommands } from "../../hooks/useBookmarkedSlashCommands";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { useMainEditor } from "../mainInput/TipTapEditor";
import { ConversationStarterCard } from "./ConversationStarterCard";

const NUM_CARDS_TO_RENDER = 5;

const DEFAULT_SUGGESTIONS = [
  {
    title: "Explain this project",
    text: "Explain how this project is structured. ",
  },
  { title: "Track down a bug", text: "Help me find the cause of this bug: " },
  {
    title: "Review recent changes",
    text: "Review my uncommitted changes and point out problems. ",
  },
  { title: "Implement a feature", text: "Implement this feature: " },
];

/**
 * Displays a grid of conversation starter cards for bookmarked slash commands
 */
export function ConversationStarterCards() {
  const dispatch = useAppDispatch();
  const { mainEditor } = useMainEditor();
  const [showAll, setShowAll] = useState(false);
  const { isCommandBookmarked } = useBookmarkedSlashCommands();
  const slashCommands = useAppSelector(
    (state) => state.config.config.slashCommands ?? [],
  );

  const bookmarkedSlashCommands = slashCommands.filter((command) =>
    isCommandBookmarked(command.name),
  );

  function onClick(command: SlashCommandDescWithSource) {
    mainEditor?.commands.insertPrompt({
      description: command.description,
      title: command.name,
      content: command.prompt,
    });
  }

  // Nothing bookmarked: offer a few plain starting points that just fill the composer.
  if (bookmarkedSlashCommands.length === 0) {
    return (
      <div className="flex w-full max-w-full flex-col">
        {DEFAULT_SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            className="border-chat-border text-foreground hover:bg-chat-fill rounded-chat mb-1.5 block w-full min-w-0 cursor-pointer border border-solid bg-transparent px-3 py-2 text-left text-xs transition-colors duration-150"
            onClick={() =>
              mainEditor?.chain().focus().insertContent(s.text).run()
            }
          >
            <span className="block truncate font-medium">{s.title}</span>
          </button>
        ))}
      </div>
    );
  }

  const visibleCommands = showAll
    ? bookmarkedSlashCommands
    : bookmarkedSlashCommands.slice(0, NUM_CARDS_TO_RENDER);

  const remainingCount = bookmarkedSlashCommands.length - NUM_CARDS_TO_RENDER;

  return (
    <div className="flex w-full max-w-full flex-col">
      <div className="flex flex-col">
        {visibleCommands.map((command, i) => (
          <ConversationStarterCard
            key={command.name + i}
            command={command}
            onClick={onClick}
          />
        ))}
      </div>
      {bookmarkedSlashCommands.length > NUM_CARDS_TO_RENDER && (
        <span
          className="text-description mt-0.5 cursor-pointer text-xs hover:underline"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show less" : `Show ${remainingCount} more...`}
        </span>
      )}
    </div>
  );
}
