var c = findComp(ARGS.comp);
var l = findLayer(c, ARGS.layer);
var pr = resolveProp(l, ARGS.property);
if (!pr.canSetExpression) throw new Error('"' + ARGS.property + '" does not accept expressions');
pr.expression = ARGS.expression || '';
var out = { layer: l.name, property: pr.name, expression: pr.expression, enabled: pr.expressionEnabled };
try { if (pr.expressionError) out.expressionError = pr.expressionError; } catch (e) {}
try { out.valueNow = propValue(pr); } catch (e) {}
return out;