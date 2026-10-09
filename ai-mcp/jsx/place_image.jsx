var doc = findDoc(ARGS.document);
var c = containerFor(doc, ARGS);
var f = new File(ARGS.path);
if (!f.exists) throw new Error('File not found: ' + ARGS.path);
var it = c.placedItems.add();
it.file = f;
if (ARGS.embed) { it.embed(); it = doc.selection && doc.selection.length === 1 ? doc.selection[0] : c.pageItems[0]; }
if (ARGS.name) it.name = ARGS.name;
var b = boundsOf(it);
if (ARGS.width) {
    var k = ARGS.width / b.width * 100;
    it.resize(k, k);
}
moveTo(it, ARGS.x !== undefined ? ARGS.x : 0, ARGS.y !== undefined ? ARGS.y : 0, false);
return describeItem(it);
