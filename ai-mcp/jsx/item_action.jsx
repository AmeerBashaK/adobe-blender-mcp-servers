var doc = findDoc(ARGS.document);
var a = ARGS.action;
var items = findItems(doc, ARGS.items || (ARGS.item ? [ARGS.item] : null));
var it = items[0];

function abRect() {
    var r = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
    return { x: r[0], y: -r[1], width: r[2] - r[0], height: r[1] - r[3] };
}

if (a === 'delete') {
    var names = [];
    for (var i = 0; i < items.length; i++) { names.push(items[i].name || items[i].typename); items[i].remove(); }
    return { deleted: names };
} else if (a === 'duplicate') {
    var dup = it.duplicate();
    if (ARGS.name) dup.name = ARGS.name;
    if (ARGS.moveBy) dup.translate(ARGS.moveBy[0], -ARGS.moveBy[1]);
    return describeItem(dup);
} else if (a === 'select') {
    doc.selection = null;
    for (var s = 0; s < items.length; s++) items[s].selected = true;
} else if (a === 'group') {
    var g = it.parent.groupItems.add();
    for (var k = items.length - 1; k >= 0; k--) items[k].move(g, ElementPlacement.PLACEATBEGINNING);
    if (ARGS.name) g.name = ARGS.name;
    return describeItem(g);
} else if (a === 'ungroup') {
    if (it.typename !== 'GroupItem') throw new Error('Not a group');
    var out = [];
    while (it.pageItems.length) {
        var ch = it.pageItems[0];
        ch.move(it, ElementPlacement.PLACEBEFORE);
        out.push(ch.name || ch.typename);
    }
    it.remove();
    return { ungrouped: out };
} else if (a === 'clipping_mask') {
    // The first item (topmost) becomes the clipping path for the rest.
    var cg = it.parent.groupItems.add();
    for (var m = items.length - 1; m >= 0; m--) items[m].move(cg, ElementPlacement.PLACEATBEGINNING);
    cg.clipped = true;
    var clip = cg.pageItems[0];
    if (clip.typename === 'PathItem') clip.clipping = true;
    else if (clip.typename === 'CompoundPathItem') clip.pathItems[0].clipping = true;
    else throw new Error('The clipping item must be a path');
    if (ARGS.name) cg.name = ARGS.name;
    return describeItem(cg);
} else if (a === 'compound_path') {
    var cp = it.parent.compoundPathItems.add();
    for (var n = items.length - 1; n >= 0; n--) items[n].move(cp, ElementPlacement.PLACEATBEGINNING);
    return describeItem(cp);
} else if (a === 'outline_text') {
    if (it.typename !== 'TextFrame') throw new Error('Not a text frame');
    return describeItem(it.createOutline());
} else if (a === 'bring_to_front') it.zOrder(ZOrderMethod.BRINGTOFRONT);
else if (a === 'send_to_back') it.zOrder(ZOrderMethod.SENDTOBACK);
else if (a === 'bring_forward') it.zOrder(ZOrderMethod.BRINGFORWARD);
else if (a === 'send_backward') it.zOrder(ZOrderMethod.SENDBACKWARD);
else if (a === 'move_to_layer') {
    var L = findLayer(doc, ARGS.layer);
    for (var q = 0; q < items.length; q++) items[q].move(L, ElementPlacement.PLACEATBEGINNING);
} else if (a === 'align') {
    // Align to the active artboard: ARGS.horizontal = left|center|right, ARGS.vertical = top|center|bottom
    var r = abRect();
    for (var z = 0; z < items.length; z++) {
        var b = boundsOf(items[z]);
        var nx = b.x, ny = b.y;
        if (ARGS.horizontal === 'left') nx = r.x;
        else if (ARGS.horizontal === 'center') nx = r.x + (r.width - b.width) / 2;
        else if (ARGS.horizontal === 'right') nx = r.x + r.width - b.width;
        if (ARGS.vertical === 'top') ny = r.y;
        else if (ARGS.vertical === 'center') ny = r.y + (r.height - b.height) / 2;
        else if (ARGS.vertical === 'bottom') ny = r.y + r.height - b.height;
        items[z].translate(nx - b.x, -(ny - b.y));
    }
} else throw new Error('Unknown action: ' + a);
var res = [];
for (var e = 0; e < items.length; e++) res.push(describeItem(items[e]));
return res.length === 1 ? res[0] : res;
