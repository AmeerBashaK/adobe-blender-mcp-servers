var doc = findDoc(ARGS.document);
var it = findItem(doc, ARGS.item);
if (it.typename !== 'PlacedItem' && it.typename !== 'RasterItem') throw new Error('Image Trace needs a placed or raster image, got ' + it.typename);
var plugin = it.trace();
var preset = ARGS.preset || 'Black and White Logo';
try { plugin.tracing.tracingOptions.loadFromPreset(preset); }
catch (e) { throw new Error('Unknown preset "' + preset + '". Try: [Default], High Fidelity Photo, Low Fidelity Photo, 3 Colors, 6 Colors, 16 Colors, Shades of Gray, Black and White Logo, Sketched Art, Silhouettes, Line Art, Technical Drawing'); }
var opts = plugin.tracing.tracingOptions;
if (ARGS.colors !== undefined) opts.maxColors = ARGS.colors;
if (ARGS.threshold !== undefined) opts.threshold = ARGS.threshold;
if (ARGS.ignoreWhite !== undefined) opts.ignoreWhite = ARGS.ignoreWhite;
app.redraw();
if (ARGS.expand === false) return describeItem(plugin);
var g = plugin.tracing.expandTracing();
if (ARGS.name) g.name = ARGS.name;
return describeItem(g);
