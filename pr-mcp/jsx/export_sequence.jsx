var seq = findSeq(ARGS.sequence);
var presetFile = new File(ARGS.preset || DEFAULT_EXPORT_PRESET);
if (!presetFile.exists) throw new Error('Export preset not found: ' + presetFile.fsName);
var preset = presetFile.fsName;
var out = new File(ARGS.path);
if (out.parent && !out.parent.exists) out.parent.create();
var range = { all: 0, inout: 1, workarea: 2 }[ARGS.range || 'all'];
if (ARGS.queue) {
    app.encoder.launchEncoder();
    var job = app.encoder.encodeSequence(seq, out.fsName, preset, range, 1);
    if (ARGS.start_queue !== false) app.encoder.startBatch();
    return { queued: true, job: job, output: out.fsName, note: 'Rendering in Adobe Media Encoder.' };
}
var res = seq.exportAsMediaDirect(out.fsName, preset, range);
if (!out.exists) throw new Error('Export failed: ' + res);
return { exported: out.fsName, preset: preset, sizeMB: Math.round(out.length / 1048576 * 10) / 10 };
