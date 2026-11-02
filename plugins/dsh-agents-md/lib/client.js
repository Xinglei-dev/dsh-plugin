window.__ModuleLoader__.load({
  id: 'dsh-agents-md',
  factory: (require) => {
    const react = require('react');

    /** Locale namespace this plugin owns. */
    const NS = 'agents-md';

    /** Endpoints served by the Host half. */
    const ROUTE_STATE = '/agents-md/state';
    const ROUTE_FILE = '/agents-md/file';
    const ROUTE_SAVE = '/agents-md/save';

    const zh = {
      tab: 'Agent 指令',
      intro: '编辑 DSH 每次请求前加载的 AGENTS.md。保存后不会重启进程，下一轮模型请求就会使用新内容。',
      project: '项目',
      globalOnly: '仅全局',
      reload: '刷新',
      global: '全局',
      projectSection: '项目',
      projectRoot: '项目根',
      rootMissing: '未找到 .git，项目根按 workspace 目录计算',
      workspaceMissing: '这个 workspace 的目录不存在',
      loading: '读取中…',
      loadFailed: '读取失败：{message}',
      unauthorized: '未通过身份验证；请从当前 dsh web 打印的地址打开页面。',
      noWorkspaces: '还没有已注册的项目；先在侧边栏添加 workspace。',
      newFile: '新建',
      notExists: '不存在',
      editorEmpty: '从左侧选择一个文件开始编辑。',
      save: '保存',
      discard: '放弃修改',
      unsaved: '有未保存的修改',
      saved: '已保存；下一次模型请求生效',
      saveFailed: '保存失败：{message}',
      conflict: '文件已在磁盘上变化。重新加载会采用磁盘版本，覆盖保存会写入当前编辑内容。',
      overwrite: '覆盖保存',
      reloadFile: '重新加载文件',
      tooLarge: '文件超过 1 MiB，不能在这里编辑。',
      globalHint: '两个全局文件都在项目文件之前加载；内容去空白后相同的只注入一次。',
      projectHint: '从项目根到 workspace 目录依次加载，越靠后越具体。',
      appliesNext: '保存后在下一轮模型请求生效；运行中的回合不会改变。',
      size: '{size}',
      characters: '{count} 字符',
    };

    const en = {
      tab: 'Agent Instructions',
      intro: 'Edit the AGENTS.md files DSH loads before each request. Saving does not restart the process: the next model request uses the new content.',
      project: 'Project',
      globalOnly: 'Global only',
      reload: 'Refresh',
      global: 'Global',
      projectSection: 'Project',
      projectRoot: 'Project root',
      rootMissing: 'No .git was found; the workspace directory is the project root',
      workspaceMissing: 'This workspace directory does not exist',
      loading: 'Loading…',
      loadFailed: 'Load failed: {message}',
      unauthorized: 'Not authenticated; open the page through the address the current dsh web printed.',
      noWorkspaces: 'No project is registered yet; add a workspace from the sidebar first.',
      newFile: 'Create',
      notExists: 'absent',
      editorEmpty: 'Select a file on the left to start editing.',
      save: 'Save',
      discard: 'Discard changes',
      unsaved: 'Unsaved changes',
      saved: 'Saved; the next model request uses it',
      saveFailed: 'Save failed: {message}',
      conflict: 'The file changed on disk. Reload adopts the disk version; Overwrite saves the current draft.',
      overwrite: 'Overwrite',
      reloadFile: 'Reload file',
      tooLarge: 'The file is larger than 1 MiB and cannot be edited here.',
      globalHint: 'Both global files load before project files; identical trimmed content is injected once.',
      projectHint: 'Loaded from the project root down to the workspace directory; later entries are more specific.',
      appliesNext: 'Saving takes effect on the next model request; a running turn does not change.',
      size: '{size}',
      characters: '{count} characters',
    };

    const STYLE_PAGE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      maxWidth: '960px',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      lineHeight: '20px',
    };
    const STYLE_HINT = {
      margin: 0,
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '12px',
      lineHeight: '18px',
      textWrap: 'pretty',
    };
    const STYLE_ROW = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexWrap: 'wrap',
    };
    const STYLE_SELECT = {
      flex: '1 1 220px',
      minWidth: 0,
      height: '32px',
      padding: '0 8px',
      font: 'inherit',
      color: 'inherit',
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      border: '0.5px solid var(--dsw-alias-border-l4, rgba(128, 128, 128, 0.4))',
      borderRadius: 'var(--dsw-radius-md, 8px)',
    };
    const STYLE_BUTTON = {
      flex: 'none',
      height: '32px',
      padding: '0 12px',
      font: 'inherit',
      color: 'inherit',
      background: 'var(--dsw-alias-bg-module-platform, rgba(128, 128, 128, 0.12))',
      border: '0.5px solid var(--dsw-alias-border-l3, rgba(128, 128, 128, 0.3))',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      cursor: 'pointer',
    };
    const STYLE_LAYOUT = {
      display: 'flex',
      gap: '14px',
      alignItems: 'stretch',
      flexWrap: 'wrap',
    };
    const STYLE_TREE = {
      flex: '1 1 220px',
      minWidth: '200px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    };
    const STYLE_EDITOR = {
      flex: '2 1 380px',
      minWidth: '280px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    };
    const STYLE_SECTION_TITLE = {
      margin: '0 0 4px',
      fontWeight: 600,
    };
    const STYLE_FILE = {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      padding: '6px 8px',
      font: 'inherit',
      color: 'inherit',
      textAlign: 'left',
      background: 'transparent',
      border: '0.5px solid transparent',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      cursor: 'pointer',
    };
    const STYLE_FILE_ACTIVE = {
      ...STYLE_FILE,
      background: 'var(--dsw-alias-bg-module-platform, rgba(128, 128, 128, 0.12))',
      borderColor: 'var(--dsw-alias-border-l3, rgba(128, 128, 128, 0.3))',
    };
    const STYLE_TEXTAREA = {
      width: '100%',
      boxSizing: 'border-box',
      minHeight: '300px',
      flex: '1 1 auto',
      padding: '10px',
      font: 'inherit',
      fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
      fontSize: '12.5px',
      lineHeight: '19px',
      color: 'inherit',
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      border: '0.5px solid var(--dsw-alias-border-l4, rgba(128, 128, 128, 0.4))',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      resize: 'vertical',
    };
    const STYLE_NOTICE = {
      ...STYLE_HINT,
      color: 'var(--dsw-alias-label-primary)',
    };

    /**
     * Decide the workspace the page opens after the workspace list is ready.
     * @param phase - workspace-list arrival phase.
     * @param workspaces - registered workspaces.
     * @returns null while undecided, otherwise a workspace id or an empty string.
     */
    function initialWorkspaceId(phase, workspaces) {
      if (phase !== 'ready') return null;
      return workspaces.length > 0 ? workspaces[0].workspaceId : '';
    }

    /**
     * Format a byte size for the tree rows.
     * @param bytes - size in bytes.
     * @returns a compact human-readable size.
     */
    function formatSize(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
      if (bytes < 1024) return `${String(bytes)} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Pick the file the page opens when nothing better is selected.
     * @param data - state response.
     * @returns the most specific project AGENTS.md, or the harness-home file.
     */
    function defaultTarget(data) {
      const project = data?.project;
      if (project?.available === true && Array.isArray(project.levels) && project.levels.length > 0) {
        const level = project.levels[project.levels.length - 1];
        return { scope: 'project', dir: level.relDir, name: 'AGENTS.md' };
      }
      return { scope: 'global-dsh', dir: '', name: 'AGENTS.md' };
    }

    /**
     * Whether a previous selection still exists in a fresh state response.
     * @param selected - current selection.
     * @param data - state response.
     * @returns true when the selection can stay selected.
     */
    function stillExists(selected, data) {
      if (selected === null || data === undefined) return false;
      if (selected.scope === 'global-dsh' || selected.scope === 'global-agents') {
        return Array.isArray(data.global) && data.global.some((entry) => entry.scope === selected.scope);
      }
      const project = data.project;
      if (project?.available !== true || !Array.isArray(project.levels)) return false;
      return project.levels.some((level) => level.relDir === selected.dir && level.files.some((file) => file.name === selected.name));
    }

    /**
     * Build the URL of one file read.
     * @param selected - current selection.
     * @param workspaceId - selected workspace id, or an empty string.
     * @returns the request URL.
     */
    function buildFileUrl(selected, workspaceId) {
      const params = new URLSearchParams({ scope: selected.scope, name: selected.name });
      if (selected.scope === 'project') {
        params.set('workspaceId', workspaceId);
        params.set('dir', selected.dir);
      }
      return `${ROUTE_FILE}?${params.toString()}`;
    }

    /**
     * Build the save request body.
     * @param selected - current selection.
     * @param workspaceId - selected workspace id, or an empty string.
     * @param content - draft content.
     * @param expectedHash - version the draft is based on, or null for "create".
     * @returns the JSON body.
     */
    function buildSaveBody(selected, workspaceId, content, expectedHash) {
      return {
        scope: selected.scope,
        name: selected.name,
        content,
        expectedHash,
        ...(selected.scope === 'project' ? { workspaceId, dir: selected.dir } : {}),
      };
    }

    /**
     * Fetch JSON and turn a non-2xx answer into an error carrying its body.
     * @param url - request URL.
     * @param options - fetch options.
     * @returns the parsed body.
     */
    async function requestJson(url, options = {}) {
      const response = await globalThis.fetch(url, {
        credentials: 'same-origin',
        ...options,
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok || body?.ok === false) {
        const error = new Error(body?.message ?? `HTTP ${String(response.status)}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    }

    /**
     * Describe a failed request for the page.
     * @param t - namespace translator.
     * @param error - thrown request error.
     * @returns the notice kind and message.
     */
    function describeError(t, error) {
      if (error?.status === 401) return { kind: 'failed', message: t('unauthorized') };
      if (error?.status === 413) return { kind: 'tooLarge' };
      if (error?.status === 403) return { kind: 'failed', message: t('loadFailed', { message: error.message }) };
      return { kind: 'failed', message: t('loadFailed', { message: error?.message ?? String(error) }) };
    }

    /**
     * The settings page.
     * @param props - standard slot kit plus this entry's translator.
     * @returns the page body.
     */
    function AgentsMdPage({ t, useWorkspaces }) {
      const workspaces = useWorkspaces((state) => state.items);
      const workspacePhase = useWorkspaces((state) => state.phase);
      const [workspaceId, setWorkspaceId] = react.useState(null);
      const [stateToken, setStateToken] = react.useState(0);
      const [fileToken, setFileToken] = react.useState(0);
      const [snapshot, setSnapshot] = react.useState({ status: 'idle', data: null, error: null });
      const [selected, setSelected] = react.useState(null);
      const [file, setFile] = react.useState({ status: 'idle', data: null, error: null });
      const [draft, setDraft] = react.useState('');
      const [notice, setNotice] = react.useState(null);
      const [busy, setBusy] = react.useState(false);

      react.useEffect(() => {
        if (workspaceId !== null) return;
        const next = initialWorkspaceId(workspacePhase, workspaces);
        if (next !== null) setWorkspaceId(next);
      }, [workspaceId, workspacePhase, workspaces]);

      react.useEffect(() => {
        if (workspaceId === null || workspaceId === '' || workspacePhase !== 'ready') return;
        if (workspaces.some((workspace) => workspace.workspaceId === workspaceId)) return;
        setWorkspaceId(workspaces.length > 0 ? workspaces[0].workspaceId : '');
      }, [workspaceId, workspacePhase, workspaces]);

      react.useEffect(() => {
        if (workspaceId === null) return undefined;
        let cancelled = false;
        setSnapshot((previous) => ({
          status: 'loading',
          data: previous.status === 'ready' ? previous.data : null,
          error: null,
        }));
        const url = workspaceId === ''
          ? ROUTE_STATE
          : `${ROUTE_STATE}?workspaceId=${encodeURIComponent(workspaceId)}`;
        requestJson(url)
          .then((data) => {
            if (cancelled) return;
            setSnapshot({ status: 'ready', data, error: null });
            setSelected((previous) => (previous !== null && stillExists(previous, data) ? previous : defaultTarget(data)));
          })
          .catch((error) => {
            if (!cancelled) setSnapshot({ status: 'error', data: null, error });
          });
        return () => {
          cancelled = true;
        };
      }, [workspaceId, stateToken]);

      react.useEffect(() => {
        if (selected === null) {
          setFile({ status: 'idle', data: null, error: null });
          setDraft('');
          return undefined;
        }
        let cancelled = false;
        setFile({ status: 'loading', data: null, error: null });
        setNotice(null);
        requestJson(buildFileUrl(selected, workspaceId ?? ''))
          .then((data) => {
            if (cancelled) return;
            setFile({ status: 'ready', data, error: null });
            setDraft(data.content);
          })
          .catch((error) => {
            if (!cancelled) setFile({ status: 'error', data: null, error });
          });
        return () => {
          cancelled = true;
        };
      }, [selected, workspaceId, fileToken]);

      const data = snapshot.data;
      const project = data?.project ?? null;
      const dirty = file.status === 'ready' && draft !== file.data.content;
      const activeWorkspace = workspaceId === null ? '' : workspaceId;

      /**
       * Save the draft, optionally overriding the version check.
       * @param overrideHash - expected hash to use instead of the loaded one.
       */
      const save = async (overrideHash) => {
        if (busy || selected === null || file.status !== 'ready') return;
        setBusy(true);
        setNotice(null);
        try {
          const expectedHash = overrideHash === undefined ? file.data.hash : overrideHash;
          const body = await requestJson(ROUTE_SAVE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildSaveBody(selected, activeWorkspace, draft, expectedHash)),
          });
          setFile({
            status: 'ready',
            data: {
              ...file.data,
              exists: true,
              content: draft,
              hash: body.hash,
              size: body.size,
              path: body.path,
              mtimeMs: body.mtimeMs ?? null,
            },
            error: null,
          });
          setNotice({ kind: 'saved' });
          setStateToken((value) => value + 1);
        } catch (error) {
          if (error?.status === 409 && error.body?.current !== undefined) {
            setNotice({ kind: 'conflict', current: error.body.current });
          } else if (error?.status === 413) {
            setNotice({ kind: 'tooLarge' });
          } else {
            setNotice({ kind: 'failed', message: t('saveFailed', { message: error?.message ?? String(error) }) });
          }
        } finally {
          setBusy(false);
        }
      };

      const reloadFile = () => setFileToken((value) => value + 1);
      const reloadAll = () => setStateToken((value) => value + 1);

      const isActive = (scope, dir, name) => selected !== null
        && selected.scope === scope
        && selected.dir === dir
        && selected.name === name;

      const fileRow = (scope, dir, name, exists, size) => react.createElement('button', {
        key: `${scope}:${dir}:${name}`,
        type: 'button',
        style: isActive(scope, dir, name) ? STYLE_FILE_ACTIVE : STYLE_FILE,
        onClick: () => setSelected({ scope, dir, name }),
      },
      react.createElement('span', { style: { overflowWrap: 'anywhere' } }, name),
      react.createElement('span', { style: STYLE_HINT }, exists ? formatSize(size) : t('newFile')));

      const tree = [];
      tree.push(react.createElement('section', { key: 'global', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        react.createElement('h3', { style: STYLE_SECTION_TITLE }, t('global')),
        react.createElement('p', { style: STYLE_HINT }, t('globalHint')),
        (data?.global ?? []).map((entry) => react.createElement('div', { key: entry.scope },
          react.createElement('p', { style: { ...STYLE_HINT, margin: '4px 0 2px' } }, entry.display),
          fileRow(entry.scope, '', entry.name, entry.exists, entry.size)))));
      if (project !== null) {
        const levels = project.available === true ? project.levels : [];
        tree.push(react.createElement('section', { key: 'project', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          react.createElement('h3', { style: STYLE_SECTION_TITLE }, t('projectSection')),
          react.createElement('p', { style: STYLE_HINT }, t('projectHint')),
          project.available !== true ? react.createElement('p', { style: STYLE_HINT }, t('workspaceMissing')) : null,
          project.available === true ? react.createElement('p', { style: STYLE_HINT }, `${t('projectRoot')}: ${project.projectRoot}`) : null,
          project.available === true && project.rootDetected === false
            ? react.createElement('p', { style: STYLE_HINT }, t('rootMissing'))
            : null,
          levels.map((level) => react.createElement('div', { key: level.relDir, style: { marginTop: '6px' } },
            react.createElement('p', { style: { ...STYLE_HINT, margin: '0 0 2px' } }, level.relDir === '.' ? t('projectRoot') : level.relDir),
            level.files.map((entry) => fileRow('project', level.relDir, entry.name, entry.exists, entry.size))))));
      }

      let noticeNode = null;
      if (notice?.kind === 'saved') noticeNode = react.createElement('p', { style: STYLE_NOTICE }, t('saved'));
      if (notice?.kind === 'tooLarge') noticeNode = react.createElement('p', { style: STYLE_NOTICE }, t('tooLarge'));
      if (notice?.kind === 'failed') noticeNode = react.createElement('p', { style: STYLE_NOTICE }, notice.message);
      if (notice?.kind === 'conflict') {
        noticeNode = react.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          react.createElement('p', { style: STYLE_NOTICE }, t('conflict')),
          react.createElement('div', { style: STYLE_ROW },
            react.createElement('button', {
              type: 'button',
              style: STYLE_BUTTON,
              onClick: () => {
                setDraft(notice.current.content);
                setFile((previous) => (previous.status === 'ready'
                  ? { ...previous, data: { ...previous.data, content: notice.current.content, hash: notice.current.hash, exists: notice.current.exists } }
                  : previous));
                setNotice(null);
              },
            }, t('reloadFile')),
            react.createElement('button', {
              type: 'button',
              style: STYLE_BUTTON,
              onClick: () => { void save(notice.current.exists ? notice.current.hash : null); },
            }, t('overwrite'))));
      }

      let editor = react.createElement('p', { style: STYLE_HINT }, t('editorEmpty'));
      if (selected !== null) {
        const path = file.data?.path ?? '';
        const body = file.status === 'loading'
          ? react.createElement('p', { style: STYLE_HINT }, t('loading'))
          : file.status === 'error'
            ? react.createElement('p', { style: STYLE_NOTICE }, file.error?.status === 413 ? t('tooLarge') : t('loadFailed', { message: file.error?.message ?? '' }))
            : react.createElement('textarea', {
              value: draft,
              spellCheck: false,
              style: STYLE_TEXTAREA,
              onChange: (event) => {
                setDraft(event.target.value);
                setNotice(null);
              },
            });
        editor = react.createElement('div', { style: STYLE_EDITOR },
          react.createElement('div', { style: { ...STYLE_HINT, fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', overflowWrap: 'anywhere' } }, path),
          react.createElement('p', { style: STYLE_HINT }, t('appliesNext')),
          body,
          react.createElement('div', { style: STYLE_ROW },
            react.createElement('button', {
              type: 'button',
              style: STYLE_BUTTON,
              disabled: busy || dirty === false || file.status !== 'ready',
              onClick: () => { void save(); },
            }, t('save')),
            react.createElement('button', {
              type: 'button',
              style: STYLE_BUTTON,
              disabled: busy || file.status !== 'ready',
              onClick: reloadFile,
            }, t('reloadFile')),
            react.createElement('button', {
              type: 'button',
              style: STYLE_BUTTON,
              disabled: busy || dirty === false || file.status !== 'ready',
              onClick: () => { setDraft(file.data.content); setNotice(null); },
            }, t('discard')),
            dirty ? react.createElement('span', { style: STYLE_HINT }, t('unsaved')) : null,
            file.status === 'ready' ? react.createElement('span', { style: STYLE_HINT }, t('characters', { count: draft.length })) : null),
          noticeNode);
      }

      let status = null;
      if (snapshot.status === 'loading') status = react.createElement('p', { style: STYLE_HINT }, t('loading'));
      if (snapshot.status === 'error') {
        const described = describeError(t, snapshot.error);
        status = react.createElement('p', { style: STYLE_NOTICE }, described.message);
      }

      return react.createElement('div', { style: STYLE_PAGE },
        react.createElement('p', { style: STYLE_HINT }, t('intro')),
        workspaces.length === 0 ? react.createElement('p', { style: STYLE_HINT }, t('noWorkspaces')) : null,
        react.createElement('div', { style: STYLE_ROW },
          react.createElement('label', { htmlFor: 'agents-md-workspace', style: { fontWeight: 500 } }, t('project')),
          react.createElement('select', {
            id: 'agents-md-workspace',
            value: activeWorkspace,
            style: STYLE_SELECT,
            onChange: (event) => setWorkspaceId(event.target.value),
          },
          react.createElement('option', { value: '' }, t('globalOnly')),
          workspaces.map((workspace) => react.createElement('option', { key: workspace.workspaceId, value: workspace.workspaceId },
            `${workspace.title} — ${workspace.path}`))),
          react.createElement('button', { type: 'button', style: STYLE_BUTTON, onClick: reloadAll }, t('reload'))),
        status,
        react.createElement('div', { style: STYLE_LAYOUT },
          react.createElement('div', { style: STYLE_TREE }, tree),
          editor));
    }

    /** Services this page needs. */
    const inject = ['slots', 'locale'];

    /**
     * Register the settings page.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);
      const t = ctx.locale.bind(NS);
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'agents-md',
        order: 30,
        label: () => t('tab'),
        locale: NS,
      }, AgentsMdPage));
    }

    return {
      inject,
      apply,
      formatSize,
      defaultTarget,
      initialWorkspaceId,
      stillExists,
      buildFileUrl,
      buildSaveBody,
      AgentsMdPage,
    };
  },
});
