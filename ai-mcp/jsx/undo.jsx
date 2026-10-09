findDoc(ARGS.document);
var steps = ARGS.steps || 1;
for (var i = 0; i < steps; i++) {
    if (ARGS.redo) app.redo();
    else app.undo();
}
return { steps: steps, redo: !!ARGS.redo };
