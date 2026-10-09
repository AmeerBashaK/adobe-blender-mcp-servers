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
    // Host objects (CompItem, Layer, TextDocument, ...) are not plain data.
    return __jsonEsc(String(v));
}

function __mcpWrite(path, obj) {
    var tmp = new File(path + '.tmp');
    tmp.encoding = 'UTF-8';
    if (!tmp.open('w')) return;
    tmp.write(__json(obj));
    tmp.close();
    tmp.rename(new File(path).name);
}

// ---- Lookup -------------------------------------------------------------

function findComp(ref) {
    if (ref === undefined || ref === null || ref === '' || ref === 'active') {
        var a = app.project.activeItem;
        if (a && a instanceof CompItem) return a;
        throw new Error('No active composition. Pass "comp" (name or id), or open a comp in After Effects.');
    }
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem && (it.name === ref || it.id === ref)) return it;
    }
    throw new Error('Composition not found: ' + ref);
}

function findItem(ref) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it.name === ref || it.id === ref) return it;
    }
    throw new Error('Project item not found: ' + ref);
}

function findLayer(comp, ref) {
    if (ref === undefined || ref === null || ref === '') {
        if (comp.selectedLayers.length === 1) return comp.selectedLayers[0];
        throw new Error('Pass "layer" (name or 1-based index); there is not exactly one selected layer in "' + comp.name + '".');
    }
    var l = null;
    if (typeof ref === 'number') {
        if (ref >= 1 && ref <= comp.numLayers) l = comp.layer(ref);
    } else {
        l = comp.layer(String(ref));
    }
    if (!l) throw new Error('Layer not found in "' + comp.name + '": ' + ref);
    return l;
}

function __child(group, key) {
    try {
        if (!group || group.propertyType === PropertyType.PROPERTY) return null;
        return group.property(/^\d+$/.test(key) ? parseInt(key, 10) : key);
    } catch (e) {
        return null;
    }
}

// Paths are "/"-separated display or match names, e.g. "Position", "Transform/Opacity",
// "Effects/Gaussian Blur/Blurriness", "Source Text". Short names are also looked up under
// Transform, Text and Effects.
function resolveProp(layer, path) {
    var parts = String(path).split('/');
    var roots = [layer, __child(layer, 'ADBE Transform Group'), __child(layer, 'ADBE Text Properties'), __child(layer, 'ADBE Effect Parade')];
    for (var r = 0; r < roots.length; r++) {
        var p = roots[r];
        for (var i = 0; i < parts.length && p; i++) p = __child(p, parts[i]);
        if (p) return p;
    }
    throw new Error('Property not found on layer "' + layer.name + '": ' + path);
}

// ---- Values -------------------------------------------------------------

function toColor(c, withAlpha) {
    var rgb;
    if (typeof c === 'string') {
        var h = c.replace(/^#/, '');
        if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error('Bad color: ' + c);
        rgb = [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
    } else if (c instanceof Array && c.length >= 3) {
        rgb = [c[0], c[1], c[2]];
        if (rgb[0] > 1 || rgb[1] > 1 || rgb[2] > 1) rgb = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    } else {
        throw new Error('Bad color (use "#rrggbb", [r,g,b] 0-1 or 0-255): ' + c);
    }
    if (withAlpha) rgb.push(1);
    return rgb;
}

var __JUSTIFY = { left: 'LEFT_JUSTIFY', center: 'CENTER_JUSTIFY', right: 'RIGHT_JUSTIFY' };

function applyTextDoc(doc, o) {
    if (o.text !== undefined) doc.text = String(o.text);
    if (o.fontSize !== undefined) doc.fontSize = o.fontSize;
    if (o.font) doc.font = o.font;
    if (o.fillColor !== undefined) { doc.applyFill = true; doc.fillColor = toColor(o.fillColor); }
    if (o.strokeColor !== undefined) { doc.applyStroke = true; doc.strokeColor = toColor(o.strokeColor); }
    if (o.strokeWidth !== undefined) doc.strokeWidth = o.strokeWidth;
    if (o.tracking !== undefined) doc.tracking = o.tracking;
    if (o.leading !== undefined) { doc.autoLeading = false; doc.leading = o.leading; }
    if (o.justification) doc.justification = ParagraphJustification[__JUSTIFY[o.justification] || o.justification];
    return doc;
}

function textDocOut(d) {
    var o = { text: d.text, fontSize: d.fontSize, font: d.font };
    try { if (d.applyFill) o.fillColor = d.fillColor; } catch (e) {}
    try { if (d.applyStroke) { o.strokeColor = d.strokeColor; o.strokeWidth = d.strokeWidth; } } catch (e) {}
    return o;
}

function propValue(prop) {
    var t = prop.propertyValueType;
    if (t === PropertyValueType.NO_VALUE) return undefined;
    if (t === PropertyValueType.CUSTOM_VALUE) return '[custom value]';
    if (t === PropertyValueType.MARKER) return '[marker]';
    try {
        var v = prop.value;
        if (t === PropertyValueType.TEXT_DOCUMENT) return textDocOut(v);
        if (t === PropertyValueType.SHAPE) return '[path, ' + v.vertices.length + ' vertices]';
        return v;
    } catch (e) {
        return '[unreadable: ' + e + ']';
    }
}

function coerceValue(prop, value) {
    var t = prop.propertyValueType;
    if (t === PropertyValueType.COLOR) return toColor(value, true);
    if (t === PropertyValueType.TEXT_DOCUMENT) {
        var doc = prop.value;
        return typeof value === 'string' ? applyTextDoc(doc, { text: value }) : applyTextDoc(doc, value);
    }
    if (typeof value === 'number' && prop.value instanceof Array) {
        // Convenience: "Scale": 50 -> [50, 50, 50]
        var arr = [];
        for (var i = 0; i < prop.value.length; i++) arr.push(value);
        return arr;
    }
    return value;
}

function ownerLayer(prop) {
    return prop.propertyGroup(prop.propertyDepth);
}

function setProp(prop, value) {
    if (prop.propertyType !== PropertyType.PROPERTY) throw new Error('"' + prop.name + '" is a group, not a property');
    var v = coerceValue(prop, value);
    if (prop.numKeys > 0) prop.setValueAtTime(ownerLayer(prop).containingComp.time, v);
    else prop.setValue(v);
}

// ---- Description --------------------------------------------------------

function layerType(l) {
    if (l instanceof TextLayer) return 'text';
    if (l instanceof ShapeLayer) return 'shape';
    if (l instanceof CameraLayer) return 'camera';
    if (l instanceof LightLayer) return 'light';
    if (l.nullLayer) return 'null';
    if (l.adjustmentLayer) return 'adjustment';
    if (l.source instanceof CompItem) return 'precomp';
    if (l.source && l.source.mainSource instanceof SolidSource) return 'solid';
    if (l.source) return 'footage';
    return 'unknown';
}

function describeLayer(l) {
    var o = {
        index: l.index,
        name: l.name,
        type: layerType(l),
        enabled: l.enabled,
        locked: l.locked,
        inPoint: l.inPoint,
        outPoint: l.outPoint,
        startTime: l.startTime,
        parent: l.parent ? l.parent.index : null
    };
    if (l instanceof AVLayer) {
        o.threeD = l.threeDLayer;
        if (l.source) o.source = l.source.name;
    }
    var tr = __child(l, 'ADBE Transform Group');
    if (tr) {
        o.position = propValue(tr.property('ADBE Position'));
        var s = __child(tr, 'ADBE Scale');
        if (s) o.scale = propValue(s);
        var op = __child(tr, 'ADBE Opacity');
        if (op) o.opacity = propValue(op);
    }
    if (l instanceof TextLayer) o.text = propValue(l.property('ADBE Text Properties').property('ADBE Text Document')).text;
    var fx = __child(l, 'ADBE Effect Parade');
    if (fx && fx.numProperties) {
        o.effects = [];
        for (var i = 1; i <= fx.numProperties; i++) o.effects.push(fx.property(i).name);
    }
    return o;
}

function describeComp(c) {
    return {
        id: c.id,
        name: c.name,
        width: c.width,
        height: c.height,
        pixelAspect: c.pixelAspect,
        duration: c.duration,
        frameRate: c.frameRate,
        numLayers: c.numLayers
    };
}
