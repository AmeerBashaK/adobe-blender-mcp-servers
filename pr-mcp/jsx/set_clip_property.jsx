var seq = findSeq(ARGS.sequence);
var c = findClip(seq, ARGS);
var comp = null;
for (var i = 0; i < c.components.numItems; i++) {
    var ci = c.components[i];
    if (ci.displayName === ARGS.component || ci.matchName === ARGS.component) { comp = ci; break; }
}
if (!comp) {
    var names = [];
    for (var j = 0; j < c.components.numItems; j++) names.push(c.components[j].displayName);
    if (!ARGS.component) return { components: names };
    throw new Error('Component not found: ' + ARGS.component + '. Available: ' + names.join(', '));
}
var prop = null, pnames = [];
for (var k = 0; k < comp.properties.numItems; k++) {
    pnames.push(comp.properties[k].displayName);
    if (comp.properties[k].displayName === ARGS.property) prop = comp.properties[k];
}
if (!ARGS.property) {
    var vals = {};
    for (var m = 0; m < comp.properties.numItems; m++) { try { vals[comp.properties[m].displayName] = comp.properties[m].getValue(); } catch (e) {} }
    return { component: comp.displayName, properties: vals };
}
if (!prop) throw new Error('Property not found: ' + ARGS.property + '. Available: ' + pnames.join(', '));
var keys = ARGS.keyframes;
if (keys && keys.length) {
    // Keyframe times are given in sequence seconds; Premiere wants clip media time.
    prop.setTimeVarying(true);
    for (var q = 0; q < keys.length; q++) {
        var mt = toTime(c.inPoint.seconds + (keys[q].time - c.start.seconds));
        prop.addKey(mt);
        prop.setValueAtKey(mt, keys[q].value, true);
    }
} else {
    if (prop.isTimeVarying()) prop.setTimeVarying(false);
    prop.setValue(ARGS.value, true);
}
return { clip: c.name, component: comp.displayName, property: prop.displayName, value: prop.getValue(), keyframes: keys ? keys.length : 0 };
