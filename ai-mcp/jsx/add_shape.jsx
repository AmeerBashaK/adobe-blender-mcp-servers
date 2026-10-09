var doc = findDoc(ARGS.document);
var c = containerFor(doc, ARGS);
var t = ARGS.type || 'rectangle';
var x = ARGS.x || 0, y = ARGS.y || 0, w = ARGS.width || 100, h = ARGS.height || w;
var it;
if (t === 'rectangle') it = c.pathItems.rectangle(Y(y), x, w, h);
else if (t === 'rounded_rectangle') {
    var rad = ARGS.radius !== undefined ? ARGS.radius : 12;
    it = c.pathItems.roundedRectangle(Y(y), x, w, h, rad, rad);
} else if (t === 'ellipse') it = c.pathItems.ellipse(Y(y), x, w, h);
else if (t === 'polygon') it = c.pathItems.polygon(x + w / 2, Y(y + w / 2), w / 2, ARGS.sides || 6);
else if (t === 'star') it = c.pathItems.star(x + w / 2, Y(y + w / 2), w / 2, ARGS.innerRadius || w / 4, ARGS.points || 5);
else if (t === 'line' || t === 'path') {
    var pts = ARGS.points;
    if (t === 'line' && !pts) pts = [[x, y], [x + w, y]];
    if (!pts || pts.length < 2) throw new Error('"points" [[x, y], ...] needs at least 2 points');
    var a = [];
    for (var i = 0; i < pts.length; i++) a.push([pts[i][0], Y(pts[i][1])]);
    it = c.pathItems.add();
    it.setEntirePath(a);
    it.closed = t === 'path' && ARGS.closed !== false;
    if (ARGS.smooth) {
        // Catmull-Rom style handles: each tangent is 1/6 of the vector between its neighbours.
        var n = a.length;
        for (var k = 0; k < n; k++) {
            var prev = a[k > 0 ? k - 1 : (it.closed ? n - 1 : k)];
            var next = a[k < n - 1 ? k + 1 : (it.closed ? 0 : k)];
            var tx = (next[0] - prev[0]) / 6, ty = (next[1] - prev[1]) / 6;
            var pp = it.pathPoints[k];
            pp.leftDirection = [a[k][0] - tx, a[k][1] - ty];
            pp.rightDirection = [a[k][0] + tx, a[k][1] + ty];
            pp.pointType = PointType.SMOOTH;
        }
    }
    if (t === 'line' && ARGS.fill === undefined) ARGS.fill = 'none';
    if (t === 'line' && ARGS.stroke === undefined) ARGS.stroke = '#000000';
} else throw new Error('Unknown shape type: ' + t);
if (ARGS.fill === undefined && ARGS.stroke === undefined) ARGS.fill = '#000000';
if (ARGS.stroke === undefined) ARGS.stroke = 'none';
if (ARGS.fill === undefined) ARGS.fill = 'none';
applyStyle(it, ARGS);
if (ARGS.rotate) it.rotate(ARGS.rotate);
return describeItem(it);
