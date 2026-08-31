import { BarChart3, X } from 'lucide-react';
import { Button, IconButton } from './ui/Button';

interface AnalyticsNoticeProps {
  isOpen: boolean;
  isSubmitting: boolean;
  onDismiss: () => void;
  onOpenSettings: () => void;
  onOptOut: () => void;
}

export function AnalyticsNotice({ isOpen, isSubmitting, onDismiss, onOpenSettings, onOptOut }: AnalyticsNoticeProps) {
  if (!isOpen) return null;

  return (
    <aside
      aria-label="Analytics notice"
      className="fixed bottom-4 right-4 z-fixed w-[min(28rem,calc(100vw-2rem))] rounded-modal border border-border-primary bg-surface-primary p-4 shadow-modal"
    >
      <div className="flex items-start gap-3">
        <BarChart3 className="mt-0.5 h-5 w-5 flex-shrink-0 text-interactive" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text-primary">Anonymous product analytics are on</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Pane collects feature usage to improve the product. We never collect prompts, code, or file paths.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onOptOut} loading={isSubmitting}>
              Turn off analytics
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onOpenSettings} disabled={isSubmitting}>
              Privacy settings
            </Button>
          </div>
        </div>
        <IconButton type="button" size="sm" variant="ghost" icon={<X className="h-4 w-4" />} aria-label="Dismiss analytics notice" onClick={onDismiss} disabled={isSubmitting} />
      </div>
    </aside>
  );
}
