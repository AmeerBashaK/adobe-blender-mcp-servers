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
    // Host objects (Document, PathItem, RGBColor, ...) are not plain data.
    return __jsonEsc(String(v));
}


// Coordinates: the wrapper switches Illustrator to artboard coordinates. Tools take and return
// x/y in points (= px at 72 ppi) from the active artboard's top-left with y pointing DOWN;
// Illustrator's own y points up, so Y() flips it.
function Y(y) { return -y; }

// ---- Lookup -------------------------------------------------------------

function findDoc(ref) {
    if (!app.documents.length) throw new Error('No document is open in Illustrator. Use create_document or open_file first.');
    if (ref === undefined || ref === null || ref === '' || ref === 'active') return app.activeDocument;
    for (var i = 0; i < app.documents.length; i++) {
        var d = app.documents[i];
        if (d.name === ref) { d.activate(); return d; }
        try { if (d.fullName.fsName === ref) { d.activate(); return d; } } catch (e) {}
    }
    throw new Error('Document not found: ' + ref);
}

function findLayer(doc, ref) {
    if (ref === undefined || ref === null || ref === '') return doc.activeLayer;
    try { return doc.layers.getByName(String(ref)); } catch (e) {}
    throw new Error('Layer not found: ' + ref);
}

// ref: omitted = the single selected item; uuid; or item name.
function findItem(doc, ref) {
    if (ref === undefined || ref === null || ref === '') {
        var sel = doc.selection;
        if (sel && sel.length === 1) return sel[0];
        throw new Error('Pass "item" (name or uuid); there is not exactly one selected item.');
    }
    var s = String(ref);
    try { var u = doc.getPageItemFromUuid(s); if (u) return u; } catch (e) {}
    try { return doc.pageItems.getByName(s); } catch (e2) {}
    throw new Error('Item not found: ' + ref);
}

function findItems(doc, refs) {
    var out = [];
    if (!refs) {
        var sel = doc.selection;
        for (var i = 0; sel && i < sel.length; i++) out.push(sel[i]);
        if (!out.length) throw new Error('Pass "items" or select something first.');
        return out;
    }
    for (var j = 0; j < refs.length; j++) out.push(findItem(doc, refs[j]));
    return out;
}

function containerFor(doc, args) {
    if (args.group) {
        var g = findItem(doc, args.group);
        if (g.typename !== 'GroupItem') throw new Error('"group" must be a group: ' + args.group);
        return g;
    }
    return findLayer(doc, args.layer);
}

// ---- Values -------------------------------------------------------------

function toColor(c) {
    if (c === null || c === 'none') return new NoColor();
    var col = new RGBColor();
    if (typeof c === 'string') {
        var h = c.replace(/^#/, '');
        if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error('Bad color: ' + c);
        col.red = parseInt(h.substr(0, 2), 16);
        col.green = parseInt(h.substr(2, 2), 16);
        col.blue = parseInt(h.substr(4, 2), 16);
    } else if (c instanceof Array && c.length >= 3) {
        var k = (c[0] <= 1 && c[1] <= 1 && c[2] <= 1) ? 255 : 1;
        col.red = c[0] * k; col.green = c[1] * k; col.blue = c[2] * k;
    } else {
        throw new Error('Bad color (use "#rrggbb", "none" or [r,g,b] 0-255): ' + c);
    }
    return col;
}

function __hex2(n) { var s = Math.round(n).toString(16); return s.length < 2 ? '0' + s : s; }

function colorHex(c) {
    try {
        if (!c || c.typename === 'NoColor') return 'none';
        if (c.typename === 'RGBColor') return '#' + __hex2(c.red) + __hex2(c.green) + __hex2(c.blue);
        if (c.typename === 'GrayColor') { var g = 255 * (1 - c.gray / 100); return '#' + __hex2(g) + __hex2(g) + __hex2(g); }
        if (c.typename === 'CMYKColor') return 'cmyk(' + [Math.round(c.cyan), Math.round(c.magenta), Math.round(c.yellow), Math.round(c.black)].join(',') + ')';
        return c.typename;
    } catch (e) { return null; }
}

function r2(n) { return Math.round(n * 100) / 100; }

function boundsOf(it) {
    var b = it.geometricBounds;
    return { x: r2(b[0]), y: r2(-b[1]), width: r2(b[2] - b[0]), height: r2(b[1] - b[3]) };
}

function moveTo(it, x, y, center) {
    var b = boundsOf(it);
    var tx = x !== undefined ? x : b.x, ty = y !== undefined ? y : b.y;
    if (center) {
        if (x !== undefined) tx -= b.width / 2;
        if (y !== undefined) ty -= b.height / 2;
    }
    it.translate(tx - b.x, -(ty - b.y));
}

function enumVal(E, name, label) {
    var up = String(name).toUpperCase().split(' ').join('').split('-').join('').split('_').join('');
    if (E[up] !== undefined) return E[up];
    for (var key in E) if (key.split('_').join('') === up) return E[key];
    throw new Error('Unknown ' + (label || 'value') + ': ' + name);
}

function enumName(v) {
    var s = String(v);
    var i = s.lastIndexOf('.');
    return (i >= 0 ? s.substr(i + 1) : s).toLowerCase();
}

function applyStyle(it, a) {
    var isText = it.typename === 'TextFrame';
    if (a.fill !== undefined && !isText) {
        it.filled = a.fill !== 'none' && a.fill !== null;
        if (it.filled) it.fillColor = toColor(a.fill);
    }
    if (a.stroke !== undefined) {
        if (isText) it.textRange.characterAttributes.strokeColor = toColor(a.stroke);
        else { it.stroked = a.stroke !== 'none' && a.stroke !== null; if (it.stroked) it.strokeColor = toColor(a.stroke); }
    }
    if (a.strokeWidth !== undefined) {
        if (isText) it.textRange.characterAttributes.strokeWeight = a.strokeWidth;
        else it.strokeWidth = a.strokeWidth;
    }
    if (a.opacity !== undefined) it.opacity = a.opacity;
    if (a.blendMode) it.blendingMode = enumVal(BlendModes, a.blendMode, 'blend mode');
    if (a.name) it.name = a.name;
}

function applyText(tf, a) {
    if (a.text !== undefined) tf.contents = String(a.text).split('\n').join('\r');
    var ca = tf.textRange.characterAttributes;
    if (a.font) {
        try { ca.textFont = app.textFonts.getByName(a.font); }
        catch (e) { throw new Error('Font not found (use the PostScript name, e.g. "Montserrat-Bold"): ' + a.font); }
    }
    if (a.fontSize !== undefined) ca.size = a.fontSize;
    if (a.color !== undefined) ca.fillColor = toColor(a.color);
    if (a.tracking !== undefined) ca.tracking = a.tracking;
    if (a.leading !== undefined) { ca.autoLeading = false; ca.leading = a.leading; }
    if (a.justification) tf.textRange.paragraphAttributes.justification = enumVal(Justification, a.justification, 'justification');
}

// ---- Description --------------------------------------------------------

function describeItem(it) {
    var o = { name: it.name || null, type: it.typename };
    try { o.uuid = it.uuid; } catch (e) {}
    try { o.layer = it.layer.name; } catch (e) {}
    try { o.bounds = boundsOf(it); } catch (e) {}
    try { if (it.hidden) o.hidden = true; } catch (e) {}
    try { if (it.locked) o.locked = true; } catch (e) {}
    try { if (it.opacity !== 100) o.opacity = r2(it.opacity); } catch (e) {}
    if (it.typename === 'PathItem') {
        o.fill = it.filled ? colorHex(it.fillColor) : 'none';
        o.stroke = it.stroked ? colorHex(it.strokeColor) : 'none';
        if (it.stroked) o.strokeWidth = it.strokeWidth;
        o.closed = it.closed;
    } else if (it.typename === 'TextFrame') {
        o.text = it.contents;
        try {
            var ca = it.textRange.characterAttributes;
            o.font = ca.textFont.name;
            o.fontSize = r2(ca.size);
            o.color = colorHex(ca.fillColor);
        } catch (e) {}
        o.kind = enumName(it.kind);
    } else if (it.typename === 'GroupItem') {
        o.items = it.pageItems.length;
        if (it.clipped) o.clipped = true;
    } else if (it.typename === 'PlacedItem') {
        try { o.file = it.file.fsName; } catch (e) {}
    }
    return o;
}

function describeDoc(d, withItems) {
    var o = {
        name: d.name,
        colorMode: enumName(d.documentColorSpace),
        width: r2(d.width),
        height: r2(d.height),
        saved: d.saved,
        activeArtboard: d.artboards.getActiveArtboardIndex(),
        artboards: [],
        layers: []
    };
    try { o.path = d.fullName.fsName; } catch (e) { o.path = null; }
    for (var i = 0; i < d.artboards.length; i++) {
        var r = d.artboards[i].artboardRect;
        o.artboards.push({ index: i, name: d.artboards[i].name, x: r2(r[0]), y: r2(-r[1]), width: r2(r[2] - r[0]), height: r2(r[1] - r[3]) });
    }
    for (var j = 0; j < d.layers.length; j++) {
        var L = d.layers[j];
        var lo = { name: L.name, visible: L.visible, locked: L.locked, count: L.pageItems.length };
        if (withItems) {
            lo.items = [];
            for (var k = 0; k < L.pageItems.length && lo.items.length < 200; k++) {
                var it = L.pageItems[k];
                if (it.parent.typename === 'Layer') lo.items.push(describeItem(it));
            }
        }
        o.layers.push(lo);
    }
    var sel = d.selection;
    if (sel && sel.length) {
        o.selection = [];
        for (var s = 0; s < sel.length && s < 50; s++) o.selection.push(sel[s].name || sel[s].typename);
    }
    return o;
}
