var c = findComp(ARGS.comp);
var o = describeComp(c);
o.currentTime = c.time;
o.workAreaStart = c.workAreaStart;
o.workAreaDuration = c.workAreaDuration;
o.bgColor = c.bgColor;
o.layers = [];
for (var i = 1; i <= c.numLayers; i++) o.layers.push(describeLayer(c.layer(i)));
return o;