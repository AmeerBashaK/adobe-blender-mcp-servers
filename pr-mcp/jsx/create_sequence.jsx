requireProject();
var name = ARGS.name || 'Sequence';
var seq;
if (ARGS.items && ARGS.items.length) {
    var items = [];
    for (var i = 0; i < ARGS.items.length; i++) items.push(findItem(ARGS.items[i]));
    seq = app.project.createNewSequenceFromClips(name, items, findOrMakeBin(ARGS.bin));
} else {
    app.enableQE();
    var preset = ARGS.preset || DEFAULT_SEQ_PRESET;
    if (!new File(preset).exists) throw new Error('Sequence preset not found: ' + preset);
    qe.project.newSequence(name, preset);
    seq = null;
    for (var s = 0; s < app.project.sequences.numSequences; s++) {
        if (app.project.sequences[s].name === name) seq = app.project.sequences[s];
    }
}
if (!seq) throw new Error('Sequence was not created');
app.project.activeSequence = seq;
if (ARGS.width || ARGS.height) {
    var st = seq.getSettings();
    if (ARGS.width) st.videoFrameWidth = ARGS.width;
    if (ARGS.height) st.videoFrameHeight = ARGS.height;
    seq.setSettings(st);
}
return describeSeq(seq, true);
