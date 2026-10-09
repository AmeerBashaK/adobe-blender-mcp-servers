/*
  Premiere Pro side of the Premiere MCP server (a CEP extension with Node enabled).

  Listens on 127.0.0.1 (port 9877 by default) for one-line JSON requests from server.ps1:
      {"token": "...", "script": "<ExtendScript>", "timeout": 120}
  evaluates the ExtendScript in Premiere and answers with one line: {"ok": true, "result": "<string>"}.
  The script itself (built by server.ps1 from jsx/) returns a JSON string.

  A random token in %LOCALAPPDATA%/premiere-mcp/session.json keeps other local processes out.
  Only one instance (background or panel) can own the port; the other just reports status.
*/
(function () {
  var statusEl = document.getElementById('status');
  function status(msg) { if (statusEl) statusEl.textContent = msg; }

  var nodeRequire = typeof require !== 'undefined' ? require : (window.cep_node && window.cep_node.require);
  if (!nodeRequire) { status('Node.js is not enabled for this extension.'); return; }
  var net = nodeRequire('net');
  var fs = nodeRequire('fs');
  var path = nodeRequire('path');
  var crypto = nodeRequire('crypto');

  var PORT = parseInt(process.env.PREMIERE_MCP_PORT || '9877', 10);
  var stateDir = path.join(process.env.LOCALAPPDATA || process.env.TEMP, 'premiere-mcp');
  var token = crypto.randomBytes(16).toString('hex');

  // Premiere runs scripts one at a time; queue requests so callbacks never interleave.
  var chain = Promise.resolve();

  function evalScript(script, timeoutSec) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; resolve({ ok: false, error: 'Premiere did not finish within ' + timeoutSec + ' s.' }); }
      }, timeoutSec * 1000);
      window.__adobe_cep__.evalScript(script, function (result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (result === 'EvalScript error.') resolve({ ok: false, error: 'ExtendScript error (syntax or uncaught).' });
        else resolve({ ok: true, result: result });
      });
    });
  }

  var server = net.createServer(function (sock) {
    var buf = '';
    sock.setEncoding('utf8');
    sock.on('data', function (chunk) {
      buf += chunk;
      var nl = buf.indexOf('\n');
      if (nl < 0) return;
      var line = buf.slice(0, nl);
      buf = '';
      var req;
      try { req = JSON.parse(line); } catch (e) { sock.end(JSON.stringify({ ok: false, error: 'Bad JSON' }) + '\n'); return; }
      if (req.token !== token) { sock.end(JSON.stringify({ ok: false, error: 'Bad token' }) + '\n'); return; }
      chain = chain.then(function () {
        return evalScript(req.script || '', req.timeout || 120).then(function (res) {
          try { sock.end(JSON.stringify(res) + '\n'); } catch (e) {}
        });
      });
    });
    sock.on('error', function () {});
  });

  server.on('error', function (e) {
    if (e.code === 'EADDRINUSE') status('Connected (another MCP Bridge instance owns port ' + PORT + ').');
    else status('Error: ' + e.message);
  });

  server.listen(PORT, '127.0.0.1', function () {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'session.json'),
        JSON.stringify({ port: PORT, token: token, pid: process.pid, started: new Date().toISOString() }));
      status('Listening on 127.0.0.1:' + PORT);
    } catch (e) {
      status('Could not write session file: ' + e.message);
    }
  });
})();
