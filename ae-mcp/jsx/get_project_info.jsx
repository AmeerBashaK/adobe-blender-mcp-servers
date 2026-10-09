var p = app.project;
var comps = [];
for (var i = 1; i <= p.numItems; i++) {
    if (p.item(i) instanceof CompItem) comps.push(describeComp(p.item(i)));
}
var a = p.activeItem;
return {
    aeVersion: app.version,
    projectFile: p.file ? p.file.fsName : null,
    numItems: p.numItems,
    activeItem: a ? { id: a.id, name: a.name, type: a.typeName } : null,
    compositions: comps,
    renderQueueItems: p.renderQueue.numItems
};