var seq = findSeq(ARGS.sequence);
var a = ARGS.action || 'list';
if (a === 'add') {
    var m = seq.markers.createMarker(ARGS.time || 0);
    if (ARGS.name) m.name = ARGS.name;
    if (ARGS.comment) m.comments = ARGS.comment;
    if (ARGS.duration) m.end = toTime((ARGS.time || 0) + ARGS.duration);
    if (ARGS.color !== undefined) m.setColorByIndex(ARGS.color);
} else if (a === 'clear') {
    var cur = seq.markers.getFirstMarker();
    while (cur) { var nx = seq.markers.getNextMarker(cur); seq.markers.deleteMarker(cur); cur = nx; }
} else if (a !== 'list') throw new Error('Unknown action: ' + a);
return describeSeq(seq, true).markers || [];
