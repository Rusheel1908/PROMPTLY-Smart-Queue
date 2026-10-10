import { lazy } from 'react';

/** One dynamic import per page, so each page (and the libraries only it uses) is its own chunk. */
const LOADERS = {
  '/': () => import('../landing/Landing'),
  '/kiosk': () => import('../pages/Kiosk'),
  '/book': () => import('../pages/Book'),
  '/appointment': () => import('../pages/Appointment'),
  '/counter': () => import('../pages/Counter'),
  '/board': () => import('../pages/Board'),
  '/status': () => import('../pages/Status'),
  '/ops': () => import('../pages/Ops'),
  '/lab': () => import('../pages/Lab'),
} as const;

type PagePath = keyof typeof LOADERS;

export const Pages = {
  Landing: lazy(LOADERS['/']),
  Kiosk: lazy(LOADERS['/kiosk']),
  Book: lazy(LOADERS['/book']),
  Appointment: lazy(LOADERS['/appointment']),
  Counter: lazy(LOADERS['/counter']),
  Board: lazy(LOADERS['/board']),
  Status: lazy(LOADERS['/status']),
  Ops: lazy(LOADERS['/ops']),
  Lab: lazy(LOADERS['/lab']),
};

/** Pages with an id in the path ("/status/:id") share one loader. */
const WITH_ID = ['/status', '/appointment'] as const;

/** Start downloading a page's chunk ahead of navigation (nav hover/focus). The browser caches the import, so the later lazy() render is instant. */
export function prefetchPage(path: string) {
  const key = (WITH_ID.find((p) => path.startsWith(`${p}/`)) ?? path) as PagePath;
  LOADERS[key]?.().catch(() => undefined); // a failed prefetch just means lazy() fetches it again on navigation
}

/** Spread onto a link to prefetch its page on hover, keyboard focus or the start of a tap. */
export const prefetchOn = (path: string) => {
  const go = () => prefetchPage(path);
  return { onMouseEnter: go, onFocus: go, onTouchStart: go };
};
