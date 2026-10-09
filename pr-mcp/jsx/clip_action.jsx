var seq = findSeq(ARGS.sequence);
var c = findClip(seq, ARGS);
var a = ARGS.action;
if (a === 'remove' || a === 'ripple_delete') {
    var n = c.name;
    c.remove(a === 'ripple_delete', true);
    return { removed: n, ripple: a === 'ripple_delete' };
} else if (a === 'move') {
    var by = ARGS.moveBy !== undefined ? ARGS.moveBy : ARGS.start - c.start.seconds;
    c.move(toTime(by));
} else if (a === 'trim') {
    if (ARGS.start !== undefined) c.start = toTime(ARGS.start);
    if (ARGS.end !== undefined) c.end = toTime(ARGS.end);
    if (ARGS['in'] !== undefined) c.inPoint = toTime(ARGS['in']);
    if (ARGS.out !== undefined) c.outPoint = toTime(ARGS.out);
} else if (a === 'rename') {
    c.name = ARGS.name;
} else if (a === 'disable' || a === 'enable') {
    c.disabled = a === 'disable';
} else if (a === 'select') {
    c.setSelected(true, true);
} else if (a === 'speed') {
    var qc = qeClipFor(seq, ARGS, c);
    qc.setSpeed(ARGS.speed / 100, '', ARGS.reverse ? true : false, false, false);
} else throw new Error('Unknown action: ' + a);
return describeClip(c, ARGS.clip);
