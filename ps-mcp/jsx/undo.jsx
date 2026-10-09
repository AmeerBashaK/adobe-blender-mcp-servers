var doc = findDoc(ARGS.document);
var steps = ARGS.steps || 1;
var dir = ARGS.redo ? 'Nxt ' : 'Prvs';
for (var i = 0; i < steps; i++) {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putEnumerated(charIDToTypeID('HstS'), charIDToTypeID('Ordn'), charIDToTypeID(dir));
    d.putReference(charIDToTypeID('null'), r);
    executeAction(charIDToTypeID('slct'), d, DialogModes.NO);
}
return { now_at: doc.activeHistoryState.name, steps: steps, redo: !!ARGS.redo };
