var c = findComp(ARGS.comp);
var rq = app.project.renderQueue;
var rqi = rq.items.add(c);
if (ARGS.render_settings_template) rqi.applyTemplate(ARGS.render_settings_template);
var om = rqi.outputModule(1);
if (ARGS.output_module_template) om.applyTemplate(ARGS.output_module_template);
om.file = new File(ARGS.output_path);
var out = { comp: c.name, queueIndex: rq.numItems, output: om.file.fsName, outputModuleTemplates: om.templates };
if (ARGS.render_now) {
    rq.render();
    out.rendered = true;
}
return out;