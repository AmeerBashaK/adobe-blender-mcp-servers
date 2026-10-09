var c = findComp(ARGS.comp);
var l = findLayer(c, ARGS.layer);
var pr = resolveProp(l, ARGS.property);
if (pr.propertyType !== PropertyType.PROPERTY || !pr.canVaryOverTime) throw new Error('"' + ARGS.property + '" cannot be keyframed');

if (ARGS.clear_existing) while (pr.numKeys > 0) pr.removeKey(1);

var kfs = ARGS.keyframes || [];
for (var i = 0; i < kfs.length; i++) pr.setValueAtTime(kfs[i].time, coerceValue(pr, kfs[i].value));

var vt = pr.propertyValueType;
var dims = vt === PropertyValueType.TwoD ? 2 : vt === PropertyValueType.ThreeD ? 3 : 1;
function ease(influence) {
    var arr = [];
    for (var d = 0; d < dims; d++) arr.push(new KeyframeEase(0, influence));
    return arr;
}

for (var j = 0; j < kfs.length; j++) {
    var mode = kfs[j].interpolation || ARGS.interpolation;
    if (!mode) continue;
    var k = pr.nearestKeyIndex(kfs[j].time);
    var KIT = KeyframeInterpolationType;
    if (mode === 'linear') pr.setInterpolationTypeAtKey(k, KIT.LINEAR, KIT.LINEAR);
    else if (mode === 'hold') pr.setInterpolationTypeAtKey(k, KIT.HOLD, KIT.HOLD);
    else {
        pr.setInterpolationTypeAtKey(k, KIT.BEZIER, KIT.BEZIER);
        var inf = kfs[j].influence || ARGS.influence || 33.33;
        var inE = mode === 'ease_out' ? pr.keyInTemporalEase(k) : ease(inf);
        var outE = mode === 'ease_in' ? pr.keyOutTemporalEase(k) : ease(inf);
        pr.setTemporalEaseAtKey(k, inE, outE);
    }
}

var keys = [];
for (var n = 1; n <= pr.numKeys; n++) {
    var kv = pr.keyValue(n);
    keys.push({ time: pr.keyTime(n), value: vt === PropertyValueType.TEXT_DOCUMENT ? kv.text : kv });
}
return { layer: l.name, property: pr.name, numKeys: pr.numKeys, keyframes: keys };