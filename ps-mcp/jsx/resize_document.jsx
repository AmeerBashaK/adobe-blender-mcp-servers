var doc = findDoc(ARGS.document);
var W = px(doc.width), H = px(doc.height);
var w = ARGS.width, h = ARGS.height;
if (!w && !h) throw new Error('Pass width and/or height in pixels');
if (ARGS.mode === 'canvas') {
    var anchor = ARGS.anchor ? enumVal(AnchorPosition, ARGS.anchor, 'anchor') : AnchorPosition.MIDDLECENTER;
    doc.resizeCanvas(UnitValue(w || W, 'px'), UnitValue(h || H, 'px'), anchor);
} else if (ARGS.mode === 'crop') {
    if (!ARGS.rect) throw new Error('"rect" [x, y, width, height] is required for crop');
    var r = ARGS.rect;
    doc.crop([UnitValue(r[0], 'px'), UnitValue(r[1], 'px'), UnitValue(r[0] + r[2], 'px'), UnitValue(r[1] + r[3], 'px')]);
} else {
    if (!w) w = W * h / H;
    if (!h) h = H * w / W;
    doc.resizeImage(UnitValue(w, 'px'), UnitValue(h, 'px'), null, ResampleMethod.BICUBICAUTOMATIC);
}
return describeDoc(doc, false);
