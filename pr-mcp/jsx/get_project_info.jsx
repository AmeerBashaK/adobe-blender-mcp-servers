var o = { app: 'Premiere Pro ' + app.version };
if (!app.project || !app.project.path) { o.project = null; return o; }
o.project = { name: app.project.name, path: app.project.path };
o.sequences = [];
for (var i = 0; i < app.project.sequences.numSequences; i++) o.sequences.push(describeSeq(app.project.sequences[i], false));
var seq = null;
try { seq = ARGS.sequence ? findSeq(ARGS.sequence) : app.project.activeSequence; } catch (e) { o.sequenceError = String(e); }
o.activeSequence = seq ? describeSeq(seq, ARGS.tracks !== false) : null;
o.items = itemTree(app.project.rootItem, 0, 100);
return o;
