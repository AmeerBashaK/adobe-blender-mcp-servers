var seq = findSeq(ARGS.sequence);
var item = findItem(ARGS.item);
var type = ARGS.type || 'video';
var tr = getTrack(seq, type, ARGS.track || 1);
if (ARGS['in'] !== undefined) item.setInPoint(ARGS['in'], 4);
if (ARGS.out !== undefined) item.setOutPoint(ARGS.out, 4);
var t = ARGS.time;
if (t === undefined) {
    t = 0;
    for (var i = 0; i < tr.clips.numItems; i++) t = Math.max(t, tr.clips[i].end.seconds);
}
var before = tr.clips.numItems;
if (ARGS.mode === 'insert') tr.insertClip(item, t);
else tr.overwriteClip(item, t);
if (ARGS['in'] !== undefined || ARGS.out !== undefined) { try { item.clearInPoint(4); item.clearOutPoint(4); } catch (e) {} }
var placed = null;
for (var k = 0; k < tr.clips.numItems; k++) {
    if (Math.abs(tr.clips[k].start.seconds - t) < 0.01) { placed = describeClip(tr.clips[k], k); break; }
}
return { sequence: seq.name, track: (type === 'audio' ? 'A' : 'V') + (ARGS.track || 1), placed: placed, clipsOnTrack: tr.clips.numItems, before: before };
