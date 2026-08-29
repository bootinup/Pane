import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  readOuterPanelPreference,
  resolveOuterPanelRenderPolicy,
  resolveOuterPanelSize,
  writeOuterPanelPreference,
  type OuterPanelConfig,
} from '../utils/outerPanelSizing';

interface UseOuterPanelResizeOptions {
  config: OuterPanelConfig;
  containerPx: number;
  enabled: boolean;
}

interface PointerTransaction {
  pointerId: number;
  target: HTMLDivElement;
  startCoordinate: number;
  startEffective: number;
  oldPreferred: number | undefined;
  previousCursor: string;
  previousUserSelect: string;
}

export interface OuterResizeSeparatorHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function useOuterPanelResize({ config, containerPx, enabled }: UseOuterPanelResizeOptions) {
  const [preferredPx, setPreferredPx] = useState<number | undefined>(() => (
    readOuterPanelPreference(config, window.localStorage)
  ));
  const [tentativePreferredPx, setTentativePreferredPx] = useState<number | undefined>();
  const transactionRef = useRef<PointerTransaction | null>(null);
  const activeTentativePreferredPx = transactionRef.current ? tentativePreferredPx : undefined;
  const size = useMemo(
    () => resolveOuterPanelSize(config, containerPx, activeTentativePreferredPx ?? preferredPx),
    [activeTentativePreferredPx, config, containerPx, preferredPx],
  );
  const policy = useMemo(() => resolveOuterPanelRenderPolicy(config, size, enabled), [config, enabled, size]);

  const resetDocumentInteraction = useCallback((transaction: PointerTransaction) => {
    document.body.style.cursor = transaction.previousCursor;
    document.body.style.userSelect = transaction.previousUserSelect;
    try {
      if (transaction.target.hasPointerCapture(transaction.pointerId)) {
        transaction.target.releasePointerCapture(transaction.pointerId);
      }
    } catch {
      // The capture target may already be detached when interaction is disabled.
    }
  }, []);

  const resetTransaction = useCallback(() => {
    const transaction = transactionRef.current;
    if (!transaction) return false;
    transactionRef.current = null;
    resetDocumentInteraction(transaction);
    return true;
  }, [resetDocumentInteraction]);

  const rollback = useCallback(() => {
    if (resetTransaction()) setTentativePreferredPx(undefined);
  }, [resetTransaction]);

  const commitValue = useCallback((nextPreferred: number) => {
    const normalized = Math.max(1, Math.min(8192, Math.round(nextPreferred)));
    setPreferredPx(normalized);
    setTentativePreferredPx(undefined);
    writeOuterPanelPreference(config, window.localStorage, normalized);
  }, [config]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!policy.separatorVisible) return;
    rollback();
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const coordinate = config.axis === 'width' ? event.clientX : event.clientY;
    transactionRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startCoordinate: coordinate,
      startEffective: size.effectivePx,
      oldPreferred: preferredPx,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = config.axis === 'width' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [config.axis, policy.separatorVisible, preferredPx, rollback, size.effectivePx]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const transaction = transactionRef.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const coordinate = config.axis === 'width' ? event.clientX : event.clientY;
    setTentativePreferredPx(transaction.startEffective + transaction.startCoordinate - coordinate);
  }, [config.axis]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const transaction = transactionRef.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    const coordinate = config.axis === 'width' ? event.clientX : event.clientY;
    const displacement = transaction.startCoordinate - coordinate;
    const candidate = resolveOuterPanelSize(
      config,
      containerPx,
      transaction.startEffective + displacement,
    ).effectivePx;
    const previous = resolveOuterPanelSize(config, containerPx, transaction.oldPreferred).effectivePx;
    transactionRef.current = null;
    resetDocumentInteraction(transaction);
    if (displacement !== 0 && candidate > 0 && candidate !== previous) {
      commitValue(candidate);
    } else {
      setTentativePreferredPx(undefined);
    }
  }, [commitValue, config, containerPx, resetDocumentInteraction]);

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (transactionRef.current?.pointerId !== event.pointerId) return;
    rollback();
  }, [rollback]);

  const onLostPointerCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (transactionRef.current?.pointerId === event.pointerId) rollback();
  }, [rollback]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!policy.separatorVisible) return;
    const step = event.shiftKey ? 50 : 10;
    let next: number | undefined;
    if (config.axis === 'width' && event.key === 'ArrowLeft') next = size.effectivePx + step;
    if (config.axis === 'width' && event.key === 'ArrowRight') next = size.effectivePx - step;
    if (config.axis === 'height' && event.key === 'ArrowUp') next = size.effectivePx + step;
    if (config.axis === 'height' && event.key === 'ArrowDown') next = size.effectivePx - step;
    if (event.key === 'Home') next = size.floor;
    if (event.key === 'End') next = size.cap;
    if (next === undefined) return;
    event.preventDefault();
    const resolved = resolveOuterPanelSize(config, containerPx, next).effectivePx;
    if (resolved !== size.effectivePx && resolved > 0) commitValue(resolved);
  }, [commitValue, config, containerPx, policy.separatorVisible, size]);

  useEffect(() => {
    if (!policy.separatorVisible) resetTransaction();
  }, [policy.separatorVisible, resetTransaction]);

  useEffect(() => () => {
    resetTransaction();
  }, [resetTransaction]);

  return {
    preferredPx,
    effectivePx: size.effectivePx,
    floor: size.floor,
    cap: size.cap,
    renderedPx: policy.renderedPx,
    bodyActive: policy.bodyActive,
    separatorVisible: policy.separatorVisible,
    separatorHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onKeyDown,
    } satisfies OuterResizeSeparatorHandlers,
  };
}
