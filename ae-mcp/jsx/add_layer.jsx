var c = findComp(ARGS.comp);
var a = ARGS;
var dur = a.duration || c.duration;
var l;

function addShape() {
    var shape = a.shape || 'rectangle';
    if (shape !== 'rectangle' && shape !== 'ellipse') throw new Error('shape must be "rectangle" or "ellipse"');
    var size = a.size || [400, 400];
    var lay = c.layers.addShape();
    var grp = lay.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    grp.name = shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
    var vectors = function () {
        return lay.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group');
    };
    if (shape === 'ellipse') {
        vectors().addProperty('ADBE Vector Shape - Ellipse').property('ADBE Vector Ellipse Size').setValue(size);
    } else {
        var rect = vectors().addProperty('ADBE Vector Shape - Rect');
        rect.property('ADBE Vector Rect Size').setValue(size);
        if (a.roundness) rect.property('ADBE Vector Rect Roundness').setValue(a.roundness);
    }
    // Adding a property invalidates sibling references, so re-fetch the group each time.
    if (a.color !== null) {
        vectors().addProperty('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color').setValue(toColor(a.color || [1, 1, 1], true));
    }
    if (a.strokeColor !== undefined) {
        var st = vectors().addProperty('ADBE Vector Graphic - Stroke');
        st.property('ADBE Vector Stroke Color').setValue(toColor(a.strokeColor, true));
        st.property('ADBE Vector Stroke Width').setValue(a.strokeWidth || 4);
    }
    return lay;
}

switch (a.type) {
    case 'text':
        l = c.layers.addText(a.text || 'Text');
        var tp = l.property('ADBE Text Properties').property('ADBE Text Document');
        tp.setValue(applyTextDoc(tp.value, {
            fontSize: a.fontSize || 72,
            font: a.font,
            fillColor: a.color !== undefined ? a.color : [1, 1, 1],
            justification: a.justification || 'center'
        }));
        break;
    case 'solid':
    case 'adjustment':
        l = c.layers.addSolid(
            toColor(a.color !== undefined ? a.color : [1, 1, 1]),
            a.name || (a.type === 'adjustment' ? 'Adjustment Layer' : 'Solid'),
            a.width || c.width, a.height || c.height, c.pixelAspect, dur
        );
        if (a.type === 'adjustment') l.adjustmentLayer = true;
        break;
    case 'null':
        l = c.layers.addNull(dur);
        break;
    case 'shape':
        l = addShape();
        break;
    case 'camera':
        l = c.layers.addCamera(a.name || 'Camera', [c.width / 2, c.height / 2]);
        break;
    case 'light':
        l = c.layers.addLight(a.name || 'Light', [c.width / 2, c.height / 2]);
        break;
    default:
        throw new Error('Unknown layer type: ' + a.type);
}

if (a.name) l.name = a.name;
if (a.threeD && l instanceof AVLayer) l.threeDLayer = true;
if (a.position) l.property('ADBE Transform Group').property('ADBE Position').setValue(a.position);
if (a.startTime !== undefined) l.startTime = a.startTime;
if (a.duration && a.type !== 'solid' && a.type !== 'adjustment' && a.type !== 'null') l.outPoint = l.inPoint + a.duration;
return describeLayer(l);