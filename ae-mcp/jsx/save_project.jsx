if (ARGS.path) app.project.save(new File(ARGS.path));
else if (app.project.file) app.project.save();
else throw new Error('This project has never been saved; pass "path".');
return { saved: app.project.file.fsName };