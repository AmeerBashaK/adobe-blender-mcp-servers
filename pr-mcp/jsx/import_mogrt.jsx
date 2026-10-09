var seq = findSeq(ARGS.sequence);
if (!new File(ARGS.path).exists) throw new Error('File not found: ' + ARGS.path);
var vt = (ARGS.track || 1) - 1;
var clip = seq.importMGT(ARGS.path, ticksStr(ARGS.time || 0), vt, ARGS.audio_track !== undefined ? ARGS.audio_track - 1 : 0);
if (!clip) throw new Error('Import failed');
var o = describeClip(clip, null);
var mgt = clip.getMGTComponent();
if (mgt) {
    var set = ARGS.params || {};
    o.params = {};
    for (var i = 0; i < mgt.properties.numItems; i++) {
        var p = mgt.properties[i];
        if (set[p.displayName] !== undefined) {
            var v = set[p.displayName];
            // Source Text params hold a JSON document; set its textEditValue.
            try {
                var cur = p.getValue();
                if (typeof cur === 'string' && cur.charAt(0) === '{' && typeof v === 'string') {
                    var doc = eval('(' + cur + ')');
                    doc.textEditValue = v;
                    v = __json(doc);
                }
            } catch (e) {}
            p.setValue(v, true);
        }
        try { o.params[p.displayName] = p.getValue(); } catch (e2) { o.params[p.displayName] = '?'; }
    }
}
if (ARGS.duration) clip.end = toTime(clip.start.seconds + ARGS.duration);
return o;
