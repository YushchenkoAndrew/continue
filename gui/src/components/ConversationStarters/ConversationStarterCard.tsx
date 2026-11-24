import { SlashCommandDescWithSource } from "core";

interface ConversationStarterCardProps {
  command: SlashCommandDescWithSource;
  onClick: (command: SlashCommandDescWithSource) => void;
}

export function ConversationStarterCard({
  command,
  onClick,
}: ConversationStarterCardProps) {
  return (
    <button
      type="button"
      className="border-chat-border text-foreground hover:bg-chat-fill rounded-chat mb-1.5 block w-full min-w-0 cursor-pointer border border-solid bg-transparent px-3 py-2 text-left transition-colors duration-150"
      onClick={() => onClick(command)}
    >
      <div className="truncate text-xs font-medium">{command.name}</div>
      {command.description && (
        <div className="text-description line-clamp-2 text-xs [overflow-wrap:anywhere]">
          {command.description}
        </div>
      )}
    </button>
  );
}
