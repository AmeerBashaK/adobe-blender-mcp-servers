var c = findComp(ARGS.comp);
var l = findLayer(c, ARGS.layer);
switch (ARGS.action) {
    case 'delete':
        var name = l.name;
        l.remove();
        return { deleted: name };
    case 'duplicate':
        var d = l.duplicate();
        if (ARGS.new_name) d.name = ARGS.new_name;
        return describeLayer(d);
    case 'move_to_top':
        l.moveToBeginning();
        return describeLayer(l);
    case 'move_to_bottom':
        l.moveToEnd();
        return describeLayer(l);
    case 'move_before':
        l.moveBefore(findLayer(c, ARGS.target));
        return describeLayer(l);
    case 'move_after':
        l.moveAfter(findLayer(c, ARGS.target));
        return describeLayer(l);
    case 'precompose':
        var pc = c.layers.precompose([l.index], ARGS.new_name || (l.name + ' Comp'), true);
        return describeComp(pc);
    default:
        throw new Error('Unknown action: ' + ARGS.action);
}