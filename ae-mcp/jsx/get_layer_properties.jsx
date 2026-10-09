var c = findComp(ARGS.comp);
var l = findLayer(c, ARGS.layer);
var root = ARGS.path ? resolveProp(l, ARGS.path) : l;
var maxDepth = ARGS.depth || 2;

function leaf(p) {
    var o = { name: p.name, matchName: p.matchName };
    var v = propValue(p);
    if (v !== undefined) o.value = v;
    if (p.numKeys) o.numKeys = p.numKeys;
    try { if (p.canSetExpression && p.expression) o.expression = p.expression; } catch (e) {}
    return o;
}

function walk(g, d) {
    var out = [];
    for (var i = 1; i <= g.numProperties; i++) {
        var p = g.property(i);
        if (p.propertyType === PropertyType.PROPERTY) {
            out.push(leaf(p));
        } else {
            var o = { name: p.name, matchName: p.matchName, group: true };
            if (d < maxDepth) o.children = walk(p, d + 1);
            else o.numProperties = p.numProperties;
            out.push(o);
        }
    }
    return out;
}

if (root.propertyType === PropertyType.PROPERTY) return leaf(root);
return { layer: l.name, path: ARGS.path || '', properties: walk(root, 1) };