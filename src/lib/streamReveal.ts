export type StreamRevealHandlers = {
  onAppend: (chunk: string) => void;
};

export type StreamRevealOptions = {
  intervalMs: number;
  charsPerTick: number;
};

export type StreamRevealOptionsSource = StreamRevealOptions | (() => StreamRevealOptions);

const DEFAULT_OPTIONS: StreamRevealOptions = {
  intervalMs: 60,
  charsPerTick: 1,
};

function resolveOptions(source: StreamRevealOptionsSource): StreamRevealOptions {
  return typeof source === "function" ? source() : source;
}

function takeCodePoints(text: string, count: number): { head: string; tail: string } {
  const chars = [...text];
  if (chars.length === 0) return { head: "", tail: "" };
  const n = Math.min(count, chars.length);
  return { head: chars.slice(0, n).join(""), tail: chars.slice(n).join("") };
}

export function sliceCodePoints(text: string, start: number, end?: number): string {
  const chars = [...text];
  return chars.slice(start, end).join("");
}

export function longestCommonPrefixLength(a: string, b: string): number {
  const ac = [...a];
  const bc = [...b];
  let i = 0;
  while (i < ac.length && i < bc.length && ac[i] === bc[i]) i++;
  return i;
}

/** replace/finalContent 비교 — 줄바꿈·공백 차이(문단 정리 등) 무시 */
export function collapseStreamCompareText(text: string): string {
  return text
    .replace(/[\r\n\u00a0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** collapsed prefix 길이에 맞는 raw 문자열 끝 위치 */
export function rawPrefixForCollapsedCompare(text: string, collapsedPrefix: string): string {
  if (!collapsedPrefix) return "";
  for (let end = 0; end <= text.length; end++) {
    if (collapseStreamCompareText(text.slice(0, end)) === collapsedPrefix) {
      return text.slice(0, end);
    }
  }
  return "";
}

/** Client catch-up append — prefer streamTarget over lagging displayed text */
export function resolveStreamAppendTail(
  displayed: string,
  streamTarget: string,
  incomingTarget: string
): string | null {
  if (!incomingTarget || incomingTarget === streamTarget) return null;

  if (streamTarget && incomingTarget.startsWith(streamTarget)) {
    const tail = incomingTarget.slice(streamTarget.length);
    return tail || null;
  }

  if (
    streamTarget.length > displayed.length &&
    streamTarget.startsWith(displayed) &&
    incomingTarget.startsWith(displayed)
  ) {
    return null;
  }

  if (incomingTarget.startsWith(displayed)) {
    const tail = incomingTarget.slice(displayed.length);
    return tail || null;
  }

  return null;
}

export type StreamReplaceCatchUp = {
  mode: "instant" | "append" | "remap";
  prefix: string;
  tail: string;
};

/**
 * When collapsed prose matches, keep the already-shown newline layout.
 * Instant-snapping to a differently broken target (e.g. save-time normalize)
 * caused streaming→final paragraph count jumps (Step 7.10C).
 */
export function preferDisplayedNewlineLayout(displayed: string, target: string): string {
  if (!target) return displayed;
  if (!displayed) return target;
  if (target === displayed) return displayed;
  if (collapseStreamCompareText(displayed) === collapseStreamCompareText(target)) {
    return displayed;
  }
  return target;
}

/**
 * 서버 replace/finalContent — 스트리밍 델타와 후처리(문단 정리·분량 보정) 차이를
 * 구분해, 이미 본 본문을 처음부터 다시 타이핑하지 않도록 catch-up.
 */
export function resolveStreamReplaceCatchUp(
  displayed: string,
  target: string,
  priorTarget = ""
): StreamReplaceCatchUp | null {
  if (!target || target === displayed) return null;

  const cd = collapseStreamCompareText(displayed);
  const cn = collapseStreamCompareText(target);

  // Same prose, different newlines only — do not reflow paragraphs at complete.
  if (cd === cn) {
    return null;
  }

  if (target.startsWith(displayed)) {
    const tail = target.slice(displayed.length);
    return tail ? { mode: "append", prefix: displayed, tail } : null;
  }

  if (cn.startsWith(cd) && cd.length > 0) {
    if (cd.length >= 900) {
      return { mode: "instant", prefix: target, tail: "" };
    }
    const mapped = rawPrefixForCollapsedCompare(target, cd);
    return { mode: "remap", prefix: mapped, tail: target.slice(mapped.length) };
  }

  const cp = collapseStreamCompareText(priorTarget);
  if (cp.length > 80 && cn.startsWith(cp) && cd.length >= cp.length * 0.85) {
    const mapped = rawPrefixForCollapsedCompare(target, cp);
    return { mode: "remap", prefix: mapped, tail: target.slice(mapped.length) };
  }

  const catchUp = resolveStreamCatchUp(displayed, target);
  if (!catchUp) return null;
  if (catchUp.prefix === displayed && !catchUp.tail) return null;

  if (catchUp.prefix.length < displayed.length && cn.startsWith(cd) && cd.length >= 900) {
    return { mode: "instant", prefix: target, tail: "" };
  }

  if (catchUp.prefix.length < displayed.length && cn.startsWith(cd) && cd.length > 0) {
    const mapped = rawPrefixForCollapsedCompare(target, cd);
    return { mode: "remap", prefix: mapped, tail: target.slice(mapped.length) };
  }

  return { mode: "remap", prefix: catchUp.prefix, tail: catchUp.tail };
}

/** 스트리밍 속도 존중 — instant snap 대신 prefix·tail 큐 재생 계획 */
export function planStreamRevealCatchUp(
  displayed: string,
  target: string,
  priorTarget = "",
  streamTarget = ""
): { resetQueue: boolean; setPrefix: string; enqueue: string } | null {
  if (!target || target === displayed) return null;

  const st = streamTarget || priorTarget;
  if (st) {
    const appendTail = resolveStreamAppendTail(displayed, st, target);
    if (appendTail !== null) {
      return { resetQueue: false, setPrefix: displayed, enqueue: appendTail };
    }
    if (target === st) return null;
  }

  if (target.startsWith(displayed)) {
    if (st && st.startsWith(displayed) && st.startsWith(target) && st.length >= target.length) {
      return null;
    }
    const tail = target.slice(displayed.length);
    return tail ? { resetQueue: false, setPrefix: displayed, enqueue: tail } : null;
  }

  const catchUp = resolveStreamReplaceCatchUp(displayed, target, priorTarget);
  if (!catchUp) return null;

  if (catchUp.mode === "append") {
    return catchUp.tail
      ? { resetQueue: false, setPrefix: displayed, enqueue: catchUp.tail }
      : null;
  }

  if (catchUp.mode === "instant") {
    if (target.startsWith(displayed)) {
      const tail = target.slice(displayed.length);
      return tail ? { resetQueue: false, setPrefix: displayed, enqueue: tail } : null;
    }
    const cd = collapseStreamCompareText(displayed);
    const cn = collapseStreamCompareText(target);
    if (cd.length > 0 && cn.startsWith(cd)) {
      const mapped = rawPrefixForCollapsedCompare(target, cd);
      return {
        resetQueue: mapped !== displayed,
        setPrefix: mapped,
        enqueue: target.slice(mapped.length),
      };
    }
    const basic = resolveStreamCatchUp(displayed, target);
    if (basic) {
      return {
        resetQueue: basic.prefix !== displayed,
        setPrefix: basic.prefix,
        enqueue: basic.tail,
      };
    }
    return null;
  }

  const prefix = catchUp.prefix;
  const tail = catchUp.tail;
  if (prefix === displayed && !tail) return null;
  return { resetQueue: prefix !== displayed, setPrefix: prefix, enqueue: tail };
}

/** 표시 중인 텍스트 → 서버 목표 텍스트까지 reveal 큐에 넣을 tail·교정 prefix */
export function resolveStreamCatchUp(
  displayed: string,
  target: string
): { prefix: string; tail: string } | null {
  if (!target || target === displayed) return null;
  if (target.startsWith(displayed)) {
    const tail = target.slice(displayed.length);
    return tail ? { prefix: displayed, tail } : null;
  }
  const lcp = longestCommonPrefixLength(displayed, target);
  if (lcp <= 0) return { prefix: "", tail: target };
  const prefix = sliceCodePoints(target, 0, lcp);
  const tail = sliceCodePoints(target, lcp);
  if (!tail && prefix === displayed) return null;
  return { prefix, tail };
}

export function createStreamReveal(
  handlers: StreamRevealHandlers,
  optionsSource: StreamRevealOptionsSource = DEFAULT_OPTIONS
) {
  let pending = "";
  let timer: ReturnType<typeof setInterval> | null = null;
  let activeIntervalMs = -1;
  let paused = false;

  function readOptions(): StreamRevealOptions {
    return resolveOptions(optionsSource);
  }

  function isInstant(opts: StreamRevealOptions): boolean {
    return opts.intervalMs <= 0;
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    activeIntervalMs = -1;
  }

  function restartTimerIfNeeded(opts: StreamRevealOptions) {
    if (isInstant(opts)) {
      stopTimer();
      return;
    }
    if (!timer || !pending) return;
    if (opts.intervalMs === activeIntervalMs) return;
    stopTimer();
    timer = setInterval(tick, opts.intervalMs);
    activeIntervalMs = opts.intervalMs;
  }

  function effectiveCharsPerTick(opts: StreamRevealOptions): number {
    // 읽기 따라가기용 — 대기 큐가 쌓여도 설정 속도 유지 (가속 없음)
    return opts.charsPerTick;
  }

  function tick() {
    const opts = readOptions();
    restartTimerIfNeeded(opts);

    if (isInstant(opts)) {
      if (pending) {
        handlers.onAppend(pending);
        pending = "";
      }
      stopTimer();
      return;
    }

    if (!pending) {
      stopTimer();
      return;
    }

    const { head, tail } = takeCodePoints(pending, effectiveCharsPerTick(opts));
    pending = tail;
    if (head) handlers.onAppend(head);
    if (!pending) stopTimer();
  }

  function pump() {
    const opts = readOptions();
    if (isInstant(opts)) {
      if (pending) {
        handlers.onAppend(pending);
        pending = "";
      }
      stopTimer();
      return;
    }
    if (timer || !pending) return;
    timer = setInterval(tick, opts.intervalMs);
    activeIntervalMs = opts.intervalMs;
  }

  return {
    enqueue(text: string) {
      if (!text || paused) return;
      pending += text;
      pump();
    },
    pause() {
      paused = true;
      stopTimer();
    },
    resume() {
      paused = false;
      if (pending) pump();
    },
    isPaused() {
      return paused;
    },
    reset() {
      pending = "";
      paused = false;
      stopTimer();
    },
    flush() {
      if (pending) {
        handlers.onAppend(pending);
        pending = "";
      }
      stopTimer();
    },
    /** 슬라이더 등 설정 변경 시 진행 중인 타이머 간격을 즉시 반영 */
    syncOptions() {
      const opts = readOptions();
      if (isInstant(opts)) {
        if (pending) {
          handlers.onAppend(pending);
          pending = "";
        }
        stopTimer();
        return;
      }
      restartTimerIfNeeded(opts);
      if (!timer && pending) pump();
    },
    isIdle() {
      return !pending && !timer;
    },
    waitUntilIdle(): Promise<void> {
      return new Promise((resolve) => {
        const poll = () => {
          const opts = readOptions();
          if (!pending && !timer) {
            resolve();
            return;
          }
          setTimeout(poll, isInstant(opts) ? 16 : Math.max(16, opts.intervalMs));
        };
        poll();
      });
    },
  };
}

export type StreamRevealController = ReturnType<typeof createStreamReveal>;
