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
    // Host objects (Document, ArtLayer, SolidColor, ...) are not plain data.
    return __jsonEsc(String(v));
}

// ---- Lookup -------------------------------------------------------------

function findDoc(ref) {
    if (!app.documents.length) throw new Error('No document is open in Photoshop. Use create_document or open_file first.');
    if (ref === undefined || ref === null || ref === '' || ref === 'active') return app.activeDocument;
    for (var i = 0; i < app.documents.length; i++) {
        var d = app.documents[i];
        if (d.name === ref) return d;
        try { if (d.fullName.fsName === ref) return d; } catch (e) {}
    }
    throw new Error('Document not found: ' + ref);
}

function __findByName(container, name) {
    for (var i = 0; i < container.layers.length; i++) {
        var l = container.layers[i];
        if (l.name === name) return l;
        if (l.typename === 'LayerSet') {
            var f = __findByName(l, name);
            if (f) return f;
        }
    }
    return null;
}

function __findById(container, id) {
    for (var i = 0; i < container.layers.length; i++) {
        var l = container.layers[i];
        try { if (l.id === id) return l; } catch (e) {}
        if (l.typename === 'LayerSet') {
            var f = __findById(l, id);
            if (f) return f;
        }
    }
    return null;
}

// ref: omitted = active layer; number = layer id; "Group/Layer" = path; "Name" = first layer with that name.
function findLayer(doc, ref) {
    if (ref === undefined || ref === null || ref === '') return doc.activeLayer;
    var l = null;
    if (typeof ref === 'number') {
        l = __findById(doc, ref);
    } else {
        var s = String(ref);
        if (s.indexOf('/') >= 0) {
            var parts = s.split('/');
            var c = doc;
            for (var i = 0; i < parts.length && c; i++) {
                var next = null;
                for (var j = 0; j < c.layers.length; j++) if (c.layers[j].name === parts[i]) { next = c.layers[j]; break; }
                c = next;
            }
            l = c;
        }
        if (!l) l = __findByName(doc, s);
    }
    if (!l) throw new Error('Layer not found in "' + doc.name + '": ' + ref);
    return l;
}

// ---- Values -------------------------------------------------------------

function toColor(c) {
    var col = new SolidColor();
    if (typeof c === 'string') {
        var h = c.replace(/^#/, '');
        if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error('Bad color: ' + c);
        col.rgb.hexValue = h;
    } else if (c instanceof Array && c.length >= 3) {
        var k = (c[0] <= 1 && c[1] <= 1 && c[2] <= 1) ? 255 : 1;
        col.rgb.red = c[0] * k; col.rgb.green = c[1] * k; col.rgb.blue = c[2] * k;
    } else {
        throw new Error('Bad color (use "#rrggbb" or [r,g,b] 0-255): ' + c);
    }
    return col;
}

function colorHex(col) {
    try { return '#' + col.rgb.hexValue; } catch (e) { return null; }
}

function px(v) {
    try { return Math.round(v.as('px') * 100) / 100; } catch (e) { return Number(v); }
}

function boundsOf(l) {
    var b = l.bounds;
    var x = px(b[0]), y = px(b[1]);
    return { x: x, y: y, width: px(b[2]) - x, height: px(b[3]) - y };
}

// Photoshop enum from a friendly name: enumVal(BlendMode, 'multiply') -> BlendMode.MULTIPLY
function enumVal(E, name, label) {
    var up = String(name).toUpperCase().split(' ').join('_').split('-').join('_');
    if (E[up] !== undefined) return E[up];
    var k = up.split('_').join('');
    if (E[k] !== undefined) return E[k];
    for (var key in E) {
        if (key.split('_').join('') === k.split('_').join('')) return E[key];
    }
    throw new Error('Unknown ' + (label || 'value') + ': ' + name);
}

function enumName(v) {
    var s = String(v);
    var i = s.lastIndexOf('.');
    return (i >= 0 ? s.substr(i + 1) : s).toLowerCase();
}

// Select rectangle [x, y, w, h] in pixels.
function selectRect(doc, r, ellipse, feather) {
    var x = r[0], y = r[1], w = r[2], h = r[3];
    if (ellipse) {
        var d = new ActionDescriptor();
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID('Chnl'), charIDToTypeID('fsel'));
        d.putReference(charIDToTypeID('null'), ref);
        var e = new ActionDescriptor();
        e.putUnitDouble(charIDToTypeID('Top '), charIDToTypeID('#Pxl'), y);
        e.putUnitDouble(charIDToTypeID('Left'), charIDToTypeID('#Pxl'), x);
        e.putUnitDouble(charIDToTypeID('Btom'), charIDToTypeID('#Pxl'), y + h);
        e.putUnitDouble(charIDToTypeID('Rght'), charIDToTypeID('#Pxl'), x + w);
        d.putObject(charIDToTypeID('T   '), charIDToTypeID('Elps'), e);
        d.putBoolean(charIDToTypeID('AntA'), true);
        executeAction(charIDToTypeID('setd'), d, DialogModes.NO);
        if (feather) doc.selection.feather(feather);
    } else {
        doc.selection.select([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], SelectionType.REPLACE, feather || 0, true);
    }
}

// ---- Description --------------------------------------------------------

function describeLayer(l, path, deep) {
    var o = { name: l.name, path: path, kind: null, visible: l.visible };
    try { o.id = l.id; } catch (e) {}
    if (l.typename === 'LayerSet') {
        o.kind = 'group';
    } else {
        o.kind = enumName(l.kind);
        try { if (l.isBackgroundLayer) o.background = true; } catch (e) {}
        if (l.kind === LayerKind.TEXT) {
            try {
                var t = l.textItem;
                o.text = t.contents;
                o.font = t.font;
                o.fontSize = px(t.size);
                o.color = colorHex(t.color);
            } catch (e) {}
        }
    }
    try { o.opacity = Math.round(l.opacity); } catch (e) {}
    try { o.blendMode = enumName(l.blendMode); } catch (e) {}
    try { if (l.allLocked) o.locked = true; } catch (e) {}
    try { o.bounds = boundsOf(l); } catch (e) {}
    if (l.typename === 'LayerSet' && deep !== false) {
        o.layers = [];
        for (var i = 0; i < l.layers.length; i++) o.layers.push(describeLayer(l.layers[i], path + '/' + l.layers[i].name, deep));
    }
    return o;
}

function describeDoc(d, withLayers) {
    var o = {
        name: d.name,
        width: px(d.width),
        height: px(d.height),
        resolution: d.resolution,
        mode: enumName(d.mode),
        bitsPerChannel: enumName(d.bitsPerChannel),
        saved: d.saved,
        activeLayer: d.activeLayer ? d.activeLayer.name : null
    };
    try { o.path = d.fullName.fsName; } catch (e) { o.path = null; }
    if (withLayers) {
        o.layers = [];
        for (var i = 0; i < d.layers.length; i++) o.layers.push(describeLayer(d.layers[i], d.layers[i].name, true));
    }
    return o;
}
