var doc = findDoc(ARGS.document);
var type = ARGS.type || 'pixel';
var l;
if (type === 'group') {
    l = doc.layerSets.add();
} else {
    l = doc.artLayers.add();
    if (type === 'text') {
        l.kind = LayerKind.TEXT;
        var t = l.textItem;
        if (ARGS.box) {
            t.kind = TextType.PARAGRAPHTEXT;
            t.position = [ARGS.box[0], ARGS.box[1]];
            t.width = ARGS.box[2];
            t.height = ARGS.box[3];
        } else {
            t.position = [ARGS.x !== undefined ? ARGS.x : 100, ARGS.y !== undefined ? ARGS.y : 100];
        }
        t.contents = String(ARGS.text || 'Text').split('\n').join('\r');
        if (ARGS.font) t.font = ARGS.font;
        t.size = ARGS.fontSize || 48;
        t.color = toColor(ARGS.color || '#000000');
        if (ARGS.justification) t.justification = enumVal(Justification, ARGS.justification, 'justification');
        if (ARGS.tracking !== undefined) t.tracking = ARGS.tracking;
        if (ARGS.leading !== undefined) { t.useAutoLeading = false; t.leading = ARGS.leading; }
    } else if (type === 'solid' || type === 'rectangle' || type === 'ellipse') {
        if (ARGS.rect) selectRect(doc, ARGS.rect, type === 'ellipse', ARGS.feather);
        else if (type === 'solid') doc.selection.selectAll();
        else throw new Error('"rect" [x, y, width, height] is required for ' + type);
        doc.selection.fill(toColor(ARGS.color || '#000000'));
        doc.selection.deselect();
    } else if (type !== 'pixel') {
        throw new Error('Unknown layer type: ' + type);
    }
}
if (ARGS.name) l.name = ARGS.name;
if (ARGS.opacity !== undefined) l.opacity = ARGS.opacity;
if (ARGS.blendMode) l.blendMode = enumVal(BlendMode, ARGS.blendMode, 'blend mode');
return describeLayer(l, l.name, false);
