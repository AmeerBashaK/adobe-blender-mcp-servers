var bin = findOrMakeBin(ARGS.bin);
var paths = ARGS.paths;
for (var i = 0; i < paths.length; i++) if (!new File(paths[i]).exists) throw new Error('File not found: ' + paths[i]);
var before = {};
for (var b = 0; b < bin.children.numItems; b++) before[bin.children[b].nodeId] = true;
var ok = app.project.importFiles(paths, true, bin, !!ARGS.as_sequence);
var added = [];
for (var k = 0; k < bin.children.numItems; k++) {
    var c = bin.children[k];
    if (!before[c.nodeId]) added.push({ name: c.name, type: itemType(c) });
}
return { ok: ok, bin: bin.name, imported: added };
