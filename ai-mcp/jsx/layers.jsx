var doc = findDoc(ARGS.document);
var a = ARGS.action || 'list';
var L;
if (a === 'add') {
    L = doc.layers.add();
    if (ARGS.name) L.name = ARGS.name;
} else if (a !== 'list') {
    L = findLayer(doc, ARGS.layer);
    if (a === 'rename') L.name = ARGS.name;
    else if (a === 'delete') { var n = L.name; L.locked = false; L.remove(); return { deleted: n }; }
    else if (a === 'show') L.visible = true;
    else if (a === 'hide') L.visible = false;
    else if (a === 'lock') L.locked = true;
    else if (a === 'unlock') L.locked = false;
    else if (a === 'activate') doc.activeLayer = L;
    else if (a === 'to_top') L.zOrder(ZOrderMethod.BRINGTOFRONT);
    else if (a === 'to_bottom') L.zOrder(ZOrderMethod.SENDTOBACK);
    else throw new Error('Unknown action: ' + a);
}
return describeDoc(doc, false).layers;
