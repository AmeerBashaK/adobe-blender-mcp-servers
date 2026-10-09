var a = ARGS.action || 'save';
if (a === 'open') {
    if (!new File(ARGS.path).exists) throw new Error('File not found: ' + ARGS.path);
    app.openDocument(ARGS.path, true, true, true, true);
} else if (a === 'new') {
    if (!ARGS.path) throw new Error('"path" for the new .prproj is required');
    var f = new File(ARGS.path);
    if (f.parent && !f.parent.exists) f.parent.create();
    app.newProject(ARGS.path);
} else if (a === 'save') {
    requireProject().save();
} else if (a === 'save_as') {
    requireProject().saveAs(ARGS.path);
} else if (a === 'close') {
    requireProject().closeDocument(ARGS.save ? 1 : 0, false);
    return { closed: true };
} else throw new Error('Unknown action: ' + a);
return { project: app.project ? app.project.name : null, path: app.project ? app.project.path : null };
