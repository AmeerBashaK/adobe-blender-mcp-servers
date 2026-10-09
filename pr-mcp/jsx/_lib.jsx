// Shared helpers prepended to every tool script. ExtendScript is ES3: no JSON, no let/const, no arrow functions.

// A char loop rather than a regex: ExtendScript's parser rejects the equivalent regex literal.
function __jsonEsc(s) {
    s = String(s);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        var code = s.charCodeAt(i);
        if (c === '"') out += '\\"';
        else if (c === '\\') out += '\\\\';
        else if (c === '\n') out += '\\n';
        else if (c === '\r') out += '\\r';
        else if (c === '\t') out += '\\t';
        else if (code < 32 || code === 0x2028 || code === 0x2029) {
            var h = code.toString(16);
            while (h.length < 4) h = '0' + h;
            out += '\\u' + h;
        } else out += c;
    }
    return out + '"';
}

function __json(v, indent, cur, depth) {
    indent = indent || 0;
    cur = cur || '';
    depth = depth || 0;
    if (depth > 16) return '"[max depth]"';
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return __jsonEsc(v);
    if (t === 'function') return 'null';
    var nl = indent ? '\n' : '';
    var pad = cur + (indent ? '                '.substr(0, indent) : '');
    var i, parts = [];
    if (v instanceof Array) {
        if (!v.length) return '[]';
        var flat = true;
        for (i = 0; i < v.length; i++) if (typeof v[i] !== 'number') { flat = false; break; }
        if (flat) {
            for (i = 0; i < v.length; i++) parts.push(__json(v[i]));
            return '[' + parts.join(', ') + ']';
        }
        for (i = 0; i < v.length; i++) parts.push(pad + __json(v[i], indent, pad, depth + 1));
        return '[' + nl + parts.join(',' + nl) + nl + cur + ']';
    }
    if (v.constructor === Object) {
        for (var k in v) {
            if (v.hasOwnProperty(k) && v[k] !== undefined) {
                parts.push(pad + __jsonEsc(k) + (indent ? ': ' : ':') + __json(v[k], indent, pad, depth + 1));
            }
        }
        if (!parts.length) return '{}';
        return '{' + nl + parts.join(',' + nl) + nl + cur + '}';
    }
    // Host objects (Sequence, TrackItem, Time, ...) are not plain data.
    return __jsonEsc(String(v));
}


// ---- Premiere helpers -------------------------------------------------------

var PR_INSTALL = 'C:/Program Files/Adobe/Adobe Premiere Pro 2026';
var DEFAULT_EXPORT_PRESET = PR_INSTALL + '/MediaIO/systempresets/4E49434B_48323634/01 - Match Source - High bitrate.epr';
var DEFAULT_SEQ_PRESET = PR_INSTALL + '/Settings/SequencePresets/HD 1080p/HD 1080p 29.97 fps.sqpreset';
var TICKS = 254016000000;

function r3(n) { return Math.round(n * 1000) / 1000; }
function secs(t) { try { return r3(t.seconds); } catch (e) { return null; } }
function toTime(s) { var t = new Time(); t.seconds = s; return t; }
function ticksStr(s) { return String(Math.round(s * TICKS)); }

function requireProject() {
    if (!app.project || !app.project.path) throw new Error('No project is open in Premiere Pro. Use project action=open or new.');
    return app.project;
}

function findSeq(ref) {
    requireProject();
    if (ref === undefined || ref === null || ref === '') {
        if (app.project.activeSequence) return app.project.activeSequence;
        throw new Error('No active sequence. Pass "sequence" or open one.');
    }
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
        var s = app.project.sequences[i];
        if (s.name === ref || s.sequenceID === ref) return s;
    }
    throw new Error('Sequence not found: ' + ref);
}

function __findItemByName(bin, name) {
    for (var i = 0; i < bin.children.numItems; i++) {
        var c = bin.children[i];
        if (c.name === name) return c;
        if (c.type === ProjectItemType.BIN) {
            var f = __findItemByName(c, name);
            if (f) return f;
        }
    }
    return null;
}

// "Bin/Sub/Clip.mp4" path from the project root, or a bare name searched everywhere.
function findItem(ref) {
    requireProject();
    var root = app.project.rootItem;
    var s = String(ref);
    if (s.indexOf('/') >= 0) {
        var parts = s.split('/');
        var cur = root;
        for (var i = 0; i < parts.length && cur; i++) {
            var next = null;
            for (var j = 0; j < cur.children.numItems; j++) if (cur.children[j].name === parts[i]) { next = cur.children[j]; break; }
            cur = next;
        }
        if (cur) return cur;
    }
    var f = __findItemByName(root, s);
    if (!f) throw new Error('Project item not found: ' + ref);
    return f;
}

function findOrMakeBin(pathStr) {
    requireProject();
    if (!pathStr) return app.project.rootItem;
    var parts = String(pathStr).split('/');
    var cur = app.project.rootItem;
    for (var i = 0; i < parts.length; i++) {
        var next = null;
        for (var j = 0; j < cur.children.numItems; j++) {
            var c = cur.children[j];
            if (c.name === parts[i] && c.type === ProjectItemType.BIN) { next = c; break; }
        }
        cur = next || cur.createBin(parts[i]);
    }
    return cur;
}

function getTrack(seq, type, index) {
    var tracks = type === 'audio' ? seq.audioTracks : seq.videoTracks;
    var i = (index || 1) - 1;
    if (i < 0 || i >= tracks.numTracks) throw new Error((type === 'audio' ? 'A' : 'V') + (i + 1) + ' does not exist (sequence has ' + tracks.numTracks + ').');
    return tracks[i];
}

// clip ref: 0-based index on the track, or clip name (first match).
function findClip(seq, a) {
    var tr = getTrack(seq, a.type || 'video', a.track || 1);
    var ref = a.clip;
    if (typeof ref === 'number') {
        if (ref < 0 || ref >= tr.clips.numItems) throw new Error('Clip index ' + ref + ' out of range (track has ' + tr.clips.numItems + ').');
        return tr.clips[ref];
    }
    for (var i = 0; i < tr.clips.numItems; i++) if (tr.clips[i].name === ref) return tr.clips[i];
    throw new Error('Clip not found on track: ' + ref);
}

function describeClip(c, i) {
    var o = { index: i, name: c.name, start: secs(c.start), end: secs(c.end), duration: secs(c.duration), inPoint: secs(c.inPoint), outPoint: secs(c.outPoint) };
    try { if (c.disabled) o.disabled = true; } catch (e) {}
    try { if (c.projectItem) o.media = c.projectItem.getMediaPath() || c.projectItem.name; } catch (e) {}
    try {
        var fx = [];
        for (var k = 0; k < c.components.numItems; k++) fx.push(c.components[k].displayName);
        o.components = fx;
    } catch (e) {}
    return o;
}

function seqFps(seq) {
    try { return r3(TICKS / Number(seq.timebase)); } catch (e) { return null; }
}

function describeSeq(seq, withTracks) {
    var o = { name: seq.name, id: seq.sequenceID, fps: seqFps(seq), duration: r3(Number(seq.end) / TICKS) };
    try { var st = seq.getSettings(); o.width = st.videoFrameWidth; o.height = st.videoFrameHeight; } catch (e) {}
    try { o.playhead = r3(Number(seq.getPlayerPosition().ticks) / TICKS); } catch (e) {}
    if (withTracks) {
        o.video = []; o.audio = [];
        var kinds = [['video', seq.videoTracks], ['audio', seq.audioTracks]];
        for (var k = 0; k < 2; k++) {
            var tracks = kinds[k][1];
            for (var t = 0; t < tracks.numTracks; t++) {
                var tr = tracks[t];
                var to = { track: t + 1, name: tr.name, clips: [] };
                try { if (tr.isMuted()) to.muted = true; } catch (e) {}
                for (var c = 0; c < tr.clips.numItems && c < 100; c++) to.clips.push(describeClip(tr.clips[c], c));
                o[kinds[k][0]].push(to);
            }
        }
        try {
            var m = seq.markers.getFirstMarker();
            if (m) { o.markers = []; while (m && o.markers.length < 100) { o.markers.push({ name: m.name, start: secs(m.start), comment: m.comments }); m = seq.markers.getNextMarker(m); } }
        } catch (e) {}
    }
    return o;
}

function itemType(it) {
    if (it.type === ProjectItemType.BIN) return 'bin';
    try { if (it.isSequence()) return 'sequence'; } catch (e) {}
    if (it.type === ProjectItemType.CLIP) return 'clip';
    if (it.type === ProjectItemType.FILE) return 'file';
    if (it.type === ProjectItemType.ROOT) return 'root';
    return String(it.type);
}

function itemTree(bin, depth, maxItems) {
    var out = [];
    for (var i = 0; i < bin.children.numItems && out.length < (maxItems || 300); i++) {
        var c = bin.children[i];
        var o = { name: c.name, type: itemType(c) };
        if (o.type === 'bin') { if (depth > 0) o.items = itemTree(c, depth - 1, maxItems); else o.count = c.children.numItems; }
        else { try { var p = c.getMediaPath(); if (p) o.path = p; } catch (e) {} }
        out.push(o);
    }
    return out;
}

function qeSequence(seq) {
    app.enableQE();
    if (app.project.activeSequence !== seq) app.project.activeSequence = seq;
    return qe.project.getActiveSequence();
}

// QE track items include gaps; match the DOM clip by start time.
function qeClipFor(seq, a, clip) {
    var qs = qeSequence(seq);
    var type = a.type || 'video';
    var qt = type === 'audio' ? qs.getAudioTrackAt((a.track || 1) - 1) : qs.getVideoTrackAt((a.track || 1) - 1);
    var want = Number(clip.start.ticks);
    for (var i = 0; i < qt.numItems; i++) {
        var q = qt.getItemAt(i);
        if (!q || q.type === 'Empty') continue;
        try { if (Math.abs(Number(q.start.ticks) - want) < 2) return q; } catch (e) {}
    }
    throw new Error('Could not find the clip in the QE timeline.');
}

function formattedTime(seq, s) {
    var st = seq.getSettings();
    return toTime(s).getFormatted(st.videoFrameRate, st.videoDisplayFormat);
}
