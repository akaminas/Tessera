import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { Button, Kbd } from '@/components/ui';
import { startTour } from '@/layout/Tour';

/**
 * "How to use Tessera": a step-by-step walkthrough, opened from the account
 * menu. Every step names the button or menu exactly as it appears on screen.
 */

interface GuideSection {
  id: string;
  title: string;
  intro: string;
  steps: ReactNode[];
  tips?: ReactNode[];
}

const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-ink">{children}</b>;

const SECTIONS: GuideSection[] = [
  {
    id: 'start',
    title: '1. Get started',
    intro: 'A workspace holds your projects and the people you work with.',
    steps: [
      <>Sign in, or create an account with your email address. You can also ask for a one-time sign-in link.</>,
      <>The first time, type a name under <B>Create a workspace</B> (for example your office or team) and press <B>Create workspace</B>.</>,
      <>To invite colleagues, click your workspace’s name in the top bar, choose <B>Members and settings</B>, then <B>Members</B>, enter their email under <B>Invite someone</B> and press <B>Create invitation</B>.</>,
      <>Copy the invitation link and send it to them. They sign in with that same email address and press <B>Accept invitation</B>.</>,
    ],
    tips: [<>Invitations only work for the email address they were created for.</>],
  },
  {
    id: 'projects',
    title: '2. Create a project',
    intro: 'Each project has its own boards, people and, if you need them, project-management modules.',
    steps: [
      <>Open <B>Projects</B> in the top bar and choose <B>New project</B>.</>,
      <>Give it a name and pick a <B>Template</B>. <B>Blank project</B> gives you one board with <B>To do</B>, <B>Doing</B> and <B>Done</B>.</>,
      <>Press <B>Create project</B>. The project opens on its board, ready for tasks.</>,
      <>Project managers can show or hide whole areas (Timeline, Budget, Risks and so on) with the <B>sliders icon</B> at the top right of the project.</>,
    ],
  },
  {
    id: 'board',
    title: '3. Work on the board',
    intro: 'A board has lists from left to right, with tasks (cards) in each list.',
    steps: [
      <>Press <B>Add a task</B> at the bottom of a list, type a title and press <Kbd>Enter</Kbd>. Paste several lines to add several tasks at once.</>,
      <>Drag a task to another list or position. Drag a list by its title to reorder lists.</>,
      <>Press <B>Add another list</B> on the right to add a column. Click a list’s title to rename it; its <B>⋯</B> menu can sort, limit, move or archive it.</>,
      <>Use the board name at the top left (<B>▾</B>) to switch between boards or create a new one.</>,
      <>Open the board’s <B>⋯</B> menu for <B>Name, description and background</B> (photos, colours and patterns), <B>Labels</B>, <B>Custom fields</B> and archived items.</>,
    ],
    tips: [<>Every new board starts with six colour labels. Give them names under <B>Labels</B> so their meaning is clear to everyone, including people who cannot tell the colours apart.</>],
  },
  {
    id: 'card',
    title: '4. Open a task',
    intro: 'Click a task to open all of its details.',
    steps: [
      <>Click the title to rename it. Tick the box beside the title to mark the task done.</>,
      <>Under <B>Add to card</B>, add <B>Members</B>, <B>Labels</B>, a <B>Checklist</B>, <B>Dates</B> or an <B>Attachment</B>. More options (subtasks, priority, status, repeat, dependencies, time and estimate) are under <B>More</B>.</>,
      <>Write details under <B>Description</B> (formatting such as **bold** and lists is supported).</>,
      <>Discuss it under <B>Comments</B>. Type <B>@</B> and a name to mention someone; they are notified.</>,
      <>Use <B>Watch</B> to be told about changes, and <B>Start timer</B> to record time spent.</>,
      <>The <B>⋯</B> menu at the top right of the task has <B>Move…</B>, <B>Copy…</B>, archive and delete.</>,
    ],
    tips: [<>Sections appear only once they hold something, so a task stays as simple as its content.</>],
  },
  {
    id: 'find',
    title: '5. Find and filter',
    intro: 'Narrow down what you see, then save the filters you use often.',
    steps: [
      <>On a board, press <B>Filter</B>. Type a keyword, tick <B>Assigned to me</B>, or choose people, due dates or labels.</>,
      <>To keep a filter, give it a name under <B>Saved filters</B> and press <B>Save</B>. Clear filters with the <B>×</B> beside the button.</>,
      <>Use the search box at the top of every page to search tasks, projects and comments across the workspace.</>,
      <>To change many tasks at once, open the board’s <B>⋯</B> menu, choose <B>Select several tasks</B>, click the tasks, then move, assign, label, date or archive them together.</>,
    ],
  },
  {
    id: 'views',
    title: '6. See the project in other ways',
    intro: 'The tabs under the project name show the same tasks differently.',
    steps: [
      <><B>Table</B>: a spreadsheet of every task. Edit cells, sort, group, and export to CSV or Excel.</>,
      <><B>Timeline</B>: a Gantt chart. Drag bars to change dates. Switch to project months (M1, M2 …) for funded projects.</>,
      <><B>Calendar</B>: tasks and milestones by date. Drag a task to reschedule it.</>,
      <><B>Dashboard</B>: charts of progress and workload. <B>Map</B>: tasks that have a location.</>,
      <><B>Overview</B>: what the project is about, its people, boards and key facts.</>,
    ],
  },
  {
    id: 'day',
    title: '7. Plan your day',
    intro: 'Tessera gathers your own work from every project.',
    steps: [
      <><B>Home</B> shows today’s priorities, overdue work and upcoming deadlines. Type in the capture box to jot a task into your private Inbox.</>,
      <><B>My Work</B> lists everything assigned to you, including checklist items, grouped by when it is due.</>,
      <><B>Inbox</B> holds notifications, quick captures waiting to be sorted, and invitations.</>,
      <>Press <B>Add task</B> at the top (or <Kbd>q</Kbd>) from anywhere. Shorthand works in the title: <B>tomorrow</B>, <B>fri</B>, <B>+10d</B> or <B>2027-01-15</B> set the due date, and <B>!high</B> or <B>!urgent</B> set the priority.</>,
      <><B>Calendar</B> in the top bar shows dated work from all your projects.</>,
    ],
    tips: [<>Press <Kbd>F</Kbd> (Shift + f) for focus mode, which hides navigation and notifications.</>],
  },
  {
    id: 'team',
    title: '8. Work together',
    intro: 'Everyone sees changes as they happen; there is no need to refresh.',
    steps: [
      <>Assign people to tasks with <B>Members</B>. They are notified and the task appears in their <B>My Work</B>.</>,
      <>Mention someone with <B>@name</B> in a comment to ask them something directly.</>,
      <>The bell at the top right opens your <B>Inbox</B>; the number shows unread notifications.</>,
      <>Choose which notifications you receive under <B>Settings → Notifications</B>.</>,
      <>Project managers decide who can see a project, and who can see its budget, under the project’s settings (<B>Overview → Project settings</B>).</>,
    ],
  },
  {
    id: 'manage',
    title: '9. Manage a funded project',
    intro: 'Switch these modules on with the sliders icon when a project needs more than a board.',
    steps: [
      <><B>Work packages</B>: leads, months, effort and progress for each part of the plan.</>,
      <><B>Milestones</B>: deliverables and milestones with due months, evidence and approval.</>,
      <><B>Budget</B> and <B>KPIs</B>: partners, budget lines, spending, person-months and indicators. Only people with finance access see the money.</>,
      <><B>Risks &amp; issues</B> and <B>Meetings</B>: a risk register, and agendas whose action items become tasks.</>,
      <><B>Reports</B> in the top bar brings status, progress, KPIs, effort and finance together, with PDF and Excel export.</>,
    ],
  },
  {
    id: 'import',
    title: '10. Import and export Excel',
    intro: 'Bring in an existing plan or budget, and hand reports back in the familiar layout.',
    steps: [
      <>Open the project’s <B>Overview</B> and choose <B>Import or export workbooks</B>.</>,
      <>Choose your planning or budget workbook. Tessera shows a preview and lists anything it could not read.</>,
      <>Correct what is needed and confirm. Nothing changes until you confirm.</>,
      <>Export the plan or budget as Excel from the same page, or export any table as CSV or Excel.</>,
    ],
  },
  {
    id: 'automate',
    title: '11. Automate routine work',
    intro: 'Automations run on the server, even when nobody is signed in.',
    steps: [
      <>Turn on the <B>Automations</B> module, then open its tab.</>,
      <>Start from one of the ready-made examples, or build your own rule: something that happens (the trigger), optional conditions, and what Tessera should do.</>,
      <>Add buttons that appear on tasks or on the board, scheduled rules, and due-date reminders.</>,
      <>Each run is logged, so you can see what happened and why.</>,
    ],
  },
  {
    id: 'calendar-feed',
    title: '12. See tasks in Google or Outlook Calendar',
    intro: 'Subscribe once and your dated tasks appear in your usual calendar.',
    steps: [
      <>Open <B>Settings → Calendar feed</B> and copy your private link.</>,
      <>In Google Calendar choose <B>Other calendars → From URL</B> (in Outlook, <B>Add calendar → Subscribe from web</B>) and paste it.</>,
      <>Your calendar shows the tasks assigned to you and your projects’ milestones. If the link is ever shared by mistake, reset it on the same page.</>,
    ],
  },
  {
    id: 'obsidian',
    title: '13. Send tasks from Obsidian',
    intro: 'If you keep notes in Obsidian, the Tessera plugin turns the tasks in a note into tasks here.',
    steps: [
      <>Open <B>Settings → Obsidian</B>, download the three plugin files into a <B>tessera</B> folder inside your vault’s <B>.obsidian/plugins</B> folder, and enable <B>Tessera</B> in Obsidian’s Community plugins.</>,
      <>Click <B>Create key</B>, copy the connection code it shows once, and paste it into Obsidian under <B>Settings → Tessera</B>.</>,
      <>In a note, open the command palette and choose <B>Send the tasks in this note to Tessera</B>. Each open task (<B>- [ ] text</B>) becomes a task on the list you pick, and a small ↗ link appears on the line.</>,
      <>Dates and priorities written the way the Tasks plugin does (📅 2026-11-20, ⏫) come along. Send again after editing and the task is updated, not duplicated.</>,
      <>Choose <B>Create a Tessera project from this note</B> to start a project from a note, or <B>Tick boxes in this note for tasks done in Tessera</B> to bring completed tasks back.</>,
      <>The key can do only what you can do. Delete it on the same Settings page to disconnect a vault at any time.</>,
    ],
  },
  {
    id: 'appearance',
    title: '14. Settings and appearance',
    intro: 'The menu under your initials (top right, ▾) holds your settings, the theme and this guide.',
    steps: [
      <>Choose <B>Settings</B> for your profile, preferences, notifications, calendar feed, Obsidian connection and data export.</>,
      <>Choose <B>Dark theme</B> or <B>Light theme</B> to switch at once. Light is the default; <B>Settings → Preferences</B> can also follow your computer’s setting.</>,
      <>Under <B>Preferences</B> you can make lists denser, reduce motion and turn keyboard shortcuts off.</>,
      <>Both themes use colours chosen to stay clear for people with red-green colour blindness.</>,
    ],
  },
];

const SHORTCUTS: [string, string][] = [
  ['?', 'Show all shortcuts'],
  ['q', 'Add a task from anywhere'],
  ['/', 'Search'],
  ['f', 'Open the board filter'],
  ['n', 'Add a task to the list under the pointer'],
  ['Enter', 'Open the task under the pointer'],
  ['e', 'Rename the task under the pointer'],
  ['space', 'Assign or unassign yourself'],
  ['d', 'Mark done or not done'],
  [', and .', 'Move the task to the previous or next list'],
  ['c', 'Archive the task'],
  ['z', 'Undo the last action'],
  ['g then h / m / i / p', 'Go to Home, My Work, Inbox or Projects'],
];

export default function GuidePage() {
  const go = (id: string) => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="mx-auto flex max-w-5xl gap-10 px-4 py-8 sm:px-6">
      <nav aria-label="Guide contents" className="sticky top-6 hidden h-fit w-56 shrink-0 lg:block">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">Contents</p>
        <ol className="flex flex-col gap-0.5 text-sm">
          {[...SECTIONS, { id: 'shortcuts', title: '15. Keyboard shortcuts' }].map((s) => (
            <li key={s.id}>
              <button className="w-full rounded-[4px] px-2 py-1 text-left text-secondary hover:bg-hover hover:text-ink" onClick={() => go(s.id)}>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <article className="min-w-0 flex-1">
        <header className="mb-8">
          <h1 className="text-3xl">How to use Tessera</h1>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[8px] bg-accent-soft px-4 py-3">
            <Compass className="size-5 shrink-0 text-teal-deep" aria-hidden />
            <p className="min-w-0 flex-1 text-sm">New here? A one-minute tour points out the main parts of the screen.</p>
            <Button size="sm" variant="primary" onClick={() => startTour()}>
              Take the tour
            </Button>
          </div>
          <p className="mt-2 max-w-2xl text-secondary">
            Boards, lists and cards are at the heart of Tessera. This guide walks through each part step by step, from your
            first workspace to automations.
          </p>
        </header>

        <div className="flex flex-col gap-10">
          {SECTIONS.map((s) => (
            <section key={s.id} id={`guide-${s.id}`} aria-labelledby={`guide-${s.id}-h`} className="scroll-mt-6">
              <h2 id={`guide-${s.id}-h`} className="text-xl">
                {s.title}
              </h2>
              <p className="mt-1 text-secondary">{s.intro}</p>
              <ol className="mt-4 flex flex-col gap-3">
                {s.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-teal-deep" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
              {s.tips?.map((t, i) => (
                <p key={i} className="mt-4 rounded-[6px] bg-card px-4 py-3 text-sm">
                  <B>Tip:</B> {t}
                </p>
              ))}
            </section>
          ))}

          <section id="guide-shortcuts" aria-labelledby="guide-shortcuts-h" className="scroll-mt-6">
            <h2 id="guide-shortcuts-h" className="text-xl">
              15. Keyboard shortcuts
            </h2>
            <p className="mt-1 text-secondary">Point at a task and press a key. Press ? at any time for the full list.</p>
            <table className="mt-4 w-full max-w-xl text-sm">
              <tbody className="divide-y divide-grid">
                {SHORTCUTS.map(([k, d]) => (
                  <tr key={k}>
                    <td className="w-48 py-2 pr-4">
                      <Kbd>{k}</Kbd>
                    </td>
                    <td className="py-2">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <p className="border-t border-grid pt-6 text-sm text-secondary">
            Ready? Go to your <Link to="/projects" className="text-link underline-offset-2 hover:underline">projects</Link> or{' '}
            <Link to="/" className="text-link underline-offset-2 hover:underline">home</Link>.
          </p>
        </div>
      </article>
    </div>
  );
}
