import { useRef, useState } from "react";
import { api } from "@/api";
import { countRewriteRefs, createRewriteAction } from "@/domain/rewrite";
import type { BoardApi } from "./boardContext";
import type { ImageCardData, VideoCardData } from "@/types";

export function usePromptRewrite(id: string, data: ImageCardData | VideoCardData,
  refs: Array<{ media?: "image" | "video" | "audio" }>, board: BoardApi) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ data, refs, board });
  latest.current = { data, refs, board };
  const [run] = useState(() => createRewriteAction({
    getInput: () => ({ prompt: latest.current.data.prompt, kind: latest.current.data.kind, refs: countRewriteRefs(latest.current.refs) }),
    getPrompt: () => latest.current.data.prompt,
    apply: prompt => {
      latest.current = { ...latest.current, data: { ...latest.current.data, prompt } };
      latest.current.board.updateCard(id, { prompt });
    },
    request: input => api.rewritePrompt(input.prompt, input.kind, input.refs),
    notify: (text, action, ms) => latest.current.board.notify(text, action, ms),
    onLoading: setLoading,
    onError: setError
  }));
  return { loading, error, run };
}
