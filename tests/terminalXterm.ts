import type { Locator } from '@playwright/test';

export interface TerminalSnapshot {
  lines: string[];
  selection: string;
  viewportY: number;
  baseY: number;
}

interface XtermBufferLineLike {
  translateToString(trimRight?: boolean): string;
}

interface XtermBufferLike {
  baseY: number;
  cursorY: number;
  length: number;
  viewportY: number;
  getLine(index: number): XtermBufferLineLike | undefined;
}

interface XtermLike {
  buffer: { active: XtermBufferLike };
  element?: HTMLElement;
  getSelection(): string;
  options: object;
  scrollLines(lines: number): void;
  select(column: number, row: number, length: number): void;
  write(data: string, callback?: () => void): void;
}

export function xtermEvaluate<T>(
  panelLocator: Locator,
  fn: (terminal: XtermLike) => T,
): Promise<T>;
export function xtermEvaluate<T, Argument>(
  panelLocator: Locator,
  fn: (terminal: XtermLike, argument: Argument) => T,
  argument: Argument,
): Promise<T>;
export async function xtermEvaluate<T, Argument>(
  panelLocator: Locator,
  fn: ((terminal: XtermLike) => T) | ((terminal: XtermLike, argument: Argument) => T),
  argument?: Argument,
): Promise<T> {
  return panelLocator.evaluate((element, { fnSource, argument }) => {
    interface HookNode {
      memoizedState?: unknown;
      next?: HookNode | null;
    }
    interface FiberNode {
      memoizedState?: HookNode | null;
      return?: FiberNode | null;
    }

    if (!(element instanceof HTMLElement)) {
      throw new Error('Terminal panel locator did not resolve to an HTML element');
    }
    const xtermElement = element.matches('.xterm')
      ? element
      : element.querySelector<HTMLElement>('.xterm');
    let reactElement: HTMLElement | null = xtermElement?.parentElement ?? element.parentElement;
    while (reactElement) {
      const fiberKey = Object.keys(reactElement).find((key) => key.startsWith('__reactFiber$'));
      if (fiberKey) {
        // SAFETY: React's private fiber key points to the linked fiber contract traversed below.
        let fiber = Object.getOwnPropertyDescriptor(reactElement, fiberKey)?.value as FiberNode | null;
        while (fiber) {
          let hook = fiber.memoizedState;
          while (hook) {
            const ref = hook.memoizedState;
            if (ref instanceof Object && 'current' in ref) {
              const candidate = ref.current;
              if (
                candidate instanceof Object
                && 'options' in candidate
                && 'buffer' in candidate
                && 'write' in candidate
                && candidate.write instanceof Function
              ) {
                // SAFETY: fnSource comes from the typed callback passed to xtermEvaluate.
                const evaluate = new Function(`return (${fnSource})`)() as (
                  terminal: XtermLike,
                  argument: Argument,
                ) => T;
                // SAFETY: the structural checks above establish the xterm API used by callbacks.
                return evaluate(candidate as XtermLike, argument);
              }
            }
            hook = hook.next;
          }
          fiber = fiber.return ?? null;
        }
      }
      reactElement = reactElement.parentElement;
    }
    throw new Error('Unable to find xterm Terminal ref from panel React fiber');
  }, { fnSource: fn.toString(), argument });
}

export async function writeLines(panelLocator: Locator, count: number): Promise<void> {
  await xtermEvaluate(panelLocator, (terminal, lineCount) => {
    const start = terminal.buffer.active.length;
    const lines = Array.from({ length: lineCount }, (_, index) => `blur-line-${start + index}`);
    terminal.write(`${lines.join('\r\n')}\r\n`);
  }, count);
}

export async function selectFirstLine(panelLocator: Locator): Promise<void> {
  await xtermEvaluate(panelLocator, (terminal) => {
    const firstLine = terminal.buffer.active.getLine(0)?.translateToString(true) ?? '';
    terminal.select(0, 0, firstLine.length);
  });
}

export async function scrollUp(panelLocator: Locator, lines: number): Promise<void> {
  await xtermEvaluate(panelLocator, (terminal, lineCount) => {
    terminal.scrollLines(-lineCount);
  }, lines);
}

export async function readSnapshot(panelLocator: Locator): Promise<TerminalSnapshot> {
  return xtermEvaluate(panelLocator, (terminal) => {
    const buffer = terminal.buffer.active;
    const lines = Array.from({ length: buffer.length }, (_, index) => (
      buffer.getLine(index)?.translateToString(true) ?? ''
    ));
    while (lines.at(-1) === '') lines.pop();
    return {
      lines,
      selection: terminal.getSelection(),
      viewportY: buffer.viewportY,
      baseY: buffer.baseY,
    };
  });
}

export async function loseWebglContext(panelLocator: Locator): Promise<boolean> {
  return xtermEvaluate(panelLocator, (terminal) => {
    for (const canvas of terminal.element?.querySelectorAll('canvas') ?? []) {
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!context) continue;
      context.getExtension('WEBGL_lose_context')?.loseContext();
      return true;
    }
    return false;
  });
}
