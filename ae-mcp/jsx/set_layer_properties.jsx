var c = findComp(ARGS.comp);
var l = findLayer(c, ARGS.layer);
var set = [], errors = [];

function attempt(label, fn) {
    try { fn(); set.push(label); } catch (e) { errors.push(label + ': ' + e); }
}

if (ARGS.name !== undefined) attempt('name', function () { l.name = ARGS.name; });
if (ARGS.enabled !== undefined) attempt('enabled', function () { l.enabled = ARGS.enabled; });
if (ARGS.threeD !== undefined) attempt('threeD', function () { l.threeDLayer = ARGS.threeD; });
if (ARGS.parent !== undefined) attempt('parent', function () { l.parent = ARGS.parent === null ? null : findLayer(c, ARGS.parent); });
if (ARGS.startTime !== undefined) attempt('startTime', function () { l.startTime = ARGS.startTime; });
if (ARGS.inPoint !== undefined) attempt('inPoint', function () { l.inPoint = ARGS.inPoint; });
if (ARGS.outPoint !== undefined) attempt('outPoint', function () { l.outPoint = ARGS.outPoint; });
if (ARGS.blendingMode !== undefined) attempt('blendingMode', function () {
    var m = BlendingMode[String(ARGS.blendingMode).toUpperCase().replace(/ /g, '_')];
    if (m === undefined) throw new Error('unknown blending mode');
    l.blendingMode = m;
});

var props = ARGS.properties || {};
for (var k in props) {
    if (!props.hasOwnProperty(k)) continue;
    (function (key) {
        attempt(key, function () { setProp(resolveProp(l, key), props[key]); });
    })(k);
}

var out = describeLayer(l);
out.set = set;
if (errors.length) out.errors = errors;
return out;