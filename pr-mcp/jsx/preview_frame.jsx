var seq = findSeq(ARGS.sequence);
var t = ARGS.time;
if (t === undefined) t = Number(seq.getPlayerPosition().ticks) / TICKS;
var qs = qeSequence(seq);
// exportFramePNG needs a backslash path without extension; Premiere appends ".png".
var base = new File(__MCP_WORKDIR + '/frame_' + new Date().getTime()).fsName;
qs.exportFramePNG(formattedTime(seq, t), base);
return { __image: base + '.png', sequence: seq.name, time: r3(t) };
