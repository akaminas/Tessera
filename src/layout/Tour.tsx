import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Compass, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { updateProfile } from '@/data/personal';
import { Button } from '@/components/ui';

/**
 * A short welcome tour: offered once after a person first signs in, then
 * replayable from the top of "How to use Tessera". Each step highlights one part of the
 * screen with a small pop-up. It covers only the basics; the full guide is
 * "How to use Tessera".
 */

interface Step {
  /** `data-tour` value of the element to highlight; none = centred card. */
  target?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    target: 'nav',
    title: 'Find your way',
    body: 'Home shows what matters today. My Work lists everything assigned to you, and Inbox collects your notifications.',
  },
  {
    target: 'projects',
    title: 'Your projects',
    body: 'Each project has a board of lists and tasks. Press + to start a new project from a template.',
  },
  {
    title: 'Boards in a nutshell',
    body: 'Lists run left to right, from “To do” to “Done”. Drag tasks between lists as work moves on, and click a task to add people, dates, checklists, files and comments.',
  },
  {
    target: 'add-task',
    title: 'Capture anything',
    body: 'Add a task from anywhere. Typing “tomorrow” or “!high” in the title sets the due date or priority for you.',
  },
  {
    target: 'search',
    title: 'Search everything',
    body: 'Find tasks, projects and comments across your workspace.',
  },
  {
    target: 'inbox',
    title: 'Stay in the loop',
    body: 'You are notified here when someone assigns you a task or mentions you with @.',
  },
  {
    target: 'workspace',
    title: 'Your workspace',
    body: 'Switch workspaces here. To invite colleagues, open Workspace in the menu and choose Members.',
  },
  {
    target: 'account',
    title: 'Settings and help',
    body: 'Settings, the dark theme and How to use Tessera live in this menu. The guide has the full step-by-step instructions, and you can take this tour again from the top of it.',
  },
];

const LOCAL_KEY = 'tessera.tour';
export const TOUR_EVENT = 'tessera:tour';

/** Ask the tour to start (used by the guide page). */
export function startTour() {
  window.dispatchEvent(new Event(TOUR_EVENT));
}

function visibleRect(name: string | undefined): DOMRect | null {
  if (!name) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Hidden (e.g. the sidebar on a phone) or off-screen: fall back to a centred card.
  if (r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= window.innerWidth) return null;
  return r;
}

export function Tour() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'off' | 'offer' | 'touring'>('off');
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const seen = (() => {
    if (profile?.preferences?.tour) return true;
    try {
      return Boolean(localStorage.getItem(LOCAL_KEY));
    } catch {
      return false;
    }
  })();

  // Offer the tour once, shortly after the app has settled.
  useEffect(() => {
    if (!profile || seen || mode !== 'off') return;
    const t = window.setTimeout(() => setMode('offer'), 600);
    return () => window.clearTimeout(t);
  }, [profile, seen, mode]);

  // Replays requested from the guide page.
  useEffect(() => {
    const replay = () => {
      setIndex(0);
      setMode('touring');
    };
    window.addEventListener(TOUR_EVENT, replay);
    return () => window.removeEventListener(TOUR_EVENT, replay);
  }, []);

  const finish = useCallback(
    (outcome: 'done' | 'skipped') => {
      setMode('off');
      try {
        localStorage.setItem(LOCAL_KEY, outcome);
      } catch {
        /* storage unavailable: the profile still remembers */
      }
      if (user && profile && profile.preferences?.tour !== outcome) {
        updateProfile(user.id, { preferences: { ...profile.preferences, tour: outcome } }).catch(() => {});
      }
    },
    [user, profile],
  );

  const step = STEPS[index];

  // Follow the highlighted element as the window changes.
  useLayoutEffect(() => {
    if (mode !== 'touring') return;
    const update = () => setRect(visibleRect(step?.target));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [mode, step?.target]);

  // Keyboard: arrows move, Escape closes.
  useEffect(() => {
    if (mode !== 'touring') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish('skipped');
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(STEPS.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mode, finish]);

  if (mode === 'off') return null;

  if (mode === 'offer') {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(1,4,9,0.45)] p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="tour-offer-title" className="w-full max-w-sm rounded-[12px] bg-surface p-6 shadow-[0_12px_32px_rgba(1,4,9,0.3)]">
          <span className="mb-3 grid size-10 place-items-center rounded-full bg-accent-soft text-teal-deep" aria-hidden>
            <Compass className="size-5" />
          </span>
          <h2 id="tour-offer-title" className="text-xl">
            Welcome to Tessera{profile?.display_name ? `, ${profile.display_name.split(' ')[0]}` : ''}
          </h2>
          <p className="mt-2 text-secondary">Would you like a one-minute tour of the basics?</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="primary"
              autoFocus
              onClick={() => {
                setIndex(0);
                setMode('touring');
              }}
            >
              Show me around
            </Button>
            <Button variant="ghost" onClick={() => finish('skipped')}>
              Not now
            </Button>
          </div>
          <p className="mt-4 text-xs text-secondary">You can take it any time from How to use Tessera, in the menu under your initials.</p>
        </div>
      </div>
    );
  }

  // Spotlight around the target, and a pop-up beside it (or centred).
  const pad = 6;
  const W = 320;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardStyle: React.CSSProperties;
  if (rect) {
    const spaceBelow = vh - rect.bottom;
    const spaceRight = vw - rect.right;
    if (spaceRight > W + 24 && rect.height > 120) {
      // Tall targets in the sidebar: pop-up to the right.
      cardStyle = { left: rect.right + 16, top: Math.min(Math.max(12, rect.top), vh - 240) };
    } else if (spaceBelow > 220) {
      cardStyle = { top: rect.bottom + 14, left: Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), vw - W - 12) };
    } else {
      cardStyle = { bottom: vh - rect.top + 14, left: Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), vw - W - 12) };
    }
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }
  const last = index === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-[8px] ring-2 ring-[var(--t-focus)] transition-all duration-200"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(1, 4, 9, 0.5)',
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-[rgba(1,4,9,0.5)]" />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-body"
        className="fixed rounded-[12px] bg-surface p-5 shadow-[0_12px_32px_rgba(1,4,9,0.35)]"
        style={{ width: W, maxWidth: 'calc(100vw - 24px)', ...cardStyle }}
      >
        <div className="flex items-start gap-2">
          <h2 id="tour-step-title" className="flex-1 text-base">
            {step.title}
          </h2>
          <button className="-mr-1 -mt-1 rounded-[4px] p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Close the tour" onClick={() => finish('skipped')}>
            <X className="size-4" />
          </button>
        </div>
        <p id="tour-step-body" className="mt-1.5 text-sm leading-relaxed text-secondary">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <span className="num flex-1 text-xs text-secondary" aria-live="polite">
            {index + 1} of {STEPS.length}
          </span>
          {index > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          {last ? (
            <Button size="sm" variant="primary" autoFocus onClick={() => finish('done')}>
              Finish
            </Button>
          ) : (
            <Button size="sm" variant="primary" autoFocus onClick={() => setIndex(index + 1)}>
              Next
            </Button>
          )}
        </div>
        {last && (
          <button
            className="mt-3 text-xs text-link underline-offset-2 hover:underline"
            onClick={() => {
              finish('done');
              navigate('/guide');
            }}
          >
            Read the full guide
          </button>
        )}
      </div>
    </div>
  );
}
