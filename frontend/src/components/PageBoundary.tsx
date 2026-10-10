import { RefreshCw, WifiOff } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Button } from './ui';

const RELOADED_AT = 'promptly.chunkReloadAt';

/** A page chunk that can't be fetched: a tab opened before a rebuild/deploy asks for old file names, or the network dropped. */
const isChunkError = (e: unknown) =>
  e instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(e.message);

/** Reload once to pick up the current files; a stamp stops a reload loop if the chunk really is gone. */
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch { /* private mode: still try once */ }
  window.location.reload();
  return true;
}

/** Around the lazy routes: a page that fails to load shows a retry message instead of unmounting the whole app (blank screen). */
export class PageBoundary extends Component<{ children: ReactNode }, { error: unknown; reloading: boolean }> {
  state = { error: null as unknown, reloading: false };

  static getDerivedStateFromError(error: unknown) { return { error }; }

  componentDidCatch(error: unknown) {
    if (isChunkError(error) && reloadOnce()) this.setState({ reloading: true });
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (reloading) return null;
    return (
      <div className="grid min-h-[50vh] place-items-center" role="alert">
        <div className="flex flex-col items-center gap-3 text-center">
          <WifiOff className="size-10 text-muted opacity-60" />
          <div className="font-semibold text-ink-2">This page couldn't load</div>
          <div className="max-w-xs text-sm text-muted">
            {isChunkError(error) ? 'The app was updated or the connection dropped.' : 'Something went wrong showing this page.'}
          </div>
          <Button variant="ghost" icon={RefreshCw} onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }
}
