var doc = findDoc(ARGS.document);
var l = findLayer(doc, ARGS.layer);
doc.activeLayer = l;
var W = px(doc.width), H = px(doc.height);
var anchor = ARGS.anchor ? enumVal(AnchorPosition, ARGS.anchor, 'anchor') : AnchorPosition.MIDDLECENTER;
var b;
if (ARGS.fit) {
    b = boundsOf(l);
    var s = ARGS.fit === 'fill' ? Math.max(W / b.width, H / b.height) : Math.min(W / b.width, H / b.height);
    l.resize(s * 100, s * 100, AnchorPosition.MIDDLECENTER);
    b = boundsOf(l);
    l.translate((W - b.width) / 2 - b.x, (H - b.height) / 2 - b.y);
}
if (ARGS.scale !== undefined) {
    var sx = ARGS.scale instanceof Array ? ARGS.scale[0] : ARGS.scale;
    var sy = ARGS.scale instanceof Array ? ARGS.scale[1] : ARGS.scale;
    l.resize(sx, sy, anchor);
}
if (ARGS.rotate) l.rotate(ARGS.rotate, anchor);
if (ARGS.flip === 'horizontal') l.resize(-100, 100, anchor);
else if (ARGS.flip === 'vertical') l.resize(100, -100, anchor);
if (ARGS.moveBy) l.translate(ARGS.moveBy[0], ARGS.moveBy[1]);
if (ARGS.x !== undefined || ARGS.y !== undefined) {
    b = boundsOf(l);
    var tx = ARGS.x !== undefined ? ARGS.x : b.x;
    var ty = ARGS.y !== undefined ? ARGS.y : b.y;
    if (ARGS.align === 'center') {
        if (ARGS.x !== undefined) tx -= b.width / 2;
        if (ARGS.y !== undefined) ty -= b.height / 2;
    }
    l.translate(tx - b.x, ty - b.y);
}
if (ARGS.center) {
    b = boundsOf(l);
    l.translate((W - b.width) / 2 - b.x, (H - b.height) / 2 - b.y);
}
return describeLayer(l, l.name, false);
