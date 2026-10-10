/**
 * Customer notification text, by message key and language. English only for now; a translation is one more
 * entry in MESSAGES. Templates may use only the variables in `Vars`: token code, counter, times and counts,
 * never anything personal.
 */
export interface Vars {
  code: string;
  counter?: string;
  time?: string; // "10:42", already formatted in the branch's time zone
  minutes?: number;
  misses?: number;
  reason?: string; // a queue reason such as "Counter 2 closed"
}
export const VAR_NAMES = ['code', 'counter', 'time', 'minutes', 'misses', 'reason'] as const satisfies readonly (keyof Vars)[];

const EN = {
  'notify.nextUp.title': "You're almost up",
  'notify.nextUp.body': 'Token {code}: expected call around {time}. Please stay nearby.',
  'notify.called.title': 'Token {code}: please go to {counter} now',
  'notify.called.body': "It's your turn. If you don't arrive soon you'll re-enter the queue near the front.",
  'notify.recalled.title': 'Last call for {code} at {counter}',
  'notify.recalled.body': 'Please go to {counter} now, or you will miss your turn.',
  'notify.missed.title': 'Token {code}: you missed your turn',
  'notify.missed.body': "Come back by {time}; you'll be called near the front.",
  'notify.noShow.title': 'Token {code} was cancelled',
  'notify.noShow.body': 'Your token was cancelled after {misses} missed calls. Please ask at the desk.',
  'notify.delay.title': 'Token {code}: about {minutes} min later',
  'notify.delay.body': 'New expected call around {time}. Why: {reason}',
} as const;

export type MessageKey = keyof typeof EN;
export type Lang = 'en';

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en: EN };

/** Fill a template. An unknown language falls back to English; a missing variable stays visible as {name}. */
export function render(key: MessageKey, vars: Vars, lang: string = 'en'): string {
  const template = (MESSAGES[lang as Lang] ?? MESSAGES.en)[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name as keyof Vars] ?? whole));
}

/** "10:42" in the server's time zone (set TZ on the host to the branch's zone). */
const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
export const fmtTime = (ms: number) => CLOCK.format(ms);
