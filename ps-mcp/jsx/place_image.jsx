var doc = findDoc(ARGS.document);
var f = new File(ARGS.path);
if (!f.exists) throw new Error('File not found: ' + ARGS.path);
var d = new ActionDescriptor();
d.putPath(charIDToTypeID('null'), f);
d.putEnumerated(charIDToTypeID('FTcs'), charIDToTypeID('QCSt'), charIDToTypeID('Qcsa'));
executeAction(charIDToTypeID('Plc '), d, DialogModes.NO);
var l = doc.activeLayer;
if (ARGS.name) l.name = ARGS.name;
var W = px(doc.width), H = px(doc.height);
var b = boundsOf(l);
if (ARGS.fit === 'fill' || ARGS.fit === 'fit') {
    var s = ARGS.fit === 'fill' ? Math.max(W / b.width, H / b.height) : Math.min(W / b.width, H / b.height);
    l.resize(s * 100, s * 100, AnchorPosition.MIDDLECENTER);
} else if (ARGS.width) {
    var k = ARGS.width / b.width * 100;
    l.resize(k, k, AnchorPosition.MIDDLECENTER);
}
b = boundsOf(l);
if (ARGS.x !== undefined || ARGS.y !== undefined) {
    l.translate((ARGS.x !== undefined ? ARGS.x : b.x) - b.x, (ARGS.y !== undefined ? ARGS.y : b.y) - b.y);
} else {
    l.translate((W - b.width) / 2 - b.x, (H - b.height) / 2 - b.y);
}
if (ARGS.rasterize) l.rasterize(RasterizeType.ENTIRELAYER);
return describeLayer(l, l.name, false);
