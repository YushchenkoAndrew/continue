import { AnimatedEllipsis } from "../../../AnimatedEllipsis";

export function GeneratingIndicator({
  text = "Generating",
  testId,
}: {
  text?: string;
  testId?: string;
}) {
  return (
    <div
      className="text-description flex min-w-0 items-center"
      data-testid={testId}
    >
      <span className="truncate text-xs" title={text}>
        {text}
      </span>
      <AnimatedEllipsis />
    </div>
  );
}
