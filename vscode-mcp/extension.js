// VS Code MCP Bridge: an MCP server (Streamable HTTP, JSON responses) hosted inside the VS Code extension host.
// No dependencies. Listens on 127.0.0.1 only and rejects browser-origin requests (DNS-rebinding guard).
const vscode = require('vscode');
const http = require('http');
const path = require('path');

const SERVER_INFO = { name: 'vscode', version: '0.1.0' };
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
let server = null;
let status = 'not started';

// ---------- helpers ----------
function toUri(p) {
  if (!p) throw new Error('path is required');
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(p)) return vscode.Uri.parse(p);
  if (!path.isAbsolute(p)) {
    const root = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!root) throw new Error('relative path given but no workspace folder is open');
    return vscode.Uri.joinPath(root.uri, p);
  }
  return vscode.Uri.file(p);
}
const pos = (line, ch) => new vscode.Position(Math.max(0, (line || 1) - 1), Math.max(0, (ch || 1) - 1));
const fsPath = (uri) => (uri.scheme === 'file' ? uri.fsPath : uri.toString());
const sevName = ['error', 'warning', 'info', 'hint'];

function describeEditor(ed, includeText) {
  if (!ed) return null;
  const d = ed.document;
  const out = {
    path: fsPath(d.uri),
    languageId: d.languageId,
    isDirty: d.isDirty,
    lineCount: d.lineCount,
    selections: ed.selections.map((s) => ({
      start: { line: s.start.line + 1, column: s.start.character + 1 },
      end: { line: s.end.line + 1, column: s.end.character + 1 },
      text: d.getText(s),
    })),
    visibleRange: ed.visibleRanges[0]
      ? { startLine: ed.visibleRanges[0].start.line + 1, endLine: ed.visibleRanges[0].end.line + 1 }
      : null,
  };
  if (includeText) out.text = d.getText();
  return out;
}

// ---------- tools ----------
const TOOLS = [
  {
    name: 'get_workspace_info',
    description: 'Workspace folders, VS Code version, and the list of open editor tabs.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({
      vscodeVersion: vscode.version,
      workspaceName: vscode.workspace.name || null,
      folders: (vscode.workspace.workspaceFolders || []).map((f) => fsPath(f.uri)),
      activeFile: vscode.window.activeTextEditor ? fsPath(vscode.window.activeTextEditor.document.uri) : null,
      tabs: vscode.window.tabGroups.all.flatMap((g) =>
        g.tabs.map((t) => ({
          label: t.label,
          path: t.input && t.input.uri ? fsPath(t.input.uri) : null,
          group: g.viewColumn,
          active: t.isActive,
          dirty: t.isDirty,
        }))
      ),
    }),
  },
  {
    name: 'get_active_editor',
    description: 'The focused editor: file path, language, cursor/selections with selected text, visible range. Set includeText to also return the whole document (including unsaved changes).',
    inputSchema: { type: 'object', properties: { includeText: { type: 'boolean' } } },
    run: async (a) => describeEditor(vscode.window.activeTextEditor, a.includeText) || { activeEditor: null },
  },
  {
    name: 'open_file',
    description: 'Open a file in VS Code, optionally jumping to a line/column (1-based) or selecting up to endLine/endColumn.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path, or relative to the first workspace folder.' },
        line: { type: 'number' }, column: { type: 'number' },
        endLine: { type: 'number' }, endColumn: { type: 'number' },
        preview: { type: 'boolean', description: 'Open as preview tab (default false).' },
      },
      required: ['path'],
    },
    run: async (a) => {
      const doc = await vscode.workspace.openTextDocument(toUri(a.path));
      const opts = { preview: !!a.preview };
      if (a.line) {
        const start = pos(a.line, a.column);
        const end = a.endLine ? pos(a.endLine, a.endColumn) : start;
        opts.selection = new vscode.Range(start, end);
      }
      const ed = await vscode.window.showTextDocument(doc, opts);
      if (opts.selection) ed.revealRange(opts.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      return describeEditor(ed, false);
    },
  },
  {
    name: 'get_diagnostics',
    description: 'Errors/warnings from the Problems panel, for one file or the whole workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Limit to this file. Omit for all files.' },
        minSeverity: { type: 'string', enum: ['error', 'warning', 'info', 'hint'], description: 'Default: hint (everything).' },
      },
    },
    run: async (a) => {
      const max = a.minSeverity ? sevName.indexOf(a.minSeverity) : 3;
      const entries = a.path ? [[toUri(a.path), vscode.languages.getDiagnostics(toUri(a.path))]] : vscode.languages.getDiagnostics();
      const out = [];
      for (const [uri, diags] of entries) {
        for (const d of diags) {
          if (d.severity > max) continue;
          out.push({
            path: fsPath(uri),
            severity: sevName[d.severity],
            line: d.range.start.line + 1,
            column: d.range.start.character + 1,
            message: d.message,
            source: d.source || null,
            code: d.code && typeof d.code === 'object' ? d.code.value : d.code ?? null,
          });
        }
      }
      return { count: out.length, diagnostics: out.slice(0, 500) };
    },
  },
  {
    name: 'replace_text',
    description: 'Replace a range in a file as an undoable editor edit (1-based lines/columns; end is exclusive). Omit the range to replace the active selection. Leaves the file unsaved unless save is true.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        path: { type: 'string', description: 'Defaults to the active editor.' },
        startLine: { type: 'number' }, startColumn: { type: 'number' },
        endLine: { type: 'number' }, endColumn: { type: 'number' },
        save: { type: 'boolean' },
      },
      required: ['text'],
    },
    run: async (a) => {
      let doc, range;
      if (a.path) doc = await vscode.workspace.openTextDocument(toUri(a.path));
      else if (vscode.window.activeTextEditor) doc = vscode.window.activeTextEditor.document;
      else throw new Error('no path given and no active editor');
      if (a.startLine) {
        range = new vscode.Range(pos(a.startLine, a.startColumn), pos(a.endLine || a.startLine, a.endColumn || a.startColumn));
      } else {
        const ed = vscode.window.activeTextEditor;
        if (!ed || ed.document !== doc) throw new Error('no range given and file is not the active editor');
        range = ed.selection;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, range, a.text);
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) throw new Error('edit was rejected');
      if (a.save) await doc.save();
      return { path: fsPath(doc.uri), applied: true, saved: !!a.save, isDirty: doc.isDirty };
    },
  },
  {
    name: 'save_files',
    description: 'Save one file, or all dirty files when path is omitted.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    run: async (a) => {
      if (!a.path) return { saved: await vscode.workspace.saveAll(false) };
      const doc = await vscode.workspace.openTextDocument(toUri(a.path));
      return { path: fsPath(doc.uri), saved: await doc.save() };
    },
  },
  {
    name: 'run_in_terminal',
    description: 'Send a command line to a VS Code integrated terminal (created if missing) and show it. Output is not captured.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        terminalName: { type: 'string', description: 'Default "Claude".' },
      },
      required: ['command'],
    },
    run: async (a) => {
      const name = a.terminalName || 'Claude';
      const term = vscode.window.terminals.find((t) => t.name === name) || vscode.window.createTerminal(name);
      term.show(true);
      term.sendText(a.command, true);
      return { terminal: name, sent: a.command };
    },
  },
  {
    name: 'execute_command',
    description: 'Run any VS Code command by id (e.g. "workbench.action.files.newUntitledFile", "editor.action.formatDocument") with optional JSON args. Returns the command result if serializable.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' }, args: { type: 'array', items: {} } },
      required: ['command'],
    },
    run: async (a) => {
      const r = await vscode.commands.executeCommand(a.command, ...(a.args || []));
      try { return { result: r === undefined ? null : JSON.parse(JSON.stringify(r)) }; }
      catch { return { result: String(r) }; }
    },
  },
  {
    name: 'list_commands',
    description: 'List available VS Code command ids, filtered by a substring.',
    inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
    run: async (a) => {
      const all = await vscode.commands.getCommands(true);
      const f = (a.filter || '').toLowerCase();
      const hits = all.filter((c) => c.toLowerCase().includes(f));
      return { count: hits.length, commands: hits.slice(0, 300) };
    },
  },
  {
    name: 'show_message',
    description: 'Show a notification in VS Code.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' }, level: { type: 'string', enum: ['info', 'warning', 'error'] } },
      required: ['message'],
    },
    run: async (a) => {
      const fn = { warning: 'showWarningMessage', error: 'showErrorMessage' }[a.level] || 'showInformationMessage';
      vscode.window[fn](a.message);
      return { shown: true };
    },
  },
];
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ---------- JSON-RPC ----------
async function handleRpc(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: isNotification ? null : id, error: { code, message } });

  switch (method) {
    case 'initialize': {
      const asked = params && params.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Controls the running VS Code window. Lines and columns are 1-based. Paths may be absolute or relative to the first workspace folder.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOL_MAP.get(params && params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params && params.name}`);
      try {
        const out = await tool.run((params && params.arguments) || {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `Error: ${e && e.message ? e.message : e}` }], isError: true });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized, cancelled, etc.
      return fail(-32601, `Method not found: ${method}`);
  }
}

function startServer(port) {
  server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      res.writeHead(403).end('forbidden origin');
      return;
    }
    if (req.url.split('?')[0] !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method === 'GET') { res.writeHead(405, { Allow: 'POST' }).end(); return; } // no server-initiated stream
    if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }
      const batch = Array.isArray(msg);
      const results = (await Promise.all((batch ? msg : [msg]).map(handleRpc))).filter(Boolean);
      if (!results.length) { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(batch ? results : results[0]));
    });
  });

  server.on('error', (e) => {
    status = e.code === 'EADDRINUSE'
      ? `port ${port} already in use (another VS Code window is probably serving MCP)`
      : `error: ${e.message}`;
    server = null;
  });
  server.listen(port, '127.0.0.1', () => { status = `listening on http://127.0.0.1:${port}/mcp`; });
}

function activate(context) {
  const port = vscode.workspace.getConfiguration('vscodeMcp').get('port', 3712);
  startServer(port);
  context.subscriptions.push(
    vscode.commands.registerCommand('vscodeMcp.status', () => vscode.window.showInformationMessage(`VS Code MCP: ${status}`)),
    { dispose: () => server && server.close() }
  );
}

function deactivate() { if (server) server.close(); }

module.exports = { activate, deactivate };
