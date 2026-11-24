import type { ToolConfigReport } from "core/config/toolConfigCheck";
import { useContext, useEffect, useRef, useState } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useAppSelector } from "../redux/hooks";

const STORAGE_KEY = "toolConfigNotice";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

interface Stored {
  /** Change signatures that were applied or dismissed; never prompted again. */
  handled: string[];
  /** Tool names already announced; the first run records them without announcing. */
  seenTools: string[];
  /** Signature -> time until which "Later" hides the notice. */
  snoozed: Record<string, number>;
}

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      handled: Array.isArray(raw.handled) ? raw.handled : [],
      seenTools: Array.isArray(raw.seenTools) ? raw.seenTools : [],
      snoozed:
        raw.snoozed && typeof raw.snoozed === "object" ? raw.snoozed : {},
    };
  } catch {
    return { handled: [], seenTools: [], snoozed: {} };
  }
}

function save(next: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable; the notice then simply may reappear.
  }
}

const baseName = (uri?: string) =>
  uri ? decodeURIComponent(uri.split("/").pop() ?? uri) : "";

/**
 * Tells the user when the agent tools need a configuration change, and applies the one
 * minimal edit on request. It stays hidden when nothing is required: tools that register
 * themselves never ask for a config change, and a handled change is never prompted twice.
 */
export function ToolConfigNotice() {
  const ideMessenger = useContext(IdeMessengerContext);
  const mode = useAppSelector((s) => s.session.mode);
  // A string, so the effect below only reruns when the chat model or its capability changes.
  const modelKey = useAppSelector((s) => {
    const m = s.config.config.selectedModelByRole.chat;
    return m ? `${m.title}|${m.provider}|${m.capabilities?.tools ?? ""}` : "";
  });
  const profileId = useAppSelector((s) => s.profiles.selectedProfileId);

  const [report, setReport] = useState<ToolConfigReport>();
  const [newTools, setNewTools] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const requestId = useRef(0);

  useEffect(() => {
    if (mode !== "agent" || !modelKey) {
      setReport(undefined);
      return;
    }
    const id = ++requestId.current;
    setMessage(undefined);
    setReview(false);
    void (async () => {
      const res = await ideMessenger.request("config/toolConfig", {
        action: "check",
      });
      if (id !== requestId.current || res.status !== "success") return;
      const next = res.content;
      const stored = load();

      // Tool names: the first run is the baseline, later runs announce only additions.
      const announced = stored.seenTools.length
        ? next.tools.filter((t) => !stored.seenTools.includes(t))
        : [];
      const seenTools = Array.from(
        new Set([...stored.seenTools, ...next.tools]),
      );
      if (seenTools.length !== stored.seenTools.length) {
        save({ ...stored, seenTools });
      }

      const hidden =
        !next.needsAttention ||
        stored.handled.includes(next.signature) ||
        (stored.snoozed[next.signature] ?? 0) > Date.now();
      setNewTools(announced);
      setReport(hidden ? undefined : next);
    })();
  }, [mode, modelKey, profileId, ideMessenger]);

  if (!report || !report.needsAttention) return null;

  const markHandled = () => {
    const stored = load();
    save({ ...stored, handled: [...stored.handled, report.signature] });
    setReport(undefined);
  };

  const later = () => {
    const stored = load();
    save({
      ...stored,
      snoozed: {
        ...stored.snoozed,
        [report.signature]: Date.now() + SNOOZE_MS,
      },
    });
    setReport(undefined);
  };

  const update = async () => {
    setBusy(true);
    const res = await ideMessenger.request("config/toolConfig", {
      action: "apply",
    });
    setBusy(false);
    if (res.status !== "success") {
      setMessage("The configuration could not be updated.");
      return;
    }
    if (res.content.result === "updated") {
      markHandled();
      return;
    }
    setMessage(res.content.message ?? "The configuration was not changed.");
    setReview(true);
  };

  const button =
    "bg-input text-foreground border-border cursor-pointer rounded border border-solid px-2 py-0.5 text-xs hover:opacity-80 disabled:cursor-default disabled:opacity-50";

  return (
    <div
      className="border-border mx-2 mb-1 min-w-0 rounded border border-solid px-2 py-1.5 text-xs"
      style={{ backgroundColor: "var(--vscode-editor-background)" }}
      data-testid="tool-config-notice"
    >
      <div className="text-foreground font-semibold">
        {newTools.length
          ? "New agent tools available"
          : "Agent tools need a setting"}
      </div>
      {newTools.length > 0 && (
        <ul className="text-description m-0 mt-1 list-none p-0">
          {newTools.slice(0, 6).map((t) => (
            <li key={t} className="truncate">
              ✓ {t}
            </li>
          ))}
          {newTools.length > 6 && <li>… and {newTools.length - 6} more</li>}
        </ul>
      )}
      <div className="text-description mt-1">
        Some tools require configuration updates.{" "}
        {report.changes.map((c) => c.title).join("; ")}.
      </div>

      {review && (
        <div className="mt-1 min-w-0">
          <div className="text-description">
            {report.changes.map((c) => c.description).join(" ")}
          </div>
          {report.editable && report.added ? (
            <>
              <div className="text-description mt-1">
                Adds to {baseName(report.file)} under the model:
              </div>
              <pre className="bg-input m-0 mt-0.5 max-w-full overflow-x-auto rounded p-1">
                {report.added}
              </pre>
            </>
          ) : (
            <>
              <div className="text-description mt-1">
                This file cannot be edited automatically. Add:
              </div>
              <pre className="bg-input m-0 mt-0.5 max-w-full overflow-x-auto rounded p-1">
                {report.manual}
              </pre>
            </>
          )}
        </div>
      )}
      {message && <div className="mt-1 whitespace-pre-wrap">{message}</div>}

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button className={button} onClick={() => setReview((v) => !v)}>
          Review changes
        </button>
        {report.editable && !report.result && (
          <button className={button} onClick={update} disabled={busy}>
            {busy ? "Updating…" : "Update configuration"}
          </button>
        )}
        {(!report.editable || message) && (
          <button className={button} onClick={markHandled}>
            Dismiss
          </button>
        )}
        <button className={button} onClick={later}>
          Later
        </button>
      </div>
    </div>
  );
}
