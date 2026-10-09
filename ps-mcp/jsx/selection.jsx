var doc = findDoc(ARGS.document);
var a = ARGS.action;
var sel = doc.selection;
if (ARGS.layer !== undefined) doc.activeLayer = findLayer(doc, ARGS.layer);
if (a === 'all') sel.selectAll();
else if (a === 'none') sel.deselect();
else if (a === 'invert') sel.invert();
else if (a === 'rect' || a === 'ellipse') {
    if (!ARGS.rect) throw new Error('"rect" [x, y, width, height] is required');
    selectRect(doc, ARGS.rect, a === 'ellipse', ARGS.feather);
} else if (a === 'subject') {
    var d = new ActionDescriptor();
    d.putBoolean(stringIDToTypeID('sampleAllLayers'), !!ARGS.sampleAllLayers);
    executeAction(stringIDToTypeID('autoCutout'), d, DialogModes.NO);
} else if (a === 'layer_pixels') {
    var r = new ActionReference();
    r.putProperty(charIDToTypeID('Chnl'), charIDToTypeID('fsel'));
    var ld = new ActionDescriptor();
    ld.putReference(charIDToTypeID('null'), r);
    var t = new ActionReference();
    t.putEnumerated(charIDToTypeID('Chnl'), charIDToTypeID('Chnl'), charIDToTypeID('Trsp'));
    ld.putReference(charIDToTypeID('T   '), t);
    executeAction(charIDToTypeID('setd'), ld, DialogModes.NO);
} else if (a === 'fill') {
    sel.fill(toColor(ARGS.color || '#000000'), ColorBlendMode.NORMAL, ARGS.opacity !== undefined ? ARGS.opacity : 100);
} else if (a === 'clear') {
    sel.clear();
} else if (a === 'stroke') {
    sel.stroke(toColor(ARGS.color || '#000000'), ARGS.width || 2, StrokeLocation.INSIDE);
} else if (a === 'crop') {
    doc.crop(sel.bounds);
} else throw new Error('Unknown selection action: ' + a);
if (ARGS.feather && a !== 'rect' && a !== 'ellipse' && a !== 'none') sel.feather(ARGS.feather);
var out = { action: a, hasSelection: false };
try { var b = sel.bounds; out.hasSelection = true; out.bounds = { x: px(b[0]), y: px(b[1]), width: px(b[2]) - px(b[0]), height: px(b[3]) - px(b[1]) }; } catch (e) {}
return out;
