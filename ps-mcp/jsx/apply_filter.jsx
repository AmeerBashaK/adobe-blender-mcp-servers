var doc = findDoc(ARGS.document);
var l = findLayer(doc, ARGS.layer);
doc.activeLayer = l;
if (l.typename !== 'ArtLayer') throw new Error('Filters apply to a single layer, not a group: ' + l.name);
var p = ARGS.params || {};
var f = ARGS.filter;

function num(k, def) { return p[k] !== undefined ? p[k] : def; }

if (f === 'hue_saturation' || f === 'colorize') {
    var hd = new ActionDescriptor();
    hd.putBoolean(charIDToTypeID('Clrz'), f === 'colorize');
    var list = new ActionList();
    var a = new ActionDescriptor();
    a.putInteger(charIDToTypeID('H   '), num('hue', 0));
    a.putInteger(charIDToTypeID('Strt'), num('saturation', f === 'colorize' ? 25 : 0));
    a.putInteger(charIDToTypeID('Lght'), num('lightness', 0));
    list.putObject(charIDToTypeID('Hst2'), a);
    hd.putList(charIDToTypeID('Adjs'), list);
    executeAction(charIDToTypeID('HStr'), hd, DialogModes.NO);
} else if (f === 'gaussian_blur') l.applyGaussianBlur(num('radius', 5));
else if (f === 'motion_blur') l.applyMotionBlur(num('angle', 0), num('radius', 20));
else if (f === 'radial_blur') l.applyRadialBlur(num('amount', 10), RadialBlurMethod.SPIN, RadialBlurQuality.GOOD);
else if (f === 'add_noise') l.applyAddNoise(num('amount', 5), NoiseDistribution.GAUSSIAN, num('monochromatic', true));
else if (f === 'median') l.applyMedianNoise(num('radius', 2));
else if (f === 'unsharp_mask') l.applyUnSharpMask(num('amount', 80), num('radius', 1), num('threshold', 0));
else if (f === 'sharpen') l.applySharpen();
else if (f === 'high_pass') l.applyHighPass(num('radius', 3));
else if (f === 'brightness_contrast') l.adjustBrightnessContrast(num('brightness', 0), num('contrast', 0));
else if (f === 'levels') l.adjustLevels(num('inputBlack', 0), num('inputWhite', 255), num('gamma', 1), num('outputBlack', 0), num('outputWhite', 255));
else if (f === 'desaturate') l.desaturate();
else if (f === 'invert') l.invert();
else if (f === 'auto_levels') l.autoLevels();
else if (f === 'auto_contrast') l.autoContrast();
else if (f === 'posterize') l.posterize(num('levels', 4));
else if (f === 'threshold') l.threshold(num('level', 128));
else if (f === 'photo_filter') l.photoFilter(toColor(p.color || '#ec8a00'), num('density', 25), num('preserveLuminosity', true));
else throw new Error('Unknown filter: ' + f);
return describeLayer(l, l.name, false);
