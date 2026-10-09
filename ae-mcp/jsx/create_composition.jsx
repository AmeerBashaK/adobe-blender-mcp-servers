var c = app.project.items.addComp(
    ARGS.name || 'Comp',
    ARGS.width || 1920,
    ARGS.height || 1080,
    ARGS.pixelAspect || 1,
    ARGS.duration || 10,
    ARGS.frameRate || 30
);
if (ARGS.bgColor !== undefined) c.bgColor = toColor(ARGS.bgColor);
if (ARGS.open !== false) c.openInViewer();
return describeComp(c);