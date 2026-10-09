var p = new DocumentPreset();
p.title = ARGS.name || 'Untitled';
p.width = ARGS.width || 1080;
p.height = ARGS.height || 1080;
p.units = RulerUnits.Pixels;
p.colorMode = ARGS.colorMode === 'cmyk' ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB;
p.numArtboards = ARGS.artboards || 1;
if (p.numArtboards > 1) {
    p.artboardLayout = DocumentArtboardLayout.GridByRow;
    p.artboardSpacing = ARGS.spacing !== undefined ? ARGS.spacing : 40;
}
var d = app.documents.addDocument(ARGS.colorMode === 'cmyk' ? 'Print' : 'Web', p);
if (ARGS.background) {
    var ab = d.artboards[0].artboardRect;
    var bgLayer = d.layers.add();
    bgLayer.name = 'Background';
    bgLayer.zOrder(ZOrderMethod.SENDTOBACK);
    for (var i = 0; i < d.artboards.length; i++) {
        var r = d.artboards[i].artboardRect;
        var rect = bgLayer.pathItems.rectangle(r[1], r[0], r[2] - r[0], r[1] - r[3]);
        rect.stroked = false;
        rect.fillColor = toColor(ARGS.background);
        rect.name = 'Background';
    }
    bgLayer.locked = true;
    d.activeLayer = d.layers[0];
}
return describeDoc(d, true);
