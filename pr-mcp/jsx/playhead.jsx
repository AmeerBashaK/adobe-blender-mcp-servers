var seq = findSeq(ARGS.sequence);
if (ARGS.activate !== false && app.project.activeSequence !== seq) app.project.activeSequence = seq;
if (ARGS.time !== undefined) seq.setPlayerPosition(ticksStr(ARGS.time));
if (ARGS.in_point !== undefined) seq.setInPoint(ARGS.in_point);
if (ARGS.out_point !== undefined) seq.setOutPoint(ARGS.out_point);
var o = { sequence: seq.name, playhead: r3(Number(seq.getPlayerPosition().ticks) / TICKS) };
try {
    var ip = seq.getInPointAsTime().seconds, op = seq.getOutPointAsTime().seconds;
    o.in_point = ip >= 0 ? r3(ip) : null;
    o.out_point = op >= 0 ? r3(op) : null;
} catch (e) {}
return o;
