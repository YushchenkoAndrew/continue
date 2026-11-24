import type { ChatMessage, ContextItem } from "core";
import { LoopGuard } from "core/util/repetitionDetector";
import type { IIdeMessenger } from "../context/IdeMessenger";
import type {
  CouncilChatRequest,
  CouncilChatResponse,
  CouncilEvent,
  CouncilRuntime,
  FileInfo,
} from "./types";

const CONTEXT_TOOL = "prepare_context";

function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function abortError(): Error {
  return new Error("aborted");
}

/** Rejects when the signal fires, so a non-cancellable request can't hang a cancel. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export function createGuiCouncilRuntime(opts: {
  ideMessenger: IIdeMessenger;
  emit: (event: CouncilEvent) => void;
  /** Title used for logging when an agent has no explicit model. */
  defaultTitle: string;
  /** Smallest context window among the agents' models (for the thinking cap). */
  contextLength?: number;
  /** Whether the read-only prepare_context tool is available. */
  hasContextTool: boolean;
}): CouncilRuntime {
  const { ideMessenger, emit } = opts;
  let workspaceDirs: string[] | undefined;

  async function chat(req: CouncilChatRequest): Promise<CouncilChatResponse> {
    if (req.signal.aborted) throw abortError();

    // Local guard: caps runaway reasoning and repetition, then ends only this call.
    const guard = new LoopGuard(LoopGuard.thinkingCapChars(opts.contextLength));
    const guardAbort = new AbortController();
    const forward = () => guardAbort.abort();
    req.signal.addEventListener("abort", forward, { once: true });

    let text = "";
    let contentChars = 0;
    let thinkingChars = 0;
    try {
      const gen = ideMessenger.llmStreamChat(
        {
          title: req.modelTitle ?? opts.defaultTitle,
          modelTitle: req.modelTitle,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          completionOptions: {
            temperature: req.temperature,
            maxTokens: req.maxTokens,
          },
        },
        guardAbort.signal,
      );
      let next = await gen.next();
      while (!next.done) {
        for (const m of next.value) {
          const delta = textOf(m.content);
          if (m.role === "thinking") {
            thinkingChars += delta.length;
            guard.feed("thinking", delta);
          } else if (m.role === "assistant") {
            text += delta;
            contentChars += delta.length;
            guard.feed("content", delta);
          }
        }
        req.onProgress?.({ contentChars, thinkingChars });
        if (guard.tripped) {
          guardAbort.abort();
          break;
        }
        next = await gen.next();
      }
    } catch (e) {
      if (req.signal.aborted) throw abortError();
      if (!guard.tripped) throw e;
      // a guard-induced abort surfaces as an error on some transports: keep partial text
    } finally {
      req.signal.removeEventListener("abort", forward);
    }
    if (req.signal.aborted) throw abortError();
    return { text, thinkingChars, truncated: !!guard.tripped };
  }

  async function prepareContext(
    task: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (!opts.hasContextTool) return "";
    const res = await raceAbort(
      ideMessenger.request("tools/call", {
        toolCall: {
          id: `council-ctx-${Date.now()}`,
          type: "function",
          function: {
            name: CONTEXT_TOOL,
            arguments: JSON.stringify({ task }),
          },
        },
      }),
      signal,
    );
    if (res.status === "error" || res.content.errorMessage) return "";
    return res.content.contextItems
      .map((c: ContextItem) => c.content)
      .filter(Boolean)
      .join("\n\n");
  }

  async function fileInfo(path: string): Promise<FileInfo> {
    workspaceDirs ??= await ideMessenger.ide.getWorkspaceDirs();
    const clean = path.replace(/^\.\//, "");
    const candidates = clean.startsWith("file://")
      ? [clean]
      : clean.startsWith("/")
        ? [`file://${clean}`]
        : workspaceDirs.map((d) => `${d.replace(/\/$/, "")}/${clean}`);
    for (const uri of candidates) {
      try {
        if (await ideMessenger.ide.fileExists(uri)) {
          const content = await ideMessenger.ide.readFile(uri);
          return { exists: true, lineCount: content.split("\n").length };
        }
      } catch {
        // try the next candidate
      }
    }
    return { exists: false };
  }

  return { chat, prepareContext, fileInfo, emit };
}
