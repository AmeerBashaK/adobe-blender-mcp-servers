var doc = findDoc(ARGS.document);
var l = findLayer(doc, ARGS.layer);
doc.activeLayer = l;
if (ARGS.name !== undefined) l.name = ARGS.name;
if (ARGS.visible !== undefined) l.visible = ARGS.visible;
if (ARGS.opacity !== undefined) l.opacity = ARGS.opacity;
if (ARGS.fillOpacity !== undefined) l.fillOpacity = ARGS.fillOpacity;
if (ARGS.blendMode) l.blendMode = enumVal(BlendMode, ARGS.blendMode, 'blend mode');
if (ARGS.locked !== undefined) l.allLocked = ARGS.locked;
var textArgs = ARGS.text !== undefined || ARGS.font || ARGS.fontSize !== undefined || ARGS.color ||
    ARGS.justification || ARGS.tracking !== undefined || ARGS.leading !== undefined;
if (textArgs) {
    if (l.typename !== 'ArtLayer' || l.kind !== LayerKind.TEXT) throw new Error('"' + l.name + '" is not a text layer.');
    var t = l.textItem;
    if (ARGS.text !== undefined) t.contents = String(ARGS.text).split('\n').join('\r');
    if (ARGS.font) t.font = ARGS.font;
    if (ARGS.fontSize !== undefined) t.size = ARGS.fontSize;
    if (ARGS.color) t.color = toColor(ARGS.color);
    if (ARGS.justification) t.justification = enumVal(Justification, ARGS.justification, 'justification');
    if (ARGS.tracking !== undefined) t.tracking = ARGS.tracking;
    if (ARGS.leading !== undefined) { t.useAutoLeading = false; t.leading = ARGS.leading; }
}
return describeLayer(l, l.name, false);
