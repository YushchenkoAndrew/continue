import { ConversationStarterCards } from "../../components/ConversationStarters";
import { OnboardingCard } from "../../components/OnboardingCard";

export interface EmptyChatBodyProps {
  showOnboardingCard?: boolean;
}

export function EmptyChatBody({ showOnboardingCard }: EmptyChatBodyProps) {
  if (showOnboardingCard) {
    return (
      <div className="mx-2 mt-6">
        <OnboardingCard />
      </div>
    );
  }

  return (
    <div className="mx-auto mt-4 flex w-full min-w-0 max-w-xl flex-col gap-3 px-3">
      <div className="min-w-0">
        <h2 className="text-foreground m-0 text-base font-medium">
          How can I help?
        </h2>
        <p className="text-description m-0 mt-0.5 text-xs">
          Ask about your code, or start from a suggestion.
        </p>
      </div>
      <ConversationStarterCards />
    </div>
  );
}
