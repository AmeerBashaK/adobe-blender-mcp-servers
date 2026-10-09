var c = findComp(ARGS.comp);
var l = findLayer(c, ARGS.layer);
var fx = l.property('ADBE Effect Parade');
if (!fx) throw new Error('Layer "' + l.name + '" cannot have effects');
if (!fx.canAddProperty(ARGS.effect)) throw new Error('Unknown effect "' + ARGS.effect + '". Use list_effects to find the name.');
var e = fx.addProperty(ARGS.effect);
if (ARGS.name) e.name = ARGS.name;

var errors = [];
var params = ARGS.params || {};
for (var k in params) {
    if (!params.hasOwnProperty(k)) continue;
    try {
        var p = e.property(k);
        if (!p) throw new Error('no such parameter');
        setProp(p, params[k]);
    } catch (err) {
        errors.push(k + ': ' + err);
    }
}

var available = [];
for (var i = 1; i <= e.numProperties; i++) {
    var pp = e.property(i);
    if (pp.propertyType !== PropertyType.PROPERTY || pp.propertyValueType === PropertyValueType.NO_VALUE) continue;
    available.push({ name: pp.name, value: propValue(pp) });
}
var out = { layer: l.name, effect: e.name, matchName: e.matchName, parameters: available };
if (errors.length) out.errors = errors;
return out;