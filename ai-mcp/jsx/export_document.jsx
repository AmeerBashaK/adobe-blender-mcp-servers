var doc = findDoc(ARGS.document);
var path = ARGS.path;
var fmt = (ARGS.format || path.substr(path.lastIndexOf('.') + 1)).toLowerCase();
var f = new File(path);
if (f.parent && !f.parent.exists) f.parent.create();
if (ARGS.artboard !== undefined) doc.artboards.setActiveArtboardIndex(ARGS.artboard);
var scale = ARGS.scale || 100;
if (fmt === 'png') {
    var p = new ExportOptionsPNG24();
    p.antiAliasing = true;
    p.transparency = ARGS.transparent !== false;
    p.artBoardClipping = true;
    p.horizontalScale = scale;
    p.verticalScale = scale;
    doc.exportFile(f, ExportType.PNG24, p);
} else if (fmt === 'jpg' || fmt === 'jpeg') {
    var j = new ExportOptionsJPEG();
    j.antiAliasing = true;
    j.artBoardClipping = true;
    j.qualitySetting = ARGS.quality !== undefined ? ARGS.quality : 90;
    j.horizontalScale = scale;
    j.verticalScale = scale;
    doc.exportFile(f, ExportType.JPEG, j);
} else if (fmt === 'svg') {
    var s = new ExportOptionsSVG();
    s.embedRasterImages = true;
    s.fontType = ARGS.outlineFonts ? SVGFontType.OUTLINEFONT : SVGFontType.SVGFONT;
    s.cssProperties = SVGCSSPropertyLocation.STYLEATTRIBUTES;
    s.saveMultipleArtboards = false;
    doc.exportFile(f, ExportType.SVG, s);
} else throw new Error('Unsupported export format: ' + fmt + ' (png, jpg, svg; use save_document for .ai/.pdf)');
return { exported: f.fsName, format: fmt };
