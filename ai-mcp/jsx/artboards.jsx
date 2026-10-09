var doc = findDoc(ARGS.document);
var a = ARGS.action || 'list';
function rect(r) { return [r[0], -r[1], r[0] + r[2], -(r[1] + r[3])]; }
var i = ARGS.index !== undefined ? ARGS.index : doc.artboards.getActiveArtboardIndex();
if (a === 'add') {
    var ab = doc.artboards.add(rect(ARGS.rect));
    if (ARGS.name) ab.name = ARGS.name;
} else if (a === 'resize') doc.artboards[i].artboardRect = rect(ARGS.rect);
else if (a === 'rename') doc.artboards[i].name = ARGS.name;
else if (a === 'activate') doc.artboards.setActiveArtboardIndex(i);
else if (a === 'delete') doc.artboards.remove(i);
else if (a === 'fit_to_art') {
    doc.artboards.setActiveArtboardIndex(i);
    doc.selection = null;
    doc.selectObjectsOnActiveArtboard();
    doc.fitArtboardToSelectedArt(i);
    doc.selection = null;
} else if (a !== 'list') throw new Error('Unknown action: ' + a);
return describeDoc(doc, false).artboards;
