var doc = findDoc(ARGS.document);
var it = findItem(doc, ARGS.item);
if (ARGS.locked === false) it.locked = false;
applyStyle(it, ARGS);
if (ARGS.hidden !== undefined) it.hidden = ARGS.hidden;
var isText = it.typename === 'TextFrame';
if (ARGS.text !== undefined || ARGS.font || ARGS.fontSize !== undefined || ARGS.color !== undefined ||
    ARGS.tracking !== undefined || ARGS.leading !== undefined || ARGS.justification) {
    if (!isText) throw new Error('"' + (it.name || it.typename) + '" is not a text frame.');
    applyText(it, ARGS);
}
if (ARGS.width !== undefined || ARGS.height !== undefined) {
    var b = boundsOf(it);
    var sx = ARGS.width !== undefined ? ARGS.width / b.width * 100 : null;
    var sy = ARGS.height !== undefined ? ARGS.height / b.height * 100 : null;
    if (sx === null) sx = ARGS.keepAspect === false ? 100 : sy;
    if (sy === null) sy = ARGS.keepAspect === false ? 100 : sx;
    it.resize(sx, sy, true, true, true, true, ARGS.scaleStrokes ? sx : 100, Transformation.TOPLEFT);
}
if (ARGS.scale !== undefined) it.resize(ARGS.scale, ARGS.scale, true, true, true, true, ARGS.scaleStrokes ? ARGS.scale : 100, Transformation.CENTER);
if (ARGS.rotate) it.rotate(ARGS.rotate);
if (ARGS.flip === 'horizontal') it.resize(-100, 100);
else if (ARGS.flip === 'vertical') it.resize(100, -100);
if (ARGS.moveBy) it.translate(ARGS.moveBy[0], -ARGS.moveBy[1]);
if (ARGS.x !== undefined || ARGS.y !== undefined) moveTo(it, ARGS.x, ARGS.y, ARGS.align === 'center');
if (ARGS.locked === true) it.locked = true;
return describeItem(it);
