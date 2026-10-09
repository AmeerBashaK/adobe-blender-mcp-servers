var seq = findSeq(ARGS.sequence);
var c = findClip(seq, ARGS);
var qc = qeClipFor(seq, ARGS, c);
var audio = ARGS.type === 'audio';
var fx = audio ? qe.project.getAudioEffectByName(ARGS.effect) : qe.project.getVideoEffectByName(ARGS.effect);
if (!fx) throw new Error('Effect not found: ' + ARGS.effect + ' (use the English display name, e.g. "Gaussian Blur", "Lumetri Color", "Warp Stabilizer")');
if (audio) qc.addAudioEffect(fx); else qc.addVideoEffect(fx);
return describeClip(findClip(seq, ARGS), ARGS.clip);
