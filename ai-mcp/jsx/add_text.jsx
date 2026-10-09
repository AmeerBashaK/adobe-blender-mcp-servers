var doc = findDoc(ARGS.document);
var c = containerFor(doc, ARGS);
var tf;
if (ARGS.box) {
    var b = ARGS.box;
    var r = c.pathItems.rectangle(Y(b[1]), b[0], b[2], b[3]);
    tf = c.textFrames.areaText(r);
} else {
    tf = c.textFrames.add();
}
if (ARGS.text === undefined) ARGS.text = 'Text';
if (ARGS.fontSize === undefined) ARGS.fontSize = 48;
if (ARGS.color === undefined) ARGS.color = '#000000';
applyText(tf, ARGS);
if (!ARGS.box) moveTo(tf, ARGS.x || 0, ARGS.y || 0, ARGS.align === 'center');
if (ARGS.name) tf.name = ARGS.name;
if (ARGS.opacity !== undefined) tf.opacity = ARGS.opacity;
if (ARGS.outline) tf = tf.createOutline();
return describeItem(tf);
