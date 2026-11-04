import { App, Editor, FuzzySuggestModal, MarkdownFileInfo, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import { TesseraApi, TesseraError, destinations, type Context, type Destination, type Http, type TaskPayload } from './api';
import { decodeConnection, type Connection } from './connection';
import { noteDescription, parseTasks, withCardLink, withChecked, type NoteTask } from './parse';

interface Saved {
  /** the connection code, as pasted */
  code: string;
  destination: Destination | null;
}

const DEFAULTS: Saved = { code: '', destination: null };

const http: Http = async ({ url, method, headers, body }) => {
  const res = await requestUrl({ url, method, headers, body, throw: false });
  return { status: res.status, text: res.text };
};

export default class TesseraPlugin extends Plugin {
  saved: Saved = { ...DEFAULTS };
  /** the person's projects, fetched when connecting (not saved) */
  context: Context | null = null;

  async onload() {
    this.saved = { ...DEFAULTS, ...(await this.loadData()) };

    this.addRibbonIcon('send', 'Send tasks in this note to Tessera', () => void this.sendFromActiveNote('note'));

    this.addCommand({
      id: 'send-note',
      name: 'Send the tasks in this note to Tessera',
      editorCallback: (editor, view) => void this.send(editor, view, 'note'),
    });
    this.addCommand({
      id: 'send-selection',
      name: 'Send the selected tasks (or this line) to Tessera',
      editorCallback: (editor, view) => void this.send(editor, view, 'selection'),
    });
    this.addCommand({
      id: 'pull-status',
      name: 'Tick boxes in this note for tasks done in Tessera',
      editorCallback: (editor) => void this.pullStatus(editor),
    });
    this.addCommand({
      id: 'create-project',
      name: 'Create a Tessera project from this note',
      editorCallback: (editor, view) => void this.createProject(editor, view),
    });
    this.addCommand({
      id: 'choose-destination',
      name: 'Choose where new tasks go in Tessera',
      callback: () => void this.chooseDestination(),
    });

    this.addSettingTab(new TesseraSettings(this.app, this));
  }

  /* ----------------------------------------------------------- connection */

  connection(): Connection | null {
    const r = decodeConnection(this.saved.code);
    return r.ok ? r.connection : null;
  }

  api(): TesseraApi | null {
    const c = this.connection();
    if (!c) {
      new Notice('Tessera is not connected yet. Open Settings → Tessera and paste your connection code.');
      return null;
    }
    return new TesseraApi(c, http);
  }

  async persist() {
    await this.saveData(this.saved);
  }

  /** Fetch the person's projects (needed to pick a destination). */
  async loadContext(api: TesseraApi): Promise<Context> {
    this.context = await api.context();
    return this.context;
  }

  fail(err: unknown) {
    new Notice(err instanceof TesseraError || err instanceof Error ? err.message : 'Something went wrong talking to Tessera.', 8000);
  }

  async chooseDestination(): Promise<Destination | null> {
    const api = this.api();
    if (!api) return null;
    try {
      const ctx = await this.loadContext(api);
      const options = destinations(ctx);
      if (!options.length) {
        new Notice('You have no project with a list yet. Create a project in Tessera, or use “Create a Tessera project from this note”.', 8000);
        return null;
      }
      const picked = await new Promise<Destination | null>((resolve) => new DestinationModal(this.app, options, resolve).open());
      if (picked) {
        this.saved.destination = picked;
        await this.persist();
        new Notice(`New tasks will go to ${picked.label}.`);
      }
      return picked;
    } catch (err) {
      this.fail(err);
      return null;
    }
  }

  /* --------------------------------------------------------------- sending */

  private async sendFromActiveNote(scope: 'note' | 'selection') {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('Open a note first.');
      return;
    }
    await this.send(view.editor, view, scope);
  }

  /** Tasks in scope: the whole note, or the selected lines (or the cursor line). */
  private tasksInScope(editor: Editor, scope: 'note' | 'selection'): NoteTask[] {
    const all = parseTasks(editor.getValue());
    if (scope === 'note') return all;
    const from = editor.getCursor('from').line;
    let to = editor.getCursor('to').line;
    if (editor.getCursor('to').ch === 0 && to > from) to -= 1; // a selection ending at the start of a line does not include it
    return all.filter((t) => t.line >= from && t.line <= to);
  }

  async send(editor: Editor, view: MarkdownView | MarkdownFileInfo, scope: 'note' | 'selection') {
    const api = this.api();
    if (!api) return;
    const conn = this.connection()!;
    const noteName = view.file?.basename ?? 'a note';
    const inScope = this.tasksInScope(editor, scope);
    // Finished or dropped tasks that were never sent are left alone; ones already sent are refreshed.
    const tasks = inScope.filter((t) => t.cardId || (!t.checked && !t.cancelled));
    const skipped = inScope.length - tasks.length;
    if (!tasks.length) {
      new Notice(scope === 'note' ? 'No open tasks to send in this note. Tasks look like “- [ ] Do the thing”.' : 'No task on the selected line(s). Tasks look like “- [ ] Do the thing”.');
      return;
    }

    let dest = this.saved.destination;
    if (!dest) dest = await this.chooseDestination();
    if (!dest) return;

    try {
      const sent = await this.sendTasks(api, conn, editor, dest, tasks, noteName);
      const created = sent.filter((r) => r.created).length;
      const updated = sent.length - created;
      const parts = [created ? `${created} new` : '', updated ? `${updated} updated` : ''].filter(Boolean).join(', ');
      new Notice(`Sent to ${dest.label}: ${parts}.${skipped ? ` Skipped ${skipped} finished.` : ''}`);
    } catch (err) {
      this.fail(err);
    }
  }

  /** Send, then write the card link on each line. */
  private async sendTasks(api: TesseraApi, conn: Connection, editor: Editor, dest: Destination, tasks: NoteTask[], noteName: string) {
    const payload: TaskPayload[] = tasks.map((t) => ({
      ref: String(t.line),
      card_id: t.cardId,
      title: t.title,
      description: t.cardId ? undefined : noteDescription(noteName),
      // Only dates written on the line are sent, so an existing card keeps dates set in Tessera.
      ...(t.due ? { due: t.due } : {}),
      ...(t.start ? { start: t.start } : {}),
      priority: t.priority,
      ...(t.checked ? { done: true } : {}),
    }));
    const sent = await api.sendTasks(dest.projectId, dest.listId, payload);
    for (const r of sent) {
      const line = Number(r.ref);
      const text = editor.getLine(line);
      const next = withCardLink(text, conn.site, r.card_id);
      if (next !== text) editor.setLine(line, next);
    }
    return sent;
  }

  /* ------------------------------------------------------------- new project */

  async createProject(editor: Editor, view: MarkdownView | MarkdownFileInfo) {
    const api = this.api();
    if (!api) return;
    const conn = this.connection()!;
    try {
      const ctx = await this.loadContext(api);
      const workspaces = ctx.workspaces.filter((w) => w.can_create);
      if (!workspaces.length) {
        new Notice('You are not allowed to create projects in any workspace.');
        return;
      }
      const noteName = view.file?.basename ?? 'New project';
      const choice = await new Promise<{ name: string; workspaceId: string } | null>((resolve) => new NewProjectModal(this.app, noteName, workspaces, resolve).open());
      if (!choice) return;
      const made = await api.createProject(choice.workspaceId, choice.name, noteDescription(noteName));
      const todo = made.lists[0];
      const dest: Destination = { projectId: made.project_id, boardId: made.board_id, listId: todo.id, label: `${choice.name} › ${todo.name}` };
      const tasks = this.tasksInScope(editor, 'note').filter((t) => t.cardId === undefined && !t.checked && !t.cancelled);
      let count = 0;
      if (tasks.length) count = (await this.sendTasks(api, conn, editor, dest, tasks, noteName)).length;
      new Notice(`Created “${choice.name}” in Tessera${count ? ` with ${count} task${count === 1 ? '' : 's'} from this note` : ''}.`);
    } catch (err) {
      this.fail(err);
    }
  }

  /* ------------------------------------------------------------------ status */

  async pullStatus(editor: Editor) {
    const api = this.api();
    if (!api) return;
    const linked = parseTasks(editor.getValue()).filter((t) => t.cardId);
    if (!linked.length) {
      new Notice('No tasks in this note have been sent to Tessera yet.');
      return;
    }
    try {
      const status = new Map((await api.cardStatus([...new Set(linked.map((t) => t.cardId!))])).map((s) => [s.id, s.status]));
      let changed = 0;
      let missing = 0;
      for (const t of linked) {
        const s = status.get(t.cardId!);
        if (!s) {
          missing++;
          continue;
        }
        const done = s === 'done';
        if (done !== t.checked) {
          const text = editor.getLine(t.line);
          editor.setLine(t.line, withChecked(text, done));
          changed++;
        }
      }
      new Notice(changed ? `Updated ${changed} checkbox${changed === 1 ? '' : 'es'} from Tessera.` : 'Everything already matches Tessera.');
      if (missing) new Notice(`${missing} task${missing === 1 ? ' is' : 's are'} no longer available in Tessera (deleted, or you lost access).`, 8000);
    } catch (err) {
      this.fail(err);
    }
  }
}

/* ===================================================================== modals */

class DestinationModal extends FuzzySuggestModal<Destination> {
  private chosen = false;
  constructor(
    app: App,
    private options: Destination[],
    private done: (d: Destination | null) => void,
  ) {
    super(app);
    this.setPlaceholder('Where should new tasks go? Type to search projects and lists');
  }
  getItems() {
    return this.options;
  }
  getItemText(d: Destination) {
    return d.label;
  }
  onChooseItem(d: Destination) {
    this.chosen = true;
    this.done(d);
  }
  onClose() {
    // onChooseItem runs after onClose, so wait a tick before reporting "nothing chosen".
    window.setTimeout(() => {
      if (!this.chosen) this.done(null);
    }, 0);
  }
}

class NewProjectModal extends Modal {
  private name: string;
  private workspaceId: string;
  private submitted = false;
  constructor(
    app: App,
    initialName: string,
    private workspaces: Context['workspaces'],
    private done: (r: { name: string; workspaceId: string } | null) => void,
  ) {
    super(app);
    this.name = initialName;
    this.workspaceId = workspaces[0].id;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Create a Tessera project' });
    new Setting(contentEl).setName('Project name').addText((t) => {
      t.setValue(this.name).onChange((v) => (this.name = v));
      t.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.submit();
      });
      window.setTimeout(() => t.inputEl.select(), 0);
    });
    if (this.workspaces.length > 1) {
      new Setting(contentEl).setName('Workspace').addDropdown((d) => {
        for (const w of this.workspaces) d.addOption(w.id, w.name);
        d.setValue(this.workspaceId).onChange((v) => (this.workspaceId = v));
      });
    }
    contentEl.createEl('p', { cls: 'tessera-muted', text: 'The open tasks in this note are added to the new project’s “To do” list.' });
    new Setting(contentEl).addButton((b) => b.setButtonText('Create project').setCta().onClick(() => this.submit()));
  }
  private submit() {
    const name = this.name.trim();
    if (!name) {
      new Notice('Give the project a name.');
      return;
    }
    this.submitted = true;
    this.done({ name, workspaceId: this.workspaceId });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
    if (!this.submitted) this.done(null);
  }
}

/* ===================================================================== settings */

class TesseraSettings extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: TesseraPlugin,
  ) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const conn = this.plugin.connection();

    new Setting(containerEl)
      .setName('Connection code')
      .setDesc('In Tessera, open Settings → Obsidian, create an access key and paste the connection code here. It works like a password; delete the key in Tessera to disconnect.')
      .setClass('tessera-code')
      .addTextArea((t) => {
        t.setPlaceholder('tessera:…').setValue(this.plugin.saved.code);
        t.inputEl.addEventListener('change', () => void this.connect(t.getValue()));
      });

    const status = containerEl.createDiv({ cls: 'tessera-muted' });
    if (this.plugin.saved.code && !conn) {
      const r = decodeConnection(this.plugin.saved.code);
      status.setText(r.ok ? '' : r.error);
    } else if (conn) {
      status.setText(`Connected to ${conn.site}.`);
    }

    new Setting(containerEl)
      .setName('New tasks go to')
      .setDesc(this.plugin.saved.destination?.label ?? 'Not chosen yet. You will be asked the first time you send tasks.')
      .addButton((b) => b.setButtonText(this.plugin.saved.destination ? 'Change' : 'Choose').onClick(async () => {
        await this.plugin.chooseDestination();
        this.display();
      }));

    new Setting(containerEl)
      .setName('Disconnect')
      .setDesc('Forget the connection code on this device.')
      .addButton((b) => b.setButtonText('Disconnect').setWarning().setDisabled(!this.plugin.saved.code).onClick(async () => {
        this.plugin.saved = { ...DEFAULTS };
        await this.plugin.persist();
        this.display();
      }));
  }

  private async connect(code: string) {
    const r = decodeConnection(code);
    if (!r.ok) {
      this.plugin.saved.code = code.trim();
      await this.plugin.persist();
      new Notice(r.error, 8000);
      this.display();
      return;
    }
    try {
      const ctx = await this.plugin.loadContext(new TesseraApi(r.connection, http));
      this.plugin.saved.code = code.trim();
      // A different account or site invalidates the remembered destination.
      if (!ctx.projects.some((p) => p.id === this.plugin.saved.destination?.projectId)) this.plugin.saved.destination = null;
      await this.plugin.persist();
      new Notice(`Connected${ctx.user ? ` as ${ctx.user}` : ''}.`);
    } catch (err) {
      this.plugin.fail(err);
    }
    this.display();
  }
}
