var q = ARGS.query ? String(ARGS.query).toLowerCase() : null;
var out = [];
for (var i = 0; i < app.effects.length; i++) {
    var e = app.effects[i];
    if (q && (e.displayName + ' ' + e.matchName + ' ' + e.category).toLowerCase().indexOf(q) < 0) continue;
    out.push({ displayName: e.displayName, matchName: e.matchName, category: e.category });
}
return { count: out.length, effects: out.slice(0, ARGS.limit || 200) };