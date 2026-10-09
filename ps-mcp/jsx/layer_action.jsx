var doc = findDoc(ARGS.document);
var l = findLayer(doc, ARGS.layer);
doc.activeLayer = l;
var a = ARGS.action;
var res = l;

function moveActive(dir) {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putEnumerated(charIDToTypeID('Lyr '), charIDToTypeID('Ordn'), charIDToTypeID('Trgt'));
    d.putReference(charIDToTypeID('null'), r);
    var r2 = new ActionReference();
    r2.putEnumerated(charIDToTypeID('Lyr '), charIDToTypeID('Ordn'), charIDToTypeID(dir));
    d.putReference(charIDToTypeID('T   '), r2);
    executeAction(charIDToTypeID('move'), d, DialogModes.NO);
}

function addMask() {
    if (l.isBackgroundLayer) l.isBackgroundLayer = false;
    var d = new ActionDescriptor();
    d.putClass(charIDToTypeID('Nw  '), charIDToTypeID('Chnl'));
    var r = new ActionReference();
    r.putEnumerated(charIDToTypeID('Chnl'), charIDToTypeID('Chnl'), charIDToTypeID('Msk '));
    d.putReference(charIDToTypeID('At  '), r);
    d.putEnumerated(charIDToTypeID('Usng'), charIDToTypeID('UsrM'), charIDToTypeID('RvlS'));
    executeAction(charIDToTypeID('Mk  '), d, DialogModes.NO);
    try { doc.selection.deselect(); } catch (e) {}
}

if (a === 'delete') {
    var n = l.name;
    l.remove();
    return { deleted: n };
} else if (a === 'duplicate') {
    res = l.duplicate();
    if (ARGS.name) res.name = ARGS.name;
} else if (a === 'select') {
    // activeLayer already set
} else if (a === 'bring_forward') {
    moveActive('Nxt ');
} else if (a === 'send_backward') {
    moveActive('Prvs');
} else if (a === 'to_top') {
    moveActive('Frnt');
} else if (a === 'to_bottom') {
    moveActive('Back');
} else if (a === 'move_into') {
    var g = findLayer(doc, ARGS.target);
    if (g.typename !== 'LayerSet') throw new Error('"target" must be a group');
    l.move(g, ElementPlacement.INSIDE);
} else if (a === 'merge_down') {
    res = l.merge();
} else if (a === 'rasterize') {
    l.rasterize(RasterizeType.ENTIRELAYER);
} else if (a === 'unlock_background') {
    l.isBackgroundLayer = false;
} else if (a === 'mask_from_selection') {
    addMask();
    res = doc.activeLayer;
} else if (a === 'remove_background') {
    if (l.isBackgroundLayer) l.isBackgroundLayer = false;
    var sd = new ActionDescriptor();
    sd.putBoolean(stringIDToTypeID('sampleAllLayers'), false);
    executeAction(stringIDToTypeID('autoCutout'), sd, DialogModes.NO);
    addMask();
    res = doc.activeLayer;
} else if (a === 'convert_to_smart_object') {
    executeAction(stringIDToTypeID('newPlacedLayer'), undefined, DialogModes.NO);
    res = doc.activeLayer;
} else {
    throw new Error('Unknown action: ' + a);
}
return describeLayer(res, res.name, false);
