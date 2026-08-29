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
  startCoordinate: number;
  startEffective: number;
  oldPreferred: number | undefined;
  displacement: number;
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
  const size = useMemo(
    () => resolveOuterPanelSize(config, containerPx, tentativePreferredPx ?? preferredPx),
    [config, containerPx, preferredPx, tentativePreferredPx],
  );
  const policy = useMemo(() => resolveOuterPanelRenderPolicy(config, size, enabled), [config, enabled, size]);
  const latestRef = useRef({ containerPx, preferredPx, size });
  latestRef.current = { containerPx, preferredPx, size };

  const resetDocumentInteraction = useCallback(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const rollback = useCallback(() => {
    if (!transactionRef.current) return;
    transactionRef.current = null;
    setTentativePreferredPx(undefined);
    resetDocumentInteraction();
  }, [resetDocumentInteraction]);

  const commitValue = useCallback((nextPreferred: number) => {
    const normalized = Math.max(1, Math.min(8192, Math.round(nextPreferred)));
    setPreferredPx(normalized);
    setTentativePreferredPx(undefined);
    writeOuterPanelPreference(config, window.localStorage, normalized);
  }, [config]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!policy.separatorVisible) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const coordinate = config.axis === 'width' ? event.clientX : event.clientY;
    transactionRef.current = {
      pointerId: event.pointerId,
      startCoordinate: coordinate,
      startEffective: size.effectivePx,
      oldPreferred: preferredPx,
      displacement: 0,
    };
    document.body.style.cursor = config.axis === 'width' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [config.axis, policy.separatorVisible, preferredPx, size.effectivePx]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const transaction = transactionRef.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const coordinate = config.axis === 'width' ? event.clientX : event.clientY;
    transaction.displacement = transaction.startCoordinate - coordinate;
    setTentativePreferredPx(transaction.startEffective + transaction.displacement);
  }, [config.axis]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const transaction = transactionRef.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    const { containerPx: latestContainer } = latestRef.current;
    const candidate = resolveOuterPanelSize(
      config,
      latestContainer,
      transaction.startEffective + transaction.displacement,
    ).effectivePx;
    const previous = resolveOuterPanelSize(config, latestContainer, transaction.oldPreferred).effectivePx;
    transactionRef.current = null;
    resetDocumentInteraction();
    if (transaction.displacement !== 0 && candidate > 0 && candidate !== previous) {
      commitValue(candidate);
    } else {
      setTentativePreferredPx(undefined);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [commitValue, config, resetDocumentInteraction]);

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (transactionRef.current?.pointerId !== event.pointerId) return;
    rollback();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [rollback]);

  const onLostPointerCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (transactionRef.current?.pointerId === event.pointerId) rollback();
  }, [rollback]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!policy.separatorVisible) return;
    const step = event.shiftKey ? 50 : 10;
    let next: number | undefined;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = size.effectivePx + step;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = size.effectivePx - step;
    if (event.key === 'Home') next = size.floor;
    if (event.key === 'End') next = size.cap;
    if (next === undefined) return;
    event.preventDefault();
    const resolved = resolveOuterPanelSize(config, containerPx, next).effectivePx;
    if (resolved !== size.effectivePx && resolved > 0) commitValue(resolved);
  }, [commitValue, config, containerPx, policy.separatorVisible, size]);

  useEffect(() => rollback, [rollback]);

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
