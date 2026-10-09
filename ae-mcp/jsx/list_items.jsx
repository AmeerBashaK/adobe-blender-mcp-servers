var want = ARGS.type || 'all';
var out = [];
for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    var kind = it instanceof CompItem ? 'comp' : it instanceof FolderItem ? 'folder' : 'footage';
    if (want !== 'all' && want !== kind) continue;
    var o = { id: it.id, name: it.name, type: kind, typeName: it.typeName };
    if (it.parentFolder && it.parentFolder !== app.project.rootFolder) o.folder = it.parentFolder.name;
    if (kind !== 'folder') {
        o.width = it.width;
        o.height = it.height;
        o.duration = it.duration;
    }
    if (kind === 'footage' && it.file) o.file = it.file.fsName;
    out.push(o);
}
return out;